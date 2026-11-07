# 05. Empirical Scaling Benchmarks & Phase 12 Evaluation

---

## 1. Experimental Methodology & Workload Profile

To rigorously evaluate autoscaling efficacy, Phase 12 executed an empirical comparative benchmark across three distinct architectures:
* **Approach A**: Fixed backend with exactly 1 replica; workload controller disabled (`replicas=0`); HPA bounds fixed to $[1, 1]$.
* **Approach B**: Reactive Kubernetes HPA with minimum 1 and maximum 4 replicas; target CPU 60%; workload controller disabled (`replicas=0`).
* **Approach C**: Hybrid Predictive Scaling with workload predictor and proactive controller enabled; persistence-baseline demand signal active; isolated benchmark overlay thresholds.

### Workload Profile Parameters (Per Approach)
Each approach was subjected to a standardized, drift-free asynchronous workload profile:
1. **Warm-up Stage**: 60 seconds at **2 RPS** (120 requests scheduled)
2. **Burst Stage**: 120 seconds at **24 RPS** (2,880 requests scheduled)
3. **Cooldown Stage**: 120 seconds at **2 RPS** (240 requests scheduled)
4. **Total Planned Duration**: **300 seconds** (3,240 requests scheduled per approach)
5. **Inter-Approach Recovery Window**: **90 seconds** of mandatory cool-off between approaches to allow pods and metrics to stabilize.

### Safeguards & Invariant Controls
* **Synthetic In-Memory Workload**: Requests targeted `POST /confidential-computing/run-demo` with generated RFC-7519 JWT tokens. Zero database writes or reads occurred.
* **Database Row Invariant Verification**: Row counts on `privacymesh/db-0` were queried before and after every approach. Counts remained identically `1, 0, 0, 0, 0, 0, 0` throughout the test.
* **Automatic Restoration**: Cluster configuration snapshot was captured prior to testing and restored in a shielded cleanup routine after completion.

---

## 2. Summary Comparison Results

The table below presents the verified empirical measurements extracted from `summary_comparison_phase12_full.json` and the raw telemetry CSVs:

| Metric | Approach A: Fixed (1 Pod) | Approach B: Reactive HPA | Approach C: Predictive Hybrid |
| :--- | :---: | :---: | :---: |
| **Run Validity Classification** | **VALID_EXPERIMENT** | **VALID_EXPERIMENT** | **VALID_EXPERIMENT** |
| **Scheduled / Completed Requests** | **3,240 / 3,240** | **3,240 / 3,240** | **3,240 / 3,240** |
| **Client Pacing Lag** | 0.59% | 0.07% | 0.59% |
| **HTTP 200 Success Count** | 3,240 | 3,240 | 3,240 |
| **HTTP 4xx / 5xx Errors** | 0 / 0 | 0 / 0 | 0 / 0 |
| **Timeouts / Connection Drops** | 0 / 0 | 0 / 0 | 0 / 0 |
| **Error Rate** | **0.00%** | **0.00%** | **0.00%** |
| **Overall Mean Latency** | **10.30 ms** | **10.08 ms** | **19.82 ms** |
| **Median Latency (P50)** | 9.76 ms | 9.51 ms | 11.71 ms |
| **Max Observed P50** | 12.88 ms | 11.45 ms | 109.04 ms |
| **Mean P95 Latency** | 13.00 ms | 13.42 ms | 44.87 ms |
| **Max Observed P95** | 21.16 ms | 46.77 ms | 1,946.60 ms* |
| **Mean P99 Latency** | 14.47 ms | 15.77 ms | 47.06 ms |
| **Max Observed P99** | 27.86 ms | 126.99 ms | 2,030.10 ms* |
| **Replicas (Min / Max Reached)** | **1 / 1** | **1 / 2** | **1 / 4** |
| **Peak Total Pod CPU** | 82m | 78m | 369m |
| **Average Total Pod CPU** | 33.9m | 42.2m | 100.7m |
| **Peak Total Pod Memory** | 108.0 MiB | 182.0 MiB | 308.0 MiB |
| **Average Total Pod Memory** | 106.8 MiB | 119.4 MiB | 224.1 MiB |

---

## 3. Detailed Stage-by-Stage Performance Breakdown

### A. Warm-up Stage (0 s to 60 s @ 2 RPS)
* **Approach A**: Mean latency 10.11 ms, Mean P50 10.00 ms, Mean P95 11.99 ms, CPU 4.5m, 1 replica.
* **Approach B**: Mean latency 10.99 ms, Mean P50 10.04 ms, Mean P95 13.71 ms, CPU 3.7m, 1 replica.
* **Approach C**: Mean latency 10.36 ms, Mean P50 10.30 ms, Mean P95 11.88 ms, CPU 3.0m, 1 replica.
* *Observation*: Baseline operational latencies were indistinguishable across all three architectures prior to load onset.

### B. Burst Stage (60 s to 180 s @ 24 RPS)
* **Approach A (Fixed 1 Pod)**:
  * Sustained the entire 24 RPS burst on a single pod.
  * Mean latency: 10.17 ms, Mean P95: 13.38 ms, Peak P95: 16.74 ms, Peak P99: 27.86 ms.
  * CPU steadily rose to peak at **82m** (utilizing ~82% of the 100m CPU request).
* **Approach B (Reactive HPA)**:
  * Single pod handled the burst initial phase; CPU reached **78m**.
  * **Reactive Scaling Delay**: Because the HPA requires multiple metric scrape cycles to register utilization above 60%, scale-up to 2 pods was delayed until $T \approx 185\text{ s}$ (just as the burst concluded).
  * Mean latency: 9.85 ms, Mean P95: 14.61 ms, Peak P95: 46.77 ms, Peak P99: 126.99 ms.
* **Approach C (Predictive Hybrid)**:
  * Proactive controller detected the persistence demand spike at $T=75\text{ s}$ ($2,123.96\text{ req/5m}$), triggering immediate scale-up to `minReplicas=2` at $T=80\text{ s}$.
  * Continued burst traffic pushed demand above thresholds, scaling to 3 replicas at $T=100\text{ s}$ and all 4 replicas at $T=115\text{ s}$.
  * Total CPU across the 4 replicas peaked at **369m**.
  * Latency under 4 replicas settled to **P50: 8.9–9.4 ms** and **P95: 11.5–12.9 ms**.

### C. Cooldown Stage (180 s to 300 s @ 2 RPS)
* **Approach A**: Settled back to 2 RPS smoothly; CPU decayed from 82m to 9m.
* **Approach B**: Replicas operated at 2 pods during early cooldown, then HPA stabilization window stepped replicas back down to 1 at $T=295\text{ s}$.
* **Approach C**: Persistence demand decayed from 7,199 down to 600. Controller initiated scale-down at $T=290\text{ s}$ (lowering `minReplicas` to 1), with active replicas stepping from 4 to 3 at $T=295\text{ s}$.

---

## 4. Analysis of Empirical Anomalies & Implementation Findings

### A. Transient Latency Spike in Approach C ($T = 80\text{ s}$)
* **Measurement**: At elapsed $T = 80\text{ s}$, Approach C exhibited a brief tail latency spike: P50 rose to **109.04 ms**, P95 reached **1,946.60 ms**, and P99 reached **2,030.10 ms**.
* **Root Cause**: At $T = 80\text{ s}$, the controller patched `minReplicas=2` on `backend-hpa`. Kubernetes immediately scheduled new backend pods. During container initialization, readiness probe polling, and endpoint routing registration under concurrent 24 RPS load, incoming HTTP requests experienced temporary queueing delays at the Nginx reverse proxy / NodePort router.
* **Recovery**: Within 5 seconds ($T = 85\text{ s}$), the second replica became ready. P95 latency immediately plummeted back to **17.14 ms**, and remained under **13 ms** for the remainder of the burst.

### B. Incomplete Scale-Down Within the Benchmark Window (Approach C)
* **Measurement**: At the conclusion of Approach C ($T = 300\text{ s}$), the active replica count stood at **3**, rather than returning completely to **1**.
* **Root Cause**: The workload controller enforces a 45-second scale-down stabilization cooldown (`SCALE_DOWN_COOLDOWN_SECONDS=45`). Cooldown traffic began at $T=180\text{ s}$, but persistence demand decayed gradually across Prometheus rate windows. The controller lowered `minReplicas` to 1 at $T=290\text{ s}$. Kubernetes stepped active replicas from 4 down to 3 at $T=295\text{ s}$. The 300-second benchmark timer expired before the subsequent HPA stabilization window stepped replicas from 3 to 1.
* **Restoration**: The benchmark harness's `finally` block successfully scaled the deployment back to 1 replica immediately upon benchmark completion.

---

## 5. Raw Result Artifact Index (`D:\PrivacyMesh_Results\`)

| Artifact File | Description | Checksum / Size |
| :--- | :--- | :---: |
| `approach_a_phase12_full.csv` | Raw 60-tick telemetry CSV for Approach A (Fixed 1 Pod). | 8,387 bytes |
| `approach_b_phase12_full.csv` | Raw 60-tick telemetry CSV for Approach B (Reactive HPA). | 8,365 bytes |
| `approach_c_phase12_full.csv` | Raw 60-tick telemetry CSV for Approach C (Predictive Scaling). | 8,647 bytes |
| `summary_comparison_phase12_full.json` | Generated statistical summary JSON across all approaches. | 2,399 bytes |

---

## 6. Generated Visual Figures & Phase 14 Result Analysis

High-resolution presentation graphs and academic analyses generated from these telemetry datasets are cataloged in [`docs/phase14_results/`](phase14_results/README.md):

* [**Comprehensive Master Dashboard**](phase14_results/comprehensive_phase12_dashboard.png) (`comprehensive_phase12_dashboard.png`): Unified 6-panel comparison figure.
* [**Mean Latency Comparison**](phase14_results/mean_latency_comparison.png) (`mean_latency_comparison.png`): Sliding-window mean response durations.
* [**Latency Percentiles Distribution**](phase14_results/latency_percentiles_comparison.png) (`latency_percentiles_comparison.png`): Median (P50), 95th (P95), and 99th (P99) percentile curves.
* [**CPU Utilization Over Time**](phase14_results/cpu_utilization_over_time.png) (`cpu_utilization_over_time.png`): Total pod millicores vs. 60% HPA target.
* [**Memory Utilization Over Time**](phase14_results/memory_utilization_over_time.png) (`memory_utilization_over_time.png`): Total resident memory footprint (MiB).
* [**Replica Scaling Dynamics**](phase14_results/replica_scaling_dynamics.png) (`replica_scaling_dynamics.png`): Active pod counts, showing predictive lead vs. reactive lag.
* [**Request Throughput & Pacing**](phase14_results/request_throughput_pacing.png) (`request_throughput_pacing.png`): Target vs. achieved client request throughput.
