"""
PrivacyMesh Phase 12: Comparative Benchmark Report Generator.

Reads raw CSV telemetry files from benchmarks/results/ for:
  - Approach A: Fixed 1-replica deployment
  - Approach B: Reactive CPU-based HPA
  - Approach C: Prediction-assisted scaling

Calculates empirical statistical summaries and outputs:
  - benchmarks/results/summary_comparison.json
  - Formatted Markdown comparative table

Classifies runs into five mutually exclusive validity states:
  1. VALID_EXPERIMENT: Expected requests scheduled, generator kept pace, valid server telemetry.
  2. SERVER_OVERLOADED: Pacing sustained, but backend exhibited high 5xx errors or timeouts (valid scaling stress result).
  3. LOAD_GENERATOR_LIMITED: Host client lagged by >10% in scheduling target RPS (benchmark machine bottleneck).
  4. INFRASTRUCTURE_FAILURE: Backend unreachable or connection refused on >50% of requests.
  5. INCOMPLETE_RUN: Missing essential telemetry samples (>20% of ticks) or test ended prematurely.
"""

import argparse
import csv
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

def get_results_dir() -> Path:
    """Resolve results directory from BENCHMARK_RESULTS_DIR environment variable or fallback to default."""
    env_dir = os.getenv("BENCHMARK_RESULTS_DIR")
    if env_dir and env_dir.strip():
        p = Path(env_dir.strip())
    else:
        p = Path(__file__).resolve().parent / "results"
    p.mkdir(parents=True, exist_ok=True)
    return p


RESULTS_DIR = get_results_dir()


def load_csv_data(filepath: Path) -> List[Dict[str, Any]]:
    """Load and parse raw CSV benchmark log without silently zeroing missing telemetry."""
    if not filepath.exists():
        return []

    rows = []
    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            parsed = {}
            for k, v in r.items():
                if v is None or v == "" or v == "None":
                    parsed[k] = None
                elif k in ["elapsed_sec", "scheduled_requests", "completed_requests",
                           "http_200", "errors", "timeouts", "conn_errors",
                           "active_replicas", "desired_replicas", "min_replicas",
                           "max_replicas", "cpu_millicores", "hpa_cpu_percent"]:
                    parsed[k] = int(float(v))
                elif k in ["target_rps", "actual_rps", "generator_lag_pct", "avg_latency_ms",
                           "p50_latency_ms", "p90_latency_ms", "p95_latency_ms", "p99_latency_ms",
                           "memory_mib", "predicted_demand_5m", "persistence_demand_5m"]:
                    parsed[k] = float(v)
                else:
                    parsed[k] = v
            rows.append(parsed)
    return rows


def analyze_approach(rows: List[Dict[str, Any]], approach_name: str, is_dry_run: bool = False) -> Dict[str, Any]:
    """Compute empirical performance KPIs and classify validity rigorously."""
    if not rows:
        return {"approach": approach_name, "status": "NO_DATA"}

    last_row = rows[-1]
    total_scheduled = last_row.get("scheduled_requests") or sum(r.get("http_200", 0) + r.get("errors", 0) for r in rows)
    total_completed = last_row.get("completed_requests") or sum(r.get("http_200", 0) + r.get("errors", 0) for r in rows)
    total_http_200 = sum(r.get("http_200", 0) for r in rows)
    total_errors = sum(r.get("errors", 0) for r in rows)
    total_timeouts = sum(r.get("timeouts", 0) for r in rows)
    total_conn_errors = sum(r.get("conn_errors", 0) for r in rows)
    if total_errors == 0 and total_timeouts == 0 and total_conn_errors == 0 and total_completed > total_http_200:
        total_http_200 = total_completed

    # Missing telemetry audit
    missing_cpu_ticks = sum(1 for r in rows if r.get("cpu_millicores") is None)
    missing_replica_ticks = sum(1 for r in rows if r.get("active_replicas") is None)
    total_ticks = len(rows)

    # Generator lag audit
    max_lag = max((r.get("generator_lag_pct", 0.0) or 0.0) for r in rows)
    avg_lag = round(sum((r.get("generator_lag_pct", 0.0) or 0.0) for r in rows) / max(1, total_ticks), 2)

    error_rate = round((total_errors / max(1, total_completed)) * 100.0, 2)

    # Expected requests benchmark check (3240 for 24 RPS burst, 2520 for 18 RPS burst)
    burst_rps_observed = max((r.get("target_rps", 0.0) or 0.0) for r in rows) if rows else 18.0
    expected_full_requests = 3240 if burst_rps_observed >= 22.0 else 2520
    is_volume_limited = (not is_dry_run) and (total_completed < int(expected_full_requests * 0.90))

    # Mutually exclusive classification
    if total_completed == 0 or total_conn_errors >= max(1, int(total_completed * 0.5)):
        run_status = "INFRASTRUCTURE_FAILURE (Endpoint Unreachable / Connection Refused)"
        is_valid = False
    elif (missing_cpu_ticks / max(1, total_ticks)) > 0.20 or (missing_replica_ticks / max(1, total_ticks)) > 0.20:
        run_status = "INCOMPLETE_RUN (Missing Essential Cluster Telemetry > 20%)"
        is_valid = False
    elif not is_dry_run and total_ticks < 50:  # 300s run should have ~60 ticks; <50 indicates premature abort
        run_status = "INCOMPLETE_RUN (Experiment Terminated Prematurely)"
        is_valid = False
    elif avg_lag > 10.0 or is_volume_limited:
        deficit_pct = round(max(0.0, (1.0 - (total_completed / max(1, expected_full_requests))) * 100.0), 2)
        effective_lag = max(avg_lag, deficit_pct)
        run_status = f"LOAD_GENERATOR_LIMITED (Pacing Lag/Deficit {effective_lag}% > 10% Threshold)"
        is_valid = False
    elif error_rate > 50.0 or total_timeouts > (total_completed * 0.3):
        run_status = "SERVER_OVERLOADED (High Server Saturation / Timeouts)"
        is_valid = True
    elif is_dry_run:
        run_status = "VALID_DRY_RUN (10s Pipeline Verified)"
        is_valid = True
    else:
        run_status = "VALID_EXPERIMENT"
        is_valid = True

    # Latencies from successful responses
    all_lats = [r["avg_latency_ms"] for r in rows if r.get("avg_latency_ms") is not None]
    burst_lats = [r["avg_latency_ms"] for r in rows if r.get("stage") == "burst" and r.get("avg_latency_ms") is not None]
    p95_lats = [r["p95_latency_ms"] for r in rows if r.get("p95_latency_ms") is not None]

    overall_avg_lat = round(sum(all_lats) / max(1, len(all_lats)), 2) if all_lats else None
    burst_avg_lat = round(sum(burst_lats) / max(1, len(burst_lats)), 2) if burst_lats else None
    max_p95_lat = max(p95_lats) if p95_lats else None

    # Replicas
    all_replicas = [r["active_replicas"] for r in rows if r.get("active_replicas") is not None]
    max_replicas = max(all_replicas) if all_replicas else None
    min_replicas = min(all_replicas) if all_replicas else None

    # Resource usage
    all_cpus = [r["cpu_millicores"] for r in rows if r.get("cpu_millicores") is not None]
    all_mems = [r["memory_mib"] for r in rows if r.get("memory_mib") is not None]
    max_cpu_mcores = max(all_cpus) if all_cpus else None
    avg_cpu_mcores = round(sum(all_cpus) / max(1, len(all_cpus)), 1) if all_cpus else None
    max_memory_mib = max(all_mems) if all_mems else None
    avg_memory_mib = round(sum(all_mems) / max(1, len(all_mems)), 1) if all_mems else None

    # Dynamic scaling detection (T_scale_up, T_scale_down)
    t_burst_start = 60
    t_burst_end = 180
    scale_up_sec = None
    scale_down_sec = None

    for r in rows:
        act = r.get("active_replicas")
        if r.get("stage") == "burst" and act is not None and act >= 2 and scale_up_sec is None:
            scale_up_sec = r.get("elapsed_sec", 60) - t_burst_start

    for r in rows:
        act = r.get("active_replicas")
        if r.get("stage") == "cooldown" and act is not None and act == 1 and scale_down_sec is None and scale_up_sec is not None:
            scale_down_sec = r.get("elapsed_sec", 180) - t_burst_end

    return {
        "approach": approach_name,
        "run_status": run_status,
        "is_valid_for_comparison": is_valid,
        "sample_ticks": total_ticks,
        "missing_telemetry_ticks": missing_cpu_ticks,
        "scheduled_requests": total_scheduled,
        "completed_requests": total_completed,
        "generator_avg_lag_pct": avg_lag,
        "total_success": total_http_200,
        "total_errors": total_errors,
        "timeouts": total_timeouts,
        "connection_errors": total_conn_errors,
        "error_rate_pct": error_rate,
        "overall_avg_latency_ms": overall_avg_lat,
        "burst_avg_latency_ms": burst_avg_lat,
        "max_p95_latency_ms": max_p95_lat,
        "min_replicas_observed": min_replicas,
        "max_replicas_reached": max_replicas,
        "scale_up_response_time_sec": scale_up_sec,
        "scale_down_duration_sec": scale_down_sec,
        "max_cpu_millicores": max_cpu_mcores,
        "avg_cpu_millicores": avg_cpu_mcores,
        "max_memory_mib": max_memory_mib,
        "avg_memory_mib": avg_memory_mib,
    }


def generate_markdown_comparison_table(results: Dict[str, Dict[str, Any]]) -> str:
    """Generate Markdown comparison table across approaches, separating invalid runs."""
    a = results.get("Approach A", {})
    b = results.get("Approach B", {})
    c = results.get("Approach C", {})

    def fmt(val, unit="", default="N/A"):
        if val is None or val == "NO_DATA":
            return default
        return f"{val}{unit}"

    md = []
    md.append("### Empirical Scaling Performance Comparison (Phase 12)\n")
    md.append("| Performance Metric | Approach A: Fixed 1 Replica | Approach B: Reactive CPU HPA | Approach C: Prediction-Assisted |")
    md.append("| :--- | :---: | :---: | :---: |")
    md.append(f"| **Validity Classification** | **{fmt(a.get('run_status'))}** | **{fmt(b.get('run_status'))}** | **{fmt(c.get('run_status'))}** |")
    md.append(f"| **Autoscaling Policy** | None (Static) | Reactive CPU Target 60% | Hybrid (Proactive + Reactive) |")
    md.append(f"| **Scheduled / Completed Requests** | {fmt(a.get('scheduled_requests'))} / {fmt(a.get('completed_requests'))} | {fmt(b.get('scheduled_requests'))} / {fmt(b.get('completed_requests'))} | {fmt(c.get('scheduled_requests'))} / {fmt(c.get('completed_requests'))} |")
    md.append(f"| **Client Pacing Lag** | {fmt(a.get('generator_avg_lag_pct'), '%')} | {fmt(b.get('generator_avg_lag_pct'), '%')} | {fmt(c.get('generator_avg_lag_pct'), '%')} |")
    md.append(f"| **HTTP 200 Success Count** | {fmt(a.get('total_success'))} | {fmt(b.get('total_success'))} | {fmt(c.get('total_success'))} |")
    md.append(f"| **Timeouts / Connection Errors** | {fmt(a.get('timeouts'))} / {fmt(a.get('connection_errors'))} | {fmt(b.get('timeouts'))} / {fmt(b.get('connection_errors'))} | {fmt(c.get('timeouts'))} / {fmt(c.get('connection_errors'))} |")
    md.append(f"| **Error Rate** | {fmt(a.get('error_rate_pct'), '%')} | {fmt(b.get('error_rate_pct'), '%')} | {fmt(c.get('error_rate_pct'), '%')} |")
    md.append(f"| **Overall Mean Latency** | {fmt(a.get('overall_avg_latency_ms'), ' ms')} | {fmt(b.get('overall_avg_latency_ms'), ' ms')} | {fmt(c.get('overall_avg_latency_ms'), ' ms')} |")
    md.append(f"| **Peak Burst Mean Latency** | {fmt(a.get('burst_avg_latency_ms'), ' ms')} | {fmt(b.get('burst_avg_latency_ms'), ' ms')} | {fmt(c.get('burst_avg_latency_ms'), ' ms')} |")
    md.append(f"| **Max P95 Latency** | {fmt(a.get('max_p95_latency_ms'), ' ms')} | {fmt(b.get('max_p95_latency_ms'), ' ms')} | {fmt(c.get('max_p95_latency_ms'), ' ms')} |")
    md.append(f"| **Replicas (Min / Max Reached)** | {fmt(a.get('min_replicas_observed'))} / {fmt(a.get('max_replicas_reached'))} | {fmt(b.get('min_replicas_observed'))} / {fmt(b.get('max_replicas_reached'))} | {fmt(c.get('min_replicas_observed'))} / {fmt(c.get('max_replicas_reached'))} |")
    md.append(f"| **Scale-Up Time ($T_{{\\text{{scale-up}}}}$)** | {fmt(a.get('scale_up_response_time_sec'), ' s', 'N/A (Fixed)')} | {fmt(b.get('scale_up_response_time_sec'), ' s')} | {fmt(c.get('scale_up_response_time_sec'), ' s')} |")
    md.append(f"| **Scale-Down Time ($T_{{\\text{{scale-down}}}}$)** | {fmt(a.get('scale_down_duration_sec'), ' s', 'N/A (Fixed)')} | {fmt(b.get('scale_down_duration_sec'), ' s')} | {fmt(c.get('scale_down_duration_sec'), ' s')} |")
    md.append(f"| **Max Pod CPU** | {fmt(a.get('max_cpu_millicores'), 'm')} | {fmt(b.get('max_cpu_millicores'), 'm')} | {fmt(c.get('max_cpu_millicores'), 'm')} |")
    md.append(f"| **Average Pod CPU** | {fmt(a.get('avg_cpu_millicores'), 'm')} | {fmt(b.get('avg_cpu_millicores'), 'm')} | {fmt(c.get('avg_cpu_millicores'), 'm')} |")
    md.append(f"| **Max Memory Usage** | {fmt(a.get('max_memory_mib'), ' MiB')} | {fmt(b.get('max_memory_mib'), ' MiB')} | {fmt(c.get('max_memory_mib'), ' MiB')} |")

    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="PrivacyMesh Phase 12 Comparative Benchmark Report Generator")
    parser.add_argument("--tag", default="corrected",
                        help="Result tag to analyze, e.g. 'corrected', 'full', 'dryrun' (default: corrected)")
    args = parser.parse_args()

    results_dir = get_results_dir()
    results_dir.mkdir(parents=True, exist_ok=True)
    summary: Dict[str, Dict[str, Any]] = {}

    tag = args.tag.lower()
    default_dir = Path(__file__).resolve().parent / "results"
    for mode, name in [("a", "Approach A"), ("b", "Approach B"), ("c", "Approach C")]:
        path = results_dir / f"approach_{mode}_{tag}.csv"
        is_dry = False
        if not path.exists():
            # Fallback to full or dryrun if tag file not found in results_dir
            alt_path = results_dir / f"approach_{mode}_full.csv"
            if alt_path.exists():
                path = alt_path
            elif (default_dir / f"approach_{mode}_{tag}.csv").exists():
                path = default_dir / f"approach_{mode}_{tag}.csv"
            elif (default_dir / f"approach_{mode}_full.csv").exists():
                path = default_dir / f"approach_{mode}_full.csv"
            else:
                path = results_dir / f"approach_{mode}_dryrun.csv"
                if not path.exists() and (default_dir / f"approach_{mode}_dryrun.csv").exists():
                    path = default_dir / f"approach_{mode}_dryrun.csv"
                is_dry = True

        rows = load_csv_data(path)
        summary[name] = analyze_approach(rows, name, is_dry_run=is_dry)

    json_path = results_dir / f"summary_comparison_{tag}.json" if tag != "full" else results_dir / "summary_comparison.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    md_table = generate_markdown_comparison_table(summary)
    print(f"\n[ReportGenerator] Results directory: {results_dir}")
    print("\n" + md_table + "\n")
    print(f"Summary JSON saved to: {json_path}")


if __name__ == "__main__":
    main()
