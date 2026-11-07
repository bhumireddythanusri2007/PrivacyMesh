# PrivacyMesh Mode B Benchmark Evidence (Reconstructed from CSV Telemetry)

This folder contains high-resolution empirical performance graphs generated directly from the ground-truth benchmark output file [`benchmarks/results/approach_b_corrected.csv`](file:///C:/Users/LENOVO/OneDrive/Desktop/PrivacyMesh/benchmarks/results/approach_b_corrected.csv).

---

## 1. Audit Summary: Prometheus/Grafana vs. Direct CSV Evidence

An audit comparing the live metrics in Prometheus/Grafana against the ground-truth CSV artifact reveals critical operational discrepancies:

| Visualization Domain | Grafana / Prometheus Scraping Evidence | Ground-Truth CSV Evidence (`approach_b_corrected.csv`) | Audit Assessment & Integrity Finding |
| :--- | :--- | :--- | :--- |
| **Response Latency** | `01_response_latency_percentiles.png`<br>Peaked at **~45 ms** | `01_p50_p95_latency.png`<br>Peak P95: **4,035.62 ms**, Peak P50: **3,600.43 ms** | **Misleading in Prometheus**: Prometheus 10s scrape interval and 1m rate smoothing dramatically understated the queuing latency spike during initial burst saturation. The CSV records true end-to-end client latency. |
| **Autoscaling Replicas** | `02_autoscaling_replica_count.png`<br>Flat line at **1.0 replica** | `03_backend_replicas.png`<br>Stepped from **1 to 3 replicas** at `t = 165s` | **Misleading in Prometheus**: In Mode B, the predictive `workload-controller` was scaled to 0 replicas to isolate reactive HPA. As a result, controller metrics were frozen at 1. The CSV captures live Kubernetes HPA scaling (`active_replicas`). |
| **Request Throughput** | `03_request_rate.png`<br>Flat at **~0.1 req/s** | `04_request_rate.png`<br>Shows full **24.0 req/s** burst and queue drain to **34.4 req/s** | **Incomplete in Prometheus**: Prometheus scraped service-level `/health` and `/metrics` probes, missing the actual synthetic client load sent via port-forwarding. The CSV records exact client dispatch and completion rates. |
| **Backend CPU & Memory** | `04_backend_cpu_and_memory.png`<br>Process CPU peaked at **23%** | `02_backend_cpu_memory.png`<br>Pod CPU peaked at **197m (197%)**, Memory at **223 MiB** | **Incomplete in Prometheus**: Process-level CPU does not reflect total container limits. Kubernetes top pods captured the 197% threshold breach that actually triggered the HPA scale-up. |

---

## 2. Benchmark Execution Metadata & Time Window

- **Experiment Approach**: Mode B (Reactive CPU-Based Kubernetes HPA)
- **Execution Date**: 6 November 2026
- **Wall-Clock Time Window**:
  - **IST (Local Time)**: `16:17:10 – 16:22:25 IST`
  - **UTC**: `10:47:10 – 10:52:25 UTC`
- **Total Duration**: 300 seconds (60s Warm-up @ 2 RPS &rarr; 120s Burst @ 24 RPS &rarr; 120s Cooldown @ 2 RPS)
- **Total Requests**: 3,240 scheduled / 3,240 completed (100.0% success rate, 0 errors, 0 timeouts)

---

## 3. Generated Graph Catalog & Technical Description

### 1. `01_p50_p95_latency.png`
- **Source Columns**: `elapsed_sec`, `p50_latency_ms`, `p95_latency_ms`, `avg_latency_ms`
- **Key Observation**: Documents the dramatic initial saturation spike at `t = 80s – 85s` where P95 reached `4,035.62 ms` and P50 reached `3,600.43 ms` on a single pod. Once additional replicas became healthy at `t = 165s`, latency immediately stabilized down to `11 – 25 ms`.

### 2. `02_backend_cpu_memory.png`
- **Source Columns**: `elapsed_sec`, `cpu_millicores`, `memory_mib`, `hpa_cpu_percent`
- **Key Observation**: Illustrates container CPU consumption climbing past the 60% (60m) threshold up to `197m` (197% utilization), triggering scale-up to 3 replicas. Memory stepped from `78 MiB` to `223 MiB` as 3 pods joined the active cluster.

### 3. `03_backend_replicas.png`
- **Source Columns**: `elapsed_sec`, `active_replicas`, `desired_replicas`, `min_replicas`, `max_replicas`
- **Key Observation**: Visually proves the **105-second reactive HPA delay**. Burst started at `t = 60s`, HPA evaluated `desired = 3` at `t = 150s`, and pods became ready at `t = 165s`. Additional pods served load for only the final 15 seconds of the burst.

### 4. `04_request_rate.png`
- **Source Columns**: `elapsed_sec`, `target_rps`, `actual_rps`, `http_200`
- **Key Observation**: Confirms precise rate pacing: 2.0 RPS warm-up, instantaneous step to 24.0 RPS burst, a queue-draining peak of 34.4 req/s at `t = 90s` (172 responses in 5s), and sharp drop back to 2.0 RPS cooldown.

---

## 4. Documentation of Unavailable / Excluded Metrics

In accordance with strict benchmark integrity guidelines, the following metrics were **not generated or estimated**:

1. **Granular HTTP Status Distribution**:
   - `approach_b_corrected.csv` only records aggregate `http_200` (which totals 3,240), `errors` (0), `timeouts` (0), and `conn_errors` (0).
   - Detailed breakdown by individual status code (e.g. 200 vs 201 vs 401 vs 403 vs 404 vs 500) was not logged per-window in the CSV and therefore cannot be reconstructed.
2. **Predictive Demand vs. Baseline Forecast**:
   - While the CSV contains telemetry columns for `predicted_demand_5m` and `persistence_demand_5m`, in Mode B the predictive controller was intentionally scaled to 0 replicas to isolate reactive HPA.
   - The predictor service had no endpoint traffic regex aligned to `/confidential-computing/run-demo`, so the recorded values (~14–15 req/s) reflect idle background noise rather than active predictive scaling signals.
