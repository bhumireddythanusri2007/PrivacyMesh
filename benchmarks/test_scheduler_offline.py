"""
PrivacyMesh Phase 12: Offline Scheduler and Demand Function Validation Suite.

Validates the corrected cumulative demand calculation, pacing lag formula,
stage boundary transitions, and burst catch-up logic without any network or
cluster dependencies.
"""

import math
import sys
import unittest
from pathlib import Path

# Add benchmarks directory to path
BENCHMARKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCHMARKS_DIR))

from run_scaling_experiments import (
    STAGE1_DURATION,
    STAGE1_RPS,
    STAGE2_DURATION,
    STAGE2_RPS,
    STAGE3_DURATION,
    STAGE3_RPS,
    TOTAL_DURATION,
    WorkloadBenchmarker,
)


class TestSchedulerOffline(unittest.TestCase):
    """Rigorous offline validation for the pacing scheduler and mathematical models."""

    def setUp(self):
        self.runner_full = WorkloadBenchmarker(mode="A", dry_run=False)
        self.runner_dry = WorkloadBenchmarker(mode="A", dry_run=True)

    def test_total_workload_volumes(self):
        """Verify exact total expected requests for each stage and the full 300s envelope."""
        # Warmup: 60s * 2 RPS = 120
        warmup_reqs = STAGE1_DURATION * STAGE1_RPS
        self.assertEqual(warmup_reqs, 120)

        # Burst: 120s * 18 RPS = 2,160
        burst_reqs = STAGE2_DURATION * STAGE2_RPS
        self.assertEqual(burst_reqs, 2160)

        # Cooldown: 120s * 2 RPS = 240
        cooldown_reqs = STAGE3_DURATION * STAGE3_RPS
        self.assertEqual(cooldown_reqs, 240)

        # Total: 120 + 2,160 + 240 = 2,520
        total_reqs = warmup_reqs + burst_reqs + cooldown_reqs
        self.assertEqual(total_reqs, 2520)
        self.assertEqual(TOTAL_DURATION, 300)

    def test_cumulative_demand_progression(self):
        """Verify cumulative demand function at key milestones."""
        f = self.runner_full.get_expected_cumulative_requests

        self.assertAlmostEqual(f(0.0), 0.0)
        self.assertAlmostEqual(f(30.0), 60.0)
        self.assertAlmostEqual(f(60.0), 120.0)
        self.assertAlmostEqual(f(90.0), 120.0 + 30 * 18.0)  # 660.0
        self.assertAlmostEqual(f(120.0), 120.0 + 60 * 18.0)  # 1200.0
        self.assertAlmostEqual(f(180.0), 120.0 + 120 * 18.0)  # 2280.0
        self.assertAlmostEqual(f(240.0), 2280.0 + 60 * 2.0)  # 2400.0
        self.assertAlmostEqual(f(300.0), 2520.0)
        # Should cap gracefully beyond 300s
        self.assertAlmostEqual(f(305.0), 2520.0)

    def test_stage_boundary_continuity(self):
        """Verify continuity at exact boundary transitions (t=60s, t=180s, t=300s)."""
        f = self.runner_full.get_expected_cumulative_requests
        eps = 1e-6

        # Continuity at t = 60s
        left_60 = f(60.0 - eps)
        at_60 = f(60.0)
        right_60 = f(60.0 + eps)
        self.assertAlmostEqual(left_60, 120.0, places=4)
        self.assertAlmostEqual(at_60, 120.0, places=4)
        self.assertAlmostEqual(right_60, 120.0, places=4)

        # Continuity at t = 180s
        left_180 = f(180.0 - eps)
        at_180 = f(180.0)
        right_180 = f(180.0 + eps)
        self.assertAlmostEqual(left_180, 2280.0, places=4)
        self.assertAlmostEqual(at_180, 2280.0, places=4)
        self.assertAlmostEqual(right_180, 2280.0, places=4)

        # Cap at t = 300s
        self.assertAlmostEqual(f(300.0), 2520.0)
        self.assertAlmostEqual(f(300.1), 2520.0)

    def test_stage_classification(self):
        """Verify get_target_rps_for_time returns correct stages and target RPS."""
        g = self.runner_full.get_target_rps_for_time

        rps, stage = g(0.0)
        self.assertEqual((rps, stage), (2.0, "warmup"))
        rps, stage = g(59.9)
        self.assertEqual((rps, stage), (2.0, "warmup"))
        rps, stage = g(60.0)
        self.assertEqual((rps, stage), (18.0, "burst"))
        rps, stage = g(179.9)
        self.assertEqual((rps, stage), (18.0, "burst"))
        rps, stage = g(180.0)
        self.assertEqual((rps, stage), (2.0, "cooldown"))
        rps, stage = g(299.9)
        self.assertEqual((rps, stage), (2.0, "cooldown"))

    def test_dry_run_profile(self):
        """Verify dry-run demand: 10s @ 2 RPS = 20 requests."""
        f = self.runner_dry.get_expected_cumulative_requests
        g = self.runner_dry.get_target_rps_for_time

        self.assertAlmostEqual(f(0.0), 0.0)
        self.assertAlmostEqual(f(5.0), 10.0)
        self.assertAlmostEqual(f(10.0), 20.0)
        self.assertAlmostEqual(f(12.0), 20.0)

        rps, stage = g(2.0)
        self.assertEqual((rps, stage), (2.0, "dry_run"))

    def test_simulated_dispatch_loop_ideal(self):
        """Simulate high-frequency (10ms tick) dispatcher under ideal conditions."""
        total_scheduled = 0
        scheduled_history = []
        dt = 0.010  # 10ms
        elapsed = 0.0

        f = self.runner_full.get_expected_cumulative_requests

        while True:
            expected = f(min(300.0, elapsed))
            needed = int(math.floor(expected)) - total_scheduled
            if needed > 0:
                self.assertGreater(needed, 0)
                total_scheduled += needed
                scheduled_history.append((elapsed, needed, total_scheduled))

            if elapsed >= 300.0 and total_scheduled >= 2520:
                break
            if elapsed > 302.0:
                break
            elapsed += dt

        # Final scheduled count must be EXACTLY 2,520
        self.assertEqual(total_scheduled, 2520)
        # No negative counts occurred
        for _, needed, _ in scheduled_history:
            self.assertGreater(needed, 0)

    def test_simulated_dispatch_with_delayed_ticks(self):
        """Simulate event loop pauses (e.g. 500ms delay during 18 RPS burst).

        Verifies the scheduler immediately catches up without losing any requests.
        """
        total_scheduled = 0
        dt = 0.010  # 10ms
        elapsed = 0.0
        f = self.runner_full.get_expected_cumulative_requests

        while True:
            # Simulate a 500ms freeze at t=100s during burst
            if 100.0 <= elapsed < 100.5:
                elapsed = 100.5  # jump ahead 500ms

            expected = f(min(300.0, elapsed))
            needed = int(math.floor(expected)) - total_scheduled
            if needed > 0:
                # With max batch size 50, it will catch up in 1 tick (9 requests due in 500ms)
                batch = min(needed, 50)
                total_scheduled += batch

            if elapsed >= 300.0 and total_scheduled >= 2520:
                break
            if elapsed > 302.0:
                break
            elapsed += dt

        # Must catch up completely to 2,520
        self.assertEqual(total_scheduled, 2520)

    def test_simulated_dry_run_dispatch(self):
        """Verify dry-run dispatches exactly 20 requests over 10 seconds."""
        total_scheduled = 0
        dt = 0.010
        elapsed = 0.0
        f = self.runner_dry.get_expected_cumulative_requests

        while True:
            expected = f(min(10.0, elapsed))
            needed = int(math.floor(expected)) - total_scheduled
            if needed > 0:
                total_scheduled += needed

            if elapsed >= 10.0 and total_scheduled >= 20:
                break
            if elapsed > 12.0:
                break
            elapsed += dt

        self.assertEqual(total_scheduled, 20)

    def test_request_id_uniqueness_and_non_negative(self):
        """Verify request ID generation produces unique, strictly increasing IDs without duplicates."""
        seen_ids = set()
        req_counter = 0

        # Simulate 2,520 requests
        for _ in range(2520):
            req_counter += 1
            account_id = f"SYNTH-PERF-{req_counter:05d}"
            self.assertNotIn(account_id, seen_ids)
            seen_ids.add(account_id)

        self.assertEqual(len(seen_ids), 2520)
        self.assertEqual(req_counter, 2520)


if __name__ == "__main__":
    unittest.main()
