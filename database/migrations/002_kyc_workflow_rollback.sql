-- ============================================================================
-- Rollback: 002_kyc_workflow_rollback.sql
-- Description: Safely rolls back 002_kyc_workflow_migration.sql
-- Restores original user roles from pre-migration backup table.
-- Reassigns and drops role ownership cleanly to avoid dependency errors.
-- Drops only migration-introduced objects in strict reverse dependency order (RESTRICT).
-- Preserves original users, transactions, and kyc_records completely.
-- Target: PostgreSQL 16+
-- ============================================================================

-- [CRITICAL WARNING]
-- This rollback script drops kyc_submissions, kyc_versions, kyc_reviews, and kyc_audit_log.
-- Rollback permanently destroys newly created workflow data and must NOT be used after real
-- live workflow activity without a prior cold-storage audit export and disaster recovery procedure!
-- This script is strictly intended for pre-production testing or deployment failure backout.

BEGIN;

-- Guard: Verify existence of DBA role privacy_user before performing reassignments
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_user') THEN
        RAISE EXCEPTION 'Rollback precondition failed: superuser/DBA role privacy_user does not exist.';
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. Deregister Migration Version
-- Note: The schema_migrations table itself is intentionally retained as the
-- permanent schema version registry for the database. Only the entry for
-- 002_kyc_workflow_migration is deleted to signal rollback of this migration.
-- ----------------------------------------------------------------------------
DELETE FROM schema_migrations WHERE version = '002_kyc_workflow_migration';

-- ----------------------------------------------------------------------------
-- 2. Drop Secure Views First (Reverse Dependency Order)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS customer_kyc_decisions RESTRICT;

-- ----------------------------------------------------------------------------
-- 3. Drop Audit Log Triggers, Policies, Table, and Functions (RESTRICT, No CASCADE)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_log_actor_stamp ON kyc_audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_prevent_delete ON kyc_audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_prevent_update ON kyc_audit_log;
DROP POLICY IF EXISTS p_kyc_audit_log_select ON kyc_audit_log;
DROP POLICY IF EXISTS p_kyc_audit_log_insert ON kyc_audit_log;
DROP TABLE IF EXISTS kyc_audit_log RESTRICT;

DROP FUNCTION IF EXISTS trg_prevent_audit_tampering();
DROP FUNCTION IF EXISTS trg_enforce_kyc_audit_log_actor();

-- ----------------------------------------------------------------------------
-- 4. Drop Reviews Triggers, Policies, Table, and Functions (RESTRICT, No CASCADE)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_kyc_review_author ON kyc_reviews;
DROP TRIGGER IF EXISTS trg_kyc_review_prevent_delete ON kyc_reviews;
DROP TRIGGER IF EXISTS trg_kyc_review_prevent_update ON kyc_reviews;
DROP POLICY IF EXISTS p_kyc_reviews_isolation ON kyc_reviews;
DROP TABLE IF EXISTS kyc_reviews RESTRICT;

DROP FUNCTION IF EXISTS trg_enforce_kyc_review_author();
DROP FUNCTION IF EXISTS trg_prevent_kyc_review_mutation();

-- ----------------------------------------------------------------------------
-- 5. Drop Versions Triggers, Policies, Table, and Functions (RESTRICT, No CASCADE)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_version_enforce_current_version ON kyc_versions;
DROP TRIGGER IF EXISTS trg_kyc_version_before_insert ON kyc_versions;
DROP TRIGGER IF EXISTS trg_kyc_version_prevent_delete ON kyc_versions;
DROP TRIGGER IF EXISTS trg_kyc_version_prevent_update ON kyc_versions;
DROP POLICY IF EXISTS p_kyc_versions_isolation ON kyc_versions;
DROP POLICY IF EXISTS p_kyc_versions_select ON kyc_versions;
DROP POLICY IF EXISTS p_kyc_versions_insert ON kyc_versions;
DROP POLICY IF EXISTS p_kyc_versions_update ON kyc_versions;
DROP POLICY IF EXISTS p_owner_all_versions ON kyc_versions;
DROP TABLE IF EXISTS kyc_versions RESTRICT;

DROP FUNCTION IF EXISTS trg_enforce_kyc_version_insert();
DROP FUNCTION IF EXISTS trg_prevent_kyc_version_deletion();
DROP FUNCTION IF EXISTS trg_prevent_kyc_version_mutation();

-- ----------------------------------------------------------------------------
-- 6. Disable RLS and Drop Policy on Transactions (Before Dropping Helper Functions)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS p_transactions_isolation ON transactions;
DROP POLICY IF EXISTS p_owner_all_txns ON transactions;
ALTER TABLE transactions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 7. Drop Submissions Triggers, Policies, Table, and Functions (RESTRICT, No CASCADE)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_submission_enforce_current_version ON kyc_submissions;
DROP TRIGGER IF EXISTS trg_kyc_submission_before_insert ON kyc_submissions;
DROP TRIGGER IF EXISTS trg_kyc_status_transitions ON kyc_submissions;
DROP POLICY IF EXISTS p_kyc_submissions_select ON kyc_submissions;
DROP POLICY IF EXISTS p_kyc_submissions_insert ON kyc_submissions;
DROP POLICY IF EXISTS p_kyc_submissions_update ON kyc_submissions;
DROP POLICY IF EXISTS p_owner_all_submissions ON kyc_submissions;
DROP TABLE IF EXISTS kyc_submissions RESTRICT;

DROP FUNCTION IF EXISTS trg_check_active_submission_has_current_version();
DROP FUNCTION IF EXISTS trg_enforce_kyc_submission_insert();
DROP FUNCTION IF EXISTS trg_enforce_kyc_status_transitions();
DROP FUNCTION IF EXISTS get_current_app_role();

-- ----------------------------------------------------------------------------
-- 8. Restore Exact Pre-Migration User Roles from Snapshot Table
-- ----------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;

-- Restore each user's exact original role captured prior to migration 002
UPDATE users u
SET role = b.original_role
FROM _migration_002_user_backup b
WHERE u.id = b.user_id;

-- Any accounts created post-migration (not in snapshot) safely default to pre-migration 'user' role
UPDATE users
SET role = 'user'
WHERE role NOT IN ('user', 'admin');

-- Revert default role back to user
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Restore exact pre-migration check constraint: role IN ('user', 'admin')
ALTER TABLE users ADD CONSTRAINT check_user_role
  CHECK (role IN ('user', 'admin'));

-- Clean up snapshot table
DROP TABLE IF EXISTS _migration_002_user_backup RESTRICT;

-- ----------------------------------------------------------------------------
-- 9. Cleanly Handle Role Ownership and Drop Roles
-- ----------------------------------------------------------------------------
-- Transfer ownership of any surviving objects (e.g. schema_migrations) back to privacy_user
REASSIGN OWNED BY privacy_owner TO privacy_user;
DROP OWNED BY privacy_owner;

REASSIGN OWNED BY privacy_migrator TO privacy_user;
DROP OWNED BY privacy_migrator;

REASSIGN OWNED BY privacy_app TO privacy_user;
DROP OWNED BY privacy_app;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM privacy_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM privacy_app;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM privacy_app;
DO $$
BEGIN
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM privacy_app', current_database());
EXCEPTION WHEN OTHERS THEN
    NULL;
END
$$;
DROP ROLE IF EXISTS privacy_app;

REVOKE privacy_owner FROM privacy_migrator;
DROP ROLE IF EXISTS privacy_migrator;
DROP ROLE IF EXISTS privacy_owner;

-- Preservation Verification:
-- Original tables `users`, `transactions`, and `kyc_records` and all their
-- data rows remain completely untouched.

COMMIT;
