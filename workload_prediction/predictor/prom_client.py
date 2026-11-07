"""
Prometheus Metrics Client for PrivacyMesh Workload Predictor.

Queries live Prometheus instance for HTTP request rates and KYC submission volume.
Provides timeout handling, safe fallbacks, and zero data leakage.
"""

import logging
import os
from typing import Any, Dict, Optional
import requests

logger = logging.getLogger("workload_predictor.prometheus")

DEFAULT_PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
TIMEOUT_SECONDS = float(os.getenv("PROMETHEUS_TIMEOUT_SECONDS", "3.0"))
DEFAULT_ENDPOINT_REGEX = os.getenv("PREDICTOR_ENDPOINT_REGEX", ".*submissions.*")
DEFAULT_RATE_WINDOW = os.getenv("PREDICTOR_RATE_WINDOW", "5m")


class PrometheusClient:
    def __init__(
        self,
        base_url: str = DEFAULT_PROMETHEUS_URL,
        timeout: float = TIMEOUT_SECONDS,
        endpoint_regex: Optional[str] = None,
        rate_window: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.endpoint_regex = endpoint_regex if endpoint_regex is not None else DEFAULT_ENDPOINT_REGEX
        self.rate_window = rate_window if rate_window is not None else DEFAULT_RATE_WINDOW
        self.last_known_metrics: Dict[str, float] = {
            "http_request_rate_5m": 0.05,
            "kyc_submission_rate_5m": 0.01,
            "kyc_submission_rate_15m": 0.01,
            "lag_1_demand": 3.0,
            "lag_2_demand": 3.0,
            "current_backend_replicas": 1.0,
        }
        self.is_connected = False

    def check_connection(self) -> bool:
        """Lightweight connectivity probe to verify Prometheus reachability."""
        val = self.query_instant("up")
        self.is_connected = (val is not None)
        return self.is_connected

    def query_instant(self, query: str) -> Optional[float]:
        """Execute instant query against Prometheus HTTP API."""
        url = f"{self.base_url}/api/v1/query"
        try:
            resp = requests.get(url, params={"query": query}, timeout=self.timeout)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    result = data.get("data", {}).get("result", [])
                    if result and "value" in result[0]:
                        val = float(result[0]["value"][1])
                        self.is_connected = True
                        return val
            logger.warning("Prometheus query returned non-200 or empty result: %s", query)
        except Exception as e:
            logger.warning("Failed to query Prometheus at %s: %s", url, e)
            self.is_connected = False
        return None

    def get_workload_features(self) -> Dict[str, Any]:
        """
        Fetch real-time workload rates from Prometheus using the configured endpoint regex.
        If Prometheus is unreachable or queries return empty, return last known safe values with status flag.
        """
        regex = self.endpoint_regex or os.getenv("PREDICTOR_ENDPOINT_REGEX", ".*submissions.*")
        window = self.rate_window or os.getenv("PREDICTOR_RATE_WINDOW", "5m")
        is_synthetic = "confidential-computing" in regex
        workload_type = "synthetic_benchmark" if is_synthetic else "production_kyc"

        q_http_total = f'sum(rate(privacymesh_http_requests_total[{window}])) or vector(0)'
        val_http = self.query_instant(q_http_total)

        q_kyc_5m = f'sum(rate(privacymesh_http_requests_total{{endpoint=~"{regex}"}}[{window}])) or vector(0)'
        val_kyc_5m = self.query_instant(q_kyc_5m)

        q_kyc_15m = f'sum(rate(privacymesh_http_requests_total{{endpoint=~"{regex}"}}[15m])) or vector(0)'
        val_kyc_15m = self.query_instant(q_kyc_15m)

        q_replicas = 'count(up{job="privacymesh-backend"} == 1) or vector(1)'
        val_replicas = self.query_instant(q_replicas)

        live_data_available = (val_http is not None and val_kyc_5m is not None)

        if live_data_available:
            http_rate = max(0.0, float(val_http))
            kyc_rate_5m = max(0.0, float(val_kyc_5m))
            kyc_rate_15m = max(0.0, float(val_kyc_15m if val_kyc_15m is not None else kyc_rate_5m))
            replicas = max(1.0, float(val_replicas if val_replicas is not None else 1.0))

            recent_demand = round(kyc_rate_5m * 300.0, 2)

            self.last_known_metrics["lag_2_demand"] = self.last_known_metrics["lag_1_demand"]
            self.last_known_metrics["lag_1_demand"] = recent_demand
            self.last_known_metrics["http_request_rate_5m"] = http_rate
            self.last_known_metrics["kyc_submission_rate_5m"] = kyc_rate_5m
            self.last_known_metrics["kyc_submission_rate_15m"] = kyc_rate_15m
            self.last_known_metrics["current_backend_replicas"] = replicas

            return {
                "source": "live_prometheus",
                "healthy": True,
                "endpoint_regex": regex,
                "rate_window": window,
                "workload_type": workload_type,
                "http_request_rate_5m": http_rate,
                "kyc_submission_rate_5m": kyc_rate_5m,
                "kyc_submission_rate_15m": kyc_rate_15m,
                "lag_1_demand": self.last_known_metrics["lag_1_demand"],
                "lag_2_demand": self.last_known_metrics["lag_2_demand"],
                "current_backend_replicas": replicas,
            }
        else:
            logger.info("Using cached metrics due to Prometheus unavailability")
            return {
                "source": "cached_fallback",
                "healthy": False,
                "endpoint_regex": regex,
                "rate_window": window,
                "workload_type": workload_type,
                **self.last_known_metrics,
            }
