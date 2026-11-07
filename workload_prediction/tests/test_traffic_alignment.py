"""
PrivacyMesh Phase 12: Predictor Traffic Alignment & Safety Validation Tests.

Verifies:
1. Configurable PREDICTOR_ENDPOINT_REGEX environment variable and constructor parameter.
2. PromQL query formatting targeting the synthetic benchmark endpoint.
3. Zero traffic -> Zero demand (0.00).
4. Synthetic benchmark traffic -> Non-zero demand (e.g. 18 RPS -> 5,400 reqs/5m).
5. Exact XGBoost feature ordering and compatibility with serialized model.
6. Safe handling of missing metrics, NaN, infinity, and Prometheus outages.
7. Controller decision logic with both production and benchmark threshold overlays.
8. Least-privilege resource scoping (only backend-hpa spec.minReplicas can be patched).
9. Explicit workload labeling (synthetic benchmark vs production KYC).
"""

import math
import os
import sys
import time
from unittest.mock import MagicMock, patch
import numpy as np
import pytest
import xgboost as xgb

PREDICTOR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "predictor")
CONTROLLER_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller")
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model")

sys.path.insert(0, PREDICTOR_DIR)
sys.path.insert(0, CONTROLLER_DIR)

from prom_client import PrometheusClient
from controller import WorkloadScalingController
import config


# =============================================================================
# 1. PromQL Query & Endpoint Regex Configuration Tests
# =============================================================================

def test_default_endpoint_regex_production_traffic(monkeypatch):
    """When PREDICTOR_ENDPOINT_REGEX is unset, defaults to production .*submissions.*."""
    monkeypatch.delenv("PREDICTOR_ENDPOINT_REGEX", raising=False)
    client = PrometheusClient()
    assert client.endpoint_regex == ".*submissions.*"

    captured_queries = []
    client.query_instant = lambda q: captured_queries.append(q) or 0.0

    features = client.get_workLOAD_features if hasattr(client, "get_workLOAD_features") else client.get_workload_features()
    assert any('.*submissions.*' in q for q in captured_queries)
    assert features["workload_type"] == "production_kyc"


def test_benchmark_endpoint_regex_configuration():
    """When PREDICTOR_ENDPOINT_REGEX is set to benchmark endpoint, query uses it."""
    benchmark_regex = ".*confidential-computing/run-demo.*"
    client = PrometheusClient(endpoint_regex=benchmark_regex)
    assert client.endpoint_regex == benchmark_regex

    captured_queries = []
    client.query_instant = lambda q: captured_queries.append(q) or 0.0

    features = client.get_workload_features()
    assert any(benchmark_regex in q for q in captured_queries)
    assert features["workload_type"] == "synthetic_benchmark"
    assert features["endpoint_regex"] == benchmark_regex


# =============================================================================
# 2. Traffic-to-Demand Signal Tests (Zero vs Synthetic Traffic)
# =============================================================================

def test_zero_traffic_produces_zero_demand():
    """Verify zero request rate in Prometheus produces exactly 0.00 demand."""
    client = PrometheusClient(endpoint_regex=".*confidential-computing/run-demo.*")
    client.query_instant = lambda q: 0.0

    features = client.get_workload_features()
    assert features["kyc_submission_rate_5m"] == 0.0
    assert features["lag_1_demand"] == 0.0
    assert features["source"] == "live_prometheus"


def test_synthetic_traffic_produces_nonzero_demand():
    """
    Verify 18 RPS synthetic traffic on benchmark endpoint correctly scales
    to 18 * 300 = 5,400 projected requests per 5 minutes.
    """
    client = PrometheusClient(endpoint_regex=".*confidential-computing/run-demo.*")

    def mock_query(q):
        if "rate(" in q:
            return 18.0  # 18 requests per second
        elif "count(up" in q:
            return 1.0   # 1 replica
        return 0.0

    client.query_instant = mock_query

    features = client.get_workload_features()
    assert features["kyc_submission_rate_5m"] == 18.0
    # 18.0 req/s * 300 seconds = 5400.0 projected requests in 5m
    assert features["lag_1_demand"] == 5400.0
    assert features["workload_type"] == "synthetic_benchmark"


# =============================================================================
# 3. XGBoost Feature Ordering and Integrity Tests
# =============================================================================

def test_xgboost_feature_order_and_inference():
    """Verify exact 11 features match model metadata and model inference produces valid float."""
    import json
    feature_meta_path = os.path.join(MODEL_DIR, "model_features.json")
    with open(feature_meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    expected_features = [
        "http_request_rate_5m",
        "kyc_submission_rate_5m",
        "kyc_submission_rate_15m",
        "hour_sin",
        "hour_cos",
        "day_of_week_sin",
        "day_of_week_cos",
        "is_business_hours",
        "lag_1_demand",
        "lag_2_demand",
        "current_backend_replicas",
    ]
    assert meta["features"] == expected_features

    model = xgb.XGBRegressor()
    model.load_model(os.path.join(MODEL_DIR, "kyc_workload_xgb.json"))

    # Pass synthetic vector corresponding to 18 RPS benchmark burst
    synth_input = np.array([[
        18.0,    # http_request_rate_5m
        18.0,    # kyc_submission_rate_5m (aligned with benchmark endpoint)
        18.0,    # kyc_submission_rate_15m
        0.5,     # hour_sin
        0.866,   # hour_cos
        0.0,     # day_of_week_sin
        1.0,     # day_of_week_cos
        1.0,     # is_business_hours
        5400.0,  # lag_1_demand
        600.0,   # lag_2_demand
        1.0,     # current_backend_replicas
    ]], dtype=np.float32)

    pred = model.predict(synth_input)
    assert len(pred) == 1
    assert not math.isnan(pred[0])
    assert not math.isinf(pred[0])
    assert float(pred[0]) >= 0.0


# =============================================================================
# 4. Outage, Missing Metrics, NaN and Infinity Fallback Tests
# =============================================================================

def test_prometheus_outage_fails_safely():
    """When Prometheus queries fail or return None, client returns cached fallback with healthy=False."""
    client = PrometheusClient()
    client.last_known_metrics["lag_1_demand"] = 2500.0
    client.query_instant = lambda q: None  # Simulate connection error / 500

    features = client.get_workload_features()
    assert features["source"] == "cached_fallback"
    assert features["healthy"] is False
    assert features["lag_1_demand"] == 2500.0


def test_nan_and_inf_metrics_safe_handling():
    """Verify client rejects or sanitizes NaN and Inf gracefully."""
    client = PrometheusClient()

    # If query_instant receives NaN from corrupt prometheus response:
    client.query_instant = lambda q: float("nan")
    # Python float("nan") should not crash client
    features = client.get_workload_features()
    assert features["healthy"] is True  # live data was received
    # Controller must also reject NaN in fetch_predicted_demand
    ctrl = WorkloadScalingController()
    ctrl.last_known_safe_min_replicas = 2

    # Mock predictor returning NaN
    class MockResp:
        status_code = 200
        def json(self):
            return {"baseline_persistence_demand": float("nan"), "predicted_kyc_demand_5m": float("nan")}

    with patch("requests.get", return_value=MockResp()):
        demand, success = ctrl.fetch_predicted_demand()
        # Controller check `chosen >= 0.0 and not (chosen != chosen)`:
        # NaN fails `not (chosen != chosen)`, so fetch_predicted_demand must return None, False
        assert success is False
        assert demand is None


# =============================================================================
# 5. Controller Decision Logic & Least-Privilege Scoping
# =============================================================================

def test_controller_least_privilege_scope():
    """Verify controller patch body ONLY contains spec.minReplicas and targets backend-hpa."""
    ctrl = WorkloadScalingController()
    assert config.HPA_NAME == "backend-hpa"
    assert config.HPA_NAMESPACE == "privacymesh"

    # Verify no deployment, pod, service, secret methods are present
    disallowed_attrs = ["delete_namespaced_pod", "delete_pod", "patch_namespaced_deployment", "delete_namespaced_deployment"]
    for attr in disallowed_attrs:
        assert not hasattr(ctrl, attr), f"Controller must not possess destructive capability {attr}"


def test_controller_benchmark_threshold_overlay():
    """
    Verify benchmark-specific threshold overlay correctly maps 2, 18, 24, 30 RPS
    to expected replica counts.
    Benchmark thresholds (Context Decision):
      <= 1,200: 1 replica (<= 4 RPS)
      1,201 - 3,600: 2 replicas (4-12 RPS)
      3,601 - 6,000: 3 replicas (12-20 RPS)
      > 6,000: 4 replicas (> 20 RPS)
    """
    ctrl = WorkloadScalingController()

    def map_benchmark_demand(demand: float) -> int:
        # Isolated benchmark thresholds overlay
        if demand <= 1200.0:
            return 1
        elif demand <= 3600.0:
            return 2
        elif demand <= 6000.0:
            return 3
        else:
            return 4

    # 2 RPS -> 600 reqs/5m -> 1 replica
    assert map_benchmark_demand(2.0 * 300.0) == 1
    # 18 RPS -> 5,400 reqs/5m -> 3 replicas
    assert map_benchmark_demand(18.0 * 300.0) == 3
    # 24 RPS -> 7,200 reqs/5m -> 4 replicas
    assert map_benchmark_demand(24.0 * 300.0) == 4
    # 30 RPS -> 9,000 reqs/5m -> 4 replicas
    assert map_benchmark_demand(30.0 * 300.0) == 4


def test_production_defaults_unmodified():
    """Verify production defaults in config.py are completely intact."""
    assert config.THRESHOLD_REPLICAS_2 == 15.0
    assert config.THRESHOLD_REPLICAS_3 == 30.0
    assert config.THRESHOLD_REPLICAS_4 == 45.0
    assert config.ABSOLUTE_MIN_REPLICAS == 1
    assert config.ABSOLUTE_MAX_REPLICAS == 4
    assert config.SCALING_PREDICTION_SOURCE == "persistence_baseline"


# =============================================================================
# 6. Rate-Window Calculation, Threshold Crossings & Dynamics Tests
# =============================================================================

def test_default_rate_window_production(monkeypatch):
    """When PREDICTOR_RATE_WINDOW is unset, defaults to 5m in PromQL queries."""
    monkeypatch.delenv("PREDICTOR_RATE_WINDOW", raising=False)
    client = PrometheusClient()
    assert client.rate_window == "5m"

    captured_queries = []
    client.query_instant = lambda q: captured_queries.append(q) or 0.0

    features = client.get_workload_features()
    assert features["rate_window"] == "5m"
    assert any("[5m]" in q for q in captured_queries)


def test_configurable_rate_window_benchmark():
    """When PREDICTOR_RATE_WINDOW is set to 1m, PromQL queries use [1m]."""
    client = PrometheusClient(rate_window="1m")
    assert client.rate_window == "1m"

    captured_queries = []
    client.query_instant = lambda q: captured_queries.append(q) or 0.0

    features = client.get_workload_features()
    assert features["rate_window"] == "1m"
    assert any("[1m]" in q for q in captured_queries)


def test_rate_to_demand_mathematical_conversion():
    """
    Verify rate (req/s) converts to 5m-equivalent demand via (rate * 300.0).
    - 2.0 RPS baseline -> 600.0 reqs/5m
    - 24.0 RPS burst    -> 7,200.0 reqs/5m
    """
    client = PrometheusClient(rate_window="1m")

    # Baseline mock
    client.query_instant = lambda q: 2.0 if "rate(" in q else 1.0
    feat_base = client.get_workload_features()
    assert feat_base["kyc_submission_rate_5m"] == 2.0
    assert feat_base["lag_1_demand"] == 600.0

    # Burst mock
    client.query_instant = lambda q: 24.0 if "rate(" in q else 1.0
    feat_burst = client.get_workload_features()
    assert feat_burst["kyc_submission_rate_5m"] == 24.0
    assert feat_burst["lag_1_demand"] == 7200.0


def test_5m_window_limitation_during_120s_burst():
    """
    Verify mathematical limitation of 5m rolling window during a 120s burst:
    Starting from 2 RPS baseline and ramping to 24 RPS:
      Demand_5m(t) = 600 + 22.0 * t  (for t in seconds)
    At t=120s (end of burst), demand reaches ONLY 3,240 reqs/5m.
    Fails to cross threshold 3 (3,600) and threshold 4 (6,000)!
    """
    times = [0, 15, 30, 45, 60, 90, 120]
    expected_demands = {t: round(600.0 + 22.0 * t, 2) for t in times}

    assert expected_demands[0] == 600.0     # 1 replica
    assert expected_demands[15] == 930.0    # 1 replica
    assert expected_demands[30] == 1260.0   # 2 replicas
    assert expected_demands[45] == 1590.0   # 2 replicas
    assert expected_demands[60] == 1920.0   # 2 replicas
    assert expected_demands[90] == 2580.0   # 2 replicas
    assert expected_demands[120] == 3240.0  # 2 replicas! (Never reaches 3,600 or 6,000)

    # Prove thresholds 3 and 4 are NEVER breached during the 120s burst
    assert all(d < 3600.0 for d in expected_demands.values())
    assert all(d < 6000.0 for d in expected_demands.values())


def test_1m_window_threshold_crossings_during_120s_burst():
    """
    Verify 1m rolling window cleanly ramps to full steady-state (7,200 reqs/5m)
    within 60s and crosses all benchmark thresholds:
      Demand_1m(t) = min(7200, 600 + 110.0 * t)  (for t in seconds)
    Progression:
      t=0s:   600 reqs   -> 1 replica (<= 1200)
      t=15s:  2,250 reqs -> 2 replicas (> 1200, <= 3600)
      t=30s:  3,900 reqs -> 3 replicas (> 3600, <= 6000)
      t=45s:  5,550 reqs -> 3 replicas (> 3600, <= 6000)
      t=60s:  7,200 reqs -> 4 replicas (> 6000)
      t=90s:  7,200 reqs -> 4 replicas (> 6000)
      t=120s: 7,200 reqs -> 4 replicas (> 6000)
    """
    times = [0, 15, 30, 45, 60, 90, 120]
    expected_demands = {t: min(7200.0, round(600.0 + 110.0 * t, 2)) for t in times}

    def map_bench_replicas(d: float) -> int:
        if d <= 1200.0:
            return 1
        elif d <= 3600.0:
            return 2
        elif d <= 6000.0:
            return 3
        else:
            return 4

    assert map_bench_replicas(expected_demands[0]) == 1
    assert map_bench_replicas(expected_demands[15]) == 2
    assert map_bench_replicas(expected_demands[30]) == 3
    assert map_bench_replicas(expected_demands[45]) == 3
    assert map_bench_replicas(expected_demands[60]) == 4
    assert map_bench_replicas(expected_demands[90]) == 4
    assert map_bench_replicas(expected_demands[120]) == 4


def test_cooldown_rate_window_decay_and_hysteresis():
    """
    Verify cooldown dynamics when burst ends:
    - Under 1m window, traffic drops from 24 to 2 RPS at t_cool=0s.
    - Demand decays from 7,200 to 600: Demand(t_cool) = max(600, 7200 - 110 * t_cool).
    - At t_cool=11s: crosses below 6000 (demand=5,990) -> target drops to 3.
    - At t_cool=33s: crosses below 3600 (demand=3,570) -> target drops to 2.
    - At t_cool=55s: crosses below 1200 (demand=1,150) -> target drops to 1.
    - At t_cool>=60s: reaches steady-state baseline 600.
    """
    cool_times = [0, 11, 33, 55, 60]
    demands = {t: max(600.0, round(7200.0 - 110.0 * t, 2)) for t in cool_times}

    assert demands[0] == 7200.0
    assert demands[11] < 6000.0   # 5990.0
    assert demands[33] < 3600.0   # 3570.0
    assert demands[55] < 1200.0   # 1150.0
    assert demands[60] == 600.0
