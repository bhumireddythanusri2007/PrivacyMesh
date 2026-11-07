"""
PrivacyMesh KYC Workload Prediction Microservice.

Loads serialized XGBoost model and queries Prometheus for recent HTTP/KYC rates.
Infers expected KYC submissions for the upcoming 5-minute interval.
Exposes predictions, baselines, health checks, and Prometheus metrics.
"""

import json
import math
import os
import time
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
import numpy as np
import xgboost as xgb

from prom_client import PrometheusClient

# Prometheus Metrics Definition
PREDICTED_DEMAND = Gauge(
    "privacymesh_workload_predicted_demand_5m",
    "Predicted KYC submission requests for the next 5-minute interval (XGBoost)",
)

BASELINE_DEMAND = Gauge(
    "privacymesh_workload_baseline_persistence_demand",
    "Persistence baseline KYC demand (last-known completed 5m interval)",
)

INFERENCE_DURATION = Histogram(
    "privacymesh_workload_inference_duration_seconds",
    "Time taken to compute workload prediction in seconds",
)

PREDICTION_ERRORS = Counter(
    "privacymesh_workload_prediction_errors_total",
    "Total count of workload prediction errors or fallbacks encountered",
)

PREDICTOR_HEALTH = Gauge(
    "privacymesh_workload_predictor_health",
    "Predictor operational health status (1 = healthy, 0 = degraded/fallback)",
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(BASE_DIR, "kyc_workload_xgb.json"))
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(os.path.dirname(BASE_DIR), "model", "kyc_workload_xgb.json")

FEATURES_PATH = os.getenv("FEATURES_PATH", os.path.join(BASE_DIR, "model_features.json"))
if not os.path.exists(FEATURES_PATH):
    FEATURES_PATH = os.path.join(os.path.dirname(BASE_DIR), "model", "model_features.json")

model: Optional[xgb.XGBRegressor] = None
model_meta: Dict[str, Any] = {}
prom_client = PrometheusClient()

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield

# App & Model Initialization
app = FastAPI(
    title="PrivacyMesh Workload Predictor",
    description="XGBoost-based predictive workload forecasting microservice for Kubernetes autoscaling.",
    version="1.0.0",
    lifespan=lifespan,
)
def load_model():
    global model, model_meta
    try:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
        if not os.path.exists(FEATURES_PATH):
            raise FileNotFoundError(f"Feature metadata not found at {FEATURES_PATH}")

        with open(FEATURES_PATH, "r", encoding="utf-8") as f:
            model_meta = json.load(f)

        m = xgb.XGBRegressor()
        m.load_model(MODEL_PATH)
        model = m
        PREDICTOR_HEALTH.set(1.0)
        print(f"XGBoost model loaded successfully from {MODEL_PATH}")
    except Exception as e:
        PREDICTOR_HEALTH.set(0.0)
        PREDICTION_ERRORS.inc()
        print(f"Failed to load XGBoost model: {e}")


def build_cyclical_features(dt: datetime) -> Dict[str, float]:
    """Compute sine/cosine temporal features from UTC timestamp."""
    hour = dt.hour + (dt.minute / 60.0)
    day_of_week = dt.weekday()
    hour_rad = 2 * math.pi * (hour / 24.0)
    dow_rad = 2 * math.pi * (day_of_week / 7.0)
    is_weekday = 1 if day_of_week < 5 else 0
    is_business = 1.0 if (is_weekday and 9 <= dt.hour < 17) else 0.0

    return {
        "hour_sin": round(math.sin(hour_rad), 4),
        "hour_cos": round(math.cos(hour_rad), 4),
        "day_of_week_sin": round(math.sin(dow_rad), 4),
        "day_of_week_cos": round(math.cos(dow_rad), 4),
        "is_business_hours": is_business,
    }


class SyntheticPredictRequest(BaseModel):
    http_request_rate_5m: float = Field(..., ge=0.0)
    kyc_submission_rate_5m: float = Field(..., ge=0.0)
    kyc_submission_rate_15m: float = Field(..., ge=0.0)
    hour_sin: float
    hour_cos: float
    day_of_week_sin: float
    day_of_week_cos: float
    is_business_hours: float
    lag_1_demand: float = Field(..., ge=0.0)
    lag_2_demand: float = Field(..., ge=0.0)
    current_backend_replicas: float = Field(..., ge=1.0, le=4.0)


@app.get("/health")
def health_check():
    prom_ok = prom_client.check_connection()
    is_healthy = (model is not None and prom_ok)
    PREDICTOR_HEALTH.set(1.0 if is_healthy else 0.5 if model is not None else 0.0)
    return {
        "status": "healthy" if is_healthy else "degraded",
        "model_loaded": model is not None,
        "model_version": model_meta.get("version", "unknown"),
        "model_path": MODEL_PATH,
        "prometheus_connected": prom_ok,
    }


@app.get("/predict")
def predict_workload():
    """Generate predictive workload forecast using live Prometheus metrics."""
    if model is None:
        PREDICTOR_HEALTH.set(0.0)
        PREDICTION_ERRORS.inc()
        raise HTTPException(status_code=503, detail="XGBoost model is not loaded")

    start_time = time.perf_counter()
    now_utc = datetime.now(timezone.utc)

    # 1. Fetch live metrics from Prometheus
    prom_features = prom_client.get_workload_features()
    time_features = build_cyclical_features(now_utc)

    # 2. Assemble ordered feature vector
    ordered_feature_names = model_meta.get("features", [])
    raw_feature_dict = {**prom_features, **time_features}

    try:
        feature_vector = [float(raw_feature_dict.get(name, 0.0)) for name in ordered_feature_names]
        X = np.array([feature_vector], dtype=np.float32)

        # 3. XGBoost inference
        pred_raw = float(model.predict(X)[0])
        pred_demand = max(0.0, round(pred_raw, 2))

        # 4. Persistence baseline (demand in last completed interval)
        baseline_demand = max(0.0, float(raw_feature_dict.get("lag_1_demand", 0.0)))

        # 5. Update Prometheus metrics
        PREDICTED_DEMAND.set(pred_demand)
        BASELINE_DEMAND.set(baseline_demand)
        PREDICTOR_HEALTH.set(1.0 if prom_features["healthy"] else 0.5)

        duration = time.perf_counter() - start_time
        INFERENCE_DURATION.observe(duration)

        is_synthetic = prom_features.get("workload_type") == "synthetic_benchmark"
        demand_label = "synthetic_benchmark_demand_5m" if is_synthetic else "predicted_kyc_demand_5m"

        return {
            "status": "success",
            "timestamp": now_utc.isoformat(),
            "predicted_kyc_demand_5m": pred_demand,
            "baseline_persistence_demand": baseline_demand,
            "demand_label": demand_label,
            "workload_type": prom_features.get("workload_type", "production_kyc"),
            "endpoint_regex": prom_features.get("endpoint_regex", prom_client.endpoint_regex),
            "rate_window": prom_features.get("rate_window", "5m"),
            "inference_duration_ms": round(duration * 1000, 2),
            "data_source": prom_features["source"],
            "model_version": model_meta.get("version", "1.0.0"),
            "features_used": raw_feature_dict,
        }
    except Exception as e:
        PREDICTOR_HEALTH.set(0.0)
        PREDICTION_ERRORS.inc()
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


@app.post("/predict/synthetic")
def predict_synthetic(payload: SyntheticPredictRequest):
    """Offline endpoint for synthetic testing and validation with custom features."""
    if model is None:
        raise HTTPException(status_code=503, detail="XGBoost model is not loaded")

    start_time = time.perf_counter()
    ordered_feature_names = model_meta.get("features", [])
    feature_dict = payload.model_dump()

    feature_vector = [float(feature_dict.get(name, 0.0)) for name in ordered_feature_names]
    X = np.array([feature_vector], dtype=np.float32)

    pred_raw = float(model.predict(X)[0])
    pred_demand = max(0.0, round(pred_raw, 2))
    baseline_demand = float(payload.lag_1_demand)

    duration = time.perf_counter() - start_time

    return {
        "status": "success",
        "predicted_kyc_demand_5m": pred_demand,
        "baseline_persistence_demand": baseline_demand,
        "inference_duration_ms": round(duration * 1000, 2),
        "data_source": "synthetic_request",
    }


@app.get("/metrics")
def metrics():
    return Response(
        content=generate_latest(),
        headers={"Content-Type": CONTENT_TYPE_LATEST},
    )
