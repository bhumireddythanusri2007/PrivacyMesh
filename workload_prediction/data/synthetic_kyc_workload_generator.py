"""
Synthetic KYC Workload Generator for PrivacyMesh Phase 10.

DATASET TYPE: SYNTHETIC_BENCHMARK
PURPOSE: Research prototype training and validation for proactive Kubernetes autoscaling.
LIMITATION NOTICE: This dataset is synthesized to simulate realistic diurnal banking cycles,
operating hours, weekend shifts, and batch arrivals. It does NOT represent measured production
customer traffic or real-world customer behavior.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
RANDOM_SEED = 42


def generate_synthetic_workload(days: int = 30, interval_minutes: int = 5) -> pd.DataFrame:
    """Generate deterministic synthetic KYC workload time-series over a fixed number of days."""
    np.random.seed(RANDOM_SEED)

    start_time = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
    total_intervals = (days * 24 * 60) // interval_minutes

    records = []
    base_time = start_time

    for i in range(total_intervals):
        dt = base_time + timedelta(minutes=i * interval_minutes)
        hour = dt.hour + (dt.minute / 60.0)
        day_of_week = dt.weekday()  # 0=Monday, 6=Sunday
        day_of_month = dt.day

        # Diurnal pattern: peaks around 10:30 and 15:00, dip at lunch (12:30-13:30)
        is_weekday = 1 if day_of_week < 5 else 0
        is_business_hours = 1 if (is_weekday and 9 <= dt.hour < 17) else 0

        # Base submissions per 5-minute interval
        if is_business_hours:
            # Morning peak (10:30) and afternoon peak (15:00)
            morning_curve = math.exp(-((hour - 10.5) ** 2) / 3.0)
            afternoon_curve = math.exp(-((hour - 15.0) ** 2) / 4.0)
            lunch_dip = 0.6 if 12.5 <= hour <= 13.5 else 1.0
            daily_factor = (morning_curve * 28.0 + afternoon_curve * 32.0 + 10.0) * lunch_dip
        elif is_weekday:
            # Evening/early morning weekday traffic
            daily_factor = max(2.0, 8.0 * math.exp(-((hour - 20.0) ** 2) / 8.0) + 1.5)
        else:
            # Weekend low baseline (banking hours closed)
            daily_factor = max(1.0, 5.0 * math.exp(-((hour - 14.0) ** 2) / 10.0) + 1.0)

        # End of month surge (days 27 to 31: salary / compliance checks +25%)
        month_factor = 1.25 if day_of_month >= 27 else 1.0

        # Random Poisson burst and Gaussian noise
        noise = np.random.normal(0, 1.8)
        burst = np.random.poisson(3.0) if np.random.rand() < 0.08 else 0.0

        raw_kyc_count = max(0.0, (daily_factor * month_factor) + noise + burst)
        # Submission rate in requests/sec over 5-minute window (300 sec)
        kyc_sub_rate_5m = round(raw_kyc_count / 300.0, 4)

        # Total HTTP requests includes auth, general navigation, and kyc checks
        http_multiplier = 4.5 + np.random.uniform(0.5, 1.5)
        total_http_count = max(5.0, raw_kyc_count * http_multiplier + np.random.normal(0, 4.0))
        http_req_rate_5m = round(total_http_count / 300.0, 4)

        # Cyclical temporal features
        hour_rad = 2 * math.pi * (hour / 24.0)
        dow_rad = 2 * math.pi * (day_of_week / 7.0)

        records.append({
            "timestamp": dt.isoformat(),
            "http_request_rate_5m": http_req_rate_5m,
            "kyc_submission_rate_5m": kyc_sub_rate_5m,
            "hour_sin": round(math.sin(hour_rad), 4),
            "hour_cos": round(math.cos(hour_rad), 4),
            "day_of_week_sin": round(math.sin(dow_rad), 4),
            "day_of_week_cos": round(math.cos(dow_rad), 4),
            "is_business_hours": is_business_hours,
            "raw_kyc_count": round(raw_kyc_count, 2),
        })

    df = pd.DataFrame(records)

    # Calculate lag features and rolling rates without lookahead
    df["lag_1_demand"] = df["raw_kyc_count"].shift(1).fillna(df["raw_kyc_count"].iloc[0])
    df["lag_2_demand"] = df["raw_kyc_count"].shift(2).fillna(df["raw_kyc_count"].iloc[0])

    # 15-minute rolling submission rate (average of current and 2 prior 5-minute intervals)
    df["kyc_submission_rate_15m"] = df["kyc_submission_rate_5m"].rolling(window=3, min_periods=1).mean().round(4)

    # Simulated backend replica count based on demand in current window
    # 1 replica baseline, up to 4 replicas under heavy load
    def estimate_replicas(count):
        if count <= 15:
            return 1
        elif count <= 30:
            return 2
        elif count <= 45:
            return 3
        else:
            return 4

    df["current_backend_replicas"] = df["lag_1_demand"].apply(estimate_replicas)

    # Prediction Target: Actual KYC submissions expected in the NEXT 5 minutes (shift -1)
    df["target_kyc_submissions_next_5m"] = df["raw_kyc_count"].shift(-1)

    # Drop the final row because its future target is undefined
    df = df.iloc[:-1].copy()

    return df


def save_dataset_and_metadata():
    """Generate, split chronologically, and save dataset with metadata."""
    os.makedirs(DATA_DIR, exist_ok=True)
    df = generate_synthetic_workload(days=30, interval_minutes=5)

    # Chronological split: 80% train, 20% test (strictly time-ordered, no random shuffle)
    split_index = int(len(df) * 0.8)
    train_df = df.iloc[:split_index].copy()
    test_df = df.iloc[split_index:].copy()

    train_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_train.csv")
    test_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_test.csv")

    train_df.to_csv(train_path, index=False)
    test_df.to_csv(test_path, index=False)

    metadata = {
        "dataset_type": "SYNTHETIC_BENCHMARK",
        "description": "Synthetic time-series simulating diurnal banking KYC submission rates for research autoscaler evaluation.",
        "notice": "DO NOT USE AS REAL CUSTOMER PRODUCTION TRAFFIC. Generated deterministically with fixed random seed.",
        "random_seed": RANDOM_SEED,
        "time_interval_minutes": 5,
        "total_days": 30,
        "total_samples": len(df),
        "train_samples": len(train_df),
        "test_samples": len(test_df),
        "train_period": {
            "start": train_df["timestamp"].iloc[0],
            "end": train_df["timestamp"].iloc[-1],
        },
        "test_period": {
            "start": test_df["timestamp"].iloc[0],
            "end": test_df["timestamp"].iloc[-1],
        },
        "features": [
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
        ],
        "target": "target_kyc_submissions_next_5m",
        "summary_statistics": {
            "train_target_mean": round(float(train_df["target_kyc_submissions_next_5m"].mean()), 2),
            "train_target_max": round(float(train_df["target_kyc_submissions_next_5m"].max()), 2),
            "test_target_mean": round(float(test_df["target_kyc_submissions_next_5m"].mean()), 2),
            "test_target_max": round(float(test_df["target_kyc_submissions_next_5m"].max()), 2),
        },
    }

    metadata_path = os.path.join(DATA_DIR, "dataset_metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"Generated {len(df)} total intervals.")
    print(f"Train split: {len(train_df)} rows saved to {train_path}")
    print(f"Test split:  {len(test_df)} rows saved to {test_path}")
    print(f"Metadata saved to {metadata_path}")


if __name__ == "__main__":
    save_dataset_and_metadata()
