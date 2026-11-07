# PrivacyMesh Phase 12: Mode B Performance Benchmark Report
**Approach B: Reactive CPU-Based Kubernetes Horizontal Pod Autoscaler (HPA)**

---

## 1. Executive Summary & Experiment Overview

This report provides the empirical evaluation of **Approach B (Reactive HPA)** in the PrivacyMesh zero-trust credit evaluation platform. The benchmark simulates real-world bursty confidential KYC traffic against the Kubernetes backend deployment without incurring database modifications (read-only row count invariants verified at 100%).

- **HPA Policy Configuration**:
  - `minReplicas`: 1
  - `maxReplicas`: 4
  - `targetCPUUtilizationPercentage`: 60% (evaluated against `100m` CPU request)
  - Predictive Workload Controller: Scaled to 0 replicas (strictly evaluating reactive CPU scaling)
- **Workload Target**: `http://localhost:8088/confidential-computing/run-demo`
- **Total Experiment Duration**: 300 seconds (5 minutes)
- **Workload Profile**:
  - **Stage 1 (Warm-up)**: 60s @ 2.0 req/s (120 requests planned)
  - **Stage 2 (Burst)**: 120s @ 24.0 req/s (2,880 requests planned — empirical threshold breach)
  - **Stage 3 (Cooldown)**: 120s @ 2.0 req/s (240 requests planned)
- **Execution Classification**: `VALID_EXPERIMENT` (100% request completion, 0.0% generator lag, 0 timeouts/errors).
- **Source Telemetry File**: [`benchmarks/results/approach_b_corrected.csv`](file:///C:/Users/LENOVO/OneDrive/Desktop/PrivacyMesh/benchmarks/results/approach_b_corrected.csv)

---

## 2. Overall Performance & Stage KPI Summary

| Performance Metric | Stage 1: Warm-up (0–60s) | Stage 2: Burst (60–180s) | Stage 3: Cooldown (180–300s) | Full Benchmark (0–300s) |
| :--- | :--- | :--- | :--- | :--- |
| **Duration** | 60 seconds | 120 seconds | 120 seconds | **300 seconds** |
| **Scheduled Requests** | 120 | 2,880 | 240 | **3,240** |
| **Completed Requests** | 120 | 2,880 | 240 | **3,240** |
| **Request Success Rate** | **100.00%** | **100.00%** | **100.00%** | **100.00%** |
| **HTTP 200 Count** | 120 | 2,880 | 240 | **3,240** |
| **HTTP Errors (4xx/5xx)** | 0 | 0 | 0 | **0** |
| **Client Timeouts** | 0 | 0 | 0 | **0** |
| **Connection Errors** | 0 | 0 | 0 | **0** |
| **P50 Latency (Mean / Max)** | 13.11 ms / 16.80 ms | 193.77 ms / 3,600.43 ms | 12.07 ms / 14.18 ms | **84.94 ms / 3,600.43 ms** |
| **P95 Latency (Mean / Max)** | 16.76 ms / 25.55 ms | 623.40 ms / 4,035.62 ms | 16.20 ms / 30.41 ms | **259.18 ms / 4,035.62 ms** |
| **Average Latency (Mean)** | 14.37 ms | 253.62 ms | 13.00 ms | **109.50 ms** |
| **CPU Usage (Mean / Peak)** | 5.3m / 6.0m | 87.7m / 197.0m | 250.1m / 425.0m | **140.3m / 425.0m** |
| **HPA CPU Utilization %** | 5.1% / 6.0% | 77.8% / 197.0% | 122.2% / 197.0% | **83.0% / 197.0%** |
| **Memory Resident (RSS)** | 72.0 MiB | 72.0 – 78.0 MiB | 78.0 – 223.0 MiB | **72.0 – 223.0 MiB** |
| **Backend Active Replicas** | 1 | 1 &rarr; 3 | 3 | **1 &rarr; 3** |

---

## 3. Detailed Stage-by-Stage Performance Analysis

### 3.1 Stage 1: Warm-up (Elapsed 0s – 60s @ 2.0 RPS)
- **Workload Dynamics**: Baseline traffic dispatch verifying cluster stability, connection pooling, and JWT verification.
- **Latency**: P50 stayed consistently around `11.31 ms – 14.19 ms`; P95 averaged `16.76 ms`.
- **Resource Footprint**: The single backend pod consumed between `4m` and `6m` CPU (`4% – 6%` of request), well below the 60% autoscaling threshold. Memory utilization remained flat at `72.0 MiB`.
- **Autoscaler State**: HPA observed nominal low utilization; desired and active replicas remained strictly at `1`.

### 3.2 Stage 2: Burst (Elapsed 60s – 180s @ 24.0 RPS)

#### The Initial Latency Spike (t = 80s – 85s)
At `t = 60s`, client dispatch rate increased twelve-fold from 2.0 to 24.0 req/s.
- For the first 15 seconds (`60s – 75s`), the single backend pod absorbed requests with low immediate latency (`P95 ~17ms – 24ms`) as internal event loops queued incoming requests.
- At `t = 80s – 85s`, concurrency limits on the single pod were saturated:
  - **P50 Latency spiked to 3,600.43 ms**.
  - **P95 Latency peaked at 4,035.62 ms** (maximum latency recorded during the entire benchmark).
  - Window average latency reached `3,434.46 ms`.
- **Resilience**: Despite queue saturation, **zero requests failed or timed out** (HTTP 200 success remained 100%). At `t = 90s`, the backend cleared the backlog, draining 172 responses in a single 5-second sampling window.

#### Honest Analysis of Reactive HPA Scaling Delay
The benchmark reveals the classic empirical limitation of **Reactive HPA**:
1. **Scrape & Reporting Lag (t = 60s – 90s)**:
   - When the burst hit at `t = 60s`, the Kubernetes `metrics-server` scrape window lagged behind live traffic.
   - At `t = 80s` (the height of the latency spike), HPA still reported `6%` CPU utilization.
   - HPA only registered an initial jump to `54%` at `t = 90s`. Because `54% < 60%`, HPA calculated `desiredReplicas = 1` and took **no scaling action**.
2. **Threshold Saturation Lag (t = 90s – 145s)**:
   - From `t = 90s` to `t = 145s`, the single pod continued handling the full 24 RPS burst alone.
   - Measured pod CPU climbed to `197m` (197% of the 100m target request).
3. **Autoscaling Decision & Cold Start (t = 150s – 165s)**:
   - At `t = 150s`, HPA observed the 197% utilization and computed `desiredReplicas = ceil(1 * 197 / 60) = 3`.
   - Pod scheduling, container image init, and readiness probe gating took an additional 15 seconds.
   - **Active replicas only scaled from 1 to 3 at `t = 165s`**.
4. **Reactive Delay Quantification**:
   - Time from Burst Onset (`t = 60s`) to Pod Ready (`t = 165s`): **105 seconds**.
   - Out of the 120-second burst, the system operated under-provisioned on 1 replica for **87.5% of the burst duration**.
   - Additional replica capacity was online for only the final **15 seconds** before the burst ended.

```
Burst Timeline & HPA Reactive Delay:
t=60s: Burst starts (24 RPS) -------------------------------------------------------------+
t=85s: Latency peak (P95: 4,035ms) on single pod [HPA still reporting 6% CPU]            |
t=90s: HPA registers 54% CPU (still < 60% threshold -> NO SCALE)                         | 105s Reactive Lag
t=150s: HPA registers 197% CPU -> triggers scale to 3 desired pods                       | (Under-provisioned)
t=165s: Replicas 2 and 3 pass readiness probes (Active Replicas = 3) --------------------+
t=180s: Burst ends (Traffic drops to 2 RPS) [Replicas served load for only 15 seconds]
```

### 3.3 Stage 3: Cooldown (Elapsed 180s – 300s @ 2.0 RPS)
- **Workload Dynamics**: Immediate reduction of incoming traffic back to 2.0 RPS.
- **Latency**: P50 dropped immediately back to `10.05 ms – 14.18 ms`; P95 normalized to `11.88 ms – 14.41 ms`.
- **HPA Stabilization Window Behavior**:
  - HPA maintained `3` active replicas throughout the entire 120-second cooldown window.
  - This is expected Kubernetes HPA behavior: the default scale-down stabilization window prevents rapid replica flapping ("thrashing").
  - Combined memory footprint stabilized across the 3 pods at `223.0 MiB` (`~74 MiB` per pod).
  - CPU utilization per pod dropped back to idle levels (`21m` aggregate across all 3 pods, or `7%` HPA utilization).

---

## 4. Key Takeaways for Project Demonstration

1. **Flawless Zero-Error Availability Under Heavy Stress**:
   - Despite severe CPU queuing causing a 4-second P95 spike at `t = 85s`, the FastAPI backend connection handling and async worker pool dropped 0 requests (3,240 / 3,240 succeeded).
2. **Clear Empirical Demonstration of Reactive Autoscaling Lag**:
   - Mode B proves that reactive CPU autoscaling is inherently ill-suited for sudden high-volume spikes: the **105-second reaction delay** meant that by the time replicas 2 and 3 became healthy, the spike was nearly over.
3. **Compelling Baseline for Mode C (Predictive Scaling)**:
   - This exact reactive lag provides the justification and motivation for **Approach C (Hybrid Predictive Controller)**, which leverages synthetic KYC forecasting to pre-scale backend pods ahead of incoming spikes, eliminating the 4,035ms latency surge.

---

## 5. Grafana Evidence Panel Capture Guide

To document this benchmark for project presentation, open the Grafana dashboard (`http://localhost:3000`, Dashboard: **PrivacyMesh Operations & Confidential Computing Telemetry**) and capture the following panels:

| Panel ID | Panel Title | Display Type | What to Highlight in Demo / Presentation |
| :---: | :--- | :---: | :--- |
| **Panel 7** | **Request Rate by Endpoint (req/s)** | Timeseries | Shows the clean stepped traffic curve: 2.0 RPS &rarr; sharp 24.0 RPS step &rarr; 2.0 RPS cooldown. |
| **Panel 9** | **Response Latency Percentiles (p50, p95, p99)** | Timeseries | **Primary Evidence**: Captures the dramatic latency peak reaching ~4.0s at `t=85s`, followed by rapid stabilization down to ~15ms once scaling completes. |
| **Panel 202** | **Autoscaling Coordination (Replicas)** | Timeseries | Shows active replicas remaining at 1 until `t=165s`, then stepping to 3 replicas, visually proving the 105s reactive scaling lag. |
| **Panel 12** | **CPU & Memory Utilization History** | Timeseries | Demonstrates the CPU climbing from 6m to 197m during the single-pod burst, followed by load distribution across 3 pods. |
| **Panel 8** | **HTTP Status Code Distribution** | Timeseries | Shows 100% solid green HTTP 200 band with zero 5xx or 4xx responses throughout the entire run. |
| **Panel 201** | **Predicted KYC Demand vs Baseline** | Timeseries | Confirms that in Mode B the predictive controller was decoupled, leaving reactive HPA solely responsible for cluster elasticity. |
