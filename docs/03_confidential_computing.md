# 03. Confidential Computing & TEE Security Boundaries

---

## 1. Executive Summary & Honest Security Posture

PrivacyMesh incorporates confidential computing design patterns to protect sensitive banking data across its lifecycle: **data-at-rest**, **data-in-transit**, and **data-in-use**.

> [!IMPORTANT]
> **Definitive Security Notice**:
> In accordance with project design principles, **remote hardware attestation is NOT implemented**. The current implementation provides a transparent **software-only simulation** of confidential computing. It does **not** employ Microsoft Azure Attestation (MAA), does **not** verify cryptographic attestation quotes, and does **not** use attestation-based Secure Key Release (SKR).

The system explicitly distinguishes this software simulation from hardware-backed memory encryption, ensuring academic integrity and transparent threat modeling.

---

## 2. Software Simulation vs. Hardware-Backed Confidential Computing

The table below contrasts the implemented local simulation against actual hardware Trusted Execution Environments (TEEs), such as AMD SEV-SNP:

| Dimension | Implemented Prototype (`SimulationTEEProvider`) | Hardware Confidential VM (e.g., AMD SEV-SNP) |
| :--- | :--- | :--- |
| **Execution Environment** | Standard CPython 3.12 process running inside an unprivileged Docker container / Minikube Pod. | Dedicated Virtual Machine with CPU-enforced hardware memory isolation. |
| **Memory Isolation** | **Software masking only**. Host OS, hypervisor, or root container runtime can read process memory via `/proc/<pid>/mem`. | **Hardware-enforced memory encryption** via AES-128/256 keys embedded in the memory controller. |
| **Remote Attestation** | **Not implemented**. No attestation quotes, no collateral fetching, no signature verification. | Cryptographic quote signed by AMD Platform Security Processor (PSP) verified by Microsoft Azure Attestation. |
| **Key Release Policy** | Static JWT secrets loaded from `.env` or Kubernetes Secrets. | Secure Key Release (SKR): Keys unlocked only when attestation report matches an approved policy. |
| **Operational Readiness** | Returns: `status: "simulation"`, `is_hardware_enclave: false`, `operational_readiness: "Not configured (Simulation mode active)"`. | Cryptographically verified hardware measurement hash matching approved PCR baselines. |
| **Infrastructure Target** | **100% Local**: Minikube on Windows with Docker driver. Zero cloud dependency. | Microsoft Azure `DCas_v5` confidential VMs (blocked on Student subscriptions due to 0-vCPU quotas). |

---

## 3. Data Protection Triad in Local Simulation

The active `SimulationTEEProvider` (`backend/app/confidential/provider.py`) returns the following data protection triad status:

* **Data-at-Rest**:
  ```text
  PostgreSQL standard table storage; database-table encryption is not configured or verified by this application.
  ```
  Data is stored in unencrypted PostgreSQL volume tables (`privacymesh_pgdata` in Docker, `db-data` PVC in Kubernetes).
* **Data-in-Transit**:
  ```text
  HTTP/REST over the local development connection; TLS/HTTPS is not configured in this environment.
  ```
  Communication between frontend, backend, and database utilizes cleartext HTTP and unencrypted PostgreSQL protocol over internal bridge/container networks.
* **Data-in-Use**:
  ```text
  Standard Python process memory. This simulation does not provide hardware-backed memory encryption or isolation.
  ```
  Processing occurs in standard process RAM. Privileged processes with administrative access to the host machine can inspect memory structures.

---

## 4. Synthetic Workload Execution Engine

The endpoint `POST /confidential-computing/run-demo` simulates confidential credit scoring calculations without mutating application state or storing customer data.

### Processing Pipeline
1. **Input Validation & Token Masking**:
   * Accepts synthetic applicant details: `account_id`, `monthly_income`, `requested_credit_amount`, `existing_obligations`, `risk_tier`.
   * Immediately masks account identifiers (e.g., `SYNTH-PERF-00123` becomes `SYNTH-PERF-****`). The full raw account identifier is stripped from the execution trace.
2. **Debt-to-Income (DTI) & Credit Score Calculation**:
   * Computes DTI ratio:
     $$\text{DTI} = \left(\frac{\text{existing\_obligations}}{\text{monthly\_income}}\right) \times 100$$
   * Calculates an illustrative credit score (base 750 with DTI penalties and risk-tier offsets, clamped to $[300, 850]$).
   * Note: This is an illustrative simulation model, not a certified credit evaluation algorithm.
3. **Execution Trace Metadata**:
   * Each returned response payload contains structured execution step metadata explicitly noting:
     ```json
     {
       "step_number": 2,
       "phase": "2. Simulated Risk Calculation",
       "simulated_isolation_boundary": "Application validation and masking; not a hardware-enforced enclave boundary"
     }
     ```
4. **Zero Database Writes**:
   * The synthetic workload engine executes purely in-memory. Zero database reads, writes, or audit logs occur, guaranteeing that performance benchmarking generates no database state mutation.

---

## 5. Hardware Inspector & Dual-Provider Architecture

The backend implements a provider abstraction (`TEEProvider`) resolved at startup:

```
+-------------------------------------------------------------+
|                     select_tee_provider()                   |
+-------------------------------------------------------------+
                              |
       +----------------------+----------------------+
       | Environment Detection                       | CONFIDENTIAL_PROVIDER == "azure_cvm"
       v                                             v
+-------------------------------+             +-------------------------------+
|     SimulationTEEProvider     |             |  AzureConfidentialVMProvider  |
|  • Default runtime            |             |  • Staged CVM Target          |
|  • Status: "simulation"       |             |  • Status: "hardware_tee"     |
|  • is_hardware_enclave: false |             |  • Unattested Mode            |
|  • Explicit limitations list  |             |  • Disclaims remote quote     |
+-------------------------------+             +-------------------------------+
```

* **Hardware Inspector (`backend/app/confidential/inspector.py`)**:
  * Inspects system attributes: vTPM devices (`/dev/tpmrm0`), Microsoft DMI chassis strings (`/sys/class/dmi/id/sys_vendor`), and processor capabilities.
  * In the local Windows/Minikube environment, correctly identifies that hardware enclaves (Intel SGX, AMD SEV) are unavailable.

---

## 6. Azure Confidential Computing Quota Findings & Offline IaC

While the runtime remains entirely local, production infrastructure templates were developed to study Azure Confidential Virtual Machines.

### Empirical Quota Audit Findings
During architectural preparation, an automated Azure Resource Manager capacity audit was executed across multiple Azure regions (`eastus`, `westeurope`, `southeastasia`, `centralus`):

* **Result**: The active **Azure for Students** subscription has a **hard quota limit of 0 vCPUs** for the `standardDCASv5Family` (AMD SEV-SNP Confidential VMs).
* **Policy Barrier**: Official Microsoft Azure policy dictates that **Azure for Students and Free Trial subscriptions are strictly ineligible for confidential computing quota increases**.
* **Design Decision**: Live cloud deployment was consciously omitted. The project operates locally on Minikube, with Azure Bicep templates retained as offline Infrastructure-as-Code artifacts.

### Architecture of Offline Bicep Template (`azure/confidential-vm.bicep`)
The compiled template specifies an isolated network architecture designed for confidential workloads:
* **Confidential VM Spec**: `Standard_DC2as_v5` with AMD SEV-SNP memory encryption, Secure Boot, and vTPM 2.0.
* **Network Isolation**:
  * Public Subnet (`10.0.1.0/24`): Ingress reverse proxy with HTTPS (443) and HTTP (80).
  * Private Subnet (`10.0.2.0/24`): Confidential VM with **zero public IP address**.
  * **Database Security**: PostgreSQL port `5432` and backend port `8000` are strictly blocked from the public internet via Network Security Groups (NSGs).
