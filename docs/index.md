# PrivacyMesh Documentation Suite

Welcome to the official technical architecture and operational documentation for **PrivacyMesh**, an academic research prototype and privacy-preserving banking infrastructure framework.

PrivacyMesh demonstrates confidential computing patterns, multi-role Know Your Customer (KYC) workflows, predictive horizontal pod autoscaling, and zero-trust data protection principles within a **strictly local deployment environment** (Docker Desktop and Minikube on Windows 11).

---

## Documentation Index

| Document | Primary Focus | Key Topics Covered |
| :--- | :--- | :--- |
| [**01. Architecture Overview**](01_architecture_overview.md) | System Topology & Design | 4-tier model, ingress routing, port mappings, API route catalog, network topology, technology stack. |
| [**02. Security & RBAC Model**](02_security_and_rbac_model.md) | Access Control & Integrity | 4-role KYC workflow, Row-Level Security (RLS), immutable audit triggers, administrative isolation, transaction context injection. |
| [**03. Confidential Computing & TEE Boundaries**](03_confidential_computing.md) | Memory Isolation Boundaries | Honest distinction between software simulation (`SimulationTEEProvider`) and hardware CVMs; zero-attestation rationale; Azure quota constraints. |
| [**04. Predictive Autoscaling**](04_predictive_autoscaling.md) | ML Inference & Scaling Engine | Dual-model predictor architecture, active persistence-baseline signal vs comparative XGBoost regressor, custom K8s controller, HPA integration. |
| [**05. Empirical Scaling Benchmarks**](05_empirical_benchmarks.md) | Phase 12 Evaluation Results | Empirical 300s workload results for Approaches A, B, and C (3,240 reqs each), latency percentiles, throughput, CPU/memory scaling, transient scaling spike analysis. |
| [**06. Operations & Runbook**](06_operations_and_runbook.md) | Deployment & Maintenance | Local Docker Compose and Minikube runbooks, health probe reference, Prometheus alert rules, Grafana dashboards, troubleshooting procedures. |
| [**Phase 14 Results Analysis**](phase14_results/README.md) | Presentation Graphs & Analysis | High-resolution publication plots (latency, percentiles, CPU, RAM, replicas, throughput), B.Tech presentation slide explanations, limitation breakdown. |

---

## Architecture Visualizations

Standalone Mermaid diagram specifications are available in the [diagrams/](diagrams/) directory:
* [**Multi-Tier System Architecture Diagram**](diagrams/system_architecture.mmd)
* [**End-to-End KYC Workflow Lifecycle Sequence Diagram**](diagrams/kyc_lifecycle_flow.mmd)

---

## Core System Guarantees & Constraints

1. **Local-Only Infrastructure**: The application stack executes entirely locally on Docker Compose and Minikube. No cloud resources or external attestation authorities are required or contacted.
2. **Honest Security Posture**: The current implementation operates in a **transparent software simulation mode** (`status: "simulation"`, `is_hardware_enclave: false`). Remote hardware attestation (Microsoft Azure Attestation) and secure key release are explicitly not implemented.
3. **Database Integrity & Least Privilege**: The FastAPI application accesses PostgreSQL exclusively via the non-superuser `privacy_app` role. All KYC records are protected by PostgreSQL Row-Level Security (RLS) policies and append-only trigger functions.
4. **Predictive Scaling Separation**: Production scaling decisions are driven by the authoritative **persistence baseline demand signal** (`SCALING_PREDICTION_SOURCE=persistence_baseline`). The XGBoost regressor operates strictly for comparative monitoring and feature evaluation.
