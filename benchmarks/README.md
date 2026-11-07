# PrivacyMesh Phase 12: Comparative Performance Benchmarks

This directory contains the empirical benchmarking suite for evaluating PrivacyMesh Kubernetes scaling architectures under realistic synthetic banking KYC traffic patterns.

---

## 1. Overview & Evaluated Approaches

The benchmark compares three scaling strategies under identical, reproducible 300-second step-burst workload profiles:

| Approach | Scaling Policy | HPA Configuration | Workload Controller | Expected Dynamics |
| :--- | :--- | :--- | :--- | :--- |
| **Approach A** | Fixed (No Autoscaling) | `minReplicas=1, maxReplicas=1` | Scaled to 0 (Stopped) | Severe queue buildup & latency surge during burst |
| **Approach B** | Reactive CPU HPA | `minReplicas=1, maxReplicas=4, target=60%` | Scaled to 0 (Stopped) | Scaling lag during initial 30–45s; recovers after scale-out |
| **Approach C** | Prediction-Assisted | `minReplicas=dynamic, maxReplicas=4, target=60%` | Running (Persistence baseline) | Proactive pod pre-warming at/before burst onset; lower latency variance |

---

## 2. Standard Workload Profile

Every run executes for exactly **300 seconds (5 minutes)** generating **2,520 synthetic requests**:

- **Stage 1 (0 – 60s, 60s duration)**: Warm-up @ **2.0 req/s** (120 requests). Establishes quiescent baseline.
- **Stage 2 (60 – 180s, 120s duration)**: Burst Spike @ **18.0 req/s** (2,160 requests). Drives CPU demand beyond 60% of single pod.
- **Stage 3 (180 – 300s, 120s duration)**: Recovery Cooldown @ **2.0 req/s** (240 requests). Measures scale-down stabilization and termination.
- **Inter-Run Pause**: 90-second quiescent window between successive approaches.

---

## 3. Safety, Fault Recovery & Invariant Guarantees

1. **State Capture & Signal-Shielded Restoration**:
   - At startup, the runner captures the live cluster configuration (`hpa_min_replicas`, `hpa_max_replicas`, `controller_replicas`, `backend_replicas`).
   - A global `finally` block and signal handlers (`SIGINT`, `SIGTERM`, `SIGBREAK`) ensure that the exact captured state is restored and verified against the Kubernetes API.
   - Restoration is shielded against signal interruption.
   - *Limitation Notice*: Uncatchable signals (`SIGKILL`, `taskkill /F`, hard power loss, kernel OOM kills) terminate processes instantly and cannot be intercepted by user-space code. If an uncatchable kill occurs, run the manual recovery command printed during pre-flight.
2. **Kubernetes Readiness Gate**:
   - After applying any mode transition, the harness actively polls `kubectl get hpa` and `kubectl get deployment` until HPA bounds, controller replica count, and backend deployment match the expected state before generating any traffic.
3. **Zero Database Ingestion**:
   - All traffic targets `POST /confidential-computing/run-demo`, executing in-memory simulated TEE risk evaluations. No database sessions or SQL writes occur.
4. **Stateless JWT Authorization**:
   - Authentication uses a cryptographically signed HMAC-SHA256 JWT (`sub: 9999`, `username: synth_perf_runner`, `role: customer`) generated directly in-memory using `JWT_SECRET_KEY`. No customer account lookup or registration occurs.
5. **Database Row Count Invariants**:
   - Row counts are queried before and after every run:
     $$\text{users}=44,\;\text{txns}=40,\;\text{kyc\_records}=40,\;\text{submissions}=36,\;\text{versions}=36,\;\text{reviews}=0,\;\text{audit}=36$$
   - Any difference aborts the suite immediately.
6. **Port Isolation**:
   - The Kubernetes backend is accessed strictly through `localhost:8088`, preventing collision with Docker Compose on port `8000`.

---

## 4. Run Validity Classifications

The report generator classifies every run into one of five mutually exclusive states:

1. `VALID_EXPERIMENT`: All requests scheduled, generator lag $<10\%$, telemetry $>80\%$ complete, error rate $<50\%$.
2. `SERVER_OVERLOADED`: Pacing sustained, but backend exhibited high 5xx errors or timeouts (valid scaling stress result).
3. `LOAD_GENERATOR_LIMITED`: Client host lagged by $>10\%$ in scheduling target rate (benchmark machine bottleneck, not a valid server test).
4. `INFRASTRUCTURE_FAILURE`: Backend unreachable or connection refused on $>50\%$ of requests.
5. `INCOMPLETE_RUN`: Missing essential telemetry samples ($>20\%$ of ticks) or test ended prematurely.

---

## 5. CLI Execution Modes

### A. Pure Read-Only Check (`--check-only`)
Performs pre-flight inspection without changing cluster state or sending HTTP traffic:
```bash
python benchmarks/run_scaling_experiments.py --check-only
```
- Cluster state modified: **NO (0%)**
- HTTP traffic sent: **NO (0 requests)**
- Database modified: **NO**

### B. Pipeline Dry-Run (`--dry-run`)
End-to-end validation of the test harness (10 seconds, 20 synthetic requests):
```bash
python benchmarks/run_scaling_experiments.py --mode A --dry-run
```
- Cluster state modified: **Temporarily** (sets mode for 10s and immediately restores exact initial snapshot).
- HTTP traffic sent: **YES** (20 synthetic requests to `/confidential-computing/run-demo`).
- Database modified: **NO** (in-memory math only, verified by before/after invariant audit).

### C. Full Production Experiments
```bash
# Individual approach (300 seconds)
python benchmarks/run_scaling_experiments.py --mode A
python benchmarks/run_scaling_experiments.py --mode B
python benchmarks/run_scaling_experiments.py --mode C

# Full sequential comparative suite with 90s cool-offs
python benchmarks/run_scaling_experiments.py --mode all
```

### D. Generate Report
```bash
python benchmarks/generate_report.py
```

---

## 6. Manual Recovery Commands

If an uncatchable process termination (`SIGKILL`, hard reboot) interrupts a run while a mode is active, execute this manual recovery command in PowerShell:

```powershell
kubectl patch hpa backend-hpa -n privacymesh --type=merge -p '{"spec":{"minReplicas":1,"maxReplicas":4}}'
kubectl scale deployment workload-controller --replicas=1 -n privacymesh
kubectl scale deployment backend --replicas=1 -n privacymesh
```
