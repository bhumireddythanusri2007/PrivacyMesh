"""
Independent Model Evaluation Script for PrivacyMesh Phase 10.

Computes MAE, RMSE, and R² for:
- Persistence Baseline
- 15-minute Rolling Mean Baseline
- Trained XGBoost Model (loaded from kyc_workload_xgb.json)
"""

import json
import os
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import xgboost as xgb

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")


def evaluate_saved_model():
    model_path = os.path.join(BASE_DIR, "kyc_workload_xgb.json")
    feature_path = os.path.join(BASE_DIR, "model_features.json")
    test_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_test.csv")

    with open(feature_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    features = meta["features"]
    target = meta["target"]

    test_df = pd.read_csv(test_path)
    X_test = test_df[features]
    y_test = test_df[target]

    # Load model
    model = xgb.XGBRegressor()
    model.load_model(model_path)

    y_pred_xgb = np.clip(model.predict(X_test), 0.0, None)
    y_pred_persistence = test_df["raw_kyc_count"]
    y_pred_rolling = (test_df["raw_kyc_count"] + test_df["lag_1_demand"] + test_df["lag_2_demand"]) / 3.0

    def compute(y_true, y_pred):
        return {
            "MAE": round(float(mean_absolute_error(y_true, y_pred)), 4),
            "RMSE": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
            "R2": round(float(r2_score(y_true, y_pred)), 4),
        }

    res_pers = compute(y_test, y_pred_persistence)
    res_roll = compute(y_test, y_pred_rolling)
    res_xgb = compute(y_test, y_pred_xgb)

    print("=== Saved Model Evaluation Report ===")
    print(f"Test samples:          {len(test_df)}")
    print(f"Persistence Baseline:  MAE={res_pers['MAE']}, RMSE={res_pers['RMSE']}, R2={res_pers['R2']}")
    print(f"Rolling Mean Baseline: MAE={res_roll['MAE']}, RMSE={res_roll['RMSE']}, R2={res_roll['R2']}")
    print(f"XGBoost Model:         MAE={res_xgb['MAE']}, RMSE={res_xgb['RMSE']}, R2={res_xgb['R2']}")

    return {
        "persistence": res_pers,
        "rolling_mean": res_roll,
        "xgboost": res_xgb,
    }


if __name__ == "__main__":
    evaluate_saved_model()
