# 02. Security & Role-Based Access Control (RBAC) Model

---

## 1. Multi-Role Banking Separation of Duties

PrivacyMesh enforces banking compliance boundaries across four distinct user roles. No individual actor can independently create, evaluate, and approve a KYC submission:

```
+--------------------------------------------------------------------------------------------------+
|                                  Role Boundary Matrix                                            |
+-------------------+--------------------------------+---------------------------------------------+
| Role Key          | User Interface Workspace       | Permissions & Security Boundaries           |
+-------------------+--------------------------------+---------------------------------------------+
| customer          | Customer KYC Hub (My KYC)      | • Creates initial submissions and versions. |
|                   |                                | • Resubmits corrections upon bank request.  |
|                   |                                | • Views sanitized decision receipts.        |
|                   |                                | • Internal officer notes are excluded.      |
+-------------------+--------------------------------+---------------------------------------------+
| bank_employee     | Officer Workbench              | • Examines assigned customer dossiers.      |
|                   | (Assigned Cases)               | • Initiates review and records findings.    |
|                   |                                | • Submits approval/rejection recommendation.|
|                   |                                | • Prohibited from issuing binding decisions.|
+-------------------+--------------------------------+---------------------------------------------+
| bank_manager      | Management Oversight Console   | • Inspects all bank-wide KYC submissions.   |
|                   | (Case Management)              | • Assigns/reassigns officers to cases.      |
|                   |                                | • Issues final binding approve/reject.      |
|                   |                                | • Issues binding correction requests.       |
+-------------------+--------------------------------+---------------------------------------------+
| system_admin      | Technical Admin Console        | • Observes process health and telemetry.    |
|                   | (User Management & Telemetry)  | • Inspects user accounts (credentials).     |
|                   |                                | • Strictly isolated from customer KYC PII.  |
+-------------------+--------------------------------+---------------------------------------------+
```

---

## 2. Administrator Authorization & Privacy Isolation Behavior

A core design requirement is technical administrator isolation: platform administrators must maintain infrastructure without accessing customer financial or KYC data. The actual implementation enforces this across three distinct layers:

1. **KYC Workflow API Barrier (`backend/app/routers/kyc_workflow.py`)**:
   Every workflow endpoint invokes the database dependency `get_workflow_db()`, which inspects the authenticated JWT role before executing any query:
   ```python
   if current_user["role"] in ("system_admin", "admin"):
       raise HTTPException(
           status_code=status.HTTP_403_FORBIDDEN,
           detail="System administrators are not authorized to access customer KYC workflow content",
       )
   ```
   Administrators cannot view submissions, versions, review findings, or audit events.

2. **Legacy KYC Read Barrier (`backend/app/routers/kyc.py`)**:
   On the legacy single-table KYC query endpoint (`GET /kyc`), administrators receive an empty dataset:
   ```python
   if current_user["role"] == "system_admin":
       return []
   ```

3. **Permitted Administrative Telemetry (`backend/app/routers/admin.py`)**:
   Administrators have access exclusively to technical operational endpoints:
   * `GET /admin/summary`: Returns scalar aggregates only (`total_users`, `total_transactions`, `total_kyc_records`). Zero customer identity details, dossier content, or documents are exposed.
   * `GET /admin/users`: Lists user account identities, usernames, assigned roles, and creation timestamps for identity governance.
   * `GET /monitoring/status` & `GET /metrics`: Infrastructure telemetry (CPU, RSS memory, request rates).

---

## 3. Database Least Privilege: The `privacy_app` Account

PostgreSQL runs under the principle of least privilege. The application connects exclusively through the `privacy_app` role (`database/migrations/001_bootstrap_roles.sql`):

* **Non-Superuser**: `privacy_app` has `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, and `NOINHERIT`.
* **Explicit DML Only**: Granted `SELECT`, `INSERT`, `UPDATE` on specific tables (`users`, `transactions`, `kyc_submissions`, `kyc_versions`, `kyc_reviews`, `kyc_audit_log`).
* **Zero DDL Grants**: `privacy_app` cannot `DROP`, `ALTER`, or `TRUNCATE` tables, nor can it disable triggers or bypass Row-Level Security policies.
* **Superuser Isolation**: The administrative superuser `privacy_user` is used exclusively during migration scripts and container initialization, never at application runtime.

---

## 4. Row-Level Security (RLS) & Session Context Injection

All multi-role KYC tables enforce PostgreSQL Row-Level Security. Because connection pooling shares database connections across requests, transaction-scoped session context is injected into PostgreSQL:

```python
# Executed within get_workflow_db() before handling any request
db.execute(
    text("SELECT set_config('app.current_user_id', :uid, true)"),
    {"uid": str(current_user["id"])},
)
```

The third argument (`true`) scopes the configuration variable strictly to the active transaction. When the transaction commits or rolls back, the variable resets.

### RLS Policies (`002_kyc_workflow_migration.sql`)

1. **`kyc_submissions`**:
   * **Customer Policy**: Can `SELECT` and `INSERT` records where `customer_id = current_setting('app.current_user_id')::integer`.
   * **Bank Employee Policy**: Can `SELECT` records where `assigned_employee_id = current_setting('app.current_user_id')::integer`.
   * **Bank Manager Policy**: Can `SELECT` and `UPDATE` all unarchived records bank-wide.
2. **`kyc_versions`**:
   * Scoped via parent submission ownership. Customers can view versions of their own submissions; compliance staff can view versions of assigned or managed cases.
3. **`kyc_reviews`**:
   * **Customer Policy**: Blocked from internal review deliberation notes.
   * **Officer & Manager Policy**: Can view review records for assigned or managed cases.

---

## 5. Database Status Transition Triggers & Integrity Rules

Database triggers enforce workflow integrity independently of frontend or API controls (`trg_enforce_kyc_status_transitions`).

### Mechanism of Role Resolution
The trigger function does **not** perform independent cryptographic identity verification. Instead, it resolves the caller's role via the helper function `get_current_app_role()`:
```sql
CREATE OR REPLACE FUNCTION get_current_app_role()
RETURNS VARCHAR AS $$
DECLARE
    v_user_id INTEGER;
    v_role VARCHAR;
BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    IF v_user_id IS NULL THEN RETURN 'anonymous'; END IF;
    SELECT role INTO v_role FROM public.users WHERE id = v_user_id;
    RETURN COALESCE(v_role, 'anonymous');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;
```

### Verified Trigger Invariant Guards

1. **Immutable Fields**:
   * `customer_id`, `submission_ref`, and `created_at` cannot be updated under any circumstances. Attempted mutations raise a database exception.
2. **Assignment Rules**:
   * Only `bank_manager` can alter `assigned_employee_id` or `assigned_manager_id`.
   * The trigger verifies that the user assigned to `assigned_employee_id` has `role = 'bank_employee'` in `public.users`.
3. **Employee Restrictions**:
   * Employees cannot transition a submission directly to `approved` or `rejected`.
   * An assigned employee can only transition a case from `under_employee_review` to `pending_manager_decision` if an authorized employee recommendation record exists in `kyc_reviews` for the active version.
4. **Manager Final Decision Verification**:
   * Transitions to `approved` or `rejected` strictly require `OLD.status = 'pending_manager_decision'` and caller `v_role = 'bank_manager'`.
   * The trigger queries `public.kyc_reviews` to verify that a matching manager review record (`action = 'approve'` or `'reject'`) exists for the current active version.
5. **Archival Restrictions**:
   * Only `bank_manager` can set `is_archived = TRUE`. Automatically stamps `archived_at` and `archived_by_id`.

---

## 6. Immutable Audit Trail & Tamper Prevention

Audit integrity is enforced through dedicated trigger functions:

* **Audit Stamp Enforcement (`trg_enforce_kyc_audit_log_actor`)**: Automatically populates `actor_id` from `app.current_user_id` and captures `CURRENT_TIMESTAMP`.
* **Zero Modification on Audit Logs (`trg_prevent_audit_tampering`)**: Blocks `UPDATE` and `DELETE` on `kyc_audit_log`:
  ```sql
  CREATE OR REPLACE FUNCTION trg_prevent_audit_tampering()
  RETURNS TRIGGER AS $$
  BEGIN
      RAISE EXCEPTION 'Audit log records are immutable and cannot be modified or deleted.';
  END;
  $$ LANGUAGE plpgsql;
  ```
* **Review Immutability (`trg_prevent_kyc_review_mutation`)**: Compliance findings and manager determination records cannot be altered or deleted once committed.
* **Document Version Immutability (`trg_prevent_kyc_version_mutation`)**: Historical document versions cannot be deleted or overwritten. Updates are restricted exclusively to toggling `is_current` when a new version is created.

---

## 7. Authentication & Token Architecture

* **Password Hashing**: Stored using **Argon2id** (`pwdlib`), a memory-hard password hashing algorithm resistant to GPU brute-force attacks.
* **Session Tokens**: RFC-7519 compliant JSON Web Tokens (JWT) signed with **HMAC-SHA256 (`HS256`)**.
* **Stateless Claims**: Payload contains `sub` (user ID), `username`, `role`, `iat` (issued at), and `exp` (expiration timestamp).
* **Zero Database Queries for Auth Probes**: Token validation decodes claims in-memory using the shared `JWT_SECRET_KEY`, enabling low-overhead synthetic benchmark execution without database query amplification.
