# 06. Operations & Maintenance Runbook

---

## 1. Operating Environment Prerequisites

PrivacyMesh is designed for **strictly local execution** on Windows 11. No external cloud credentials or cloud subscriptions are required.

* **Operating System**: Windows 11 (x64) with WSL2 enabled.
* **Container Runtime**: Docker Desktop v24+ (WSL2 backend).
* **Kubernetes Engine**: Minikube v1.39+ with Docker driver (`--driver=docker`).
* **CLI Tools**: `kubectl`, `docker`, `powershell` (v7+ or Windows PowerShell 5.1).
* **Runtime**: Python 3.12+ (for running test harnesses and benchmark scripts).

---

## 2. Docker Compose Operations

### A. Startup & Service Verification
To start the entire five-container local environment:
```powershell
# 1. Ensure .env is populated from example
if (!(Test-Path .env)) { Copy-Item .env.example .env }

# 2. Build and start containers in detached mode
docker compose up -d --build

# 3. Verify container health status (all 5 should report healthy)
docker compose ps
```

### B. Health Verification Endpoints
```powershell
# Backend API process health
curl http://localhost:8000/health
# Response: {"status":"healthy"}

# Database connectivity via privacy_app
curl http://localhost:8000/db-health
# Response: {"status":"connected","database":"PostgreSQL"}

# Process telemetry status
curl http://localhost:8000/monitoring/status

# Prometheus server health
curl http://localhost:9090/-/healthy
# Response: Prometheus Server is Healthy.

# Grafana portal health
curl http://localhost:3000/api/health
# Response: {"commit":"...","database":"ok","version":"..."}
```

### C. Graceful Teardown
```powershell
# Stop and remove containers, preserving database volumes
docker compose down

# CAUTION: Never pass -v unless intentional complete database purge is desired
```

---

## 3. Minikube Kubernetes Operations

### A. Cluster Startup & Addon Configuration
```powershell
# 1. Start Minikube with sufficient resources for ML & monitoring pods
minikube start --driver=docker --cpus=2 --memory=3072m

# 2. Enable Metrics Server for HPA CPU metrics
minikube addons enable metrics-server

# 3. Verify node and metrics server readiness
kubectl get nodes
kubectl get deployment metrics-server -n kube-system
```

### B. Pre-loading Container Images
To avoid external registry pulls inside Minikube:
```powershell
minikube image load postgres:16
minikube image load privacymesh-backend:latest
minikube image load privacymesh-frontend:latest
minikube image load prom/prometheus:latest
minikube image load grafana/grafana:latest
minikube image load privacymesh-workload-predictor:latest
minikube image load privacymesh-workload-controller:latest
```

### C. Staged Manifest Deployment
Manifests must be applied in dependency order:
```powershell
# 1. Generate local Kubernetes secrets from .env
.\kubernetes\generate-secrets.ps1

# 2. Base namespace, secrets, and configuration
kubectl apply -f kubernetes/00-namespace.yaml
kubectl apply -f kubernetes/01-secrets.yaml
kubectl apply -f kubernetes/02-configmap.yaml

# 3. Database tier (StatefulSet with 2Gi PVC)
kubectl apply -f kubernetes/03-postgres-statefulset.yaml
kubectl rollout status statefulset/db -n privacymesh --timeout=90s

# 4. Backend gateway tier
kubectl apply -f kubernetes/04-backend-deployment.yaml
kubectl apply -f kubernetes/05-backend-service.yaml
kubectl rollout status deployment/backend -n privacymesh --timeout=90s

# 5. Frontend presentation tier
kubectl apply -f kubernetes/06-frontend-deployment.yaml
kubectl apply -f kubernetes/07-frontend-service.yaml
kubectl rollout status deployment/frontend -n privacymesh --timeout=60s

# 6. Horizontal Pod Autoscaler (HPA)
kubectl apply -f kubernetes/08-hpa.yaml

# 7. Monitoring tier (Prometheus, Grafana, Dashboards)
kubectl apply -f kubernetes/09-prometheus.yaml
kubectl apply -f kubernetes/10-grafana.yaml
kubectl apply -f kubernetes/11-grafana-dashboard-configmap.yaml
kubectl rollout status deployment/prometheus -n privacymesh --timeout=90s
kubectl rollout status deployment/grafana -n privacymesh --timeout=90s

# 8. Predictive autoscaling tier (Predictor & RBAC Controller)
kubectl apply -f kubernetes/12-workload-predictor.yaml
kubectl apply -f kubernetes/13-workload-controller-rbac.yaml
kubectl apply -f kubernetes/14-workload-controller.yaml
kubectl rollout status deployment/workload-predictor -n privacymesh --timeout=60s
kubectl rollout status deployment/workload-controller -n privacymesh --timeout=60s
```

### D. Cluster Health Inspection Commands
```powershell
# List all pods and services across namespace
kubectl get pods,services,hpa -n privacymesh -o wide

# Check CPU and memory consumption across pods
kubectl top pods -n privacymesh

# Inspect active HPA targets and replica counts
kubectl get hpa backend-hpa -n privacymesh

# Query PostgreSQL row count invariants on db-0
kubectl exec -n privacymesh db-0 -- psql -U privacy_user -d privacymesh -c "SELECT count(*) FROM users;"
```

---

## 4. Observability & Alerting Reference

### A. Pre-Configured Alerting Policies (`monitoring/prometheus/alerts.yml`)
Prometheus evaluates five alerting rules every 10 seconds:

| Alert Name | Severity | Condition | Description |
| :--- | :---: | :--- | :--- |
| `BackendUnavailable` | `critical` | `up{job="privacymesh-backend"} == 0` for 30s | FastAPI backend instance is down or unreachable. |
| `DatabaseUnavailable`| `critical` | `privacymesh_db_connected == 0` for 30s | Database probe failed to connect via `privacy_app`. |
| `HighCPUUsage` | `warning` | `privacymesh_process_cpu_percent > 85` for 1m | Backend process CPU consumption exceeds 85%. |
| `HighMemoryUsage` | `warning` | `privacymesh_process_memory_percent > 85` for 1m | Backend process memory exceeds 85% of host RAM. |
| `HighHttp5xxErrorRate`| `critical`| 5xx error rate $> 5\%$ for 2m | Backend service is experiencing high server failure rates. |

### B. Grafana Dashboard Reference (`UID: privacymesh-overview`)
The pre-provisioned dashboard **PrivacyMesh Application Observability** includes:
* **Service Status Banner**: Target health badges (`UP`/`DOWN`), DB connectivity, and error budget counters.
* **Traffic Panels**: Request rate time-series (`req/s`) partitioned by normalized endpoint route.
* **Latency Quantiles**: p50 median, p95, and p99 response duration curves.
* **System Telemetry**: Process RSS memory curves and process CPU utilization percentages.

---

## 5. Troubleshooting & Common Operational Issues

### Issue 1: Metrics Server Not Reporting (`unknown` in HPA)
* **Symptom**: `kubectl get hpa` reports `cpu: <unknown>/60%`.
* **Cause**: Minikube Metrics Server takes 30–60 seconds after startup to gather the initial CPU scrape sample.
* **Resolution**: Wait 60 seconds and run `kubectl top pods -n privacymesh`. If still unknown, restart the addon:
  ```powershell
  minikube addons disable metrics-server
  minikube addons enable metrics-server
  ```

### Issue 2: Docker Engine Named Pipe Disconnection
* **Symptom**: `failed to connect to docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
* **Cause**: Docker Desktop background service halted during Windows host reboot or session restart.
* **Resolution**: Launch Docker Desktop and verify the daemon is responsive:
  ```powershell
  Start-Process "C:\Users\LENOVO\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"
  docker ps
  ```

### Issue 3: Stale Minikube Kubeconfig Endpoint Port
* **Symptom**: `kubectl` commands fail with `connection refused on 127.0.0.1:<old-port>`.
* **Cause**: Restarting the Minikube Docker container may dynamically re-assign the control plane port.
* **Resolution**: Refresh the active kubeconfig context:
  ```powershell
  minikube update-context
  ```

### Issue 4: Port-Forward Socket Conflicts
* **Symptom**: Benchmark scripts report `Address already in use` on port `8088`.
* **Cause**: A previous port-forward process did not terminate cleanly.
* **Resolution**: Identify and terminate the lingering process:
  ```powershell
  Get-Process kubectl -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
