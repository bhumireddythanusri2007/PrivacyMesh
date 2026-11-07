"""
Configuration for PrivacyMesh Workload Scaling Controller.

All thresholds are experimental starting values and fully configurable via environment variables.
"""

import os

PREDICTOR_URL = os.getenv("PREDICTOR_URL", "http://workload-predictor:8080")
RECONCILE_INTERVAL_SECONDS = int(os.getenv("RECONCILE_INTERVAL_SECONDS", "30"))
SCALE_DOWN_COOLDOWN_SECONDS = int(os.getenv("SCALE_DOWN_COOLDOWN_SECONDS", "120"))

HPA_NAME = os.getenv("HPA_NAME", "backend-hpa")
HPA_NAMESPACE = os.getenv("HPA_NAMESPACE", "privacymesh")

# Scaling prediction source: "persistence_baseline" (safe reference) or "xgboost" (experimental comparison)
# By default, the persistence baseline is used as the safe reference for recommending minReplicas.
SCALING_PREDICTION_SOURCE = os.getenv("SCALING_PREDICTION_SOURCE", "persistence_baseline")

# Configurable experimental starting thresholds (submissions per 5 minutes)
# Note: These are starting baseline estimates and subject to empirical calibration.
THRESHOLD_REPLICAS_2 = float(os.getenv("THRESHOLD_REPLICAS_2", "15.0"))
THRESHOLD_REPLICAS_3 = float(os.getenv("THRESHOLD_REPLICAS_3", "30.0"))
THRESHOLD_REPLICAS_4 = float(os.getenv("THRESHOLD_REPLICAS_4", "45.0"))

ABSOLUTE_MIN_REPLICAS = int(os.getenv("ABSOLUTE_MIN_REPLICAS", "1"))
ABSOLUTE_MAX_REPLICAS = int(os.getenv("ABSOLUTE_MAX_REPLICAS", "4"))
METRICS_PORT = int(os.getenv("METRICS_PORT", "8081"))
