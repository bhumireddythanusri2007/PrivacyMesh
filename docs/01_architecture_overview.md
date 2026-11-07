# 01. Architecture Overview

---

## 1. System Vision & Objectives

**PrivacyMesh** is a privacy-preserving banking and compliance prototype built to evaluate security, isolation, and scalability architectures for sensitive financial workloads. The platform demonstrates:

1. **Multi-Role Separation of Duties**: Enforcing banking compliance where no individual actor can independently create, evaluate, and approve customer KYC applications.
2. **Database Least Privilege & Immutability**: Implementing PostgreSQL Row-Level Security (RLS) and tamper-proof audit triggers under a dedicated, non-superuser application role (`privacy_app`).
3. **Simulated Confidential Computing (TEE)**: Providing transparent, software-isolated synthetic banking workload processing while maintaining honest disclaimers regarding the absence of hardware-backed enclaves and remote attestation.
4. **Predictive Workload Autoscaling**: Coordinating Horizontal Pod Autoscaling (HPA) with an ML-informed custom controller to preemptively adjust pod capacity ahead of KYC submission spikes.
5. **Production-Grade Observability**: Exporting normalized metrics to Prometheus and rendering operational dashboards in Grafana with zero cardinality explosion.

---

## 2. Four-Tier Architecture Model

The PrivacyMesh architecture is partitioned into four decoupled tiers:

```
+-----------------------------------------------------------------------------------------+
|                                      Tier 1: Client UI                                  |
|   • React 19 Single-Page Application (TypeScript + Vite + Tailwind CSS 4)               |
|   • Role-based view routing: Customer, Compliance Officer, Manager, Administrator       |
+-----------------------------------------------------------------------------------------+
                                             |
                                             | HTTP / REST (JWT in Authorization Header)
                                             v
+-----------------------------------------------------------------------------------------+
|                                 Tier 2: API Gateway & Core                              |
|   • Nginx Reverse Proxy (Port 80 -> /api/ to backend:8000)                              |
|   • FastAPI Application Gateway (Uvicorn ASGI, Python 3.12)                             |
|   • Argon2id Password Hashing, PyJWT HS256 Token Issuance & Verification                |
|   • Software TEE Simulation Provider (Synthetic KYC risk assessment)                    |
|   • Prometheus Instrumentation (/metrics middleware with normalized endpoints)          |
+-----------------------------------------------------------------------------------------+
                                             |
                                             | PostgreSQL Protocol (Port 5432)
                                             | Role: privacy_app (Least Privilege)
                                             v
+-----------------------------------------------------------------------------------------+
|                                    Tier 3: Database Engine                              |
|   • PostgreSQL 16 (StatefulSet db-0 in K8s, Container db in Compose)                    |
|   • Tables: users, transactions, kyc_submissions, kyc_versions, kyc_reviews, audit_log  |
|   • Security: Row-Level Security (RLS) policies scoped by app.current_user_id           |
|   • Immutability: Triggers preventing update/deletion of reviews, versions, and audit   |
|   • Network: Strictly internal ClusterIP / Docker network (Zero external DB exposure)   |
+-----------------------------------------------------------------------------------------+
                                             ^
                                             | Telemetry Scrapes & HPA Control
+-----------------------------------------------------------------------------------------+
|                              Tier 4: Autoscaling & Observability                        |
|   • Prometheus Server (Scrapes backend /metrics every 10s, evaluates 5 alert rules)     |
|   • Grafana Portal (Auto-loaded PrivacyMesh Application Observability Dashboard)        |
|   • Workload Predictor (Evaluates persistence baseline & XGBoost regressors)            |
|   • Workload Controller (Custom controller dynamically patching HPA spec.minReplicas)   |
|   • Horizontal Pod Autoscaler (HPA autoscaling/v2, min: 1, max: 4, CPU target: 60%)     |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Network Topology & Port Mappings

PrivacyMesh operates in two deployment modes: **Docker Compose** and **Minikube Kubernetes**. All ports and networking configurations are documented below.

### A. Docker Compose Port Topology (`compose.yaml`)

In Docker Compose, services communicate over the internal bridge network `privacymesh_default`. Host port mappings allow developer access:

| Service | Container Internal Port | Host Mapped Port | Protocol | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| `frontend` | `80` | `5173` | HTTP | Nginx serving React SPA and reverse proxying `/api/` to backend. |
| `backend` | `8000` | `8000` | HTTP | FastAPI REST API gateway, health probes, and `/metrics`. |
| `db` | `5432` | `5433` | TCP | PostgreSQL 16 database (host mapped to `5433` to prevent local conflicts). |
| `prometheus` | `9090` | `9090` | HTTP | Prometheus Web UI, PromQL console, and scraping engine. |
| `grafana` | `3000` | `3000` | HTTP | Grafana analytics portal with pre-provisioned dashboards. |

### B. Minikube Kubernetes Port Topology (`kubernetes/`)

In Kubernetes, all services run in the dedicated namespace `privacymesh`. Database and scaling services are restricted to internal `ClusterIP` networks:

| Component | Manifest File | Service Type | Cluster Port | NodePort | Description |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `frontend` | `07-frontend-service.yaml` | `NodePort` | `80` | `30080` | External entrypoint for React 19 UI. |
| `backend` | `05-backend-service.yaml` | `NodePort` | `8000` | `30800` | Backend API gateway and health check endpoints. |
| `db` | `03-postgres-statefulset.yaml`| `ClusterIP` | `5432` | *None* | Strictly internal database access. Zero external exposure. |
| `prometheus`| `09-prometheus.yaml` | `NodePort` | `9090` | `30090` | Prometheus UI and metrics query endpoint. |
| `grafana` | `10-grafana.yaml` | `NodePort` | `3000` | `30030` | Grafana observability portal. |
| `workload-predictor` | `12-workload-predictor.yaml` | `ClusterIP` | `8080` | *None* | Internal ML prediction service (`/predict`, `/health`). |
| `workload-controller`| `14-workload-controller.yaml`| `ClusterIP` | `8081` | *None* | Internal controller Prometheus metrics endpoint. |

---

## 4. Ingress & Reverse Proxy Architecture

The frontend container utilizes Nginx Alpine configured as follows (`frontend/nginx.conf`):

1. **SPA Routing**: All client routes (`/`, `/dashboard`, `/kyc`, etc.) fall back to `/usr/share/nginx/html/index.html` via `try_files $uri $uri/ /index.html;`.
2. **Reverse Proxy**: Requests matching `/api/` are forwarded to `http://backend:8000/` with forwarded host headers.
3. **Security Headers**: Injects defensive HTTP headers:
   * `X-Frame-Options: "DENY"` (clickjacking protection)
   * `X-Content-Type-Options: "nosniff"` (MIME-sniffing prevention)
   * `X-XSS-Protection: "1; mode=block"`
   * `Referrer-Policy: "strict-origin-when-cross-origin"`
4. **Compression & Caching**: Gzip compression active for JSON, SVG, JS, and CSS. Static assets carry 1-year immutable cache headers.

---

## 5. Verified API Route Catalog

The following routes are implemented in the FastAPI backend:

### Authentication & Core Endpoints
| HTTP Method | Route Path | Access Control | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | System identification and operational status banner. |
| `GET` | `/health` | Public | Process health probe (returns `{"status":"healthy"}`). |
| `GET` | `/db-health` | Public | Database connectivity check via `privacy_app`. |
| `GET` | `/protected` | Authenticated | Token verification test endpoint returning identity payload. |
| `POST`| `/auth/register` | Public | Register new user account (defaults to role `customer`). |
| `POST`| `/auth/login` | Public | Authenticate user credentials and return HS256 JWT access token. |

### KYC Workflow Endpoints (`/kyc/workflow`)
| HTTP Method | Route Path | Access Control | Description |
| :--- | :--- | :--- | :--- |
| `POST`| `/kyc/workflow/submissions` | `customer` | Create new KYC dossier with initial Version 1 document. |
| `GET` | `/kyc/workflow/submissions/my` | `customer` | List all KYC dossiers created by the authenticated customer. |
| `GET` | `/kyc/workflow/submissions/{id}` | Role Scoped | View specific submission details (subject to ownership/assignment). |
| `POST`| `/kyc/workflow/submissions/{id}/versions` | `customer` | Upload a new document version following a correction request. |
| `POST`| `/kyc/workflow/submissions/{id}/resubmit` | `customer` | Resubmit a case from `correction_requested` to `submitted`. |
| `GET` | `/kyc/workflow/submissions/{id}/decision` | `customer` | Retrieve final decision receipt (internal compliance notes omitted). |
| `GET` | `/kyc/workflow/employee/assigned` | `bank_employee` | List cases assigned to the authenticated compliance officer. |
| `POST`| `/kyc/workflow/submissions/{id}/review-start` | `bank_employee` | Transition case from `submitted` to `under_employee_review`. |
| `POST`| `/kyc/workflow/submissions/{id}/recommend` | `bank_employee` | Submit findings and recommendation (`recommend_approve/reject/request_correction`). |
| `GET` | `/kyc/workflow/manager/cases` | `bank_manager` | List all bank-wide KYC submissions for delegation or determination. |
| `POST`| `/kyc/workflow/submissions/{id}/assign` | `bank_manager` | Assign or reassign compliance officers to a submission. |
| `POST`| `/kyc/workflow/submissions/{id}/decision` | `bank_manager` | Issue binding manager decision (`approve`, `reject`, `manager_request_correction`). |
| `GET` | `/kyc/workflow/submissions/{id}/reviews` | Bank Staff | Retrieve audit review history for a case (`bank_employee`, `bank_manager`). |
| `POST`| `/kyc/workflow/submissions/{id}/archive` | `bank_manager` | Soft-archive a completed KYC case. |

### Administrative, Legacy KYC, Transactions & Observability
| HTTP Method | Route Path | Access Control | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/admin/summary` | `system_admin`, `admin` | Aggregate metadata counts (`total_users`, `total_transactions`, `total_kyc_records`). |
| `GET` | `/admin/users` | `system_admin`, `admin` | List user accounts (identities, roles, creation dates). Zero KYC data. |
| `POST`| `/kyc` | `customer` | Legacy single-table KYC record creation. |
| `GET` | `/kyc` | Role Scoped | List legacy KYC records (returns `[]` for `system_admin`). |
| `POST`| `/transactions` | Authenticated | Create a financial transaction record. |
| `GET` | `/transactions` | Authenticated | List transactions belonging to authenticated user. |
| `GET` | `/confidential-computing/status`| Authenticated | Query hardware detection and active TEE provider configuration. |
| `POST`| `/confidential-computing/run-demo`| Authenticated | Execute synthetic credit scoring workload (zero DB writes). |
| `GET` | `/monitoring/status` | Public | Real-time process telemetry (CPU %, RSS memory, thread count). |
| `GET` | `/metrics` | Public (Prometheus)| Prometheus exposition format scrape target. |

---

## 6. Technology Stack Matrix

| Layer | Component | Specification |
| :--- | :--- | :--- |
| **Frontend** | Framework | React 19.0, Vite 6.0, TypeScript 5.7 |
| **Frontend** | Styling | Tailwind CSS 4.0, Lucide React Icons |
| **Frontend** | Web Server | Nginx 1.27 Alpine |
| **Backend** | Framework | FastAPI 0.115, Starlette 0.45 |
| **Backend** | ASGI Server | Uvicorn 0.34 (Standard worker) |
| **Backend** | Language | Python 3.12 (CPython) |
| **Backend** | Database ORM | SQLAlchemy 2.0.36 |
| **Backend** | Database Driver| Psycopg 3.2 binary |
| **Backend** | Validation | Pydantic v2.10 |
| **Backend** | Cryptography | Argon2id (`pwdlib`), PyJWT 2.10 (`HS256`) |
| **Database** | Database Engine| PostgreSQL 16.6 |
| **Monitoring**| Scrape Engine | Prometheus v2.55 |
| **Monitoring**| Dashboards | Grafana 11.3 |
| **Machine Learning**| Predictor | XGBoost 2.1.3, scikit-learn 1.6, NumPy 2.2 |
| **Orchestration**| Kubernetes | Minikube v1.39 (Kubernetes v1.37 on containerd 2.3) |
