"""
Unit Tests for XGBoost Model Inference and Prediction Service.

Verifies:
- Native XGBoost JSON model deserialization.
- Fast inference duration (< 50ms per batch).
- Synthetic endpoint validation.
- Output bounding (no negative demand).
"""

import json
import os
import time
import numpy as np
import pytest
import xgboost as xgb
from fastapi.testclient import TestClient

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model")
PREDICTOR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "predictor")

import sys
sys.path.insert(0, PREDICTOR_DIR)
from app import app, load_model


@pytest.fixture(scope="module", autouse=True)
def init_predictor():
    load_model()


def test_model_file_validity():
    model_path = os.path.join(MODEL_DIR, "kyc_workload_xgb.json")
    feature_path = os.path.join(MODEL_DIR, "model_features.json")

    assert os.path.exists(model_path), "Model JSON file missing"
    assert os.path.exists(feature_path), "Feature metadata missing"

    with open(feature_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    assert len(meta["features"]) == 11
    assert meta["target"] == "target_kyc_submissions_next_5m"

    # Verify native loading
    model = xgb.XGBRegressor()
    model.load_model(model_path)
    assert model is not None


def test_model_inference_speed():
    model_path = os.path.join(MODEL_DIR, "kyc_workload_xgb.json")
    model = xgb.XGBRegressor()
    model.load_model(model_path)

    # 11 sample features
    dummy_input = np.array([[0.05, 0.01, 0.01, 0.5, 0.86, 0.0, 1.0, 1.0, 5.0, 4.0, 1.0]], dtype=np.float32)

    start = time.perf_counter()
    pred = model.predict(dummy_input)
    duration_ms = (time.perf_counter() - start) * 1000

    assert len(pred) == 1
    assert pred[0] >= 0.0
    assert duration_ms < 50.0, f"Inference too slow: {duration_ms}ms"


def test_predictor_health_and_synthetic_endpoints():
    client = TestClient(app)

    # Health endpoint
    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["model_loaded"] is True

    # Synthetic inference endpoint
    payload = {
        "http_request_rate_5m": 0.25,
        "kyc_submission_rate_5m": 0.08,
        "kyc_submission_rate_15m": 0.07,
        "hour_sin": 0.25,
        "hour_cos": 0.96,
        "day_of_week_sin": 0.78,
        "day_of_week_cos": 0.62,
        "is_business_hours": 1.0,
        "lag_1_demand": 24.0,
        "lag_2_demand": 20.0,
        "current_backend_replicas": 2.0,
    }
    res_synth = client.post("/predict/synthetic", json=payload)
    assert res_synth.status_code == 200
    data = res_synth.json()
    assert data["status"] == "success"
    assert data["predicted_kyc_demand_5m"] > 0.0
    assert data["baseline_persistence_demand"] == 24.0


def test_predictor_metrics_endpoint():
    client = TestClient(app)
    res_m = client.get("/metrics")
    assert res_m.status_code == 200
    assert "privacymesh_workload_predicted_demand_5m" in res_m.text
    assert "privacymesh_workload_predictor_health" in res_m.text
