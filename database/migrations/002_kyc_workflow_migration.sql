-- ============================================================================
-- Migration: 002_kyc_workflow_migration.sql
-- Description: Multi-role KYC validation and review platform schema migration
-- Target: PostgreSQL 16+
-- Transactional, Idempotent, Non-Destructive, Least-Privilege, RLS-Enforced
-- ============================================================================

-- [SECURITY DEFINER & TRUST BOUNDARY DOCUMENTATION]
-- All SECURITY DEFINER functions explicitly declare SET search_path = pg_catalog, public
-- and fully schema-qualify all referenced relations (public.users, public.kyc_submissions, etc.)
-- to eliminate search_path hijacking vulnerabilities.
--
-- Trust Boundary: 'app.current_user_id' is set per-session or per-transaction by the application tier
-- (FastAPI connection pool / middleware) after authenticating and verifying the caller's JWT token.
-- PostgreSQL trusts this session variable as established by the authenticated application connection.
-- The runtime role 'privacy_app' is not granted table-level superuser or admin privileges, cannot alter
-- roles, cannot truncate tables, and cannot modify sensitive ownership columns. Direct external network
-- access to the PostgreSQL port is restricted to authorized application hosts.

BEGIN;

-- Switch execution role to schema owner for all schema operations
SET ROLE privacy_owner;

-- ----------------------------------------------------------------------------
-- 1. Migration Version Tracking & Prerequisite Verifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT NOT NULL
);

-- Guard: Abort immediately if migration 002 has already been applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '002_kyc_workflow_migration') THEN
        RAISE EXCEPTION 'Migration 002_kyc_workflow_migration has already been applied. Aborting.';
    END IF;
END
$$;

-- Guard: Verify baseline prerequisite tables exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') OR
       NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kyc_records') OR
       NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
        RAISE EXCEPTION 'Prerequisite tables (users, kyc_records, transactions) are missing. Unexpected database state. Aborting.';
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Snapshot Exact Pre-Migration User Roles for Guaranteed Rollback
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _migration_002_user_backup (
    user_id INTEGER PRIMARY KEY,
    original_role VARCHAR(20) NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO _migration_002_user_backup (user_id, original_role)
SELECT id, role FROM users
ON CONFLICT (user_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Dedicated Non-Superuser Roles & Ownership Architecture
-- ----------------------------------------------------------------------------
-- privacy_owner: NOLOGIN schema owner role (owns all tables, triggers, functions, sequences)
-- privacy_migrator: LOGIN role for executing migrations via SET ROLE privacy_owner
-- privacy_app:   LOGIN application runtime role (non-owner, least-privilege DML)
-- Zero passwords embedded in SQL; credentials provisioned securely out-of-band via stdin.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_owner') OR
       NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_migrator') OR
       NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_app') THEN
        RAISE EXCEPTION 'Prerequisite roles (privacy_owner, privacy_migrator, privacy_app) are missing. Run 001_bootstrap_roles.sql first.';
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 4. Migrate Users Role Check Constraint & Safe Customer Default
-- ----------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;

-- Selective migration: only approved administrator account receives system_admin
UPDATE users
SET role = 'system_admin'
WHERE username = 'privacy_admin' AND role != 'system_admin';

-- All standard user accounts map safely to customer
UPDATE users
SET role = 'customer'
WHERE role = 'user';

-- Any other unexpected admin accounts are quarantined to pending_review
UPDATE users
SET role = 'pending_review'
WHERE role = 'admin' AND username != 'privacy_admin';

-- Set safe column default on users.role to customer
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer';

ALTER TABLE users ADD CONSTRAINT check_user_role
  CHECK (role IN ('customer', 'bank_employee', 'bank_manager', 'system_admin', 'pending_review'));

-- ----------------------------------------------------------------------------
-- 5. Create KYC Submissions Table (With Archival & Ownership Protection)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_submissions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    submission_ref VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'submitted',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    archived_by_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    assigned_employee_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    assigned_manager_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_submission_status CHECK (
        status IN (
            'draft',
            'submitted',
            'under_employee_review',
            'pending_manager_decision',
            'approved',
            'rejected',
            'correction_requested',
            'legacy_verified',
            'legacy_unresolved'
        )
    )
);

CREATE INDEX IF NOT EXISTS ix_kyc_submissions_customer_id ON kyc_submissions(customer_id);
CREATE INDEX IF NOT EXISTS ix_kyc_submissions_status ON kyc_submissions(status);
CREATE INDEX IF NOT EXISTS ix_kyc_submissions_assigned_emp ON kyc_submissions(assigned_employee_id);
CREATE INDEX IF NOT EXISTS ix_kyc_submissions_assigned_mgr ON kyc_submissions(assigned_manager_id);
CREATE INDEX IF NOT EXISTS ix_kyc_submissions_archived ON kyc_submissions(is_archived);

-- ----------------------------------------------------------------------------
-- 6. Create KYC Versions Table (Strictly Immutable, No Archival Columns)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_versions (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES kyc_submissions(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    document_type VARCHAR(50) NOT NULL,
    document_id_hash VARCHAR(64),
    encrypted_pii TEXT,
    pii_nonce VARCHAR(64),
    attachment_filename VARCHAR(255),
    attachment_mime_type VARCHAR(100),
    attachment_size_bytes INTEGER,
    attachment_hash VARCHAR(64),
    auto_validation_status VARCHAR(30) NOT NULL DEFAULT 'unassessed',
    auto_validation_results JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_submission_version UNIQUE (submission_id, version_number),
    CONSTRAINT uq_kyc_versions_submission_id_id UNIQUE (submission_id, id)
);

-- Crucial: Enforce at most ONE current version per submission at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uq_kyc_submission_current_version
    ON kyc_versions (submission_id)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS ix_kyc_versions_submission_id ON kyc_versions(submission_id);
CREATE INDEX IF NOT EXISTS ix_kyc_versions_doc_hash ON kyc_versions(document_id_hash);

-- ----------------------------------------------------------------------------
-- 7. Create KYC Reviews & Decisions Table (Composite FK to Same Submission)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_reviews (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewer_role VARCHAR(30) NOT NULL CHECK (reviewer_role IN ('bank_employee', 'bank_manager')),
    action VARCHAR(40) NOT NULL CHECK (
        action IN (
            'recommend_approve',
            'recommend_reject',
            'request_correction',
            'approve',
            'reject',
            'manager_request_correction'
        )
    ),
    internal_notes TEXT NOT NULL,
    customer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_kyc_reviews_submission_version
        FOREIGN KEY (submission_id, version_id)
        REFERENCES kyc_versions(submission_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_kyc_reviews_submission_id ON kyc_reviews(submission_id);
CREATE INDEX IF NOT EXISTS ix_kyc_reviews_version_id ON kyc_reviews(version_id);

-- ----------------------------------------------------------------------------
-- 8. Create KYC Audit Log Table (Non-Cascading RESTRICT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_audit_log (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER REFERENCES kyc_submissions(id) ON DELETE RESTRICT,
    actor_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    actor_role VARCHAR(30) NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    event_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_kyc_audit_log_submission_id ON kyc_audit_log(submission_id);

-- ----------------------------------------------------------------------------
-- 9. Secure Role Resolution Function (Authoritative DB-Enforced Identity)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_app_role()
RETURNS VARCHAR AS $$
DECLARE
    v_user_id INTEGER;
    v_role VARCHAR;
BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    IF v_user_id IS NULL THEN
        RETURN 'anonymous';
    END IF;
    -- Authoritative lookup from public.users with fixed safe search_path
    SELECT role INTO v_role FROM public.users WHERE id = v_user_id;
    RETURN COALESCE(v_role, 'anonymous');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION get_current_app_role() OWNER TO privacy_owner;

-- ----------------------------------------------------------------------------
-- 10. Database Triggers for KYC Submissions (Insert Validation, Transitions, Assignments, Archival)
-- ----------------------------------------------------------------------------

-- Trigger A: Submission Creation Validation (BEFORE INSERT)
CREATE OR REPLACE FUNCTION trg_enforce_kyc_submission_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_uid INTEGER;
    v_role VARCHAR;
BEGIN
    -- Dedicated, restricted migration/maintenance path
    -- Requires both explicit session flag AND authorized privileged database role
    IF current_setting('app.migration_in_progress', true) = 'true' AND SESSION_USER IN ('privacy_owner', 'privacy_migrator') THEN
        RETURN NEW;
    END IF;

    v_uid := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    v_role := get_current_app_role();

    -- Only customers are authorized to submit KYC applications
    IF v_role != 'customer' THEN
        RAISE EXCEPTION 'Security violation: Only customers are authorized to create KYC submissions (caller role: %). Employees and Managers cannot create submissions on behalf of customers.', v_role;
    END IF;

    -- Customer identity check: customers may create submissions only for themselves
    IF NEW.customer_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Security violation: Customers may create submissions only for themselves (authenticated: %, requested: %).', v_uid, NEW.customer_id;
    END IF;

    -- Initial status check: must be submitted or draft
    IF NEW.status NOT IN ('submitted', 'draft') THEN
        RAISE EXCEPTION 'Validation error: Initial submission status must be draft or submitted (received: %).', NEW.status;
    END IF;

    -- Prevent customers and employees from supplying assignment fields during creation
    IF NEW.assigned_employee_id IS NOT NULL OR NEW.assigned_manager_id IS NOT NULL THEN
        RAISE EXCEPTION 'Security violation: Assignment fields (assigned_employee_id, assigned_manager_id) must not be supplied on submission creation.';
    END IF;

    -- Prevent customers and employees from supplying archival fields during creation
    IF NEW.is_archived IS TRUE OR NEW.archived_at IS NOT NULL OR NEW.archived_by_id IS NOT NULL THEN
        RAISE EXCEPTION 'Security violation: Archival fields must not be supplied on submission creation.';
    END IF;

    NEW.created_at := CURRENT_TIMESTAMP;
    NEW.updated_at := CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_enforce_kyc_submission_insert() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_submission_before_insert ON kyc_submissions;
CREATE TRIGGER trg_kyc_submission_before_insert
BEFORE INSERT ON kyc_submissions
FOR EACH ROW EXECUTE FUNCTION trg_enforce_kyc_submission_insert();

-- Trigger B: Submission Transitions, Assignments & Archival Protection (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION trg_enforce_kyc_status_transitions()
RETURNS TRIGGER AS $$
DECLARE
    v_role VARCHAR;
    v_uid INTEGER;
BEGIN
    v_uid := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    v_role := get_current_app_role();

    -- Immutability of ownership and creation identity
    IF (OLD.customer_id IS DISTINCT FROM NEW.customer_id) THEN
        RAISE EXCEPTION 'Customer ownership of a KYC submission is immutable and cannot be altered.';
    END IF;
    IF (OLD.submission_ref != NEW.submission_ref) THEN
        RAISE EXCEPTION 'Submission reference is immutable and cannot be altered.';
    END IF;
    IF (OLD.created_at != NEW.created_at) THEN
        RAISE EXCEPTION 'Creation timestamp is immutable and cannot be altered.';
    END IF;

    -- 1. Assignment Protection:
    -- Only bank_manager can assign or reassign either field.
    -- Validate that the assigned user actually has the corresponding role.
    IF (OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id) THEN
        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers can assign or reassign employee cases.';
        END IF;
        IF NEW.assigned_employee_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.assigned_employee_id AND role = 'bank_employee') THEN
                RAISE EXCEPTION 'Invalid assignment: User % does not have role bank_employee.', NEW.assigned_employee_id;
            END IF;
        END IF;
    END IF;

    IF (OLD.assigned_manager_id IS DISTINCT FROM NEW.assigned_manager_id) THEN
        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers can assign or reassign Bank Managers.';
        END IF;
        IF NEW.assigned_manager_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.assigned_manager_id AND role = 'bank_manager') THEN
                RAISE EXCEPTION 'Invalid assignment: User % does not have role bank_manager.', NEW.assigned_manager_id;
            END IF;
        END IF;
    END IF;

    -- 2. Archival Protection:
    -- Customers and employees must not be able to change is_archived, archived_at, or archived_by_id.
    -- Restrict archival operations strictly to authorized managers.
    IF (OLD.is_archived IS DISTINCT FROM NEW.is_archived OR
        OLD.archived_at IS DISTINCT FROM NEW.archived_at OR
        OLD.archived_by_id IS DISTINCT FROM NEW.archived_by_id) THEN
        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers are authorized to archive or unarchive KYC submissions.';
        END IF;
        IF NEW.is_archived = TRUE THEN
            NEW.archived_at := CURRENT_TIMESTAMP;
            NEW.archived_by_id := v_uid;
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by_id := NULL;
        END IF;
    END IF;

    -- If status is not changing, permit update of assignments, archival, or updated_at
    IF (OLD.status = NEW.status) THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
        RETURN NEW;
    END IF;

    -- 3. Status Transition Restrictions:
    IF v_role = 'customer' THEN
        -- Customers can only resubmit a correction_requested submission to submitted
        IF NOT (OLD.status = 'correction_requested' AND NEW.status = 'submitted') THEN
            RAISE EXCEPTION 'Customers are not permitted to alter KYC workflow status.';
        END IF;
        IF v_uid IS NOT NULL AND v_uid != OLD.customer_id THEN
            RAISE EXCEPTION 'Security violation: Customers can only resubmit their own KYC submissions.';
        END IF;
    END IF;

    IF v_role = 'bank_employee' THEN
        IF NEW.status IN ('approved', 'rejected') THEN
            RAISE EXCEPTION 'Bank Employees are not authorized to approve or reject KYC submissions.';
        END IF;
    END IF;

    IF v_role = 'system_admin' THEN
        RAISE EXCEPTION 'System Administrators have no authorization to alter KYC workflow status.';
    END IF;

    -- 4. Workflow Integrity: Moving from under_employee_review to pending_manager_decision
    -- Strictly requires an authorized employee recommendation for the current KYC version.
    -- Verify that the employee is assigned to the submission.
    IF (OLD.status = 'under_employee_review' AND NEW.status = 'pending_manager_decision') THEN
        IF v_role NOT IN ('bank_employee', 'bank_manager') THEN
            RAISE EXCEPTION 'Security violation: Only Bank Employees and Managers can submit cases for manager decision.';
        END IF;

        IF v_role = 'bank_employee' AND (OLD.assigned_employee_id IS NULL OR v_uid != OLD.assigned_employee_id) THEN
            RAISE EXCEPTION 'Security violation: Only the assigned Bank Employee (ID: %) can submit this case for manager decision.', OLD.assigned_employee_id;
        END IF;

        DECLARE
            v_curr_ver_id INTEGER;
        BEGIN
            SELECT id INTO v_curr_ver_id
            FROM public.kyc_versions
            WHERE submission_id = NEW.id AND is_current = TRUE;

            IF v_curr_ver_id IS NULL THEN
                RAISE EXCEPTION 'Integrity violation: Submission % has no active current version.', NEW.id;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM public.kyc_reviews r
                WHERE r.submission_id = NEW.id
                  AND r.version_id = v_curr_ver_id
                  AND r.reviewer_role = 'bank_employee'
                  AND (OLD.assigned_employee_id IS NULL OR r.reviewer_id = OLD.assigned_employee_id)
                  AND r.action IN ('recommend_approve', 'recommend_reject', 'request_correction')
            ) THEN
                RAISE EXCEPTION 'Workflow violation: Moving from under_employee_review to pending_manager_decision requires an authorized employee recommendation on current version % by assigned employee %.', v_curr_ver_id, OLD.assigned_employee_id;
            END IF;
        END;
    END IF;

    -- 5. Manager Decision Integrity: Final decisions (approved, rejected)
    -- REQUIRE matching Manager review on CURRENT version recorded by authenticated manager!
    IF NEW.status IN ('approved', 'rejected') THEN
        IF OLD.status != 'pending_manager_decision' THEN
            RAISE EXCEPTION 'Invalid transition: Submission must be in pending_manager_decision before being approved or rejected (current: %).', OLD.status;
        END IF;

        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers are authorized to finalize decisions.';
        END IF;

        DECLARE
            v_expected_action VARCHAR;
            v_current_version_id INTEGER;
        BEGIN
            IF NEW.status = 'approved' THEN
                v_expected_action := 'approve';
            ELSE
                v_expected_action := 'reject';
            END IF;

            -- Retrieve exact current version ID
            SELECT id INTO v_current_version_id
            FROM public.kyc_versions
            WHERE submission_id = NEW.id AND is_current = TRUE;

            IF v_current_version_id IS NULL THEN
                RAISE EXCEPTION 'Integrity violation: Submission % has no active current version.', NEW.id;
            END IF;

            -- Verify matching manager review on the CURRENT version recorded by authenticated manager
            IF NOT EXISTS (
                SELECT 1 FROM public.kyc_reviews r
                WHERE r.submission_id = NEW.id
                  AND r.version_id = v_current_version_id
                  AND r.reviewer_role = 'bank_manager'
                  AND r.action = v_expected_action
                  AND (v_uid IS NULL OR r.reviewer_id = v_uid)
            ) THEN
                RAISE EXCEPTION 'Security violation: Transition to % requires an authorized Bank Manager decision record with action % for current version %.', NEW.status, v_expected_action, v_current_version_id;
            END IF;
        END;
    END IF;

    -- 6. Manager Correction Request
    IF (OLD.status = 'pending_manager_decision' AND NEW.status = 'correction_requested') THEN
        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers are authorized to request corrections from pending_manager_decision.';
        END IF;

        DECLARE
            v_current_version_id INTEGER;
        BEGIN
            SELECT id INTO v_current_version_id
            FROM public.kyc_versions
            WHERE submission_id = NEW.id AND is_current = TRUE;

            IF NOT EXISTS (
                SELECT 1 FROM public.kyc_reviews r
                WHERE r.submission_id = NEW.id
                  AND r.version_id = v_current_version_id
                  AND r.reviewer_role = 'bank_manager'
                  AND r.action IN ('manager_request_correction', 'request_correction')
                  AND (v_uid IS NULL OR r.reviewer_id = v_uid)
            ) THEN
                RAISE EXCEPTION 'Security violation: Requesting correction from pending_manager_decision requires a Bank Manager review record with action manager_request_correction on current version %.', v_current_version_id;
            END IF;
        END;
    END IF;

    -- 7. Customer Correction Resubmission
    -- Transition from correction_requested to submitted strictly requires a newer KYC version!
    IF (OLD.status = 'correction_requested' AND NEW.status = 'submitted') THEN
        IF v_role != 'customer' THEN
            RAISE EXCEPTION 'Security violation: Only customers can resubmit a KYC application after correction request (caller role: %).', v_role;
        END IF;

        IF v_uid IS NOT NULL AND OLD.customer_id != v_uid THEN
            RAISE EXCEPTION 'Security violation: Only the owning customer (ID: %) can resubmit this application.', OLD.customer_id;
        END IF;

        DECLARE
            v_corr_ver_id INTEGER;
            v_corr_ver_num INTEGER;
            v_curr_ver_id INTEGER;
            v_curr_ver_num INTEGER;
        BEGIN
            -- Find the version on which correction was requested by the manager
            SELECT r.version_id, v.version_number INTO v_corr_ver_id, v_corr_ver_num
            FROM public.kyc_reviews r
            JOIN public.kyc_versions v ON v.id = r.version_id
            WHERE r.submission_id = NEW.id
              AND r.reviewer_role = 'bank_manager'
              AND r.action IN ('manager_request_correction', 'request_correction')
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT 1;

            -- Find the current active version
            SELECT id, version_number INTO v_curr_ver_id, v_curr_ver_num
            FROM public.kyc_versions
            WHERE submission_id = NEW.id AND is_current = TRUE;

            IF v_curr_ver_id IS NULL THEN
                RAISE EXCEPTION 'Integrity violation: Submission % has no active current version.', NEW.id;
            END IF;

            -- If manager requested correction on a version, the resubmission MUST have a strictly newer version
            IF v_corr_ver_id IS NOT NULL AND (v_curr_ver_id = v_corr_ver_id OR v_curr_ver_num <= v_corr_ver_num) THEN
                RAISE EXCEPTION 'Workflow violation: Resubmission from correction_requested requires creating a new KYC version. Current version % was the version requested for correction.', v_curr_ver_num;
            END IF;
        END;
    END IF;

    -- Valid workflow state transitions
    IF (OLD.status = 'submitted' AND NEW.status IN ('under_employee_review', 'legacy_unresolved')) OR
       (OLD.status = 'under_employee_review' AND NEW.status IN ('pending_manager_decision', 'under_employee_review')) OR
       (OLD.status = 'pending_manager_decision' AND NEW.status IN ('approved', 'rejected', 'correction_requested')) OR
       (OLD.status = 'correction_requested' AND NEW.status = 'submitted') OR
       (OLD.status = 'legacy_unresolved' AND NEW.status = 'submitted') THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Illegal workflow state transition from % to %.', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_enforce_kyc_status_transitions() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_status_transitions ON kyc_submissions;
CREATE TRIGGER trg_kyc_status_transitions
BEFORE UPDATE ON kyc_submissions
FOR EACH ROW EXECUTE FUNCTION trg_enforce_kyc_status_transitions();

-- ----------------------------------------------------------------------------
-- 11. Engine-Level Immutability & Version Creation Triggers on kyc_versions
-- ----------------------------------------------------------------------------

-- Trigger: Version Creation Validation (BEFORE INSERT)
-- Only owning customer can create a new version for their own active submission
CREATE OR REPLACE FUNCTION trg_enforce_kyc_version_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_uid INTEGER;
    v_role VARCHAR;
    v_sub_owner INTEGER;
    v_sub_archived BOOLEAN;
BEGIN
    -- Dedicated, restricted migration/maintenance path
    IF current_setting('app.migration_in_progress', true) = 'true' AND SESSION_USER IN ('privacy_owner', 'privacy_migrator') THEN
        RETURN NEW;
    END IF;

    v_uid := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    v_role := get_current_app_role();

    -- Role check: ONLY customers can submit KYC versions
    IF v_role != 'customer' THEN
        RAISE EXCEPTION 'Security violation: Only customers can create new KYC versions (caller role: %). Employees and Managers are prohibited from creating or replacing customer versions.', v_role;
    END IF;

    -- Verify submission existence and ownership
    SELECT customer_id, is_archived INTO v_sub_owner, v_sub_archived
    FROM public.kyc_submissions
    WHERE id = NEW.submission_id;

    IF v_sub_owner IS NULL THEN
        RAISE EXCEPTION 'Integrity violation: Submission % does not exist.', NEW.submission_id;
    END IF;

    IF v_sub_owner IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Security violation: Customers can create versions only for their own submissions (submission owner: %, caller: %).', v_sub_owner, v_uid;
    END IF;

    IF v_sub_archived IS TRUE THEN
        RAISE EXCEPTION 'Integrity violation: Cannot create new versions for archived submission %.', NEW.submission_id;
    END IF;

    -- Default auto_validation_status to unassessed
    IF NEW.auto_validation_status IS NULL THEN
        NEW.auto_validation_status := 'unassessed';
    END IF;

    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_enforce_kyc_version_insert() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_version_before_insert ON kyc_versions;
CREATE TRIGGER trg_kyc_version_before_insert
BEFORE INSERT ON kyc_versions
FOR EACH ROW EXECUTE FUNCTION trg_enforce_kyc_version_insert();

CREATE OR REPLACE FUNCTION trg_prevent_kyc_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.is_current = TRUE AND NEW.is_current = FALSE) AND
       (OLD.id = NEW.id AND
        OLD.submission_id = NEW.submission_id AND
        OLD.version_number = NEW.version_number AND
        OLD.document_type = NEW.document_type AND
        OLD.document_id_hash IS NOT DISTINCT FROM NEW.document_id_hash AND
        OLD.encrypted_pii IS NOT DISTINCT FROM NEW.encrypted_pii AND
        OLD.pii_nonce IS NOT DISTINCT FROM NEW.pii_nonce AND
        OLD.attachment_filename IS NOT DISTINCT FROM NEW.attachment_filename AND
        OLD.attachment_mime_type IS NOT DISTINCT FROM NEW.attachment_mime_type AND
        OLD.attachment_size_bytes IS NOT DISTINCT FROM NEW.attachment_size_bytes AND
        OLD.attachment_hash IS NOT DISTINCT FROM NEW.attachment_hash AND
        OLD.auto_validation_status = NEW.auto_validation_status AND
        OLD.auto_validation_results IS NOT DISTINCT FROM NEW.auto_validation_results AND
        OLD.created_at = NEW.created_at) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'KYC version records are strictly immutable. No fields other than is_current (from TRUE to FALSE) may be updated.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_prevent_kyc_version_mutation() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_version_prevent_update ON kyc_versions;
CREATE TRIGGER trg_kyc_version_prevent_update
BEFORE UPDATE ON kyc_versions
FOR EACH ROW EXECUTE FUNCTION trg_prevent_kyc_version_mutation();

CREATE OR REPLACE FUNCTION trg_prevent_kyc_version_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Submitted KYC versions are permanently immutable and deletion is forbidden.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_prevent_kyc_version_deletion() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_version_prevent_delete ON kyc_versions;
CREATE TRIGGER trg_kyc_version_prevent_delete
BEFORE DELETE ON kyc_versions
FOR EACH ROW EXECUTE FUNCTION trg_prevent_kyc_version_deletion();

-- ----------------------------------------------------------------------------
-- 12. Engine-Level Immutability & Author Triggers on kyc_reviews (Historical Log)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_enforce_kyc_review_author()
RETURNS TRIGGER AS $$
DECLARE
    v_role VARCHAR;
    v_uid INTEGER;
BEGIN
    v_uid := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    v_role := get_current_app_role();

    IF v_role NOT IN ('bank_employee', 'bank_manager') THEN
        RAISE EXCEPTION 'Security violation: Only Bank Employees and Bank Managers are authorized to record reviews (caller role: %).', v_role;
    END IF;

    IF NEW.reviewer_role != v_role THEN
        RAISE EXCEPTION 'Reviewer role (%) does not match caller database role (%).', NEW.reviewer_role, v_role;
    END IF;

    IF v_uid IS NOT NULL AND NEW.reviewer_id != v_uid THEN
        RAISE EXCEPTION 'Reviewer ID (%) does not match authenticated user ID (%).', NEW.reviewer_id, v_uid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_enforce_kyc_review_author() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_review_author ON kyc_reviews;
CREATE TRIGGER trg_kyc_review_author
BEFORE INSERT ON kyc_reviews
FOR EACH ROW EXECUTE FUNCTION trg_enforce_kyc_review_author();

CREATE OR REPLACE FUNCTION trg_prevent_kyc_review_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'KYC reviews and decisions are strictly immutable historical records. UPDATE and DELETE are prohibited.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_prevent_kyc_review_mutation() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_kyc_review_prevent_update ON kyc_reviews;
CREATE TRIGGER trg_kyc_review_prevent_update
BEFORE UPDATE ON kyc_reviews
FOR EACH ROW EXECUTE FUNCTION trg_prevent_kyc_review_mutation();

DROP TRIGGER IF EXISTS trg_kyc_review_prevent_delete ON kyc_reviews;
CREATE TRIGGER trg_kyc_review_prevent_delete
BEFORE DELETE ON kyc_reviews
FOR EACH ROW EXECUTE FUNCTION trg_prevent_kyc_review_mutation();

-- ----------------------------------------------------------------------------
-- 13. Audit Log Actor Identity Validation & Immutability Triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_enforce_kyc_audit_log_actor()
RETURNS TRIGGER AS $$
DECLARE
    v_uid INTEGER;
    v_role VARCHAR;
    v_sub_owner INTEGER;
    v_sub_emp INTEGER;
BEGIN
    -- Dedicated, restricted migration/maintenance path
    IF current_setting('app.migration_in_progress', true) = 'true' AND SESSION_USER IN ('privacy_owner', 'privacy_migrator') THEN
        RETURN NEW;
    END IF;

    v_uid := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    v_role := get_current_app_role();

    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Security violation: KYC audit log insertion requires an authenticated application session.';
    END IF;

    -- Enforce actor identity matching authenticated session
    IF NEW.actor_id IS NOT NULL AND NEW.actor_id != v_uid THEN
        RAISE EXCEPTION 'Security violation: Audit log actor_id (%) does not match authenticated user ID (%).', NEW.actor_id, v_uid;
    END IF;
    IF NEW.actor_role IS NOT NULL AND NEW.actor_role != v_role THEN
        RAISE EXCEPTION 'Security violation: Audit log actor_role (%) does not match authenticated user role (%).', NEW.actor_role, v_role;
    END IF;

    -- Authoritatively stamp actor identity
    NEW.actor_id := v_uid;
    NEW.actor_role := v_role;

    -- Validate caller authorization for the referenced submission
    IF NEW.submission_id IS NOT NULL THEN
        SELECT customer_id, assigned_employee_id INTO v_sub_owner, v_sub_emp
        FROM public.kyc_submissions
        WHERE id = NEW.submission_id;

        IF v_sub_owner IS NULL THEN
            RAISE EXCEPTION 'Integrity violation: Audit log submission % does not exist.', NEW.submission_id;
        END IF;

        IF v_role = 'customer' THEN
            IF v_sub_owner != v_uid THEN
                RAISE EXCEPTION 'Security violation: Customers can only log audit events for their own submissions.';
            END IF;
            IF NEW.event_type NOT IN ('submission_created', 'version_created', 'correction_resubmitted') THEN
                RAISE EXCEPTION 'Security violation: Customer is not authorized to emit audit event type %.', NEW.event_type;
            END IF;

        ELSIF v_role = 'bank_employee' THEN
            IF v_sub_emp IS NULL OR v_sub_emp != v_uid THEN
                RAISE EXCEPTION 'Security violation: Employees can only log audit events for cases assigned to them.';
            END IF;
            IF NEW.event_type NOT IN ('case_opened', 'review_started', 'recommendation_submitted') THEN
                RAISE EXCEPTION 'Security violation: Bank Employee is not authorized to emit audit event type %.', NEW.event_type;
            END IF;

        ELSIF v_role = 'bank_manager' THEN
            IF NEW.event_type NOT IN ('case_assigned', 'case_reassigned', 'decision_approved', 'decision_rejected', 'decision_correction_requested', 'case_archived', 'case_unarchived', 'status_change') THEN
                RAISE EXCEPTION 'Security violation: Bank Manager is not authorized to emit audit event type %.', NEW.event_type;
            END IF;

        ELSE
            RAISE EXCEPTION 'Security violation: Role % is not authorized to log KYC audit events.', v_role;
        END IF;
    ELSE
        IF v_role != 'bank_manager' THEN
            RAISE EXCEPTION 'Security violation: Only Bank Managers can emit general system audit events.';
        END IF;
    END IF;

    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_enforce_kyc_audit_log_actor() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_audit_log_actor_stamp ON kyc_audit_log;
CREATE TRIGGER trg_audit_log_actor_stamp
BEFORE INSERT ON kyc_audit_log
FOR EACH ROW EXECUTE FUNCTION trg_enforce_kyc_audit_log_actor();

CREATE OR REPLACE FUNCTION trg_prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log entries are strictly immutable. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_prevent_audit_tampering() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_audit_log_prevent_update ON kyc_audit_log;
CREATE TRIGGER trg_audit_log_prevent_update
BEFORE UPDATE ON kyc_audit_log
FOR EACH ROW EXECUTE FUNCTION trg_prevent_audit_tampering();

DROP TRIGGER IF EXISTS trg_audit_log_prevent_delete ON kyc_audit_log;
CREATE TRIGGER trg_audit_log_prevent_delete
BEFORE DELETE ON kyc_audit_log
FOR EACH ROW EXECUTE FUNCTION trg_prevent_audit_tampering();

-- ----------------------------------------------------------------------------
-- 14. Dual Deferrable Constraint Triggers: Exactly One Current Version per Active Submission
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_check_active_submission_has_current_version()
RETURNS TRIGGER AS $$
DECLARE
    target_sub_id INTEGER;
    curr_count INTEGER;
    sub_archived BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'kyc_submissions' THEN
        target_sub_id := NEW.id;
        sub_archived := NEW.is_archived;
    ELSE -- kyc_versions
        target_sub_id := NEW.submission_id;
        SELECT is_archived INTO sub_archived FROM public.kyc_submissions WHERE id = target_sub_id;
    END IF;

    IF (sub_archived IS NOT NULL AND sub_archived = FALSE) THEN
        SELECT count(*) INTO curr_count
        FROM public.kyc_versions
        WHERE submission_id = target_sub_id AND is_current = TRUE;

        IF (curr_count != 1) THEN
            RAISE EXCEPTION 'Integrity violation: Active KYC submission % must have exactly one current version at transaction commit (found %).', target_sub_id, curr_count;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

ALTER FUNCTION trg_check_active_submission_has_current_version() OWNER TO privacy_owner;

DROP TRIGGER IF EXISTS trg_submission_enforce_current_version ON kyc_submissions;
CREATE CONSTRAINT TRIGGER trg_submission_enforce_current_version
AFTER INSERT OR UPDATE ON kyc_submissions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_check_active_submission_has_current_version();

DROP TRIGGER IF EXISTS trg_version_enforce_current_version ON kyc_versions;
CREATE CONSTRAINT TRIGGER trg_version_enforce_current_version
AFTER INSERT OR UPDATE ON kyc_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_check_active_submission_has_current_version();

-- ----------------------------------------------------------------------------
-- 15. Row-Level Security (RLS) & Customer-Facing Secure Views
-- ----------------------------------------------------------------------------
ALTER TABLE kyc_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE kyc_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE kyc_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE kyc_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE kyc_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;

-- Submissions policy:
-- Customer: own submissions only.
-- Bank Employee: strictly assigned submissions only (zero unassigned case access).
-- Bank Manager: bank-wide queue across all statuses.
-- System Administrator: FALSE (strictly excluded from customer KYC submissions).
DROP POLICY IF EXISTS p_kyc_submissions_select ON kyc_submissions;
CREATE POLICY p_kyc_submissions_select ON kyc_submissions
    FOR SELECT
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
            WHEN get_current_app_role() = 'bank_employee' THEN
                assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

DROP POLICY IF EXISTS p_kyc_submissions_insert ON kyc_submissions;
CREATE POLICY p_kyc_submissions_insert ON kyc_submissions
    FOR INSERT
    TO privacy_app
    WITH CHECK (
        get_current_app_role() = 'customer'
        AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
    );

DROP POLICY IF EXISTS p_kyc_submissions_update ON kyc_submissions;
CREATE POLICY p_kyc_submissions_update ON kyc_submissions
    FOR UPDATE
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
            WHEN get_current_app_role() = 'bank_employee' THEN
                assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Versions policy:
-- Customer: own submissions' versions.
-- Bank Employee: assigned submissions' versions only.
-- Bank Manager: all versions.
-- System Administrator: FALSE (strictly excluded from KYC documents, PII, hashes).
DROP POLICY IF EXISTS p_kyc_versions_isolation ON kyc_versions;
DROP POLICY IF EXISTS p_kyc_versions_select ON kyc_versions;
CREATE POLICY p_kyc_versions_select ON kyc_versions
    FOR SELECT
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_versions.submission_id
                      AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_employee' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_versions.submission_id
                      AND s.assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Version creation policy: ONLY owning customer can create versions for their own submission
DROP POLICY IF EXISTS p_kyc_versions_insert ON kyc_versions;
CREATE POLICY p_kyc_versions_insert ON kyc_versions
    FOR INSERT
    TO privacy_app
    WITH CHECK (
        get_current_app_role() = 'customer'
        AND EXISTS (
            SELECT 1 FROM public.kyc_submissions s
            WHERE s.id = kyc_versions.submission_id
              AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
        )
    );

DROP POLICY IF EXISTS p_kyc_versions_update ON kyc_versions;
CREATE POLICY p_kyc_versions_update ON kyc_versions
    FOR UPDATE
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_versions.submission_id
                      AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_employee' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_versions.submission_id
                      AND s.assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Reviews policy:
-- Customer: FALSE (direct table queries completely forbidden to prevent internal note leaks).
-- Customers query customer_kyc_decisions view exclusively for final decisions and customer notes.
-- Bank Employee: reviews on strictly assigned cases only.
-- Bank Manager: all reviews bank-wide.
-- System Administrator: FALSE (strictly excluded from reviews, notes, decisions).
DROP POLICY IF EXISTS p_kyc_reviews_isolation ON kyc_reviews;
CREATE POLICY p_kyc_reviews_isolation ON kyc_reviews
    FOR ALL
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                FALSE
            WHEN get_current_app_role() = 'bank_employee' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_reviews.submission_id
                      AND s.assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Audit Log policy:
-- Customer: events for own submissions only.
-- Bank Employee: events for assigned submissions only.
-- Bank Manager: bank-wide events.
-- System Administrator: FALSE (strictly excluded from customer KYC audit events).
DROP POLICY IF EXISTS p_kyc_audit_log_select ON kyc_audit_log;
CREATE POLICY p_kyc_audit_log_select ON kyc_audit_log
    FOR SELECT
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_audit_log.submission_id
                      AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_employee' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_audit_log.submission_id
                      AND s.assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

DROP POLICY IF EXISTS p_kyc_audit_log_insert ON kyc_audit_log;
CREATE POLICY p_kyc_audit_log_insert ON kyc_audit_log
    FOR INSERT
    TO privacy_app
    WITH CHECK (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_audit_log.submission_id
                      AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_employee' THEN
                EXISTS (
                    SELECT 1 FROM public.kyc_submissions s
                    WHERE s.id = kyc_audit_log.submission_id
                      AND s.assigned_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
                )
            WHEN get_current_app_role() = 'bank_manager' THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Owner maintenance policies: Permit privacy_owner full access for integrity triggers & migrations
DROP POLICY IF EXISTS p_owner_all_submissions ON kyc_submissions;
CREATE POLICY p_owner_all_submissions ON kyc_submissions TO privacy_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_owner_all_versions ON kyc_versions;
CREATE POLICY p_owner_all_versions ON kyc_versions TO privacy_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_owner_all_reviews ON kyc_reviews;
CREATE POLICY p_owner_all_reviews ON kyc_reviews TO privacy_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_owner_all_audit ON kyc_audit_log;
CREATE POLICY p_owner_all_audit ON kyc_audit_log TO privacy_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_owner_all_txns ON transactions;
CREATE POLICY p_owner_all_txns ON transactions TO privacy_owner USING (true) WITH CHECK (true);

-- Transactions policy:
-- Customer: own transactions only.
-- Bank Staff (Employee, Manager): full operational visibility.
-- System Administrator: FALSE (strictly excluded from customer financial transaction content).
DROP POLICY IF EXISTS p_transactions_isolation ON transactions;
CREATE POLICY p_transactions_isolation ON transactions
    FOR ALL
    TO privacy_app
    USING (
        CASE
            WHEN get_current_app_role() = 'customer' THEN
                user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
            WHEN get_current_app_role() IN ('bank_employee', 'bank_manager') THEN
                TRUE
            ELSE
                FALSE
        END
    );

-- Secure Customer-Facing View for KYC Decisions:
-- Column-level isolation: Exposes only customer-facing explanation and action.
-- Internal employee and manager notes (internal_notes) are completely excluded from this view.
-- Runs with view owner privileges (privacy_owner) to access kyc_reviews safely without exposing table to customer.
-- Protected by security_barrier to prevent search qualification leaks.
CREATE OR REPLACE VIEW customer_kyc_decisions WITH (security_barrier = true) AS
SELECT
    r.id,
    r.submission_id,
    r.version_id,
    r.action,
    r.customer_notes,
    r.created_at
FROM public.kyc_reviews r
JOIN public.kyc_submissions s ON s.id = r.submission_id
WHERE r.reviewer_role = 'bank_manager'
  AND s.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer;

ALTER VIEW customer_kyc_decisions OWNER TO privacy_owner;

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 16. Least-Privilege DCL Permissions for Application Role (privacy_app)
-- ----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM privacy_app;
GRANT USAGE ON SCHEMA public TO privacy_app;
GRANT EXECUTE ON FUNCTION get_current_app_role() TO privacy_app;

-- users table: Column-level permissions.
-- NEVER permit inserting role (defaults to customer)! NEVER permit updating role or username!
GRANT SELECT (id, username, password_hash, role, created_at) ON users TO privacy_app;
GRANT INSERT (username, password_hash) ON users TO privacy_app;
GRANT UPDATE (password_hash) ON users TO privacy_app;

-- transactions table: Read and insert only
GRANT SELECT, INSERT ON transactions TO privacy_app;

-- Legacy kyc_records table: Read and insert only (backward compatibility)
GRANT SELECT, INSERT ON kyc_records TO privacy_app;

-- kyc_submissions table: Column-level permissions. customer_id & submission_ref are immutable!
-- Notice: INSERT is granted ONLY on customer_id, submission_ref, status.
-- Assigned and archival fields are strictly excluded from INSERT to prevent creation tampering.
GRANT SELECT ON kyc_submissions TO privacy_app;
GRANT INSERT (customer_id, submission_ref, status) ON kyc_submissions TO privacy_app;
GRANT UPDATE (status, assigned_employee_id, assigned_manager_id, is_archived, archived_at, archived_by_id, updated_at) ON kyc_submissions TO privacy_app;

-- kyc_versions table: Insert new version and update is_current (strictly enforced by trigger)
GRANT SELECT ON kyc_versions TO privacy_app;
GRANT INSERT ON kyc_versions TO privacy_app;
GRANT UPDATE (is_current) ON kyc_versions TO privacy_app;

-- kyc_reviews table & customer_kyc_decisions view:
GRANT SELECT (id, submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes, created_at) ON kyc_reviews TO privacy_app;
GRANT INSERT (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes) ON kyc_reviews TO privacy_app;
GRANT SELECT ON customer_kyc_decisions TO privacy_app;

-- kyc_audit_log table: Insert and read only (audit entries are immutable)
GRANT SELECT, INSERT ON kyc_audit_log TO privacy_app;

-- Sequences: USAGE & SELECT only
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE transactions_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE kyc_records_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE kyc_submissions_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE kyc_versions_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE kyc_reviews_id_seq TO privacy_app;
GRANT USAGE, SELECT ON SEQUENCE kyc_audit_log_id_seq TO privacy_app;

-- Revoke all table-level destructive permissions explicitly
REVOKE DELETE, TRUNCATE ON users FROM privacy_app;
REVOKE DELETE, TRUNCATE ON transactions FROM privacy_app;
REVOKE DELETE, TRUNCATE ON kyc_submissions FROM privacy_app;
REVOKE DELETE, TRUNCATE ON kyc_versions FROM privacy_app;
REVOKE UPDATE, DELETE, TRUNCATE ON kyc_reviews FROM privacy_app;
REVOKE UPDATE, DELETE, TRUNCATE ON kyc_audit_log FROM privacy_app;

-- ----------------------------------------------------------------------------
-- 17. Migrate Historical kyc_records Data (Zero Invented PII or Ownership)
-- ----------------------------------------------------------------------------
-- Activate restricted migration session flag (valid only for privileged maintenance roles)
SET LOCAL app.migration_in_progress = 'true';

INSERT INTO kyc_submissions (
    id, customer_id, submission_ref, status, is_archived, created_at, updated_at
)
SELECT
    kr.id,
    kr.user_id,
    kr.customer_ref,
    CASE
        WHEN kr.user_id IS NULL THEN 'legacy_unresolved'
        WHEN kr.verification_status = 'verified' THEN 'legacy_verified'
        WHEN kr.verification_status = 'pending' THEN 'submitted'
        ELSE 'legacy_unresolved'
    END,
    FALSE,
    kr.created_at,
    kr.created_at
FROM kyc_records kr
ON CONFLICT (id) DO NOTHING;

SELECT setval('kyc_submissions_id_seq', COALESCE((SELECT MAX(id) FROM kyc_submissions), 1));

INSERT INTO kyc_versions (
    submission_id,
    version_number,
    is_current,
    document_type,
    document_id_hash,
    encrypted_pii,
    pii_nonce,
    attachment_filename,
    attachment_mime_type,
    attachment_size_bytes,
    attachment_hash,
    auto_validation_status,
    auto_validation_results,
    created_at
)
SELECT
    kr.id,
    1,
    TRUE,
    kr.document_type,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'unassessed',
    jsonb_build_object(
        'legacy_migration', true,
        'original_risk_category', kr.risk_category,
        'original_verification_status', kr.verification_status,
        'requires_review', (
            kr.user_id IS NULL OR
            kr.verification_status IS NULL OR
            kr.verification_status NOT IN ('verified', 'pending')
        )
    ),
    kr.created_at
FROM kyc_records kr
ON CONFLICT (submission_id, version_number) DO NOTHING;

INSERT INTO kyc_audit_log (
    submission_id, actor_id, actor_role, event_type, event_metadata, created_at
)
SELECT
    kr.id,
    NULL,
    'system',
    'legacy_migration',
    jsonb_build_object(
        'migration_id', 'MIG-002-KYC-WORKFLOW',
        'source_table', 'kyc_records',
        'source_id', kr.id,
        'migrated_at', CURRENT_TIMESTAMP
    ),
    CURRENT_TIMESTAMP
FROM kyc_records kr
WHERE NOT EXISTS (
    SELECT 1 FROM kyc_audit_log kal
    WHERE kal.submission_id = kr.id
      AND kal.event_type = 'legacy_migration'
      AND kal.event_metadata->>'migration_id' = 'MIG-002-KYC-WORKFLOW'
);

-- ----------------------------------------------------------------------------
-- 18. Record Migration Completion in schema_migrations
-- ----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, description)
VALUES ('002_kyc_workflow_migration', 'Multi-role KYC validation and review platform schema');

COMMIT;
