# PrivacyMesh: Confidential Computing for Sensitive Banking Workloads

PrivacyMesh is an academic research prototype and confidential computing framework designed to secure sensitive banking transaction processing and multi-role KYC (Know Your Customer) workflows.

The system combines a React 19 frontend served via Nginx, a FastAPI backend gateway running under the least-privilege `privacy_app` database account, PostgreSQL 16 with Row-Level Security (RLS) and immutable audit triggers, and cryptographic isolation architectures to protect data-in-transit, data-at-rest, and data-in-use.

---

## 1. System Architecture

PrivacyMesh is architected across three decoupled, containerized tiers connected via an internal Docker bridge network (`privacymesh_default`):

```
+-------------------------------------------------------------------------+
|                       Browser Client (User Host)                        |
|   • Customer KYC Portal      • Officer Review Queue                     |
|   • Management Console       • Administrator Observability              |
+-------------------------------------------------------------------------+
       |                                                 |
       | HTTP (Port 5173)                                | REST / JWT (Port 8000)
       v                                                 v
+------------------------------------+   +--------------------------------+
|       Frontend Container           |   |       Backend Container        |
|  • Nginx Alpine Static Server      |   |  • FastAPI (Python 3.12)       |
|  • React 19 + TypeScript + Vite    |   |  • Uvicorn ASGI Server         |
|  • Tailwind CSS v4 Responsive UI   |   |  • Argon2id Password Hashing   |
|  • Reverse Proxy (/api/ -> 8000)   |   |  • PyJWT Token Verification    |
|  • Healthcheck: wget 127.0.0.1:80  |   |  • Strict 4-Role RBAC          |
+------------------------------------+   |  • Prometheus Metrics (/metrics)
                                         |  • Healthcheck: /health        |
                                         +--------------------------------+
                                                         |
                                                         | PostgreSQL Protocol
                                                         | User: privacy_app
                                                         v
                                         +--------------------------------+
                                         |      PostgreSQL Container      |
                                         |  • PostgreSQL 16 Engine        |
                                         |  • Row-Level Security (RLS)    |
                                         |  • Immutable Audit Triggers    |
                                         |  • Multi-Role Schema           |
                                         |  • Persistent Volume (pgdata)  |
                                         |  • Healthcheck: pg_isready     |
                                         +--------------------------------+
```

---

## 2. Technology Stack

- **Frontend Container (`frontend`)**: React 19, TypeScript, Vite, Tailwind CSS 4, Nginx Alpine, Docker multi-stage build.
- **Backend Container (`backend`)**: Python 3.12, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0, Psycopg 3 binary.
- **Database Container (`db`)**: PostgreSQL 16 on internal port `5432` (host mapped to `5433`).
- **Security & Authorization**:
  - Least-Privilege Database Role: `privacy_app` (strictly non-superuser with explicit DML grants and RLS).
  - Password Hashing: Argon2id via `pwdlib`.
  - Session Authentication: JWT signed using HMAC-SHA256 (`HS256`).
  - Row-Level Security (RLS): Table policies isolating data across tenants and preventing unauthorized access.
  - Immutable Audit Log: PostgreSQL trigger functions enforcing append-only logs for all KYC reviews and version revisions.
- **Observability**: Prometheus metrics exporter (`/metrics`) and FastAPI process telemetry (`/monitoring/status`).

---

## 3. Four-Role KYC Workflow Architecture

The application enforces strict separation of duties across four specialized roles:

| Role | Workspace View | Responsibilities & Boundaries |
| :--- | :--- | :--- |
| **`customer`** | Customer KYC Hub (`My KYC`) | Creates identity submissions, uploads version revisions upon correction requests, and views final decision receipts. Internal compliance notes are strictly hidden from this role. |
| **`bank_employee`** | Compliance Officer Workbench (`Assigned Cases`) | Examines assigned customer dossiers, initiates reviews, records verification findings, and routes recommendations to management. Cannot issue binding final decisions. |
| **`bank_manager`** | Management Oversight Console (`Case Management`) | Superintends bank-wide verification cases, delegates cases to compliance officers, and issues final binding determinations (`approve`, `reject`, `manager_request_correction`). |
| **`system_admin`** | Technical Telemetry & Admin Console (`User Management`) | Monitors platform health, infrastructure telemetry, and audits user credential accounts. Strictly isolated from customer KYC dossiers to ensure regulatory privacy. |

---

## 4. Required Software

- **Docker Desktop** (version 24+ with Docker Compose v2)
- **Git** (version 2.30+)
- **Web Browser** (Google Chrome, Mozilla Firefox, or Microsoft Edge)
- **Node.js** (v18+ recommended, for local standalone frontend development outside Docker)
- **Python** (v3.12+, for running standalone CLI integration test suites)

---

## 5. Environment Configuration

Copy the provided environment template `.env.example` to `.env` before starting services:

```powershell
Copy-Item .env.example .env
```

### Configuration Variables

| Variable | Description | Example / Recommended Format |
| :--- | :--- | :--- |
| `POSTGRES_USER` | PostgreSQL superuser for database bootstrapping and DBA administration. | `privacy_user` |
| `POSTGRES_PASSWORD` | Strong password for the PostgreSQL superuser account. | `[random-secure-secret]` |
| `POSTGRES_DB` | Default database name. | `privacymesh` |
| `APP_DB_USER` | Least-privilege runtime account used by FastAPI backend. | `privacy_app` |
| `APP_DB_PASSWORD` | Secure password for the `privacy_app` PostgreSQL role. | `[random-secure-secret]` |
| `DATABASE_URL` | SQLAlchemy connection string used by FastAPI backend. | `postgresql+psycopg://privacy_app:[password]@db:5432/privacymesh` |
| `JWT_SECRET_KEY` | 64-character hexadecimal key used to sign session access tokens. | Generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins for CORS preflight. | `http://localhost:5173,http://127.0.0.1:5173` |
| `VITE_API_URL` | Base URL used by the React frontend client to invoke API endpoints. | `http://localhost:8000` |

> [!WARNING]
> Never commit real production secrets, passwords, or JWT keys to version control. Always maintain `.env` in `.gitignore`.

---

## 6. Docker Startup and Operation

### A. Initial Build & Startup

To build all container images and start the full application stack in the background:

```powershell
docker compose up -d --build
```

### B. Verify Container Status & Health

Verify that all three services are running and report `(healthy)`:

```powershell
docker compose ps
```

Expected output:
```
NAME                     IMAGE                  COMMAND                  SERVICE    STATUS                    PORTS
privacymesh-backend-1    privacymesh-backend    "uvicorn app.main:ap…"   backend    Up (healthy)              0.0.0.0:8000->8000/tcp
privacymesh-db-1         postgres:16            "docker-entrypoint.s…"   db         Up (healthy)              0.0.0.0:5433->5432/tcp
privacymesh-frontend-1   privacymesh-frontend   "/docker-entrypoint.…"   frontend   Up (healthy)              0.0.0.0:5173->80/tcp
```

### C. Viewing Service Logs

Stream unified logs or inspect individual service outputs:

```powershell
# Unified logs
docker compose logs -f

# Specific service logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

### D. Restarting Services

To restart all containers without rebuilding or losing database state:

```powershell
docker compose restart
```

### E. Graceful Shutdown

To stop and remove application containers while preserving database volume data:

```powershell
docker compose down
```

> [!CAUTION]
> Do NOT pass `-v` or `--volumes` to `docker compose down`, as that destroys persistent PostgreSQL data volumes.

---

## 7. Service Access Addresses

| Component | Host URL | Description |
| :--- | :--- | :--- |
| **Frontend Application** | `http://localhost:5173` | React 19 UI with role-based navigation and workflow views. |
| **FastAPI Backend Gateway** | `http://localhost:8000` | Core REST API gateway for authentication and workflow actions. |
| **Interactive API Documentation** | `http://localhost:8000/docs` | Swagger UI documentation with schema models and interactive testing. |
| **OpenAPI Specification** | `http://localhost:8000/openapi.json` | OpenAPI 3.1 JSON schema specification. |
| **Prometheus Web UI & Engine** | `http://localhost:9090` | Prometheus server interface for PromQL queries, targets, and alert rules. |
| **Prometheus Scrape Targets** | `http://localhost:9090/targets` | Health status of monitored services (`backend:8000`). |
| **Grafana Observability Portal** | `http://localhost:3000` | Pre-provisioned dashboards for real-time throughput, latency, and error budgets. |
| **Host Database Port** | `localhost:5433` | Host-mapped port for PostgreSQL administrative inspection. |

---

## 8. Health-Check Endpoints

Verify operational status and infrastructure connectivity using `curl`:

```powershell
# Backend process health
curl http://localhost:8000/health
# Response: {"status":"healthy"}

# PostgreSQL database connectivity (via privacy_app)
curl http://localhost:8000/db-health
# Response: {"status":"connected","database":"PostgreSQL"}

# Host and process telemetry status
curl http://localhost:8000/monitoring/status

# Frontend static delivery check
curl -I http://localhost:5173/
# Response: HTTP/1.1 200 OK

# Prometheus server health check
curl http://localhost:9090/-/healthy
# Response: Prometheus Server is Healthy.

# Grafana service health check
curl http://localhost:3000/api/health
# Response: {"commit":"...","database":"ok","version":"..."}
```

---

## 9. Observability & Telemetry Architecture (Prometheus & Grafana)

PrivacyMesh features a dedicated, production-grade monitoring architecture integrated into Docker Compose:

```
+-----------------------------------------------------------------------------------+
|                            Observability Pipeline                                 |
+-----------------------------------------------------------------------------------+
       |                                                               |
       | Scrapes metrics every 10s                                     | Queries PromQL API
       v                                                               v
+------------------------------------+                       +----------------------+
|        FastAPI Backend             |                       |       Grafana        |
|  • /metrics endpoint               |                       |  • Port 3000         |
|  • Low-cardinality label templates |                       |  • Pre-provisioned   |
|  • Process RSS & CPU gauges        |                       |    Prometheus source |
|  • DB connection health probe      |                       |  • Auto-loaded       |
+------------------------------------+                       |    Dashboard         |
       |                                                     +----------------------+
       | Scraped by                                                    ^
       v                                                               |
+----------------------------------------------------------------------+
|                     Prometheus Server (Port 9090)                    |
|  • TSDB Storage volume: privacymesh_prometheus_data                  |
|  • Scrape target: backend:8000/metrics (UP)                          |
|  • Alerting Rules: monitoring/prometheus/alerts.yml                  |
|    - BackendUnavailable: up == 0 for 30s (critical)                 |
|    - DatabaseUnavailable: privacymesh_db_connected == 0 (critical)   |
|    - HighCPUUsage: cpu > 85% for 1m (warning)                        |
|    - HighMemoryUsage: mem > 85% for 1m (warning)                     |
|    - HighHttp5xxErrorRate: 5xx rate > 5% for 2m (critical)           |
+----------------------------------------------------------------------+
```

### A. Metric Dictionary & Cardinality Protection

To prevent metric label cardinality explosion, all dynamic path segments (such as submission UUIDs or integer IDs) are normalized to `{id}` by middleware before recording counters and histograms:

| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `privacymesh_http_requests_total` | Counter | `method`, `endpoint`, `status` | Cumulative HTTP requests by normalized route. |
| `privacymesh_http_request_duration_seconds` | Histogram | `method`, `endpoint` | Request duration distribution buckets. |
| `privacymesh_http_errors_total` | Counter | `method`, `endpoint`, `error_type` | Partitioned HTTP error counts (`4xx`, `5xx`). |
| `privacymesh_db_connected` | Gauge | — | Database connection status (`1.0` = healthy, `0.0` = down). |
| `privacymesh_process_cpu_percent` | Gauge | — | FastAPI process CPU consumption percentage. |
| `privacymesh_process_memory_percent` | Gauge | — | Backend host virtual memory consumption percentage. |
| `privacymesh_process_memory_bytes` | Gauge | — | FastAPI process resident set size (RSS) memory in bytes. |

### B. Grafana Pre-Provisioned Dashboard

Grafana is automatically provisioned via YAML definitions (`monitoring/grafana/provisioning/`) with the pre-built dashboard **PrivacyMesh Application Observability** (`UID: privacymesh-overview`):
- **Service Health KPIs**: Backend Target UP/DOWN indicator, Database Connectivity badge, Total Request Counter, and Error Budget counter.
- **Traffic Dynamics**: Request rate time-series per route (`req/s`) and HTTP status code distribution (2xx, 4xx, 5xx stacked bars).
- **Latency & Reliability**: Quantile response latency (p50 median, p95, and p99 percentiles) and 4xx vs 5xx error rate curves.
- **System Telemetry**: Process RSS memory consumption time-series and CPU/Memory utilization history.

Anonymous viewer access is enabled (`GF_AUTH_ANONYMOUS_ENABLED=true`), with administrator management available using `admin` / `admin`.

### C. Infrastructure Monitoring Evaluation (cAdvisor & Windows Containers)

- **cAdvisor Evaluation**: Google cAdvisor is designed for native Linux kernel environments with direct access to `/sys/fs/cgroup` and the Docker UNIX domain socket. On Windows Docker Desktop with the WSL2 backend, running cAdvisor requires mounting host-restricted VM sockets that can trigger permissions warnings, cgroup v2 hierarchy translation errors, and elevated CPU overhead.
- **PrivacyMesh Architecture Choice**: In lieu of high-overhead WSL2 cAdvisor daemon sets, PrivacyMesh employs process-level telemetry (`psutil` in FastAPI) combined with Prometheus's native container metrics and scrape target heartbeat probes (`up{job="privacymesh-backend"}`). This provides 100% deterministic, low-overhead resource monitoring without requiring privileged Docker root capabilities.

---

## 10. Running Automated Test Suites

PrivacyMesh includes comprehensive automated test suites covering API contracts, security boundaries, multi-role KYC workflows, Prometheus/Grafana telemetry, and Kubernetes deployment with HPA.

> [!NOTE]
> Tests that perform mutation operations are executed against the isolated test database `privacymesh_test` on a dedicated test container to ensure zero data mutation to the production database.

### Kubernetes & HPA Test Suite (`test_phase9_kubernetes.py` - 5 Tests)
Validates Minikube node readiness, pod status across all 5 services in namespace `privacymesh`, PostgreSQL internal ClusterIP isolation (verifying no NodePort and no external exposure), Metrics Server telemetry (`kubectl top`), and HPA target metric readiness:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_phase9_kubernetes.py -v
```

### Monitoring & Telemetry Test Suite (`test_phase8_monitoring.py` - 7 Tests)
Validates backend `/monitoring/status`, Prometheus metrics export, cardinality normalization, Prometheus target health, Prometheus alert rules, Grafana datasource provisioning, and dashboard availability:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_phase8_monitoring.py -v
```

### Integration Test Suite (`test_phase6_integration.py` - 23 Tests)
Verifies full end-to-end KYC workflows, resubmission versioning, employee review delegations, manager determinations, cross-customer isolation, and administrator access restrictions:

```powershell
$env:TEST_BASE_URL="http://127.0.0.1:8001"
.\.venv\Scripts\python.exe tests\test_phase6_integration.py
```

### Legacy API Regression Suite (`test_api.py` - 27 Tests)
Verifies registration, JWT auth, transactions, legacy KYC records, confidential computing simulation, and system telemetry:

```powershell
$env:TEST_BASE_URL="http://127.0.0.1:8001"
.\.venv\Scripts\python.exe tests\test_api.py
```

### Workflow E2E Suite (`test_workflow_e2e.py` - 13 Tests)
Verifies sequential workflow lifecycle state transitions and integrity guards:

```powershell
$env:TEST_BASE_URL="http://127.0.0.1:8001"
.\.venv\Scripts\python.exe tests\test_workflow_e2e.py
```

### Headless Browser Verification Suite (`browser_verification.js` - 33 Tests)
Executes Chrome DevTools Protocol automation across desktop, tablet, and mobile breakpoints, testing forms, modals, error states, and responsive navigation:

```powershell
node tests/browser_verification.js
```

---

## 11. Kubernetes Deployment & Horizontal Pod Autoscaling (Minikube)

PrivacyMesh features a dedicated, local Kubernetes orchestration architecture with automated Horizontal Pod Autoscaling (HPA) targeting Minikube on Windows with the Docker driver.

### A. Kubernetes Tier Architecture

```
+-----------------------------------------------------------------------------------------+
|                               Minikube Kubernetes Cluster                               |
|                                (Namespace: privacymesh)                                 |
+-----------------------------------------------------------------------------------------+
       |                                                    |
       | NodePort: 30080                                    | NodePort: 30800
       v                                                    v
+-------------------------------+                  +-------------------------------+
|    frontend (Deployment)      |                  |     backend (Deployment)      |
|  • Replicas: 1                |  HTTP API        |  • Replicas: 1-4 (Auto-scaled)|
|  • Port: 80 (NodePort 30080)  |----------------->|  • Port: 8000 (NodePort 30800)|
|  • Probes: /, period 5s       |                  |  • CPU Request: 100m, Max 500m|
+-------------------------------+                  +-------------------------------+
                                                                    ^           |
                                              HPA: Target 60% CPU   |           | Port 5432
                                             (autoscaling/v2)       |           | (ClusterIP ONLY)
                                                                    |           v
+-------------------------------+                  +-------------------------------+
|    prometheus (Deployment)    |                  |        db (StatefulSet)       |
|  • Replicas: 1                |                  |  • PostgreSQL 16 Engine       |
|  • Port: 9090 (NodePort 30090)|                  |  • PVC: db-data (2Gi Storage) |
|  • Scrapes: backend:8000      |                  |  • ClusterIP Service (db:5432)|
+-------------------------------+                  |  • Strictly Internal Isolation|
               |                                   +-------------------------------+
               | PromQL Datasource
               v
+-------------------------------+
|     grafana (Deployment)      |
|  • Replicas: 1                |
|  • Port: 3000 (NodePort 30030)|
|  • PVC: grafana-storage (1Gi) |
|  • Auto-loaded Dashboards     |
+-------------------------------+
```

### B. Kubernetes Manifest Index (`kubernetes/`)

The `kubernetes/` directory is organized into staged manifests adhering to the Kubernetes standard schema:

| File | Kind | Component | Description |
| :--- | :--- | :--- | :--- |
| `00-namespace.yaml` | `Namespace` | Cluster | Dedicated isolated namespace `privacymesh`. |
| `01-secrets.yaml.example` | `Secret` template | Security | Template for database passwords, JWT secrets, and Grafana admin credentials. |
| `01-secrets.yaml` | `Secret` | Security | Local generated secret file (excluded from Git via `.gitignore`). |
| `02-configmap.yaml` | `ConfigMap` | Config | Non-sensitive runtime variables (`POSTGRES_DB`, `DATABASE_HOST`, `CORS_ORIGINS`). |
| `03-postgres-statefulset.yaml` | `StatefulSet` + `Service` | Database | PostgreSQL 16 StatefulSet with 2Gi PVC, ClusterIP service `db` (strictly internal, no NodePort), readiness/liveness probes, and init script configuring `privacy_app`. |
| `04-backend-deployment.yaml` | `Deployment` | Backend | FastAPI backend deployment with resource requests (`100m` CPU, `128Mi` RAM) for HPA, startup/readiness/liveness probes. |
| `05-backend-service.yaml` | `Service` | Backend | Backend Service (NodePort `30800`, ClusterIP on `8000`). |
| `06-frontend-deployment.yaml` | `Deployment` | Frontend | React/Nginx frontend deployment with resource requests and health probes. |
| `07-frontend-service.yaml` | `Service` | Frontend | Frontend Service (NodePort `30080`). |
| `08-hpa.yaml` | `HorizontalPodAutoscaler` | Autoscaling | `autoscaling/v2` HPA targeting `backend` (min 1, max 4, target 60% CPU utilization). |
| `09-prometheus.yaml` | `Deployment`, `Service`, `PVC` | Monitoring | Prometheus deployment, 1Gi PVC, NodePort `30090`, and ConfigMap with scrape configs and 5 alerting rules. |
| `10-grafana.yaml` | `Deployment`, `Service`, `PVC` | Monitoring | Grafana deployment, 1Gi PVC, NodePort `30030`, datasource provisioning, and dashboard provider. |
| `11-grafana-dashboard-configmap.yaml` | `ConfigMap` | Monitoring | JSON dashboard model for `PrivacyMesh Application Observability`. |
| `generate-secrets.ps1` | Utility | Automation | Generates `01-secrets.yaml` directly from local `.env` configuration. |

### C. Prerequisites & Minikube Cluster Startup

1. **Start Minikube** with 2 CPUs and 3072 MB RAM using the Docker driver:
   ```powershell
   minikube start --driver=docker --cpus=2 --memory=3072m
   ```

2. **Enable Metrics Server**:
   ```powershell
   minikube addons enable metrics-server
   ```

3. **Verify Node and Metrics Server Readiness**:
   ```powershell
   kubectl get nodes
   kubectl get deployment metrics-server -n kube-system
   ```

### D. Image Loading into Minikube

Load local application and infrastructure Docker images into Minikube's container runtime:

```powershell
minikube image load postgres:16
minikube image load privacymesh-backend:latest
minikube image load privacymesh-frontend:latest
minikube image load prom/prometheus:latest
minikube image load grafana/grafana:latest
```

### E. Staged Manifest Deployment

Deploy manifests in ordered dependency stages:

```powershell
# 1. Generate local secrets from .env (kept strictly out of Git)
.\kubernetes\generate-secrets.ps1

# 2. Stage 1: Namespace, Secrets, and ConfigMap
kubectl apply -f kubernetes/00-namespace.yaml -f kubernetes/01-secrets.yaml -f kubernetes/02-configmap.yaml

# 3. Stage 2: PostgreSQL StatefulSet
kubectl apply -f kubernetes/03-postgres-statefulset.yaml
kubectl rollout status statefulset/db -n privacymesh

# 4. Stage 3: Backend Deployment & Service
kubectl apply -f kubernetes/04-backend-deployment.yaml -f kubernetes/05-backend-service.yaml
kubectl rollout status deployment/backend -n privacymesh

# 5. Stage 4: Frontend Deployment & Service
kubectl apply -f kubernetes/06-frontend-deployment.yaml -f kubernetes/07-frontend-service.yaml
kubectl rollout status deployment/frontend -n privacymesh

# 6. Stage 5: Horizontal Pod Autoscaler (HPA)
kubectl apply -f kubernetes/08-hpa.yaml

# 7. Stage 6: Observability (Prometheus, Grafana, Dashboard ConfigMap)
kubectl apply -f kubernetes/09-prometheus.yaml -f kubernetes/10-grafana.yaml -f kubernetes/11-grafana-dashboard-configmap.yaml
kubectl rollout status deployment/prometheus -n privacymesh
kubectl rollout status deployment/grafana -n privacymesh
```

### F. Verifying Deployment & HPA Status

```powershell
# Inspect all running pods in namespace
kubectl get pods -n privacymesh -o wide

# Verify Metrics Server telemetry
kubectl top nodes
kubectl top pods -n privacymesh

# Verify HPA current replicas and CPU utilization
kubectl get hpa -n privacymesh
```

### G. Service URLs & NodePort Endpoints

Obtain the Minikube cluster IP via `minikube ip` (e.g. `192.168.49.2`):

| Service | NodePort | Cluster URL | Description |
| :--- | :--- | :--- | :--- |
| **Frontend Application** | `30080` | `http://<minikube-ip>:30080` | React 19 UI delivered via Nginx. |
| **FastAPI Backend** | `30800` | `http://<minikube-ip>:30800` | Backend API gateway & health probes. |
| **Backend Metrics** | `30800` | `http://<minikube-ip>:30800/metrics` | Prometheus metrics export. |
| **Prometheus Web UI** | `30090` | `http://<minikube-ip>:30090` | PromQL console, targets, and alert rules. |
| **Grafana Dashboard** | `30030` | `http://<minikube-ip>:30030` | Real-time observability dashboard. |
| **PostgreSQL Database** | *None* | `db:5432` *(internal only)* | Strictly internal ClusterIP; no NodePort or external exposure. |

### H. Testing Horizontal Pod Autoscaling (Scale-Up and Scale-Down)

1. **Trigger Scale-Up**: Execute a CPU-intensive operation in the backend pod or generate concurrent load:
   ```powershell
   kubectl exec -n privacymesh deploy/backend -- python -c "import time; end = time.time() + 35; x = 0;
   while time.time() < end: x = (x + 1) % 1000000;
   print('done', x)"
   ```

2. **Observe Scaling Up**: Check HPA reporting CPU above 60% and scaling replicas to 2-4:
   ```powershell
   kubectl get hpa backend-hpa -n privacymesh -w
   kubectl get pods -n privacymesh -l app.kubernetes.io/component=backend
   ```

3. **Observe Scaling Down**: Once the CPU load stops, after the 60-second stabilization window, the HPA automatically steps replicas back down to 1:
   ```powershell
   kubectl get hpa backend-hpa -n privacymesh
   ```

### I. Testing PostgreSQL Persistence Across Pod Restarts

Verify that database state survives pod deletion:

```powershell
# 1. Insert a test record in the Kubernetes database
kubectl exec -n privacymesh db-0 -- psql -U privacy_user -d privacymesh -c "INSERT INTO users (username, password_hash, role) VALUES ('persist_check', 'hash', 'customer');"

# 2. Delete the database pod
kubectl delete pod db-0 -n privacymesh

# 3. Wait for StatefulSet to automatically recreate db-0
kubectl wait --for=condition=ready pod/db-0 -n privacymesh --timeout=60s

# 4. Verify that data survived on the persistent volume claim
kubectl exec -n privacymesh db-0 -- psql -U privacy_user -d privacymesh -c "SELECT username FROM users WHERE username = 'persist_check';"
```

### J. Teardown & Cleanup Procedures

To cleanly remove Kubernetes resources without affecting host configurations:

```powershell
# Remove all Kubernetes manifests from namespace
kubectl delete -f kubernetes/08-hpa.yaml
kubectl delete -f kubernetes/09-prometheus.yaml -f kubernetes/10-grafana.yaml -f kubernetes/11-grafana-dashboard-configmap.yaml
kubectl delete -f kubernetes/06-frontend-deployment.yaml -f kubernetes/07-frontend-service.yaml
kubectl delete -f kubernetes/04-backend-deployment.yaml -f kubernetes/05-backend-service.yaml
kubectl delete -f kubernetes/03-postgres-statefulset.yaml
kubectl delete -f kubernetes/01-secrets.yaml -f kubernetes/02-configmap.yaml
kubectl delete -f kubernetes/00-namespace.yaml

# Stop Minikube cluster
minikube stop

# Delete Minikube cluster when no longer needed
minikube delete
```

---

## 12. Security & Regulatory Compliance Principles

1. **Least-Privilege Database Access**: The backend connects exclusively using the `privacy_app` role. Superuser privileges (`privacy_user`) are reserved strictly for initial migrations and maintenance.
2. **Four-Eye Principle**: No single user can both evaluate and approve their own or an applicant's submission. Compliance officers can only submit recommendations; final determinations require a Bank Manager.
3. **Data Minimization & Confidentiality**: Internal compliance deliberations and supervisory risk notes are strictly isolated to bank staff views and stripped from customer-facing decision payloads.
4. **Audit Immutability**: All KYC reviews, status changes, and document version creations are logged in `kyc_audit_log` with triggers preventing deletion or modification.
5. **Administrative Isolation**: System Administrators manage platform credentials and observe telemetry, but have zero access to customer KYC records or transaction contents.

---

## 13. Phase 10 – Machine Learning KYC Workload Prediction & Predictive Autoscaling

Phase 10 adds an intelligent predictive autoscaling layer to prepare Kubernetes backend capacity in advance of anticipated KYC submission spikes:

* **Prometheus Metrics Pipeline**: The `workload-predictor` microservice polls Prometheus every 15 seconds to evaluate 5-minute and 15-minute HTTP and KYC submission rates.
* **Dual-Model Inference**:
  * **Safe Persistence Baseline (Authoritative Reference)**: Recommends minimum pod capacity based on the last observed 5-minute submission rate, ensuring stable and reliable scaling decisions.
  * **XGBoost Regressor (Comparative Monitoring)**: Evaluates trained gradient-boosted trees against diurnal cyclical features (hour of day, day of week, lag demands) for comparative telemetry.
* **Least-Privilege Scaling Controller**:
  * The `workload-controller` runs as a dedicated Kubernetes deployment with strict RBAC (`verbs: ["get", "patch"]` restricted exclusively to `resourceNames: ["backend-hpa"]`).
  * Patches **only** `spec.minReplicas` on `backend-hpa`, preserving `maxReplicas=4`, reactive CPU 60% threshold, and all existing pods.
  * **Hysteresis Cooldown**: Enforces an immediate scale-up on demand spikes and a 60-second stabilization timer on scale-down to prevent pod flapping.
  * **Outage Holding**: Safely holds the last known safe capacity during predictor or Prometheus network interruptions.

---

## 14. Phase 11 – Azure Confidential Computing & TEE Preparation

Phase 11 establishes the code-level foundation and Infrastructure-as-Code (IaC) for transitioning PrivacyMesh banking workloads to hardware-backed Azure Confidential Virtual Machines:

### A. Architectural & Attestation Decision
* **Attestation Decision**: In accordance with project requirements, **remote hardware attestation is NOT implemented** (no Microsoft Azure Attestation, no attestation tokens, and no token verification).
* **Honest Security Boundaries**: While AMD SEV-SNP processors provide hypervisor-isolated memory encryption, hardware cryptographic protection is not remotely proven without an active attestation authority. The system operates in an explicit, transparent unverified mode.

### B. Dual Confidential Computing Providers
1. **`SimulationTEEProvider` (Default Local Runtime)**:
   * Provides transparent software-only simulation of confidential memory isolation for local development, Docker Compose, and Minikube.
   * Accurately reports `status: "simulation"` and `is_hardware_enclave: false`.
2. **`AzureConfidentialVMProvider` (Azure CVM Target)**:
   * Activated when Azure Confidential VM environment indicators (vTPM 2.0 `/dev/tpmrm0`, Microsoft DMI identifiers, or `CONFIDENTIAL_PROVIDER=azure_cvm`) are present.
   * Reports `status: "hardware_tee"`, `mode_label: "Azure Confidential VM (AMD SEV-SNP) - Unattested"`, and `is_hardware_enclave: false` with explicit disclaimers regarding unverified hardware memory isolation.
   * Gated via configurable provider resolution (`select_tee_provider()`).

### C. Azure for Students Quota Constraint
* **Empirical Quota Verification**:
  * An automated Azure Resource Manager audit across `eastus`, `westeurope`, `southeastasia`, and `centralus` confirmed that the active **Azure for Students** subscription has a **hard quota limit of 0 vCPUs** for the `standardDCASv5Family`.
  * Official Microsoft policy dictates that **Azure for Students and Free Trial accounts are strictly ineligible for quota increases**.
  * Consequently, live cloud provisioning on student subscriptions is blocked by policy; live deployment requires upgrading to a standard Pay-As-You-Go model.

### D. Production-Ready Infrastructure-as-Code (`azure/`)
* **Compiled Bicep Template (`azure/confidential-vm.bicep`)**:
  * Defines an isolated AMD SEV-SNP Confidential VM (`Standard_DC2as_v5`) with Secure Boot and vTPM 2.0.
  * **Strict Network Isolation**:
    * Public Subnet (`10.0.1.0/24`): Ingress reverse proxy with HTTPS (443) and HTTP (80).
    * Private Subnet (`10.0.2.0/24`): Confidential VM with **zero public IP**.
    * **Zero Public Database Exposure**: PostgreSQL port `5432` and backend port `8000` are strictly blocked from the internet via Network Security Groups.
