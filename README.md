# PrivacyMesh: Confidential Computing for Sensitive Data Workloads

PrivacyMesh is an academic research prototype and confidential computing framework designed to secure sensitive banking transaction processing and KYC (Know Your Customer) data workloads.

Developed as a third-year B.Tech Computer Science design project, the system combines a React frontend, FastAPI backend, PostgreSQL database, and hardware-enforced isolation concepts (TEEs) to protect data-in-transit, data-at-rest, and data-in-use.

---

## 1. Architecture Overview

PrivacyMesh is architected across three decoupled tiers:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    React 19 + Vite Frontend                 â”‚
â”‚         (Tailwind CSS v4, TypeScript, Session Storage)       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚ HTTPS / REST (JWT Bearer)
                               â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                   FastAPI Backend Gateway                   â”‚
â”‚          â€¢ Argon2id Password Hashing (pwdlib)               â”‚
â”‚          â€¢ JWT Token Generation & Verification (PyJWT)      â”‚
â”‚          â€¢ Strict Role-Based Access Control (RBAC)          â”‚
â”‚          â€¢ Multi-Tenant Workload Isolation                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â”‚ SQLAlchemy 2.0 (Pool Pre-ping)
                               â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  PostgreSQL 16 Database                     â”‚
â”‚         â€¢ Users, Transactions & KYC Records                 â”‚
â”‚         â€¢ Referential Integrity & Check Constraints         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4
- **Backend**: Python 3.12, FastAPI, Uvicorn, Pydantic v2
- **Database**: PostgreSQL 16 (port mapped to host `5433`, container `5432`)
- **ORM & Drivers**: SQLAlchemy 2.0, Psycopg 3 binary
- **Security & Cryptography**: PyJWT (HMAC-SHA256 tokens), Argon2id (`pwdlib`)
- **Containerization**: Docker Compose
- **Future Hardware Layer**: Intel SGX / AMD SEV Confidential Computing Enclaves

---

## 3. Current Implementation Status

### Implemented & Tested Security Controls
- **JWT Authentication**: 30-minute session-scoped tokens signed using `HS256`.
- **Argon2 Password Hashing**: Passwords hashed with `pwdlib` using recommended Argon2id parameters. Credentials and password hashes are never exposed in API payloads or console logs.
- **Role-Based Authorization (RBAC)**: Distinct permissions for standard `user` and privileged `admin`. Public registration enforces the `user` role; privilege escalation attempts are rejected.
- **Multi-Tenant Workload Isolation**: Ordinary users can only create and view their own transactions and KYC dossiers.
- **Connection Health Checks**: Active connection pool verification via `/health` and `/db-health`.

### Planned Future Milestones (TEE Enclaves)
- **Trusted Execution Environments (TEEs)**: Integration with Intel SGX / AMD SEV hardware-isolated enclaves to protect workload computation in-memory against hypervisor or host-level attackers.
- **Remote Attestation**: Cryptographic DCAP/EPID attestation verifying codebase integrity before provisioning workload keys.
- **Hardware Memory Sealing**: Protecting confidential encryption keys using silicon-level hardware root of trust.

---

## 4. Setup and Run Guide (Windows PowerShell)

### Prerequisites
- Docker Desktop (with Docker Compose v2)
- Node.js (v18+ recommended) & npm
- Python 3.12+ (optional, for local tests outside Docker)

### Step 1: Clone and Configure Environment Variables
Copy `.env.example` to `.env` in the project root:
```powershell
Copy-Item .env.example .env
```
Ensure your `.env` contains valid configurations (never commit real secrets):
```env
POSTGRES_USER=privacy_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=privacymesh
DATABASE_URL=postgresql+psycopg://privacy_user:your_secure_password@db:5432/privacymesh
JWT_SECRET_KEY=your_64_character_hex_secret_key
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Step 2: Start Backend and Database (Docker Compose)
In the project root, start the PostgreSQL database and FastAPI backend:
```powershell
docker compose up -d
```
Verify containers are running:
```powershell
docker compose ps
```
The API is accessible at `http://localhost:8000` and Swagger docs at `http://localhost:8000/docs`.

### Step 3: Start Frontend Development Server
In a separate PowerShell terminal:
```powershell
cd frontend
npm install
npm run dev
```
Open your browser at `http://localhost:5173`.

---

## 5. API Reference Summary

| Endpoint | Method | Access | Description |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Public | Returns API operational status (`healthy`) |
| `/db-health` | `GET` | Public | Verifies PostgreSQL database connectivity |
| `/auth/register` | `POST` | Public | Registers a new standard user account (`role="user"`) |
| `/auth/login` | `POST` | Public | Authenticates credentials and returns JWT access token |
| `/protected` | `GET` | Authenticated | Validates JWT bearer token and returns current user info |
| `/transactions` | `GET` | Authenticated | Lists transactions belonging to the current user |
| `/transactions` | `POST` | Authenticated | Records a new transaction (`deposit`, `withdrawal`, `transfer`) |
| `/kyc` | `GET` | Authenticated | Lists user's KYC records (admin views all records) |
| `/kyc` | `POST` | Authenticated | Registers KYC record via query parameters (`customer_ref`, `document_type`) |
| `/admin/summary` | `GET` | Admin Only | System-wide statistics (`total_users`, `total_transactions`, `total_kyc_records`) |
| `/admin/users` | `GET` | Admin Only | Audited catalog of all registered users (credentials omitted) |

---

## 6. Running Automated Tests

An automated test suite is provided in `tests/test_api.py`. It runs 16 integration and security checks including registration, authentication, RBAC boundaries, transaction isolation, and KYC validation.

Run the test suite against the live services:
```powershell
.\.venv\Scripts\python.exe tests\test_api.py
```
Expected output:
```
==================================================================
           PrivacyMesh Automated Verification Suite
==================================================================
[PASS] 1.1 GET /health returns 200 and healthy status
[PASS] 1.2 GET /db-health returns 200 connected to PostgreSQL
[PASS] 2.1 CORS preflight allows http://localhost:5173
[PASS] 3.1 Public registration creates ordinary user
[PASS] 3.2 Duplicate username returns 409 Conflict
[PASS] 3.3 Registration rejects or neutralizes role='admin'
[PASS] 3.4 Register second user for multi-tenancy testing
[PASS] 4.1 Login with invalid credentials returns 401 Unauthorized
[PASS] 4.2 Login with valid credentials returns JWT bearer token
[PASS] 4.3 Login second user successfully
[PASS] 5.1 GET /protected with valid JWT returns user info
[PASS] 5.2 GET /protected with malformed JWT returns 401
[PASS] 6.1 Ordinary user access to /admin endpoints is blocked (403 Forbidden)
[PASS] 7.1 Transaction creation and strict ownership isolation
[PASS] 7.2 Transaction input validation (rejects negative amounts & invalid types)
[PASS] 8.1 KYC query-parameter creation, duplicate rejection, and isolation
==================================================================
Results: 16 / 16 tests passed (100.0%)
==================================================================
```

To run frontend TypeScript and ESLint checks:
```powershell
cd frontend
npm run lint
npm run build
```

---

## 7. Security Limitations & Academic Scope

1. **Session-Scoped Storage**: For this academic prototype, JWT bearer tokens are stored in browser `sessionStorage`. In high-assurance production environments, tokens should be managed via `HttpOnly`, `SameSite=Strict`, `Secure` cookies with CSRF defense to prevent token leakage via XSS.
2. **Hardware Enclaves**: As an academic simulation and API gateway, the current prototype enforces cryptographic data isolation and role boundaries in software. True hardware TEE execution (e.g. Intel SGX enclaves with attestation) will be integrated in Phase 2.
