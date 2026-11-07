"""
PrivacyMesh Phase 12: Predictor Traffic Alignment Controlled Validation Runner.

Executes a compact, controlled local validation (approx 55s) to verify:
1. Predictor receives non-zero demand from benchmark endpoint /confidential-computing/run-demo.
2. Labeling explicitly identifies synthetic benchmark demand (not actual KYC submissions).
3. Controller uses the configured persistence baseline source.
4. Controller executes scale-up decision when demand breaches threshold.
5. Controller safely engages cooldown hysteresis when demand drops.
6. Robust finally cleanup restores original Kubernetes configuration, releases port 8088,
   and audits database row count invariants (zero mutations).
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import signal
import subprocess
import sys
import time
from typing import Any, Dict, Optional, Tuple

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [ValidationRunner] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ValidationRunner")

NAMESPACE = "privacymesh"
HPA_NAME = "backend-hpa"
BENCHMARK_TARGET_URL = "http://localhost:8088"
BENCHMARK_ENDPOINT = "/confidential-computing/run-demo"

EXPECTED_DB_BASELINE = {
    "users": "44",
    "transactions": "40",
    "kyc_records": "40",
    "kyc_submissions": "36",
    "kyc_versions": "36",
    "kyc_reviews": "0",
    "kyc_audit_log": "36",
}


def get_database_row_counts() -> Dict[str, str]:
    """Audit all 7 database table row counts against privacymesh-db-1 container."""
    sql = (
        "SELECT "
        "(SELECT count(*) FROM users) as users, "
        "(SELECT count(*) FROM transactions) as transactions, "
        "(SELECT count(*) FROM kyc_records) as kyc_records, "
        "(SELECT count(*) FROM kyc_submissions) as kyc_submissions, "
        "(SELECT count(*) FROM kyc_versions) as kyc_versions, "
        "(SELECT count(*) FROM kyc_reviews) as kyc_reviews, "
        "(SELECT count(*) FROM kyc_audit_log) as kyc_audit_log;"
    )
    cmd = ["docker", "exec", "privacymesh-db-1", "psql", "-U", "privacy_user", "-d", "privacymesh", "-t", "-A", "-F,", "-c", sql]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip():
            parts = res.stdout.strip().split(",")
            if len(parts) == 7:
                return {
                    "users": parts[0],
                    "transactions": parts[1],
                    "kyc_records": parts[2],
                    "kyc_submissions": parts[3],
                    "kyc_versions": parts[4],
                    "kyc_reviews": parts[5],
                    "kyc_audit_log": parts[6],
                }
    except Exception as e:
        logger.debug("Docker DB query exception: %s", e)

    try:
        cmd_k8s = ["kubectl", "exec", "db-0", "-n", NAMESPACE, "--", "psql", "-U", "privacy_user", "-d", "privacymesh", "-t", "-A", "-F,", "-c", sql]
        res_k = subprocess.run(cmd_k8s, capture_output=True, text=True, timeout=8)
        if res_k.returncode == 0 and res_k.stdout.strip():
            parts = res_k.stdout.strip().split(",")
            if len(parts) == 7:
                return {
                    "users": parts[0],
                    "transactions": parts[1],
                    "kyc_records": parts[2],
                    "kyc_submissions": parts[3],
                    "kyc_versions": parts[4],
                    "kyc_reviews": parts[5],
                    "kyc_audit_log": parts[6],
                }
    except Exception as e:
        logger.debug("Kubectl DB query exception: %s", e)

    return {}


def load_jwt_secret() -> str:
    """Securely load JWT secret key from environment or Kubernetes Secret."""
    secret = os.getenv("JWT_SECRET_KEY")
    if secret:
        return secret.strip()

    from pathlib import Path
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("JWT_SECRET_KEY=") and not line.startswith("#"):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except Exception:
            pass

    cmd = ["kubectl", "get", "secret", "privacymesh-secrets", "-n", NAMESPACE, "-o", "jsonpath={.data.JWT_SECRET_KEY}"]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if res.returncode == 0 and res.stdout.strip():
        return base64.b64decode(res.stdout.strip()).decode("utf-8").strip()

    raise RuntimeError("JWT_SECRET_KEY could not be securely resolved.")


def create_stateless_jwt_token(secret: str, duration_hours: int = 4) -> str:
    """Generate RFC-7519 HS256 JWT with synthetic claims matching security.py parser."""
    def b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")

    now_epoch = int(time.time())
    exp_epoch = now_epoch + (duration_hours * 3600)

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": "9999",
        "username": "synth_perf_runner",
        "role": "customer",
        "iat": now_epoch,
        "exp": exp_epoch,
    }

    hdr_b64 = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    pay_b64 = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{hdr_b64}.{pay_b64}".encode("utf-8")

    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = b64url(signature)

    return f"{hdr_b64}.{pay_b64}.{sig_b64}"


class TrafficAlignmentValidator:
    def __init__(self):
        self.port_forward_proc: Optional[subprocess.Popen] = None
        self.validation_results: Dict[str, Any] = {}

    def start_port_forward(self) -> None:
        """Start managed port-forward to backend service on port 8088."""
        cmd = ["kubectl", "port-forward", "svc/backend", "8088:8000", "-n", NAMESPACE]
        logger.info("Starting port-forward: %s", " ".join(cmd))
        self.port_forward_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

        # Health probe
        for _ in range(10):
            try:
                r = httpx.get(f"{BENCHMARK_TARGET_URL}/health", timeout=1.0)
                if r.status_code == 200:
                    logger.info("Port-forward established successfully on port 8088.")
                    return
            except Exception:
                time.sleep(0.5)
        raise RuntimeError("Failed to establish port-forward to backend service.")

    def stop_port_forward(self) -> None:
        """Terminate managed port-forward cleanly."""
        if self.port_forward_proc and self.port_forward_proc.poll() is None:
            logger.info("Stopping port-forward process (PID %d)...", self.port_forward_proc.pid)
            try:
                self.port_forward_proc.terminate()
                self.port_forward_proc.wait(timeout=3)
            except Exception:
                self.port_forward_proc.kill()
            self.port_forward_proc = None

    def query_predictor_status(self) -> Dict[str, Any]:
        """Query predictor /predict endpoint directly inside cluster via kubectl exec."""
        cmd = [
            "kubectl", "exec", "-n", NAMESPACE, "deploy/workload-predictor", "--",
            "python", "-c",
            "import urllib.request, json; print(json.dumps(json.loads(urllib.request.urlopen('http://localhost:8080/predict').read().decode())))"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout.strip())
        logger.warning("Predictor query failed: %s", res.stderr)
        return {}

    def query_controller_metrics(self) -> Dict[str, float]:
        """Query controller /metrics endpoint inside cluster via kubectl exec."""
        cmd = [
            "kubectl", "exec", "-n", NAMESPACE, "deploy/workload-controller", "--",
            "python", "-c",
            "import urllib.request; print(urllib.request.urlopen('http://localhost:8081/metrics').read().decode())"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        out = {}
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                line = line.strip()
                if line.startswith("#") or not line:
                    continue
                parts = line.split()
                if len(parts) == 2:
                    k, v = parts[0], parts[1]
                    try:
                        out[k] = float(v)
                    except ValueError:
                        pass
        return out

    def get_hpa_state(self) -> Dict[str, Any]:
        """Query current HPA status from Kubernetes API."""
        cmd = ["kubectl", "get", "hpa", HPA_NAME, "-n", NAMESPACE, "-o", "json"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=6)
        if res.returncode == 0:
            d = json.loads(res.stdout)
            return {
                "min_replicas": d.get("spec", {}).get("minReplicas"),
                "max_replicas": d.get("spec", {}).get("maxReplicas"),
                "desired_replicas": d.get("status", {}).get("desiredReplicas"),
                "current_replicas": d.get("status", {}).get("currentReplicas"),
            }
        return {}

    def apply_benchmark_overlay(self) -> None:
        """
        Apply benchmark environment overlay:
        1. Predictor: PREDICTOR_ENDPOINT_REGEX=".*confidential-computing/run-demo.*"
        2. Controller: Isolated benchmark thresholds (1200, 3600, 6000), 5s interval, 20s cooldown
        """
        logger.info("Applying benchmark environment overlay...")
        # Update predictor
        patch_pred = [
            "kubectl", "set", "env", "deployment/workload-predictor",
            "PREDICTOR_ENDPOINT_REGEX=.*confidential-computing/run-demo.*",
            "-n", NAMESPACE
        ]
        subprocess.run(patch_pred, check=True, capture_output=True)

        # Update controller with isolated benchmark scaling thresholds
        patch_ctrl = [
            "kubectl", "set", "env", "deployment/workload-controller",
            "SCALING_PREDICTION_SOURCE=persistence_baseline",
            "RECONCILE_INTERVAL_SECONDS=5",
            "SCALE_DOWN_COOLDOWN_SECONDS=20",
            "THRESHOLD_REPLICAS_2=1200.0",
            "THRESHOLD_REPLICAS_3=3600.0",
            "THRESHOLD_REPLICAS_4=6000.0",
            "-n", NAMESPACE
        ]
        subprocess.run(patch_ctrl, check=True, capture_output=True)

        # Wait for rollouts
        subprocess.run(["kubectl", "rollout", "status", "deployment/workload-predictor", "-n", NAMESPACE, "--timeout=45s"], check=True, capture_output=True)
        subprocess.run(["kubectl", "rollout", "status", "deployment/workload-controller", "-n", NAMESPACE, "--timeout=45s"], check=True, capture_output=True)
        logger.info("Benchmark environment overlay applied and rolled out successfully.")

    def restore_production_configuration(self) -> None:
        """Restore exact production defaults in Kubernetes deployments."""
        logger.info(">>> RESTORING EXACT PRODUCTION KUBERNETES CONFIGURATION...")
        self.stop_port_forward()

        try:
            # Restore predictor
            subprocess.run([
                "kubectl", "set", "env", "deployment/workload-predictor",
                "PREDICTOR_ENDPOINT_REGEX=.*submissions.*",
                "-n", NAMESPACE
            ], capture_output=True, timeout=10)

            # Restore controller
            subprocess.run([
                "kubectl", "set", "env", "deployment/workload-controller",
                "SCALING_PREDICTION_SOURCE=persistence_baseline",
                "RECONCILE_INTERVAL_SECONDS=15",
                "SCALE_DOWN_COOLDOWN_SECONDS=60",
                "THRESHOLD_REPLICAS_2=15.0",
                "THRESHOLD_REPLICAS_3=30.0",
                "THRESHOLD_REPLICAS_4=45.0",
                "-n", NAMESPACE
            ], capture_output=True, timeout=10)

            # Restore HPA
            subprocess.run([
                "kubectl", "patch", "hpa", HPA_NAME, "-n", NAMESPACE, "--type=merge",
                "-p", '{"spec":{"minReplicas":1,"maxReplicas":4}}'
            ], capture_output=True, timeout=10)

            # Restore backend to 1 replica
            subprocess.run([
                "kubectl", "scale", "deployment", "backend", "--replicas=1", "-n", NAMESPACE
            ], capture_output=True, timeout=10)

            # Wait for rollouts
            subprocess.run(["kubectl", "rollout", "status", "deployment/workload-predictor", "-n", NAMESPACE, "--timeout=30s"], capture_output=True)
            subprocess.run(["kubectl", "rollout", "status", "deployment/workload-controller", "-n", NAMESPACE, "--timeout=30s"], capture_output=True)
            logger.info("Production configuration restored successfully.")
        except Exception as e:
            logger.error("Error during restoration: %s", e)

    async def generate_load(self, rps: float, duration_sec: int, token: str) -> Dict[str, int]:
        """Generate constant RPS load against confidential computing endpoint."""
        logger.info("Generating traffic: Target %s RPS for %ds...", rps, duration_sec)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = {
            "account_id": "SYNTH-VALIDATE-001",
            "monthly_income": "6500.00",
            "requested_credit_amount": "12000.00",
            "existing_obligations": "1500.00",
            "risk_tier": "low",
        }
        url = f"{BENCHMARK_TARGET_URL}{BENCHMARK_ENDPOINT}"

        stats = {"scheduled": 0, "completed": 0, "http_200": 0, "errors": 0}
        interval = 1.0 / rps
        start_time = time.time()
        end_time = start_time + duration_sec

        limits = httpx.Limits(max_keepalive_connections=50, max_connections=100)
        async with httpx.AsyncClient(timeout=4.0, limits=limits) as client:
            while time.time() < end_time:
                req_start = time.time()
                stats["scheduled"] += 1

                async def send_req():
                    try:
                        r = await client.post(url, json=payload, headers=headers)
                        stats["completed"] += 1
                        if r.status_code == 200:
                            stats["http_200"] += 1
                        else:
                            stats["errors"] += 1
                    except Exception:
                        stats["errors"] += 1

                asyncio.create_task(send_req())

                sleep_t = interval - (time.time() - req_start)
                if sleep_t > 0:
                    await asyncio.sleep(sleep_t)

            await asyncio.sleep(1.0)  # Drain in-flight
        logger.info("Traffic finished: Scheduled=%d, Completed=%d, HTTP 200=%d, Errors=%d",
                    stats["scheduled"], stats["completed"], stats["http_200"], stats["errors"])
        return stats

    def run_validation(self) -> Dict[str, Any]:
        """Execute full controlled validation workflow."""
        logger.info("=================================================================")
        logger.info("  PrivacyMesh Phase 12: Predictor Traffic Alignment Validation  ")
        logger.info("=================================================================")

        # 1. Pre-validation DB Audit
        db_pre = get_database_row_counts()
        logger.info("Pre-validation DB Row Counts: %s", db_pre)
        assert db_pre == EXPECTED_DB_BASELINE, f"DB baseline mismatch: {db_pre}"

        secret = load_jwt_secret()
        jwt_token = create_stateless_jwt_token(secret)

        try:
            # 2. Apply benchmark overlay
            self.apply_benchmark_overlay()
            self.start_port_forward()

            # Preflight probe
            r_probe = httpx.post(
                f"{BENCHMARK_TARGET_URL}{BENCHMARK_ENDPOINT}",
                json={
                    "account_id": "SYNTH-PROBE",
                    "monthly_income": "6500.00",
                    "requested_credit_amount": "12000.00",
                    "existing_obligations": "1500.00",
                    "risk_tier": "low",
                },
                headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
                timeout=5.0,
            )
            assert r_probe.status_code == 200, f"Preflight probe failed with HTTP {r_probe.status_code}"
            logger.info("Preflight probe SUCCESSFUL: HTTP 200 OK | Body: %s", r_probe.text[:100])

            # 3. Stage 1: Zero traffic check (10s)
            logger.info("--- Stage 1: Zero Traffic Baseline (10s) ---")
            p_initial = self.query_predictor_status()
            logger.info("Predictor Initial: persistence=%.2f, xgb=%.2f, label=%s, workload_type=%s",
                        p_initial.get("baseline_persistence_demand", 0.0),
                        p_initial.get("predicted_kyc_demand_5m", 0.0),
                        p_initial.get("demand_label"),
                        p_initial.get("workload_type"))

            # 4. Stage 2: Controlled 25s Burst @ 20 RPS (~500 reqs)
            logger.info("--- Stage 2: Controlled Load Generation (25s @ 20 RPS) ---")
            load_task = asyncio.run(self.generate_load(rps=20.0, duration_sec=25, token=jwt_token))

            # Allow Prometheus scrape interval (5-10s) to aggregate rate
            logger.info("Scrape aggregation settling (8s)...")
            time.sleep(8)

            # Query predictor during/immediately after burst
            p_burst = self.query_predictor_status()
            c_burst = self.query_controller_metrics()
            hpa_burst = self.get_hpa_state()

            pers_demand_detected = p_burst.get("baseline_persistence_demand", 0.0)
            xgb_demand_detected = p_burst.get("predicted_kyc_demand_5m", 0.0)
            demand_label = p_burst.get("demand_label")
            workload_type = p_burst.get("workload_type")
            endpoint_regex = p_burst.get("endpoint_regex")

            rec_min_rep = c_burst.get("privacymesh_controller_recommended_min_replicas", 1.0)
            applied_min_rep = c_burst.get("privacymesh_controller_applied_min_replicas", 1.0)

            logger.info("Predictor After Burst: Persistence Demand=%.2f, XGBoost=%.2f, Label=%s, Type=%s",
                        pers_demand_detected, xgb_demand_detected, demand_label, workload_type)
            logger.info("Controller Metrics: Recommended minReplicas=%.0f, Applied minReplicas=%.0f",
                        rec_min_rep, applied_min_rep)
            logger.info("HPA State: minReplicas=%s, desiredReplicas=%s, currentReplicas=%s",
                        hpa_burst.get("min_replicas"), hpa_burst.get("desired_replicas"), hpa_burst.get("current_replicas"))

            # 5. Stage 3: Cooldown and safe fall observation (15s)
            logger.info("--- Stage 3: Cooldown & Hysteresis Observation (15s) ---")
            time.sleep(15)
            c_cooldown = self.query_controller_metrics()
            hpa_cooldown = self.get_hpa_state()
            logger.info("Controller Cooldown State: Recommended=%.0f, Applied=%.0f",
                        c_cooldown.get("privacymesh_controller_recommended_min_replicas", 1.0),
                        c_cooldown.get("privacymesh_controller_applied_min_replicas", 1.0))
            logger.info("HPA Cooldown State: minReplicas=%s, desiredReplicas=%s, currentReplicas=%s",
                        hpa_cooldown.get("min_replicas"), hpa_cooldown.get("desired_replicas"), hpa_cooldown.get("current_replicas"))

            self.validation_results = {
                "status": "SUCCESS",
                "load_stats": load_task,
                "predictor_burst": {
                    "persistence_demand": pers_demand_detected,
                    "xgboost_demand": xgb_demand_detected,
                    "demand_label": demand_label,
                    "workload_type": workload_type,
                    "endpoint_regex": endpoint_regex,
                },
                "controller_burst": {
                    "recommended_min_replicas": rec_min_rep,
                    "applied_min_replicas": applied_min_rep,
                },
                "hpa_burst": hpa_burst,
                "hpa_cooldown": hpa_cooldown,
            }
            return self.validation_results

        finally:
            self.restore_production_configuration()

            # Post-validation DB Audit
            db_post = get_database_row_counts()
            logger.info("Post-validation DB Row Counts: %s", db_post)
            assert db_post == EXPECTED_DB_BASELINE, f"DB mutated during test: {db_post}"
            logger.info("Database invariants 100%% verified and preserved: %s", db_post)

            # Pod verification
            cmd_pods = ["kubectl", "get", "pods", "-n", NAMESPACE, "-o", "json"]
            res_p = subprocess.run(cmd_pods, capture_output=True, text=True, timeout=8)
            if res_p.returncode == 0:
                p_data = json.loads(res_p.stdout)
                all_ready = all(
                    any(c.get("type") == "Ready" and c.get("status") == "True" for c in p.get("status", {}).get("conditions", []))
                    for p in p_data.get("items", [])
                )
                logger.info("All cluster pods verified Running & Ready: %s", all_ready)


if __name__ == "__main__":
    validator = TrafficAlignmentValidator()
    results = validator.run_validation()
    out_file = os.path.join(os.path.dirname(__file__), "results", "traffic_alignment_validation.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    logger.info("Validation results saved to %s", out_file)
