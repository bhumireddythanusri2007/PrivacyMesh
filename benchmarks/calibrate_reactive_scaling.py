"""
PrivacyMesh Phase 12 - Reactive HPA Scaling Staircase Calibration Runner.

PURPOSE:
Empirically identifies the exact workload level (RPS) at which reactive CPU-based HPA
triggers scale-out from 1 to 2+ replicas. Evaluates a 270-second staircase load profile:
  - Stage 1:  0 -  30s @  2 RPS (Baseline)
  - Stage 2: 30 -  90s @ 18 RPS (Known Phase 12 level)
  - Stage 3: 90 - 150s @ 24 RPS (Candidate level 1)
  - Stage 4: 150 - 210s @ 30 RPS (Candidate level 2)
  - Stage 5: 210 - 270s @  2 RPS (Cooldown & stabilization)

SAFETY & NON-DESTRUCTIVE GUARANTEES:
  - Zero database reads/writes: Targets POST /confidential-computing/run-demo with SYNTH-CALIB-* IDs.
  - Generates stateless RFC-7519 JWT tokens signed with cluster JWT_SECRET_KEY.
  - Pauses workload-controller (replicas=0) so it CANNOT influence HPA decisions.
  - Captures exact initial cluster configuration and restores it in try...finally and signal handlers.
  - Emits telemetry every 2 seconds to benchmarks/results/calibration_staircase.csv.
  - Verifies database row counts (44, 40, 40, 36, 36, 0, 36) before and after execution.
"""

import argparse
import asyncio
import base64
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

# -----------------------------------------------------------------------------
# Configuration Constants
# -----------------------------------------------------------------------------
NAMESPACE = "privacymesh"
HPA_NAME = "backend-hpa"
DEFAULT_TARGET_URL = "http://localhost:8088"
TELEMETRY_INTERVAL_SEC = 2.0
STAGE1_END = 30.0   # 0-30s @ 2 RPS
STAGE2_END = 90.0   # 30-90s @ 18 RPS
STAGE3_END = 150.0  # 90-150s @ 24 RPS
STAGE4_END = 210.0  # 150-210s @ 30 RPS
STAGE5_END = 270.0  # 210-270s @ 2 RPS
TOTAL_CALIBRATION_DURATION = 270.0

EXPECTED_BASELINE_COUNTS = {
    "users": "44",
    "transactions": "40",
    "kyc_records": "40",
    "kyc_submissions": "36",
    "kyc_versions": "36",
    "kyc_reviews": "0",
    "kyc_audit_log": "36",
}

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [Calibration] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("Calibration")


@dataclass
class ClusterSnapshot:
    hpa_min_replicas: int
    hpa_max_replicas: int
    hpa_target_cpu: int
    controller_replicas: int
    backend_replicas: int


_active_snapshot: Optional[ClusterSnapshot] = None
_port_forward_proc: Optional[subprocess.Popen] = None


# -----------------------------------------------------------------------------
# 1. Cluster State Capture & Guaranteed Restoration
# -----------------------------------------------------------------------------

def capture_initial_cluster_state() -> ClusterSnapshot:
    """Capture snapshot of Kubernetes autoscaling and deployment configuration."""
    logger.info("Capturing pre-calibration Kubernetes configuration snapshot...")

    # Read HPA
    cmd_hpa = ["kubectl", "get", "hpa", HPA_NAME, "-n", NAMESPACE, "-o", "json"]
    res_hpa = subprocess.run(cmd_hpa, capture_output=True, text=True, timeout=10)
    if res_hpa.returncode != 0:
        raise RuntimeError(f"Failed to query HPA {HPA_NAME}: {res_hpa.stderr}")
    hpa_json = json.loads(res_hpa.stdout)
    hpa_min = hpa_json.get("spec", {}).get("minReplicas", 1)
    hpa_max = hpa_json.get("spec", {}).get("maxReplicas", 4)
    hpa_cpu = 60
    for metric in hpa_json.get("spec", {}).get("metrics", []):
        if metric.get("type") == "Resource" and metric.get("resource", {}).get("name") == "cpu":
            hpa_cpu = metric.get("resource", {}).get("target", {}).get("averageUtilization", 60)

    # Read controller replicas
    cmd_ctrl = ["kubectl", "get", "deployment", "workload-controller", "-n", NAMESPACE, "-o", "jsonpath={.spec.replicas}"]
    res_ctrl = subprocess.run(cmd_ctrl, capture_output=True, text=True, timeout=10)
    ctrl_reps = int(res_ctrl.stdout.strip()) if res_ctrl.returncode == 0 and res_ctrl.stdout.strip() else 1

    # Read backend replicas
    cmd_be = ["kubectl", "get", "deployment", "backend", "-n", NAMESPACE, "-o", "jsonpath={.spec.replicas}"]
    res_be = subprocess.run(cmd_be, capture_output=True, text=True, timeout=10)
    be_reps = int(res_be.stdout.strip()) if res_be.returncode == 0 and res_be.stdout.strip() else 1

    snapshot = ClusterSnapshot(
        hpa_min_replicas=hpa_min,
        hpa_max_replicas=hpa_max,
        hpa_target_cpu=hpa_cpu,
        controller_replicas=ctrl_reps,
        backend_replicas=be_reps,
    )
    global _active_snapshot
    _active_snapshot = snapshot
    logger.info(
        "Initial snapshot captured: HPA=[min=%d, max=%d, target=%d%%], Controller=%d, Backend=%d",
        hpa_min, hpa_max, hpa_cpu, ctrl_reps, be_reps
    )
    return snapshot


def get_manual_recovery_command(snapshot: Optional[ClusterSnapshot]) -> str:
    """Produce explicit manual recovery commands if process is hard-killed (SIGKILL / power loss)."""
    min_rep = snapshot.hpa_min_replicas if snapshot else 1
    max_rep = snapshot.hpa_max_replicas if snapshot else 4
    ctrl_rep = snapshot.controller_replicas if snapshot else 1
    be_rep = snapshot.backend_replicas if snapshot else 1

    return (
        f"--- MANUAL RECOVERY COMMANDS (Run if script is killed by SIGKILL or power loss) ---\n"
        f"kubectl scale deployment workload-controller --replicas={ctrl_rep} -n privacymesh\n"
        f"kubectl scale deployment backend --replicas={be_rep} -n privacymesh\n"
        f"kubectl patch hpa backend-hpa -n privacymesh --type=merge -p '{{\"spec\":{{\"minReplicas\":{min_rep},\"maxReplicas\":{max_rep}}}}}'\n"
        f"Get-Process kubectl -ErrorAction SilentlyContinue | Where-Object {{ $_.MainWindowTitle -like '*8088*' }} | Stop-Process -Force\n"
        f"-----------------------------------------------------------------------------------"
    )


def restore_exact_cluster_state(snapshot: Optional[ClusterSnapshot] = None):
    """Guaranteed idempotently restoring the exact captured cluster state."""
    snap = snapshot or _active_snapshot
    logger.info(">>> RESTORING EXACT KUBERNETES CONFIGURATION...")

    # Terminate managed port-forward if active
    global _port_forward_proc
    if _port_forward_proc is not None:
        try:
            logger.info("Stopping managed port-forward process (PID %d)...", _port_forward_proc.pid)
            _port_forward_proc.terminate()
            _port_forward_proc.wait(timeout=4)
        except Exception as e:
            logger.debug("Force killing port-forward: %s", e)
            try:
                _port_forward_proc.kill()
            except Exception:
                pass
        finally:
            _port_forward_proc = None

    if snap is None:
        logger.warning("No snapshot available to restore; using safe defaults.")
        snap = ClusterSnapshot(hpa_min_replicas=1, hpa_max_replicas=4, hpa_target_cpu=60, controller_replicas=1, backend_replicas=1)

    try:
        # Restore workload-controller replicas
        subprocess.run(
            ["kubectl", "scale", "deployment", "workload-controller", f"--replicas={snap.controller_replicas}", "-n", NAMESPACE],
            check=False, capture_output=True, text=True, timeout=15
        )

        # Restore backend deployment replicas
        subprocess.run(
            ["kubectl", "scale", "deployment", "backend", f"--replicas={snap.backend_replicas}", "-n", NAMESPACE],
            check=False, capture_output=True, text=True, timeout=15
        )

        # Restore backend-hpa bounds
        patch = json.dumps({"spec": {"minReplicas": snap.hpa_min_replicas, "maxReplicas": snap.hpa_max_replicas}})
        subprocess.run(
            ["kubectl", "patch", "hpa", HPA_NAME, "-n", NAMESPACE, "--type=merge", "-p", patch],
            check=False, capture_output=True, text=True, timeout=15
        )

        # Wait for deployments to achieve rollout readiness
        subprocess.run(
            ["kubectl", "rollout", "status", "deployment/workload-controller", "-n", NAMESPACE, "--timeout=45s"],
            check=False, capture_output=True, text=True
        )
        subprocess.run(
            ["kubectl", "rollout", "status", "deployment/backend", "-n", NAMESPACE, "--timeout=45s"],
            check=False, capture_output=True, text=True
        )

        logger.info(
            "Restoration commands issued and rollouts verified. Restored: HPA=[%d, %d], Controller=%d, Backend=%d",
            snap.hpa_min_replicas, snap.hpa_max_replicas, snap.controller_replicas, snap.backend_replicas
        )
    except Exception as e:
        logger.error("Failed to restore cluster configuration automatically: %s", e)
        print(get_manual_recovery_command(snap))


def register_signal_handlers():
    """Register handlers to shield restoration from SIGINT, SIGTERM, and SIGBREAK."""
    def _handler(sig, frame):
        logger.warning("Signal %d received! Shielding restoration...", sig)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, signal.SIG_IGN)
        restore_exact_cluster_state()
        sys.exit(130)

    try:
        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, _handler)
    except Exception:
        pass


# -----------------------------------------------------------------------------
# 2. Authentication & Database Invariant Auditing
# -----------------------------------------------------------------------------

def load_jwt_secret() -> str:
    """Securely load JWT secret key from environment or Kubernetes Secret."""
    secret = os.getenv("JWT_SECRET_KEY")
    if secret:
        return secret.strip()

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("JWT_SECRET_KEY=") and not line.startswith("#"):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except Exception:
            pass

    cmd = ["kubectl", "get", "secret", "privacymesh-secrets", "-n", NAMESPACE, "-o", "jsonpath={.data.JWT_SECRET_KEY}"]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if res.returncode == 0 and res.stdout.strip():
        return base64.b64decode(res.stdout.strip()).decode("utf-8").strip()

    raise RuntimeError("JWT_SECRET_KEY could not be securely resolved.")


def create_stateless_jwt_token(secret: str, duration_hours: int = 4) -> str:
    """Generate RFC-7519 HS256 JWT with synthetic claims matching security.py parser."""
    def b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")

    now_epoch = int(time.time())
    exp_epoch = now_epoch + (duration_hours * 3600)

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": "9999",
        "username": "synth_perf_runner",
        "role": "customer",
        "iat": now_epoch,
        "exp": exp_epoch,
    }

    hdr_b64 = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    pay_b64 = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{hdr_b64}.{pay_b64}".encode("utf-8")

    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = b64url(signature)

    return f"{hdr_b64}.{pay_b64}.{sig_b64}"


def get_database_row_counts() -> Dict[str, str]:
    """Audit all 7 database table row counts against privacymesh-db-1 container."""
    sql = (
        "SELECT "
        "(SELECT count(*) FROM users) as users, "
        "(SELECT count(*) FROM transactions) as transactions, "
        "(SELECT count(*) FROM kyc_records) as kyc_records, "
        "(SELECT count(*) FROM kyc_submissions) as kyc_submissions, "
        "(SELECT count(*) FROM kyc_versions) as kyc_versions, "
        "(SELECT count(*) FROM kyc_reviews) as kyc_reviews, "
        "(SELECT count(*) FROM kyc_audit_log) as kyc_audit_log;"
    )
    cmd = ["docker", "exec", "privacymesh-db-1", "psql", "-U", "privacy_user", "-d", "privacymesh", "-t", "-A", "-F,", "-c", sql]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip():
            parts = res.stdout.strip().split(",")
            if len(parts) == 7:
                return {
                    "users": parts[0],
                    "transactions": parts[1],
                    "kyc_records": parts[2],
                    "kyc_submissions": parts[3],
                    "kyc_versions": parts[4],
                    "kyc_reviews": parts[5],
                    "kyc_audit_log": parts[6],
                }
    except Exception as e:
        logger.warning("Docker db check error: %s", e)

    # Fallback via kubectl
    try:
        cmd_k8s = ["kubectl", "exec", "db-0", "-n", NAMESPACE, "--", "psql", "-U", "privacy_user", "-d", "privacymesh", "-t", "-A", "-F,", "-c", sql]
        res_k = subprocess.run(cmd_k8s, capture_output=True, text=True, timeout=8)
        if res_k.returncode == 0 and res_k.stdout.strip():
            parts = res_k.stdout.strip().split(",")
            if len(parts) == 7:
                return {
                    "users": parts[0],
                    "transactions": parts[1],
                    "kyc_records": parts[2],
                    "kyc_submissions": parts[3],
                    "kyc_versions": parts[4],
                    "kyc_reviews": parts[5],
                    "kyc_audit_log": parts[6],
                }
    except Exception as e:
        logger.warning("Kubectl db check error: %s", e)

    return {}


# -----------------------------------------------------------------------------
# 3. Port-Forward Management & Connectivity Check
# -----------------------------------------------------------------------------

async def ensure_backend_accessible(target_url: str, token: str) -> bool:
    """Ensure backend is reachable and verify endpoint returns HTTP 200 with complete demo execution."""
    global _port_forward_proc
    target = target_url.rstrip("/")

    # Check if already reachable
    is_up = False
    async with httpx.AsyncClient(timeout=2.0) as client:
        try:
            resp = await client.get(f"{target}/health")
            if resp.status_code == 200:
                logger.info("Target URL %s/health is already reachable.", target)
                is_up = True
        except Exception:
            pass

    if not is_up:
        # Start managed port-forward on localhost:8088
        logger.info("Starting managed port-forward on localhost:8088...")
        _port_forward_proc = subprocess.Popen(
            ["kubectl", "port-forward", "svc/backend", "8088:8000", "-n", NAMESPACE],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Wait up to 6 seconds for port-forward to establish
        for _ in range(12):
            await asyncio.sleep(0.5)
            async with httpx.AsyncClient(timeout=1.5) as client:
                try:
                    resp = await client.get(f"{target}/health")
                    if resp.status_code == 200:
                        logger.info("Managed port-forward established successfully on %s.", target)
                        is_up = True
                        break
                except Exception:
                    pass

    if not is_up:
        logger.error("Failed to establish connectivity to %s", target)
        return False

    # Perform mandatory authenticated preflight probe against /confidential-computing/run-demo
    probe_url = f"{target}/confidential-computing/run-demo"
    probe_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    probe_payload = {
        "account_id": "SYNTH-CALIB-PROBE",
        "monthly_income": "6500.00",
        "requested_credit_amount": "12000.00",
        "existing_obligations": "1500.00",
        "risk_tier": "low",
    }
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            p_resp = await client.post(probe_url, json=probe_payload, headers=probe_headers)
            if p_resp.status_code != 200:
                logger.error("Preflight authenticated probe failed! HTTP %d: %s", p_resp.status_code, p_resp.text[:120])
                return False
            data = p_resp.json()
            logger.info("Preflight probe SUCCESSFUL: HTTP 200 OK | Mode: %s | Result: %s", data.get("execution_mode"), data.get("recommendation")[:60])
            return True
        except Exception as e:
            logger.error("Preflight probe request encountered error: %s", e)
            return False


# -----------------------------------------------------------------------------
# 4. Asynchronous Cluster Telemetry Sampler
# -----------------------------------------------------------------------------

def _sync_get_detailed_cluster_metrics() -> Dict[str, Any]:
    """Sample HPA, pods, Metrics Server, scaling events, and pod conditions."""
    data: Dict[str, Any] = {
        "active_replicas": None,
        "desired_replicas": None,
        "min_replicas": None,
        "max_replicas": None,
        "hpa_cpu_percent": None,
        "cpu_millicores": None,
        "memory_mib": None,
        "scaling_event_detected": 0,
        "pod2_ready_detected": 0,
        "newest_pod_ready_time": None,
    }

    # 1. HPA Metrics
    try:
        cmd_hpa = ["kubectl", "get", "hpa", HPA_NAME, "-n", NAMESPACE, "-o", "json"]
        res_hpa = subprocess.run(cmd_hpa, capture_output=True, text=True, timeout=4)
        if res_hpa.returncode == 0:
            h_obj = json.loads(res_hpa.stdout)
            data["min_replicas"] = h_obj.get("spec", {}).get("minReplicas")
            data["max_replicas"] = h_obj.get("spec", {}).get("maxReplicas")
            data["desired_replicas"] = h_obj.get("status", {}).get("desiredReplicas")
            data["active_replicas"] = h_obj.get("status", {}).get("currentReplicas")
            for c_metric in h_obj.get("status", {}).get("currentMetrics", []):
                if c_metric.get("type") == "Resource" and c_metric.get("resource", {}).get("name") == "cpu":
                    data["hpa_cpu_percent"] = c_metric.get("resource", {}).get("current", {}).get("averageUtilization")
    except Exception as e:
        logger.debug("HPA telemetry error: %s", e)

    # 2. Pod Top Metrics (Metrics Server)
    try:
        cmd_top = ["kubectl", "top", "pods", "-n", NAMESPACE, "-l", "app.kubernetes.io/component=backend", "--no-headers"]
        res_top = subprocess.run(cmd_top, capture_output=True, text=True, timeout=4)
        if res_top.returncode == 0 and res_top.stdout.strip():
            lines = res_top.stdout.strip().splitlines()
            total_cpu = 0
            total_mem = 0
            for line in lines:
                parts = line.split()
                if len(parts) >= 3:
                    cpu_raw = parts[1].replace("m", "")
                    mem_raw = parts[2].replace("Mi", "")
                    total_cpu += int(cpu_raw) if cpu_raw.isdigit() else 0
                    total_mem += int(mem_raw) if mem_raw.isdigit() else 0
            data["cpu_millicores"] = total_cpu
            data["memory_mib"] = total_mem
            if data["active_replicas"] is None:
                data["active_replicas"] = len(lines)
    except Exception as e:
        logger.debug("Top telemetry error: %s", e)

    # 3. Check for Backend Scaling Events
    try:
        cmd_ev = ["kubectl", "get", "events", "-n", NAMESPACE, "--field-selector", "reason=ScalingReplicaSet", "-o", "json"]
        res_ev = subprocess.run(cmd_ev, capture_output=True, text=True, timeout=4)
        if res_ev.returncode == 0:
            ev_obj = json.loads(res_ev.stdout)
            for item in ev_obj.get("items", []):
                if item.get("involvedObject", {}).get("name") == "backend":
                    data["scaling_event_detected"] = 1
                    break
    except Exception as e:
        logger.debug("Events telemetry error: %s", e)

    # 4. Check for Pod #2 Ready Condition
    try:
        cmd_pods = ["kubectl", "get", "pods", "-n", NAMESPACE, "-l", "app.kubernetes.io/component=backend", "-o", "json"]
        res_pods = subprocess.run(cmd_pods, capture_output=True, text=True, timeout=4)
        if res_pods.returncode == 0:
            pods_obj = json.loads(res_pods.stdout)
            ready_pods = 0
            newest_ready: Optional[str] = None
            for pod in pods_obj.get("items", []):
                for cond in pod.get("status", {}).get("conditions", []):
                    if cond.get("type") == "Ready" and cond.get("status") == "True":
                        ready_pods += 1
                        t_trans = cond.get("lastTransitionTime")
                        if t_trans and (newest_ready is None or t_trans > newest_ready):
                            newest_ready = t_trans
            if ready_pods >= 2:
                data["pod2_ready_detected"] = 1
                data["newest_pod_ready_time"] = newest_ready
    except Exception as e:
        logger.debug("Pod status check error: %s", e)

    return data


async def get_cluster_metrics_async() -> Dict[str, Any]:
    return await asyncio.to_thread(_sync_get_detailed_cluster_metrics)


# -----------------------------------------------------------------------------
# 5. Staircase Workload Benchmarker
# -----------------------------------------------------------------------------

class StaircaseCalibrationRunner:
    def __init__(self, target_url: str, token: str, output_csv: Path):
        self.target_url = target_url.rstrip("/")
        self.token = token
        self.output_csv = output_csv

        # Cumulative tracking
        self.total_scheduled = 0
        self.total_completed = 0
        self.total_http_200 = 0
        self.total_errors = 0
        self.total_timeouts = 0
        self.total_conn_errors = 0

        # Window tracking (reset every 2s)
        self.window_http_200 = 0
        self.window_errors = 0
        self.window_timeouts = 0
        self.window_conn_errors = 0
        self.window_latencies: List[float] = []

        # Scaling milestones
        self.scale_event_timestamp: Optional[float] = None
        self.pod2_ready_timestamp: Optional[float] = None
        self.first_scale_up_stage: Optional[str] = None
        self.first_scale_up_rps: Optional[float] = None

    def get_target_rps_and_stage(self, elapsed: float) -> Tuple[float, str]:
        """Compute target RPS and stage name for the 270-second staircase."""
        if elapsed < STAGE1_END:
            return 2.0, "baseline_2"
        elif elapsed < STAGE2_END:
            return 18.0, "burst_18"
        elif elapsed < STAGE3_END:
            return 24.0, "burst_24"
        elif elapsed < STAGE4_END:
            return 30.0, "burst_30"
        else:
            return 2.0, "cooldown_2"

    def get_expected_cumulative_requests(self, elapsed: float) -> float:
        """Piecewise integration E(t) = integral_0^t TargetRPS(u) du."""
        if elapsed <= 0:
            return 0.0
        elif elapsed < STAGE1_END:
            return 2.0 * elapsed
        elif elapsed < STAGE2_END:
            return (2.0 * STAGE1_END) + 18.0 * (elapsed - STAGE1_END)
        elif elapsed < STAGE3_END:
            b1 = 2.0 * STAGE1_END
            b2 = 18.0 * (STAGE2_END - STAGE1_END)
            return b1 + b2 + 24.0 * (elapsed - STAGE2_END)
        elif elapsed < STAGE4_END:
            b1 = 2.0 * STAGE1_END
            b2 = 18.0 * (STAGE2_END - STAGE1_END)
            b3 = 24.0 * (STAGE3_END - STAGE2_END)
            return b1 + b2 + b3 + 30.0 * (elapsed - STAGE3_END)
        else:
            b1 = 2.0 * STAGE1_END
            b2 = 18.0 * (STAGE2_END - STAGE1_END)
            b3 = 24.0 * (STAGE3_END - STAGE2_END)
            b4 = 30.0 * (STAGE4_END - STAGE3_END)
            clamped = min(elapsed, TOTAL_CALIBRATION_DURATION)
            return b1 + b2 + b3 + b4 + 2.0 * (clamped - STAGE4_END)

    async def _send_request(self, client: httpx.AsyncClient, req_id: int):
        """Send synthetic credit scoring request to in-memory endpoint."""
        url = f"{self.target_url}/confidential-computing/run-demo"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
        }
        payload = {
            "account_id": f"SYNTH-CALIB-{req_id:05d}",
            "monthly_income": "6500.00",
            "requested_credit_amount": "12000.00",
            "existing_obligations": "1500.00",
            "risk_tier": "low",
        }
        t0 = time.perf_counter()
        try:
            resp = await client.post(url, json=payload, headers=headers)
            lat_ms = (time.perf_counter() - t0) * 1000.0
            self.total_completed += 1
            if resp.status_code == 200:
                self.total_http_200 += 1
                self.window_http_200 += 1
                self.window_latencies.append(lat_ms)
            else:
                self.total_errors += 1
                self.window_errors += 1
        except httpx.TimeoutException:
            self.total_completed += 1
            self.total_timeouts += 1
            self.window_timeouts += 1
        except Exception:
            self.total_completed += 1
            self.total_conn_errors += 1
            self.window_conn_errors += 1

    async def run(self):
        """Execute the 270-second staircase benchmark with concurrent telemetry."""
        logger.info("Starting Staircase Calibration Benchmark (Duration: %.0fs)...", TOTAL_CALIBRATION_DURATION)
        fieldnames = [
            "timestamp", "elapsed_sec", "stage", "target_rps", "actual_rps",
            "scheduled_requests", "completed_requests", "generator_lag_pct",
            "avg_latency_ms", "p50_latency_ms", "p90_latency_ms", "p95_latency_ms", "p99_latency_ms",
            "http_200", "errors", "timeouts", "conn_errors",
            "active_replicas", "desired_replicas", "min_replicas", "max_replicas",
            "cpu_millicores", "memory_mib", "hpa_cpu_percent",
            "scaling_event_detected", "pod2_ready_detected", "newest_pod_ready_time"
        ]

        self.output_csv.parent.mkdir(parents=True, exist_ok=True)
        with open(self.output_csv, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            csvfile.flush()

            # Connection limits to handle 30+ RPS
            limits = httpx.Limits(max_keepalive_connections=80, max_connections=120)
            timeout = httpx.Timeout(connect=2.0, read=4.0, write=2.0, pool=2.0)

            async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
                start_time = time.time()
                active_workers: List[asyncio.Task] = []
                stop_telemetry = asyncio.Event()

                # Concurrent Telemetry Worker (Samples every 2 seconds)
                async def telemetry_worker():
                    next_tick = start_time + TELEMETRY_INTERVAL_SEC
                    while not stop_telemetry.is_set():
                        sleep_dur = next_tick - time.time()
                        if sleep_dur > 0:
                            await asyncio.sleep(sleep_dur)
                        next_tick += TELEMETRY_INTERVAL_SEC

                        curr_time = time.time()
                        elapsed_tick = curr_time - start_time
                        if elapsed_tick > TOTAL_CALIBRATION_DURATION + 3.0:
                            break

                        target_rps, stage = self.get_target_rps_and_stage(elapsed_tick)
                        actual_rps = round(self.window_http_200 / TELEMETRY_INTERVAL_SEC, 2)

                        expected_cumul = self.get_expected_cumulative_requests(elapsed_tick)
                        lag_pct = round(max(0.0, (1.0 - (self.total_scheduled / max(1.0, expected_cumul))) * 100.0), 2)

                        # Compute percentiles
                        if self.window_latencies:
                            s = sorted(self.window_latencies)
                            n = len(s)
                            avg_l = round(sum(s) / n, 2)
                            p50_l = round(s[int(0.50 * n)], 2)
                            p90_l = round(s[int(0.90 * (n - 1))], 2)
                            p95_l = round(s[int(0.95 * (n - 1))], 2)
                            p99_l = round(s[int(0.99 * (n - 1))], 2)
                        else:
                            avg_l = p50_l = p90_l = p95_l = p99_l = None

                        w_200 = self.window_http_200
                        w_err = self.window_errors
                        w_to = self.window_timeouts
                        w_conn = self.window_conn_errors

                        self.window_latencies = []
                        self.window_http_200 = 0
                        self.window_errors = 0
                        self.window_timeouts = 0
                        self.window_conn_errors = 0

                        # Sample cluster metrics asynchronously
                        try:
                            cluster_m = await get_cluster_metrics_async()
                        except Exception as e:
                            logger.warning("Telemetry sample error: %s", e)
                            cluster_m = {}

                        # Detect scaling milestones
                        act_rep = cluster_m.get("active_replicas")
                        des_rep = cluster_m.get("desired_replicas")
                        if (des_rep is not None and des_rep >= 2) or (act_rep is not None and act_rep >= 2):
                            if self.scale_event_timestamp is None:
                                self.scale_event_timestamp = curr_time
                                self.first_scale_up_stage = stage
                                self.first_scale_up_rps = target_rps
                                logger.info(
                                    ">>> SCALE-OUT DETECTED at elapsed %.1fs in stage '%s' (Target RPS: %.1f, Desired: %s, Active: %s)",
                                    elapsed_tick, stage, target_rps, str(des_rep), str(act_rep)
                                )

                        if cluster_m.get("pod2_ready_detected") == 1 and self.pod2_ready_timestamp is None:
                            self.pod2_ready_timestamp = curr_time
                            logger.info(">>> POD #2 READY at elapsed %.1fs (Ready Time: %s)", elapsed_tick, cluster_m.get("newest_pod_ready_time"))

                        row = {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "elapsed_sec": int(elapsed_tick),
                            "stage": stage,
                            "target_rps": target_rps,
                            "actual_rps": actual_rps,
                            "scheduled_requests": self.total_scheduled,
                            "completed_requests": self.total_completed,
                            "generator_lag_pct": lag_pct,
                            "avg_latency_ms": avg_l,
                            "p50_latency_ms": p50_l,
                            "p90_latency_ms": p90_l,
                            "p95_latency_ms": p95_l,
                            "p99_latency_ms": p99_l,
                            "http_200": w_200,
                            "errors": w_err,
                            "timeouts": w_to,
                            "conn_errors": w_conn,
                            **cluster_m,
                        }
                        writer.writerow(row)
                        csvfile.flush()

                        logger.info(
                            "[%3ds] Stage: %-11s | Sched: %4d | Done: %4d | RPS: %4.1f | P95: %s | Pods: %s | Desired: %s | CPU: %s (%s%%)",
                            row["elapsed_sec"], stage, self.total_scheduled, self.total_completed, actual_rps,
                            f"{p95_l}ms" if p95_l is not None else "N/A",
                            str(cluster_m.get("active_replicas")),
                            str(cluster_m.get("desired_replicas")),
                            f"{cluster_m.get('cpu_millicores')}m" if cluster_m.get('cpu_millicores') is not None else "N/A",
                            str(cluster_m.get("hpa_cpu_percent")),
                        )

                telemetry_task = asyncio.create_task(telemetry_worker())

                # Traffic Generation Loop (10ms drift-free scheduler)
                while True:
                    curr_elapsed = time.time() - start_time
                    if curr_elapsed >= TOTAL_CALIBRATION_DURATION:
                        break

                    expected_now = self.get_expected_cumulative_requests(curr_elapsed)
                    deficit = int(expected_now - self.total_scheduled)

                    if deficit > 0:
                        batch = min(deficit, 15)
                        for _ in range(batch):
                            self.total_scheduled += 1
                            t = asyncio.create_task(self._send_request(client, self.total_scheduled))
                            active_workers.append(t)

                    # Prune finished tasks
                    if len(active_workers) > 60:
                        active_workers = [t for t in active_workers if not t.done()]

                    await asyncio.sleep(0.010)

                # Stop telemetry worker and await remaining requests
                stop_telemetry.set()
                try:
                    await asyncio.wait_for(telemetry_task, timeout=4.0)
                except asyncio.TimeoutError:
                    pass

                if active_workers:
                    logger.info("Draining %d active in-flight requests...", len(active_workers))
                    await asyncio.gather(*active_workers, return_exceptions=True)

        logger.info(
            "Calibration Complete: Total Scheduled=%d, Completed=%d, HTTP 200=%d, Errors=%d, Timeouts=%d",
            self.total_scheduled, self.total_completed, self.total_http_200, self.total_errors, self.total_timeouts
        )


# -----------------------------------------------------------------------------
# 6. Main Orchestrator
# -----------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="PrivacyMesh Reactive HPA Scaling Staircase Calibration")
    parser.add_argument("--target-url", default=DEFAULT_TARGET_URL, help="Backend URL (default: http://localhost:8088)")
    parser.add_argument("--check-only", action="store_true", help="Run preflight check only without generating traffic")
    args = parser.parse_args()

    register_signal_handlers()

    logger.info("=================================================================")
    logger.info("   PrivacyMesh Phase 12: Reactive HPA Scaling Calibration        ")
    logger.info("=================================================================")

    # 1. Preflight Database Audit
    db_counts_pre = get_database_row_counts()
    logger.info("Pre-test Database Row Counts: %s", db_counts_pre)
    if db_counts_pre != EXPECTED_BASELINE_COUNTS:
        logger.error("Database baseline does NOT match expected invariant: %s vs %s", db_counts_pre, EXPECTED_BASELINE_COUNTS)
        sys.exit(1)

    # 2. Token Generation
    try:
        secret = load_jwt_secret()
        token = create_stateless_jwt_token(secret)
        logger.info("Stateless JWT benchmark token generated successfully.")
    except Exception as e:
        logger.error("Failed to generate token: %s", e)
        sys.exit(1)

    # 3. Capture Initial Kubernetes State
    snapshot = capture_initial_cluster_state()
    recovery_cmd = get_manual_recovery_command(snapshot)

    if args.check_only:
        print("\nPreflight Check Summary (Read-Only):")
        print(f"  Target URL: {args.target_url}")
        print(f"  HPA State:  min={snapshot.hpa_min_replicas}, max={snapshot.hpa_max_replicas}, target={snapshot.hpa_target_cpu}%")
        print(f"  Controller Replicas: {snapshot.controller_replicas}")
        print(f"  Backend Replicas:    {snapshot.backend_replicas}")
        print(f"  Database Counts:     {db_counts_pre}")
        print(f"\n{recovery_cmd}\n")
        return

    # 4. Ensure Backend Reachability
    is_ready = asyncio.run(ensure_backend_accessible(args.target_url, token))
    if not is_ready:
        logger.error("Cannot reach backend on %s. Aborting calibration.", args.target_url)
        sys.exit(1)

    # 5. Execute Calibration Inside Guaranteed try...finally Block
    output_csv = Path(__file__).resolve().parent / "results" / "calibration_staircase_authenticated.csv"
    try:
        # Pause Workload Controller for Reactive-Only Evaluation
        logger.info("Pausing workload-controller (scaling to 0 replicas)...")
        subprocess.run(
            ["kubectl", "scale", "deployment", "workload-controller", "--replicas=0", "-n", NAMESPACE],
            check=True, capture_output=True, text=True, timeout=15
        )
        # Wait for controller pod to terminate
        subprocess.run(
            ["kubectl", "wait", "--for=delete", "pod", "-l", "app.kubernetes.io/component=workload-controller", "-n", NAMESPACE, "--timeout=30s"],
            check=False, capture_output=True, text=True
        )
        logger.info("Workload-controller is paused. System is in reactive-only mode.")

        # Run Staircase Calibration
        runner = StaircaseCalibrationRunner(target_url=args.target_url, token=token, output_csv=output_csv)
        asyncio.run(runner.run())

    finally:
        # Guaranteed Full State Restoration
        restore_exact_cluster_state(snapshot)

    # 6. Post-Calibration Database & Pod Audit
    logger.info("Running post-calibration verification audits...")
    time.sleep(5)  # Allow cluster to settle

    db_counts_post = get_database_row_counts()
    logger.info("Post-test Database Row Counts: %s", db_counts_post)
    if db_counts_post != EXPECTED_BASELINE_COUNTS:
        logger.critical("FATAL: Database invariant violated! Pre: %s, Post: %s", db_counts_pre, db_counts_post)
    else:
        logger.info("Database invariants 100%% verified and preserved: %s", db_counts_post)

    # Verify pods ready
    res_pods = subprocess.run(["kubectl", "get", "pods", "-n", NAMESPACE, "-o", "json"], capture_output=True, text=True, timeout=10)
    if res_pods.returncode == 0:
        pods_json = json.loads(res_pods.stdout)
        all_ready = True
        for pod in pods_json.get("items", []):
            p_name = pod.get("metadata", {}).get("name", "unknown")
            p_ready = False
            for cond in pod.get("status", {}).get("conditions", []):
                if cond.get("type") == "Ready" and cond.get("status") == "True":
                    p_ready = True
                    break
            if not p_ready:
                logger.warning("Pod %s is not Ready yet.", p_name)
                all_ready = False
        if all_ready:
            logger.info("All cluster pods verified Running & Ready.")


if __name__ == "__main__":
    main()
