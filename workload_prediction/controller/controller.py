"""
PrivacyMesh Workload Scaling Controller.

Reconciles predicted KYC workload demand from the predictor microservice
and dynamically updates ONLY the spec.minReplicas field of backend-hpa.

Preserves:
- spec.maxReplicas = 4
- Reactive CPU 60% metric and behavior
- All pods and databases (zero direct pod deletions)
- Safe fallback (holds last known safe capacity during outages)
- Configurable cooldown on scale-down (anti-flapping)
"""

import json
import logging
import os
import sys
import time
from typing import Optional, Tuple
import requests

from prometheus_client import Counter, Gauge, start_http_server

from config import (
    ABSOLUTE_MAX_REPLICAS,
    ABSOLUTE_MIN_REPLICAS,
    HPA_NAME,
    HPA_NAMESPACE,
    METRICS_PORT,
    PREDICTOR_URL,
    RECONCILE_INTERVAL_SECONDS,
    SCALE_DOWN_COOLDOWN_SECONDS,
    SCALING_PREDICTION_SOURCE,
    THRESHOLD_REPLICAS_2,
    THRESHOLD_REPLICAS_3,
    THRESHOLD_REPLICAS_4,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [WorkloadController] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("WorkloadController")

# Prometheus Metrics
RECOMMENDED_MIN_REPLICAS = Gauge(
    "privacymesh_controller_recommended_min_replicas",
    "Recommended minimum replica count determined from predicted KYC workload demand",
)

APPLIED_MIN_REPLICAS = Gauge(
    "privacymesh_controller_applied_min_replicas",
    "Current minReplicas value actively applied to the backend HPA",
)

HPA_CURRENT_REPLICAS = Gauge(
    "privacymesh_controller_hpa_current_replicas",
    "Current active pod replicas reported by the backend HPA status",
)

SCALING_DEMAND_USED = Gauge(
    "privacymesh_controller_demand_used_for_scaling",
    "Demand value actively used to compute recommended minReplicas (submissions/5m)",
)

XGBOOST_DEMAND = Gauge(
    "privacymesh_controller_xgboost_demand_5m",
    "XGBoost predicted KYC demand (submissions/5m)",
)

PERSISTENCE_DEMAND = Gauge(
    "privacymesh_controller_persistence_demand_5m",
    "Persistence baseline KYC demand (submissions/5m)",
)

RECONCILIATION_TOTAL = Counter(
    "privacymesh_controller_reconciliation_total",
    "Total number of reconciliation cycles executed by the controller",
)

RECONCILIATION_ERRORS = Counter(
    "privacymesh_controller_reconciliation_errors_total",
    "Total number of errors encountered during reconciliation cycles",
)

CONTROLLER_HEALTH = Gauge(
    "privacymesh_controller_health_status",
    "Controller operational health status (1 = healthy, 0 = degraded/holding fallback)",
)


class WorkloadScalingController:
    def __init__(self):
        self.k8s_api = None
        self.last_known_safe_min_replicas = ABSOLUTE_MIN_REPLICAS
        self.current_applied_min_replicas = ABSOLUTE_MIN_REPLICAS
        self.low_demand_start_time: Optional[float] = None
        self.pending_lower_target: Optional[int] = None
        self._init_kubernetes_client()

    def _init_kubernetes_client(self):
        """Initialize in-cluster or local kubeconfig client."""
        try:
            from kubernetes import client, config
            try:
                config.load_incluster_config()
                logger.info("Loaded in-cluster Kubernetes configuration")
            except Exception:
                config.load_kube_config()
                logger.info("Loaded external kubeconfig")
            self.k8s_api = client.AutoscalingV2Api()
        except Exception as e:
            logger.warning("Could not initialize Kubernetes client: %s. Controller will run in dry-run mode if unconfigured.", e)
            self.k8s_api = None

    def map_demand_to_min_replicas(self, predicted_demand: float) -> int:
        """
        Map predicted 5m KYC demand to recommended minimum replica count.
        Note: Thresholds are experimental starting values and configurable.
        """
        if predicted_demand <= THRESHOLD_REPLICAS_2:
            rec = 1
        elif predicted_demand <= THRESHOLD_REPLICAS_3:
            rec = 2
        elif predicted_demand <= THRESHOLD_REPLICAS_4:
            rec = 3
        else:
            rec = 4

        # Enforce bounds [1, 4]
        return max(ABSOLUTE_MIN_REPLICAS, min(ABSOLUTE_MAX_REPLICAS, rec))

    def fetch_predicted_demand(self) -> Tuple[Optional[float], bool]:
        """
        Query predictor microservice for upcoming KYC submission forecast.
        Selects either the safe persistence baseline (default) or XGBoost prediction
        based on SCALING_PREDICTION_SOURCE.
        Returns (chosen_demand, success_flag).
        """
        url = f"{PREDICTOR_URL.rstrip('/')}/predict"
        try:
            resp = requests.get(url, timeout=5.0)
            if resp.status_code == 200:
                data = resp.json()
                xgb_val = float(data.get("predicted_kyc_demand_5m", 0.0))
                pers_val = float(data.get("baseline_persistence_demand", 0.0))

                # Record both metrics for comparative monitoring
                XGBOOST_DEMAND.set(max(0.0, xgb_val))
                PERSISTENCE_DEMAND.set(max(0.0, pers_val))

                if SCALING_PREDICTION_SOURCE.lower() == "xgboost":
                    chosen = xgb_val
                    logger.info("Scaling source: XGBoost (%.2f reqs/5m, baseline was %.2f)", chosen, pers_val)
                else:
                    chosen = pers_val
                    logger.info("Scaling source: Persistence Baseline [Safe Reference] (%.2f reqs/5m, XGBoost was %.2f)", chosen, xgb_val)

                if chosen >= 0.0 and not (chosen != chosen):
                    SCALING_DEMAND_USED.set(chosen)
                    return chosen, True
            logger.warning("Predictor returned non-200 or invalid payload: %s", resp.text[:200])
        except Exception as e:
            logger.warning("Failed to reach predictor microservice at %s: %s", url, e)

        return None, False

    def get_current_hpa_state(self) -> Tuple[int, int]:
        """
        Fetch current (minReplicas, currentReplicas) from backend-hpa.
        If K8s API fails, returns (last_known_safe_min_replicas, 1).
        """
        if self.k8s_api is None:
            return self.current_applied_min_replicas, 1

        try:
            hpa = self.k8s_api.read_namespaced_horizontal_pod_autoscaler(
                name=HPA_NAME,
                namespace=HPA_NAMESPACE,
            )
            min_reps = hpa.spec.min_replicas or 1
            curr_reps = hpa.status.current_replicas or min_reps
            return min_reps, curr_reps
        except Exception as e:
            logger.error("Failed to read HPA %s in namespace %s: %s", HPA_NAME, HPA_NAMESPACE, e)
            return self.current_applied_min_replicas, 1

    def patch_hpa_min_replicas(self, new_min_replicas: int) -> bool:
        """
        Apply least-privilege partial JSON merge patch modifying ONLY spec.minReplicas.
        Preserves maxReplicas, metrics, behavior, and pods.
        """
        if self.k8s_api is None:
            logger.info("[Dry-Run] Would patch %s minReplicas -> %d", HPA_NAME, new_min_replicas)
            self.current_applied_min_replicas = new_min_replicas
            return True

        bounded_val = max(ABSOLUTE_MIN_REPLICAS, min(ABSOLUTE_MAX_REPLICAS, new_min_replicas))
        patch_body = {"spec": {"minReplicas": bounded_val}}

        try:
            self.k8s_api.patch_namespaced_horizontal_pod_autoscaler(
                name=HPA_NAME,
                namespace=HPA_NAMESPACE,
                body=patch_body,
            )
            self.current_applied_min_replicas = bounded_val
            logger.info("Successfully patched %s spec.minReplicas to %d", HPA_NAME, bounded_val)
            return True
        except Exception as e:
            logger.error("Failed to patch HPA %s minReplicas: %s", HPA_NAME, e)
            return False

    def reconcile_cycle(self) -> int:
        """
        Execute one reconciliation loop.
        Returns the resolved minReplicas target.
        """
        RECONCILIATION_TOTAL.inc()
        now = time.time()

        # Step 1: Read current HPA state
        current_hpa_min, current_hpa_active = self.get_current_hpa_state()
        self.current_applied_min_replicas = current_hpa_min
        HPA_CURRENT_REPLICAS.set(current_hpa_active)
        APPLIED_MIN_REPLICAS.set(current_hpa_min)

        # Step 2: Fetch predicted demand
        pred_demand, success = self.fetch_predicted_demand()

        if not success or pred_demand is None:
            # Rule 4: Outage / Failure -> HOLD last known safe capacity! Never downscale automatically!
            CONTROLLER_HEALTH.set(0.0)
            RECONCILIATION_ERRORS.inc()
            logger.warning(
                "Degraded state: holding last known safe minReplicas=%d during outage",
                self.last_known_safe_min_replicas,
            )
            RECOMMENDED_MIN_REPLICAS.set(self.last_known_safe_min_replicas)
            return self.last_known_safe_min_replicas

        CONTROLLER_HEALTH.set(1.0)

        # Step 3: Compute recommended minReplicas from configured thresholds
        recommended = self.map_demand_to_min_replicas(pred_demand)
        RECOMMENDED_MIN_REPLICAS.set(recommended)
        logger.info(
            "Prediction=%.2f reqs/5m -> Recommended minReplicas=%d (Current HPA min=%d, active pods=%d)",
            pred_demand, recommended, current_hpa_min, current_hpa_active,
        )

        # Update last known safe capacity if recommended is healthy
        self.last_known_safe_min_replicas = recommended

        # Step 4: Evaluate scaling direction and hysteresis cooldown
        if recommended > current_hpa_min:
            # Scale-Up: Immediate pre-warming without delay
            self.low_demand_start_time = None
            self.pending_lower_target = None
            logger.info("Scale-up triggered: immediately applying minReplicas=%d", recommended)
            if self.patch_hpa_min_replicas(recommended):
                APPLIED_MIN_REPLICAS.set(recommended)
            return recommended

        elif recommended < current_hpa_min:
            # Scale-Down: Anti-flapping hysteresis cooldown check
            if self.pending_lower_target != recommended:
                self.pending_lower_target = recommended
                self.low_demand_start_time = now
                logger.info(
                    "Potential scale-down to %d detected. Starting %ds cooldown timer.",
                    recommended, SCALE_DOWN_COOLDOWN_SECONDS,
                )
                return current_hpa_min

            elapsed = now - (self.low_demand_start_time or now)
            if elapsed < SCALE_DOWN_COOLDOWN_SECONDS:
                logger.info(
                    "Cooldown in progress (%.1fs / %ds). Holding minReplicas=%d",
                    elapsed, SCALE_DOWN_COOLDOWN_SECONDS, current_hpa_min,
                )
                return current_hpa_min
            else:
                logger.info("Cooldown elapsed (%.1fs). Applying scale-down to minReplicas=%d", elapsed, recommended)
                self.low_demand_start_time = None
                self.pending_lower_target = None
                if self.patch_hpa_min_replicas(recommended):
                    APPLIED_MIN_REPLICAS.set(recommended)
                return recommended
        else:
            # Steady state: No change needed
            self.low_demand_start_time = None
            self.pending_lower_target = None
            return current_hpa_min

    def run_forever(self):
        """Start Prometheus metrics server and run reconciliation loop."""
        logger.info("Starting controller metrics HTTP server on port %d", METRICS_PORT)
        start_http_server(METRICS_PORT)
        logger.info(
            "Workload Scaling Controller active. Reconcile interval: %ds, Cooldown: %ds",
            RECONCILE_INTERVAL_SECONDS, SCALE_DOWN_COOLDOWN_SECONDS,
        )

        while True:
            try:
                self.reconcile_cycle()
            except Exception as e:
                CONTROLLER_HEALTH.set(0.0)
                RECONCILIATION_ERRORS.inc()
                logger.error("Unexpected error in reconciliation cycle: %s", e)
            time.sleep(RECONCILE_INTERVAL_SECONDS)


if __name__ == "__main__":
    controller = WorkloadScalingController()
    controller.run_forever()
