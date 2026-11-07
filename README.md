# PrivacyMesh

**Confidential Computing for Sensitive Banking and KYC Workloads**

PrivacyMesh is a local-first confidential banking platform designed to demonstrate secure banking transaction processing and Know Your Customer (KYC) workflows. It combines application-level security, role-based access control, data isolation, confidential computing concepts, workload monitoring, and resource optimization.

> **Research prototype:** PrivacyMesh is an academic demonstration, not a production banking system or certified confidential computing solution.

## 1. Project Overview

PrivacyMesh demonstrates how sensitive banking and KYC workloads can be protected through application security controls and a software-based confidential computing simulation.

The platform supports:

- Secure user authentication and authorization.
- Role-based access control.
- Banking transaction management.
- KYC submission, review, and approval workflows.
- Account-level data isolation.
- Local confidential computing simulation.
- Workload monitoring and resource optimization.
- Local Kubernetes deployment and demonstration.

## 2. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI |
| Database | PostgreSQL |
| Authentication | JWT-based authentication |
| Containerization | Docker and Docker Compose |
| Orchestration | Kubernetes using Minikube |
| Monitoring | Prometheus and Grafana |
| Workload prediction | Python-based prediction components |
| Testing | Python test suites and browser verification |

## 3. User Roles

PrivacyMesh supports four application roles.

| Role | Responsibilities |
|---|---|
| Customer | Manage personal banking transactions and submit KYC information. |
| Bank Employee | Review submitted KYC records and provide recommendations. |
| Bank Manager | Make final KYC decisions and correct review outcomes. |
| System Admin | Manage technical platform information and monitor system-level metadata. |

**KYC access restriction:** System administrators do not have access to KYC dossiers, uploaded documents, internal notes, employee reviews, or KYC decisions.

## 4. Main Modules

### A. Authentication and Authorization

- User registration and login.
- Password hashing.
- JWT-based authentication.
- Protected API endpoints.
- Role-based access control.
- Authorization checks for restricted operations.

### B. Banking Transaction Management

- Create and retrieve banking transactions.
- Associate transactions with authenticated users.
- Enforce account-level data isolation.
- Restrict access to unauthorized transaction records.

### C. KYC Management

The KYC workflow follows a controlled review process:

1. Customer submits KYC information.
2. Bank employee reviews the submitted information.
3. Employee provides a recommendation and review notes.
4. Bank manager makes the final decision.
5. Manager can correct or update the final decision where permitted.

KYC information is restricted according to application roles and workflow permissions.

### D. Confidential Computing Simulation

PrivacyMesh includes a software-based TEE simulation to demonstrate confidential computing concepts during local execution.

The simulation demonstrates application-level protection concepts but does not create a real hardware-backed enclave.

### E. Workload Monitoring

The monitoring module uses Prometheus and Grafana to observe system performance.

Metrics include:

- CPU utilization.
- Memory utilization.
- Request rate.
- Request latency.
- Error information.
- Service health.

### F. Workload Prediction and Resource Optimization

The workload components demonstrate resource monitoring and workload-based optimization concepts.

The project includes:

- Workload prediction components.
- Resource utilization monitoring.
- Scaling-related control logic.
- Local demonstration of resource optimization.

## 5. System Architecture

The application follows a frontend-backend-database architecture with supporting monitoring and workload components.

```text
                  Users
                    |
                    v
          React + TypeScript Frontend
                    |
                    v
             FastAPI Backend
                    |
          Authentication / RBAC
                    |
          +---------+---------+
          |         |         |
          v         v         v
      Banking     KYC     Confidential
    Transactions Workflow  Computing
          |         |     Simulation
          +---------+---------+
                    |
                    v
                PostgreSQL
                    |
                    v
           Monitoring Components
                    |
             Prometheus
                    |
                 Grafana

       Workload Prediction and
          Resource Optimization
```

## 6. Project Structure

```text
PrivacyMesh/
│
├── backend/
│   └── app/
│       ├── confidential/
│       ├── routers/
│       ├── main.py
│       ├── database.py
│       ├── models.py
│       ├── schemas.py
│       └── security.py
│
├── frontend/
│   └── src/
│
├── database/
│   ├── migrations/
│   └── init.sql
│
├── kubernetes/
│
├── monitoring/
│
├── benchmarks/
│
├── workload_prediction/
│
├── tests/
│
├── compose.yaml
├── .env.example
├── .gitignore
└── README.md
```

## 7. Local Setup and Execution

### Prerequisites

Install the following tools:

- Python
- Node.js and npm
- Docker Desktop
- Git
- Minikube (for local Kubernetes deployment)
- kubectl (for Kubernetes management)

### A. Clone the Repository

```bash
git clone https://github.com/bhumireddythanusri2007/PrivacyMesh.git
cd PrivacyMesh
```

### B. Configure Environment Variables

Create a local `.env` file using `.env.example` as a reference.

Configure the required database, authentication, and service settings using appropriate local values.

**Security notes:**

- Do not commit `.env`.
- Do not publish passwords, tokens, or secret keys.
- Use strong secrets for local demonstrations.
- Keep generated Kubernetes secrets out of version control.

### C. Start the Application with Docker Compose

```bash
docker compose up --build -d
```

Check the running services:

```bash
docker compose ps
```

View service logs:

```bash
docker compose logs -f
```

Stop the services:

```bash
docker compose down
```

### D. Access the Application

| Service | Local address |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API documentation | http://localhost:8000/docs |
| Backend health | http://localhost:8000/health |
| Database health | http://localhost:8000/db-health |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

Service availability depends on the corresponding container being started and healthy.

### E. Local Kubernetes Deployment

PrivacyMesh supports local Kubernetes demonstration using Minikube.

Start Minikube:

```bash
minikube start
```

Check the cluster:

```bash
kubectl get nodes
```

Apply the project Kubernetes manifests in the required deployment order, following the configuration and instructions in the `kubernetes/` directory.

Check deployed resources:

```bash
kubectl get pods -A
kubectl get services -A
```

The Kubernetes deployment is intended for local development and demonstration.

## 8. API Overview

The backend exposes REST API endpoints for authentication, transactions, KYC, administration, and health checks.

| Module | Endpoint | Method |
|---|---|---|
| Authentication | `/auth/register` | POST |
| Authentication | `/auth/login` | POST |
| Transactions | `/transactions` | GET |
| Transactions | `/transactions` | POST |
| KYC | `/kyc` | GET |
| KYC | `/kyc` | POST |
| Administration | `/admin/summary` | GET |
| Administration | `/admin/users` | GET |
| Health | `/health` | GET |
| Database Health | `/db-health` | GET |

For request and response schemas, open the FastAPI documentation:

http://localhost:8000/docs

Access to endpoints is controlled by authentication and role-based authorization.

## 9. Monitoring and Observability

### A. Prometheus

Prometheus is used to collect and monitor application and system metrics.

The monitoring setup supports observing:

- Application performance.
- Request activity.
- Service health.
- Resource utilization.
- Error-related metrics.

### B. Grafana

Grafana provides dashboards for visualizing collected metrics.

Grafana is intended for local observability. If anonymous viewer access is enabled, anyone who can reach the Grafana service may view dashboards. Keep Grafana restricted to the local environment, configure a strong administrator password, and never publish default credentials.

## 10. Workload Prediction and Resource Optimization

The workload prediction module demonstrates how workload information can support resource optimization.

The implementation includes:

- Workload data processing.
- Prediction components.
- Resource utilization information.
- Scaling-related control logic.
- Monitoring of workload behavior.

The components are intended for local experimentation and academic demonstration.

## 11. Security Features

PrivacyMesh demonstrates several application-level security controls:

- Password hashing.
- JWT authentication.
- Role-based access control.
- Protected API routes.
- Account-level transaction isolation.
- Restricted KYC access.
- Controlled employee and manager review permissions.
- Environment-based configuration of sensitive values.
- Containerized application deployment.
- Local monitoring and observability.

These controls are part of an academic prototype and do not constitute a production security certification.

## 12. Testing and Validation

The project includes backend, workflow, integration, confidential computing, monitoring, Kubernetes, and browser verification tests.

The reported validation results include:

| Test Category | Successful Checks |
|---|---:|
| Browser verification | 33 |
| API tests | 27 |
| KYC workflow tests | 13 |
| Phase 6 integration tests | 23 |
| Confidential computing tests | 8 |
| Monitoring and Kubernetes tests | 12 |
| **Total** | **116** |

These results represent successful checks across the reported test suites. They should not be interpreted as a guarantee of production readiness.

## 13. Limitations and Future Scope

### Current Limitations

- Confidential computing currently uses a software-based simulation.
- Hardware-backed TEE protection is not implemented.
- Remote hardware attestation is not implemented.
- The system is an academic prototype rather than a production banking platform.
- Security and performance require further independent validation.

### Future Scope

- Integration with hardware-backed confidential computing technologies.
- Remote attestation support.
- Advanced side-channel and memory-attack evaluation.
- More advanced workload prediction.
- Improved resource optimization.
- Extended security testing and benchmarking.
- Further enhancements to banking and KYC workflows.

## 14. Phase 11 – Local Confidential Computing Simulation

### A. Current Implementation

PrivacyMesh uses a software-based TEE simulation for local development and demonstration.

- `SimulationTEEProvider` is the default provider for Docker Compose and Minikube.
- The provider reports `status: "simulation"`.
- `is_hardware_enclave` is `false`.
- No actual Intel SGX or AMD SEV-SNP enclave is created.
- Hardware-backed memory encryption and remote hardware attestation are not implemented.
- No cloud platform is required for the supported deployment.

### B. Security Boundaries

The simulation demonstrates application-level confidential computing concepts. It does not provide hardware-enforced protection against privileged host operating systems, hypervisors, physical memory inspection, or hardware-level attacks.

Actual hardware-backed confidential computing would require compatible hardware, platform configuration, and independent security validation. Remote attestation is outside the current implementation.

### C. Deployment Scope

The supported deployment and demonstration environment is local:

- Docker Compose for containerized application services.
- Minikube for local Kubernetes orchestration.
- PostgreSQL for persistent application data.
- Prometheus and Grafana for observability.
- Local workload prediction and autoscaling components.

Cloud deployment, including Azure Confidential VMs, is outside the current project scope.

---

**Project:** PrivacyMesh  
**Domain:** Confidential Computing, Banking Security, and KYC  
**Deployment:** Local Docker and Minikube  
**Purpose:** Academic Design Project and Research Prototype
