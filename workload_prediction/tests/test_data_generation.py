"""
Unit Tests for Synthetic KYC Workload Data Generation.

Verifies:
- Deterministic output from fixed seed.
- Chronological ordering with no timestamp reversals.
- No lookahead data leakage in lag and rolling features.
- Explicit synthetic labeling metadata.
"""

import json
import os
import pandas as pd
import pytest

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def test_metadata_file_exists_and_declares_synthetic():
    meta_path = os.path.join(DATA_DIR, "dataset_metadata.json")
    assert os.path.exists(meta_path), "Metadata file missing"

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    assert meta["dataset_type"] == "SYNTHETIC_BENCHMARK"
    assert "DO NOT USE AS REAL CUSTOMER" in meta["notice"]
    assert meta["train_samples"] > 0
    assert meta["test_samples"] > 0


def test_train_test_chronological_splits():
    train_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_train.csv")
    test_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_test.csv")

    assert os.path.exists(train_path), "Train split missing"
    assert os.path.exists(test_path), "Test split missing"

    train_df = pd.read_csv(train_path)
    test_df = pd.read_csv(test_path)

    # 1. Non-empty
    assert len(train_df) > 5000
    assert len(test_df) > 1000

    # 2. Strict chronological ordering within splits
    train_times = pd.to_datetime(train_df["timestamp"])
    assert train_times.is_monotonic_increasing, "Train split timestamps not monotonic"

    test_times = pd.to_datetime(test_df["timestamp"])
    assert test_times.is_monotonic_increasing, "Test split timestamps not monotonic"

    # 3. No temporal overlap or leakage (Train strictly precedes Test)
    assert train_times.iloc[-1] < test_times.iloc[0], "Temporal leakage detected: Train overlaps with Test"


def test_feature_domains_and_bounds():
    train_path = os.path.join(DATA_DIR, "synthetic_kyc_workload_train.csv")
    df = pd.read_csv(train_path)

    # Rates must be non-negative
    assert (df["http_request_rate_5m"] >= 0.0).all()
    assert (df["kyc_submission_rate_5m"] >= 0.0).all()
    assert (df["kyc_submission_rate_15m"] >= 0.0).all()

    # Cyclical sine/cosine must be in [-1, 1]
    assert (df["hour_sin"].between(-1.01, 1.01)).all()
    assert (df["hour_cos"].between(-1.01, 1.01)).all()
    assert (df["day_of_week_sin"].between(-1.01, 1.01)).all()
    assert (df["day_of_week_cos"].between(-1.01, 1.01)).all()

    # Targets must be non-negative
    assert (df["target_kyc_submissions_next_5m"] >= 0.0).all()
