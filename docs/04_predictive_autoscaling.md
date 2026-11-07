# 04. Predictive Autoscaling & Workload Controller

---

## 1. System Overview & Motivation

Standard Kubernetes Horizontal Pod Autoscaling (HPA) operates **reactively**: it observes resource metrics (e.g., average CPU utilization) and scales pod replicas only after high load has breached the configured threshold. For banking applications with bursty traffic (e.g., end-of-quarter KYC submission deadlines), reactive scaling often lags demand spikes by 60–120 seconds due to metric scrape delays and container initialization times.

PrivacyMesh implements a **hybrid predictive autoscaling architecture**:
* An intelligent **Workload Predictor** evaluates real-time traffic dynamics from Prometheus.
* A dedicated **Workload Controller** proactively raises the HPA's `minReplicas` setting ahead of capacity exhaustion.
* The reactive CPU-based HPA remains active to handle unforeseen load spikes, bounded by `maxReplicas = 4`.

```
                                  +---------------------------------------+
                                  |         Prometheus Server             |
                                  |    (Scrapes backend /metrics :10s)    |
                                  +---------------------------------------+
                                                      |
                                                      | PromQL Traffic Queries (every 15s)
                                                      v
                                  +---------------------------------------+
                                  |       Workload Predictor Pod          |
                                  |  • Safe Persistence Baseline (Active) |
                                  |  • XGBoost Regressor (Comparative)    |
                                  +---------------------------------------+
                                                      |
                                                      | HTTP GET /predict
                                                      v
                                  +---------------------------------------+
                                  |       Workload Controller Pod         |
                                  |  • Maps demand to minReplicas [1, 4]  |
                                  |  • Anti-flapping scale-down timer     |
                                  |  • Safe holding on network failure    |
                                  +---------------------------------------+
                                                      |
                                                      | RBAC PATCH spec.minReplicas
                                                      v
+-------------------------------+ +---------------------------------------+
|     Backend Deployment        | |           backend-hpa                 |
|  • Replicas: 1 to 4 Pods      |<|  • spec.minReplicas: 1-4 (Patched)    |
|  • CPU Target: 60% (Reactive) | |  • spec.maxReplicas: 4 (Fixed)        |
+-------------------------------+ +---------------------------------------+
```

---

## 2. Workload Predictor Architecture (`workload-predictor`)

The `workload-predictor` microservice (`workload_prediction/predictor/app.py`) is deployed as a standalone container exposing port `8080`.

### A. Active Control Signal: Safe Persistence Baseline
Production autoscaling decisions are driven by the **Safe Persistence Baseline**:
* The predictor queries Prometheus for the recent HTTP request rate across the configured endpoint regex:
  $$\text{Rate} = \text{rate}\left(\text{privacymesh\_http\_requests\_total}[\text{window}]\right)$$
* It projects this observed rate forward across a 5-minute horizon ($300\text{ seconds}$):
  $$\text{Baseline Demand} = \text{Rate} \times 300$$
* **Why Persistence Baseline Controls Scaling**:
  Unlike machine learning regressors, which can produce out-of-distribution hallucinations under novel burst patterns, the persistence baseline provides a guaranteed, deterministic lower bound directly coupled to live transaction volume.

### B. Comparative Monitoring: XGBoost Regressor
Running in parallel with the persistence baseline, the predictor executes an XGBoost Regressor (`kyc_workload_xgb.json`):
* **Model Purpose**: Comparative observability, historical drift detection, and telemetry tracking. **It does not directly trigger production scaling decisions.**
* **Input Feature Vector** (10 features):
  1. `hour_sin`, `hour_cos`: Cyclical diurnal encoding of hour of day.
  2. `day_of_week_sin`, `day_of_week_cos`: Cyclical weekly pattern encoding.
  3. `is_business_hours`: Binary indicator ($1.0$ if 09:00–17:00 on weekdays, else $0.0$).
  4. `http_request_rate_5m`: General HTTP request rate over the past 5 minutes.
  5. `kyc_submission_rate_5m`: KYC submission rate over the past 5 minutes.
  6. `kyc_submission_rate_15m`: KYC submission rate over the past 15 minutes.
  7. `lag_1_demand`: Observed demand from the prior 5-minute interval.
  8. `lag_2_demand`: Observed demand from two intervals prior.
* **Inference Endpoint (`GET /predict`)**:
  Returns a unified JSON payload:
  ```json
  {
    "status": "success",
    "predicted_kyc_demand_5m": 33.35,
    "baseline_persistence_demand": 7200.0,
    "demand_label": "predicted_kyc_demand_5m",
    "endpoint_regex": ".*submissions.*",
    "rate_window": "5m",
    "inference_duration_ms": 38.5
  }
  ```

---

## 3. Workload Controller Architecture (`workload-controller`)

The `workload-controller` (`workload_prediction/controller/controller.py`) is a custom reconciliation daemon running under dedicated Kubernetes RBAC permissions.

### A. Least-Privilege RBAC Permissions (`kubernetes/13-workload-controller-rbac.yaml`)
To prevent unauthorized cluster modifications, the controller's ServiceAccount is strictly isolated:
* **API Groups**: `["autoscaling"]`
* **Resources**: `["horizontalpodautoscalers"]`
* **Resource Names**: Restricted exclusively to `["backend-hpa"]`
* **Verbs**: `["get", "patch"]`
* The controller cannot modify Deployments, create or delete Pods directly, or access Secrets or ConfigMaps.

### B. Demand-to-Replica Mapping Rules
The controller polls `/predict` every reconciliation interval and maps demand to recommended minimum replicas:

$$\text{Recommended Replicas} = \begin{cases}
1 & \text{if } \text{Demand} \le \text{THRESHOLD\_REPLICAS\_2} \\
2 & \text{if } \text{THRESHOLD\_REPLICAS\_2} < \text{Demand} \le \text{THRESHOLD\_REPLICAS\_3} \\
3 & \text{if } \text{THRESHOLD\_REPLICAS\_3} < \text{Demand} \le \text{THRESHOLD\_REPLICAS\_4} \\
4 & \text{if } \text{Demand} > \text{THRESHOLD\_REPLICAS\_4}
\end{cases}$$

The resulting replica count is clamped to the absolute boundaries $[\text{ABSOLUTE\_MIN\_REPLICAS}, \text{ABSOLUTE\_MAX\_REPLICAS}] = [1, 4]$.

### C. Configurable Production vs. Benchmark Thresholds

| Configuration Variable | Production Default | Phase 12 Benchmark Overlay | Purpose |
| :--- | :---: | :---: | :--- |
| `SCALING_PREDICTION_SOURCE` | `persistence_baseline` | `persistence_baseline` | Demand signal used for HPA patching. |
| `RECONCILE_INTERVAL_SECONDS`| `15` | `10` | Frequency of reconciliation loop execution. |
| `SCALE_DOWN_COOLDOWN_SECONDS`| `60` | `45` | Hysteresis stabilization window before scale-down. |
| `THRESHOLD_REPLICAS_2` | `15.0` | `1200.0` | Demand threshold to trigger 2 minimum replicas. |
| `THRESHOLD_REPLICAS_3` | `30.0` | `3600.0` | Demand threshold to trigger 3 minimum replicas. |
| `THRESHOLD_REPLICAS_4` | `45.0` | `6000.0` | Demand threshold to trigger 4 minimum replicas. |

---

## 4. Safety & Stabilization Mechanisms

1. **Immediate Scale-Up**:
   When demand rises above a threshold, the controller immediately patches `minReplicas` on `backend-hpa` without delay, ensuring pods begin provisioning before traffic peaks.
2. **Scale-Down Hysteresis (Anti-Flapping)**:
   When demand drops, the controller enters a stabilization cooldown (`SCALE_DOWN_COOLDOWN_SECONDS`). If demand remains below the lower threshold for the full duration, it lowers `minReplicas`. This prevents rapid oscillation ("pod flapping").
3. **Outage Fallback (Safe Holding)**:
   If the predictor microservice or Prometheus becomes unreachable, the controller logs a warning, sets its operational health metric `privacymesh_controller_health_status = 0`, and **holds the last known safe capacity**. It never scales down during telemetry failures.
4. **Preservation of Reactive HPA**:
   By patching **only** `spec.minReplicas`, the controller never overrides the reactive CPU utilization metric (`60%`) or `maxReplicas = 4`. If CPU spikes for reasons unrelated to request volume (e.g., cryptographic processing), the reactive HPA can still scale pods up to 4.
