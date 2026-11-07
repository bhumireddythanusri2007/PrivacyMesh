"""
XGBoost Training and Baseline Comparison Pipeline for PrivacyMesh Phase 10.

Evaluates XGBoost against:
1. Persistence Baseline (predicts next 5m demand = last observed 5m demand)
2. Rolling Mean Baseline (predicts next 5m demand = 15m moving average of demand)

Metrics: MAE, RMSE, R² on strictly chronological unseen test split.
"""

import json
import os
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import xgboost as xgb

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")

FEATURE_COLUMNS = [
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

TARGET_COLUMN = "target_kyc_submissions_next_5m"


def train_and_evaluate():
    train_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_train.csv")
    test_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_test.csv")

    if not os.path.exists(train_path) or not os.path.exists(test_path):
        raise FileNotFoundError("Train and test datasets not found. Run generator first.")

    train_df = pd.read_csv(train_path)
    test_df = pd.read_csv(test_path)

    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df[TARGET_COLUMN]

    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN]

    # Baseline 1: Persistence Baseline (Next 5m = last observed 5m demand)
    # lag_1_demand in the test row represents the last completed 5-minute window
    y_pred_persistence = test_df["raw_kyc_count"]

    # Baseline 2: Rolling Mean Baseline (15m moving average)
    y_pred_rolling_mean = (test_df["raw_kyc_count"] + test_df["lag_1_demand"] + test_df["lag_2_demand"]) / 3.0

    # Train XGBoost Regressor
    model = xgb.XGBRegressor(
        n_estimators=120,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred_xgb = model.predict(X_test)
    # Clip negative predictions to zero (demand cannot be negative)
    y_pred_xgb = np.clip(y_pred_xgb, 0.0, None)

    # Compute Evaluation Metrics
    def compute_metrics(y_true, y_pred):
        mae = float(mean_absolute_error(y_true, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
        r2 = float(r2_score(y_true, y_pred))
        return {
            "MAE": round(mae, 4),
            "RMSE": round(rmse, 4),
            "R2": round(r2, 4),
        }

    metrics_persistence = compute_metrics(y_test, y_pred_persistence)
    metrics_rolling = compute_metrics(y_test, y_pred_rolling_mean)
    metrics_xgb = compute_metrics(y_test, y_pred_xgb)

    # Feature Importance
    importance_scores = model.feature_importances_
    feature_importance = {
        name: round(float(score), 4)
        for name, score in zip(FEATURE_COLUMNS, importance_scores)
    }

    # Save trained model
    os.makedirs(BASE_DIR, exist_ok=True)
    model_save_path = os.path.join(BASE_DIR, "kyc_workload_xgb.json")
    model.save_model(model_save_path)

    # Save feature schema
    feature_meta = {
        "model_type": "xgboost.XGBRegressor",
        "objective": "reg:squarederror",
        "version": "1.0.0",
        "feature_count": len(FEATURE_COLUMNS),
        "features": FEATURE_COLUMNS,
        "target": TARGET_COLUMN,
        "feature_importance": feature_importance,
        "trained_on_samples": len(train_df),
        "evaluated_on_samples": len(test_df),
    }
    feature_path = os.path.join(BASE_DIR, "model_features.json")
    with open(feature_path, "w", encoding="utf-8") as f:
        json.dump(feature_meta, f, indent=2)

    # Save comparison report
    results = {
        "dataset": "synthetic_kyc_workload",
        "split_method": "chronological_80_20_no_leakage",
        "test_sample_count": len(test_df),
        "baselines": {
            "persistence_last_known_value": metrics_persistence,
            "rolling_mean_15m": metrics_rolling,
        },
        "xgboost_model": metrics_xgb,
        "comparison_delta_vs_persistence": {
            "mae_reduction": round(metrics_persistence["MAE"] - metrics_xgb["MAE"], 4),
            "rmse_reduction": round(metrics_persistence["RMSE"] - metrics_xgb["RMSE"], 4),
            "r2_improvement": round(metrics_xgb["R2"] - metrics_persistence["R2"], 4),
        },
    }
    results_path = os.path.join(BASE_DIR, "evaluation_metrics.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("=== Model Training & Baseline Evaluation Complete ===")
    print(f"Persistence Baseline:  MAE={metrics_persistence['MAE']}, RMSE={metrics_persistence['RMSE']}, R²={metrics_persistence['R2']}")
    print(f"Rolling Mean Baseline: MAE={metrics_rolling['MAE']}, RMSE={metrics_rolling['RMSE']}, R²={metrics_rolling['R2']}")
    print(f"XGBoost Regressor:     MAE={metrics_xgb['MAE']}, RMSE={metrics_xgb['RMSE']}, R²={metrics_xgb['R2']}")
    print(f"Model saved to: {model_save_path}")
    print(f"Metrics saved to: {results_path}")

    return results


if __name__ == "__main__":
    train_and_evaluate()
