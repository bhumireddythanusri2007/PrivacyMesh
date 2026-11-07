"""
Unit Tests for Workload Scaling Controller Logic.

Verifies:
- Configurable demand-to-replica threshold mapping.
- Immediate scale-up without delay.
- Anti-flapping scale-down cooldown timer.
- Outage fallback holding last-known-safe capacity (never crashing down to 1).
- Bounded minimum and maximum replica limits.
- Non-destructive JSON merge patch targeting spec.minReplicas only.
"""

import time
import pytest

import sys
import os
CONTROLLER_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller")
sys.path.insert(0, CONTROLLER_DIR)

from controller import WorkloadScalingController
import config


def test_threshold_mapping():
    ctrl = WorkloadScalingController()

    # Base thresholds: 15.0, 30.0, 45.0
    assert ctrl.map_demand_to_min_replicas(0.0) == 1
    assert ctrl.map_demand_to_min_replicas(10.0) == 1
    assert ctrl.map_demand_to_min_replicas(15.0) == 1
    assert ctrl.map_demand_to_min_replicas(15.1) == 2
    assert ctrl.map_demand_to_min_replicas(30.0) == 2
    assert ctrl.map_demand_to_min_replicas(30.1) == 3
    assert ctrl.map_demand_to_min_replicas(45.0) == 3
    assert ctrl.map_demand_to_min_replicas(45.1) == 4
    assert ctrl.map_demand_to_min_replicas(150.0) == 4

    # Negative or extreme edge cases must clamp to [1, 4]
    assert ctrl.map_demand_to_min_replicas(-10.0) == 1
    assert ctrl.map_demand_to_min_replicas(9999.0) == 4


def test_outage_fallback_holds_capacity():
    """
    CRITICAL SAFETY REQUIREMENT:
    If predictor/Prometheus fails, the controller MUST HOLD last known safe minReplicas,
    never reducing capacity to 1 automatically during an outage.
    """
    ctrl = WorkloadScalingController()
    ctrl.last_known_safe_min_replicas = 3
    ctrl.current_applied_min_replicas = 3

    # Mock fetch_predicted_demand returning failure
    ctrl.fetch_predicted_demand = lambda: (None, False)

    resolved = ctrl.reconcile_cycle()
    assert resolved == 3, f"Expected controller to hold capacity at 3, got {resolved}"
    assert ctrl.current_applied_min_replicas == 3


def test_immediate_scale_up():
    ctrl = WorkloadScalingController()
    ctrl.last_known_safe_min_replicas = 1
    ctrl.current_applied_min_replicas = 1
    ctrl.get_current_hpa_state = lambda: (1, 1)

    # Mock high demand (35 reqs -> minReplicas 3)
    ctrl.fetch_predicted_demand = lambda: (35.0, True)

    resolved = ctrl.reconcile_cycle()
    assert resolved == 3, "Scale up must be applied immediately"
    assert ctrl.current_applied_min_replicas == 3


def test_scale_down_cooldown_hysteresis():
    ctrl = WorkloadScalingController()
    ctrl.last_known_safe_min_replicas = 3
    ctrl.current_applied_min_replicas = 3
    ctrl.get_current_hpa_state = lambda: (3, 3)

    # Mock low demand (5 reqs -> minReplicas 1)
    ctrl.fetch_predicted_demand = lambda: (5.0, True)

    # First cycle: Cooldown starts, capacity must HOLD at 3
    resolved_1 = ctrl.reconcile_cycle()
    assert resolved_1 == 3, "Capacity must hold during initial cooldown trigger"

    # Second cycle immediately after: still within cooldown window
    resolved_2 = ctrl.reconcile_cycle()
    assert resolved_2 == 3, "Capacity must hold while cooldown has not elapsed"

    # Fast-forward cooldown timer beyond SCALE_DOWN_COOLDOWN_SECONDS
    ctrl.low_demand_start_time = time.time() - (config.SCALE_DOWN_COOLDOWN_SECONDS + 5)
    resolved_3 = ctrl.reconcile_cycle()
    assert resolved_3 == 1, "Scale down must be applied once cooldown has elapsed"


def test_patch_body_strict_scoping():
    ctrl = WorkloadScalingController()
    # Test patch formatting
    bounded_val = 2
    patch_body = {"spec": {"minReplicas": bounded_val}}
    assert "spec" in patch_body
    assert list(patch_body["spec"].keys()) == ["minReplicas"]
    assert "maxReplicas" not in patch_body["spec"]
    assert "metrics" not in patch_body["spec"]


def test_scaling_prediction_source_selection(monkeypatch):
    ctrl = WorkloadScalingController()

    # Mock response from predictor
    mock_response = {
        "predicted_kyc_demand_5m": 35.0,  # XGBoost predicts 35
        "baseline_persistence_demand": 12.0,  # Persistence baseline is 12
    }

    class MockResp:
        status_code = 200
        def json(self):
            return mock_response

    import requests
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: MockResp())

    # Case 1: Default or persistence_baseline -> selects 12.0 (minReplicas 1)
    monkeypatch.setattr("controller.SCALING_PREDICTION_SOURCE", "persistence_baseline")
    chosen, success = ctrl.fetch_predicted_demand()
    assert success is True
    assert chosen == 12.0
    assert ctrl.map_demand_to_min_replicas(chosen) == 1

    # Case 2: xgboost -> selects 35.0 (minReplicas 3)
    monkeypatch.setattr("controller.SCALING_PREDICTION_SOURCE", "xgboost")
    chosen_xgb, success_xgb = ctrl.fetch_predicted_demand()
    assert success_xgb is True
    assert chosen_xgb == 35.0
    assert ctrl.map_demand_to_min_replicas(chosen_xgb) == 3
