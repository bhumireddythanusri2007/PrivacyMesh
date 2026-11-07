-- ============================================================================
-- Security & Workflow Scenario Test Suite: test_security_scenarios.sql
-- Runs against temporary test database using privacy_app
-- Tests:
--   1. System Administrator KYC and Transaction isolation (Zero access to submissions, versions, reviews, transactions, audit)
--   2. Submission creation security (Customer self-submission, initial status, forbidden assignment/archival on insert, no anonymous bypass)
--   3. Version creation & ownership security (Customer self-versioning, employee/manager version creation blocked, cross-customer blocked, immutability)
--   4. Assignment protection (Manager-only, role verification, non-employee rejection)
--   5. Field-level archival protection (Manager-only archival, automatic stamp, customer/employee blocked)
--   6. Audit log security & event authorization (Actor verification, submission ownership check, event type authorization, negative tests)
--   7. Workflow integrity (Employee recommendation required, assigned employee check, manager decision matching, stale version rejection)
--   8. Review note privacy (Internal notes excluded from customer view, customer_notes visible)
--   9. Dual deferrable constraint triggers (Exactly one current version at commit)
-- ============================================================================

\set ON_ERROR_STOP on

-- Setup test roles in test database (Must be performed by DBA/superuser prior to running this script):
-- User 2: privacy_admin (system_admin)
-- User 5: test_employee_1 (bank_employee)
-- User 6: test_employee_2 (bank_employee)
-- User 7: test_manager (bank_manager)
-- User 1: test_customer (customer)
-- User 3: other_customer (customer)

\echo '=== [SUITE START] Running Security Test Suite as privacy_app ==='

-- ----------------------------------------------------------------------------
-- TEST SUITE 1: System Administrator Content, Transaction & Audit Isolation
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 1.1] System Administrator cannot view kyc_submissions ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    sub_count INTEGER;
BEGIN
    SELECT count(*) INTO sub_count FROM kyc_submissions;
    IF sub_count != 0 THEN
        RAISE EXCEPTION 'TEST 1.1 FAILED: System admin saw % submissions (expected 0)', sub_count;
    END IF;
    RAISE NOTICE 'TEST 1.1 PASSED: System Admin sees 0 submissions.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 1.2] System Administrator cannot view kyc_versions (PII, docs) ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    ver_count INTEGER;
BEGIN
    SELECT count(*) INTO ver_count FROM kyc_versions;
    IF ver_count != 0 THEN
        RAISE EXCEPTION 'TEST 1.2 FAILED: System admin saw % versions (expected 0)', ver_count;
    END IF;
    RAISE NOTICE 'TEST 1.2 PASSED: System Admin sees 0 versions.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 1.3] System Administrator cannot view kyc_reviews (notes, decisions) ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    rev_count INTEGER;
BEGIN
    SELECT count(*) INTO rev_count FROM kyc_reviews;
    IF rev_count != 0 THEN
        RAISE EXCEPTION 'TEST 1.3 FAILED: System admin saw % reviews (expected 0)', rev_count;
    END IF;
    RAISE NOTICE 'TEST 1.3 PASSED: System Admin sees 0 reviews.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 1.4] System Administrator cannot view kyc_audit_log ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    audit_count INTEGER;
BEGIN
    SELECT count(*) INTO audit_count FROM kyc_audit_log;
    IF audit_count != 0 THEN
        RAISE EXCEPTION 'TEST 1.4 FAILED: System admin saw % audit entries (expected 0)', audit_count;
    END IF;
    RAISE NOTICE 'TEST 1.4 PASSED: System Admin sees 0 KYC audit entries.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 1.5] System Administrator cannot view transactions (financial records) ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    txn_count INTEGER;
BEGIN
    SELECT count(*) INTO txn_count FROM transactions;
    IF txn_count != 0 THEN
        RAISE EXCEPTION 'TEST 1.5 FAILED: System admin saw % transactions (expected 0)', txn_count;
    END IF;
    RAISE NOTICE 'TEST 1.5 PASSED: System Admin sees 0 transactions.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 1.6] System Administrator cannot alter KYC workflow status (RLS blocks row modification) ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE kyc_submissions SET status = 'approved' WHERE id = 1;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows != 0 THEN
        RAISE EXCEPTION 'TEST 1.6 FAILED: System Admin was able to update % rows (expected 0)', v_rows;
    END IF;
    RAISE NOTICE 'TEST 1.6 PASSED: System Admin cannot modify KYC submissions (0 rows affected).';
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 2: Submission Creation Security & Anonymous Bypass Removal
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 2.1] Customer creates valid submission for themselves ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
INSERT INTO kyc_submissions (customer_id, submission_ref, status)
VALUES (1, 'SUB-TEST-VALID-001', 'submitted');
-- Also create initial version for constraint trigger
INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type)
VALUES (currval('kyc_submissions_id_seq'), 1, TRUE, 'passport');
DO $$
BEGIN
    RAISE NOTICE 'TEST 2.1 PASSED: Customer 1 successfully created submission for themselves.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 2.2] Customer CANNOT create submission for another customer ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_submissions (customer_id, submission_ref, status)
        VALUES (3, 'SUB-TEST-FORGED-002', 'submitted');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 2.2 PASSED: Creation for another customer correctly blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 2.2 FAILED: Customer was allowed to create submission for another customer';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 2.3] Customer CANNOT supply assignment fields on creation (Column grant restricted) ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        EXECUTE 'INSERT INTO kyc_submissions (customer_id, submission_ref, status, assigned_employee_id) VALUES (1, ''SUB-TEST-ASSIGN-003'', ''submitted'', 5)';
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 2.3 PASSED: Assignment on insert blocked by column privileges: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 2.3 FAILED: Customer was able to supply assigned_employee_id on insert!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 2.4] Customer CANNOT set initial status to approved ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_submissions (customer_id, submission_ref, status)
        VALUES (1, 'SUB-TEST-INVALID-STATUS-004', 'approved');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 2.4 PASSED: Invalid initial status blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 2.4 FAILED: Customer created submission with approved status';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 2.5] Employee CANNOT create KYC submission ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_submissions (customer_id, submission_ref, status)
        VALUES (1, 'SUB-TEST-EMP-CREATE-005', 'submitted');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 2.5 PASSED: Employee creation blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 2.5 FAILED: Employee was allowed to create submission';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 2.6] Anonymous insert without migration maintenance flag is BLOCKED ==='
BEGIN;
-- Session user id not set (anonymous)
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_submissions (customer_id, submission_ref, status)
        VALUES (1, 'SUB-TEST-ANON-006', 'submitted');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 2.6 PASSED: Anonymous submission insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 2.6 FAILED: Anonymous submission insert succeeded without migration flag!';
    END IF;
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 3: Version Creation & Ownership Security
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 3.1] Customer creates new KYC version on own submission ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1 (owner of submission 1)
-- Demote current version
UPDATE kyc_versions SET is_current = FALSE WHERE submission_id = 1 AND is_current = TRUE;
-- Insert new version
INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type, auto_validation_status)
VALUES (1, 2, TRUE, 'passport', 'unassessed');
DO $$
BEGIN
    RAISE NOTICE 'TEST 3.1 PASSED: Customer 1 successfully created new version on own submission.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 3.2] Customer CANNOT create version on another customer submission ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        -- Submission 3 belongs to user 4
        INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type)
        VALUES (3, 2, TRUE, 'passport');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 3.2 PASSED: Cross-customer version insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 3.2 FAILED: Customer created version on another customer submission!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 3.3] Employee CANNOT create version on customer submission ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type)
        VALUES (1, 2, TRUE, 'passport');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 3.3 PASSED: Employee version insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 3.3 FAILED: Employee was allowed to create KYC version!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 3.4] Manager CANNOT create version on customer submission ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type)
        VALUES (1, 2, TRUE, 'passport');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 3.4 PASSED: Manager version insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 3.4 FAILED: Manager was allowed to create KYC version!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 3.5] Submitted version metadata cannot be mutated (Immutability check) ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_versions SET document_id_hash = 'tampered_hash_000000000000000000' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 3.5 PASSED: Version metadata mutation blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 3.5 FAILED: KYC version metadata was mutated!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 3.6] Submitted version deletion is unconditionally forbidden ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        DELETE FROM kyc_versions WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 3.6 PASSED: Version deletion blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 3.6 FAILED: KYC version was deleted!';
    END IF;
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 4: Assignment Protection
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 4.1] Customer CANNOT assign employee ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET assigned_employee_id = 5 WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 4.1 PASSED: Customer assignment blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 4.1 FAILED: Customer was allowed to assign employee';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 4.2] Employee CANNOT self-assign unassigned case (RLS blocks row access) ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_rows INTEGER;
BEGIN
    -- Unassigned submissions are invisible to employee under RLS
    UPDATE kyc_submissions SET assigned_employee_id = 5 WHERE id = 1;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows != 0 THEN
        RAISE EXCEPTION 'TEST 4.2 FAILED: Employee updated % unassigned cases', v_rows;
    END IF;
    RAISE NOTICE 'TEST 4.2 PASSED: Employee cannot target unassigned cases (0 rows affected).';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 4.3] Manager CANNOT assign non-employee user as assigned_employee_id ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        -- User 1 has role 'customer', NOT 'bank_employee'
        UPDATE kyc_submissions SET assigned_employee_id = 1 WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 4.3 PASSED: Non-employee assignment blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 4.3 FAILED: Manager assigned non-employee to assigned_employee_id';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 4.4] Manager CANNOT assign non-manager user as assigned_manager_id ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        -- User 5 has role 'bank_employee', NOT 'bank_manager'
        UPDATE kyc_submissions SET assigned_manager_id = 5 WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 4.4 PASSED: Non-manager assignment blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 4.4 FAILED: Manager assigned employee to assigned_manager_id';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 4.5] Manager successfully assigns Employee 5 to Submission 1 ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
UPDATE kyc_submissions SET assigned_employee_id = 5 WHERE id = 1;
DO $$
DECLARE
    emp_id INTEGER;
BEGIN
    SELECT assigned_employee_id INTO emp_id FROM kyc_submissions WHERE id = 1;
    IF emp_id != 5 THEN
        RAISE EXCEPTION 'TEST 4.5 FAILED: assigned_employee_id is % (expected 5)', emp_id;
    END IF;
    RAISE NOTICE 'TEST 4.5 PASSED: Manager successfully assigned Employee 5.';
END $$;
COMMIT; -- Keep assignment for subsequent employee tests

\echo ''
\echo '=== [TEST 4.6] Employee 5 sees assigned case; Employee 6 cannot see or reassign ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    sub_count INTEGER;
BEGIN
    SELECT count(*) INTO sub_count FROM kyc_submissions;
    IF sub_count != 1 THEN
        RAISE EXCEPTION 'TEST 4.6a FAILED: Employee 5 saw % submissions (expected 1)', sub_count;
    END IF;
    RAISE NOTICE 'TEST 4.6a PASSED: Employee 5 sees exactly their 1 assigned case.';
END $$;

SET LOCAL app.current_user_id = '6'; -- Employee 2 (unassigned)
DO $$
DECLARE
    sub_count INTEGER;
    v_rows INTEGER;
BEGIN
    SELECT count(*) INTO sub_count FROM kyc_submissions WHERE id = 1;
    IF sub_count != 0 THEN
        RAISE EXCEPTION 'TEST 4.6b FAILED: Employee 6 saw submission 1 assigned to Employee 5';
    END IF;
    RAISE NOTICE 'TEST 4.6b PASSED: Employee 6 isolated from Employee 5 case.';

    UPDATE kyc_submissions SET assigned_employee_id = 6 WHERE id = 1;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows != 0 THEN
        RAISE EXCEPTION 'TEST 4.6c FAILED: Employee 6 updated % rows of Employee 5 case', v_rows;
    END IF;
    RAISE NOTICE 'TEST 4.6c PASSED: Reassignment by Employee 6 blocked by RLS (0 rows affected).';
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 5: Field-Level Archival Protection
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 5.1] Customer and Employee CANNOT archive submissions ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET is_archived = TRUE WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 5.1a PASSED: Customer archival blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 5.1a FAILED: Customer archived submission';
    END IF;
END $$;

SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET is_archived = TRUE WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 5.1b PASSED: Employee archival blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 5.1b FAILED: Employee archived submission';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 5.2] Manager archives and unarchives submission with automatic stamping ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
UPDATE kyc_submissions SET is_archived = TRUE WHERE id = 1;
DO $$
DECLARE
    v_archived BOOLEAN;
    v_by INTEGER;
    v_at TIMESTAMPTZ;
BEGIN
    SELECT is_archived, archived_by_id, archived_at INTO v_archived, v_by, v_at
    FROM kyc_submissions WHERE id = 1;
    IF v_archived != TRUE OR v_by != 7 OR v_at IS NULL THEN
        RAISE EXCEPTION 'TEST 5.2a FAILED: Archival stamp incorrect: is_archived=%, by=%, at=%', v_archived, v_by, v_at;
    END IF;
    RAISE NOTICE 'TEST 5.2a PASSED: Manager archived submission, stamped by=7, at=%.', v_at;
END $$;

-- Unarchive
UPDATE kyc_submissions SET is_archived = FALSE WHERE id = 1;
DO $$
DECLARE
    v_archived BOOLEAN;
    v_by INTEGER;
    v_at TIMESTAMPTZ;
BEGIN
    SELECT is_archived, archived_by_id, archived_at INTO v_archived, v_by, v_at
    FROM kyc_submissions WHERE id = 1;
    IF v_archived != FALSE OR v_by IS NOT NULL OR v_at IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 5.2b FAILED: Unarchival clear incorrect: is_archived=%, by=%, at=%', v_archived, v_by, v_at;
    END IF;
    RAISE NOTICE 'TEST 5.2b PASSED: Manager unarchived submission cleanly.';
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 6: Audit Log Security & Event Authorization
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 6.1] Audit log actor identity validation: Forged actor_id is rejected ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        -- Employee 5 attempts to insert audit log forging actor_id = 7 (Manager)
        INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type)
        VALUES (1, 7, 'bank_manager', 'case_opened');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 6.1 PASSED: Forged audit actor rejected: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 6.1 FAILED: Audit log accepted forged actor_id';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.2] Customer emits permitted audit event on own submission ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type, event_metadata)
VALUES (1, 1, 'customer', 'version_created', '{"version": 2}'::jsonb);
DO $$
BEGIN
    RAISE NOTICE 'TEST 6.2 PASSED: Customer 1 successfully logged permitted version_created event.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.3] Customer CANNOT emit audit event for another customer submission ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        -- Submission 3 belongs to user 4
        INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type)
        VALUES (3, 1, 'customer', 'version_created');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 6.3 PASSED: Cross-customer audit insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 6.3 FAILED: Customer logged audit event for another customer submission!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.4] Customer CANNOT emit manager audit event type ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type)
        VALUES (1, 1, 'customer', 'decision_approved');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 6.4 PASSED: Customer unauthorized event type blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 6.4 FAILED: Customer emitted manager event type decision_approved!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.5] Assigned Employee emits permitted recommendation audit event ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1 (assigned to submission 1)
INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type, event_metadata)
VALUES (1, 5, 'bank_employee', 'recommendation_submitted', '{"action": "recommend_approve"}'::jsonb);
DO $$
BEGIN
    RAISE NOTICE 'TEST 6.5 PASSED: Assigned Employee 5 logged recommendation_submitted event.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.6] Employee CANNOT emit audit event on unassigned submission ==='
BEGIN;
SET LOCAL app.current_user_id = '6'; -- Employee 2 (unassigned on submission 1)
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type)
        VALUES (1, 6, 'bank_employee', 'case_opened');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 6.6 PASSED: Unassigned employee audit insert blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 6.6 FAILED: Unassigned employee logged audit event on submission 1!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.7] Manager emits permitted workflow audit event ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager
INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type, event_metadata)
VALUES (1, 7, 'bank_manager', 'case_assigned', '{"assigned_employee": 5}'::jsonb);
DO $$
BEGIN
    RAISE NOTICE 'TEST 6.7 PASSED: Bank Manager logged case_assigned audit event.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 6.8] System Admin CANNOT emit KYC audit events ==='
BEGIN;
SET LOCAL app.current_user_id = '2'; -- privacy_admin (system_admin)
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO kyc_audit_log (submission_id, actor_id, actor_role, event_type)
        VALUES (1, 2, 'system_admin', 'case_opened');
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 6.8 PASSED: System Admin KYC audit emission blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 6.8 FAILED: System Admin was allowed to emit KYC audit event!';
    END IF;
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 7: Workflow Integrity & Recommendation Enforcement
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 7.1] Move to under_employee_review by assigned Employee 5 ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
UPDATE kyc_submissions SET status = 'under_employee_review' WHERE id = 1;
DO $$
DECLARE
    v_st VARCHAR;
BEGIN
    SELECT status INTO v_st FROM kyc_submissions WHERE id = 1;
    IF v_st != 'under_employee_review' THEN
        RAISE EXCEPTION 'TEST 7.1 FAILED: Status is %, expected under_employee_review', v_st;
    END IF;
    RAISE NOTICE 'TEST 7.1 PASSED: Status moved to under_employee_review.';
END $$;
COMMIT; -- Keep state for recommendation test

\echo ''
\echo '=== [TEST 7.2] CANNOT advance to pending_manager_decision without employee recommendation ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET status = 'pending_manager_decision' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 7.2 PASSED: Advance without recommendation blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 7.2 FAILED: Advance to pending_manager_decision succeeded without employee recommendation';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 7.3] Unassigned Employee 6 CANNOT submit case for manager decision (RLS blocked) ==='
BEGIN;
SET LOCAL app.current_user_id = '6'; -- Employee 2 (unassigned)
DO $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE kyc_submissions SET status = 'pending_manager_decision' WHERE id = 1;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows != 0 THEN
        RAISE EXCEPTION 'TEST 7.3 FAILED: Unassigned employee updated % rows', v_rows;
    END IF;
    RAISE NOTICE 'TEST 7.3 PASSED: Unassigned employee advance blocked by RLS (0 rows affected).';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 7.4] Assigned Employee 5 records recommendation and advances to pending_manager_decision ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1

-- Employee records recommendation review
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes)
VALUES (1, 1, 5, 'bank_employee', 'recommend_approve', 'ID document and selfie match verified.');

-- Employee advances status
UPDATE kyc_submissions SET status = 'pending_manager_decision' WHERE id = 1;

DO $$
DECLARE
    v_st VARCHAR;
BEGIN
    SELECT status INTO v_st FROM kyc_submissions WHERE id = 1;
    IF v_st != 'pending_manager_decision' THEN
        RAISE EXCEPTION 'TEST 7.4 FAILED: Status is %, expected pending_manager_decision', v_st;
    END IF;
    RAISE NOTICE 'TEST 7.4 PASSED: Case successfully forwarded with employee recommendation.';
END $$;
COMMIT; -- Keep state for manager tests

\echo ''
\echo '=== [TEST 7.5] Direct approval by Employee is BLOCKED ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET status = 'approved' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 7.5 PASSED: Employee direct approval blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 7.5 FAILED: Employee was able to approve submission';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 7.6] Manager approval with mismatched action is BLOCKED ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager

-- Manager records a REJECT review
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes)
VALUES (1, 1, 7, 'bank_manager', 'reject', 'Internal fraud risk', 'Failed verification');

-- Manager attempts to update status to APPROVED using the REJECT review
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET status = 'approved' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 7.6 PASSED: Mismatched action blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 7.6 FAILED: Reject review authorized an approval status';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 7.7] Stale-version decision CANNOT authorize current version approval ==='
BEGIN;
-- 1. Manager records an approve review for Version 1
SET LOCAL app.current_user_id = '7'; -- Manager
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes)
VALUES (1, 1, 7, 'bank_manager', 'approve', 'Approved v1', 'Approved');

-- 2. Customer creates Version 2 (demotes Version 1 and uploads new Version 2)
SET LOCAL app.current_user_id = '1'; -- Customer 1
UPDATE kyc_versions SET is_current = FALSE WHERE submission_id = 1 AND is_current = TRUE;
INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type, auto_validation_status)
VALUES (1, 2, TRUE, 'passport', 'passed');

-- 3. Manager attempts to approve using the decision from old Version 1
SET LOCAL app.current_user_id = '7'; -- Manager
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET status = 'approved' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 7.7 PASSED: Stale version decision blocked: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 7.7 FAILED: Old version decision authorized current version approval';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 7.8] Manager requests correction from pending_manager_decision ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager 7

-- Manager records correction review on Version 1
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes)
VALUES (1, 1, 7, 'bank_manager', 'manager_request_correction', 'Image blurry', 'Please upload a clearer passport scan.');

-- Advance to correction_requested
UPDATE kyc_submissions SET status = 'correction_requested' WHERE id = 1;

DO $$
DECLARE
    v_st VARCHAR;
BEGIN
    SELECT status INTO v_st FROM kyc_submissions WHERE id = 1;
    IF v_st != 'correction_requested' THEN
        RAISE EXCEPTION 'TEST 7.8 FAILED: Status is %, expected correction_requested', v_st;
    END IF;
    RAISE NOTICE 'TEST 7.8 PASSED: Submission successfully moved to correction_requested.';
END $$;

\echo ''
\echo '=== [TEST 7.9] Resubmission from correction_requested WITHOUT new version is REJECTED ==='
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        UPDATE kyc_submissions SET status = 'submitted' WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 7.9 PASSED: Resubmission without new version rejected: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 7.9 FAILED: Customer was allowed to resubmit without creating a new version!';
    END IF;
END $$;

\echo ''
\echo '=== [TEST 7.10] Customer creates Version 2 and successfully resubmits ==='
SET LOCAL app.current_user_id = '1'; -- Customer 1

-- Demote Version 1
UPDATE kyc_versions SET is_current = FALSE WHERE submission_id = 1 AND is_current = TRUE;

-- Insert Version 2
INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type, auto_validation_status)
VALUES (1, 2, TRUE, 'passport', 'unassessed');

-- Resubmit
UPDATE kyc_submissions SET status = 'submitted' WHERE id = 1;

DO $$
DECLARE
    v_st VARCHAR;
    v_ver_num INTEGER;
BEGIN
    SELECT status INTO v_st FROM kyc_submissions WHERE id = 1;
    IF v_st != 'submitted' THEN
        RAISE EXCEPTION 'TEST 7.10 FAILED: Status is %, expected submitted', v_st;
    END IF;
    SELECT version_number INTO v_ver_num FROM kyc_versions WHERE submission_id = 1 AND is_current = TRUE;
    IF v_ver_num != 2 THEN
        RAISE EXCEPTION 'TEST 7.10 FAILED: Current version number is %, expected 2', v_ver_num;
    END IF;
    RAISE NOTICE 'TEST 7.10 PASSED: Resubmission succeeded with new Version 2.';
END $$;

\echo ''
\echo '=== [TEST 7.11] Assigned Employee recommends and Bank Manager approves Version 2 ==='
-- Employee 5 moves to under_employee_review
SET LOCAL app.current_user_id = '5'; -- Employee 5
UPDATE kyc_submissions SET status = 'under_employee_review' WHERE id = 1;

-- Employee 5 records recommendation on Version 2
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes)
VALUES (
    1,
    (SELECT id FROM kyc_versions WHERE submission_id = 1 AND is_current = TRUE),
    5,
    'bank_employee',
    'recommend_approve',
    'V2 documents verified valid and clear.',
    'Your updated passport has been verified.'
);

-- Employee 5 advances to pending_manager_decision
UPDATE kyc_submissions SET status = 'pending_manager_decision' WHERE id = 1;

-- Manager 7 records approve review on Version 2
SET LOCAL app.current_user_id = '7'; -- Manager 7
INSERT INTO kyc_reviews (submission_id, version_id, reviewer_id, reviewer_role, action, internal_notes, customer_notes)
VALUES (
    1,
    (SELECT id FROM kyc_versions WHERE submission_id = 1 AND is_current = TRUE),
    7,
    'bank_manager',
    'approve',
    'CONFIDENTIAL_EDD_NOTES: Compliant with AML Schedule 4.',
    'Your identity documents have been approved.'
);

-- Manager 7 approves
UPDATE kyc_submissions SET status = 'approved' WHERE id = 1;

DO $$
DECLARE
    v_st VARCHAR;
BEGIN
    SELECT status INTO v_st FROM kyc_submissions WHERE id = 1;
    IF v_st != 'approved' THEN
        RAISE EXCEPTION 'TEST 7.11 FAILED: Status is %, expected approved', v_st;
    END IF;
    RAISE NOTICE 'TEST 7.11 PASSED: Manager successfully approved submission on current Version 2.';
END $$;
COMMIT; -- Keep for review note privacy test

-- ----------------------------------------------------------------------------
-- TEST SUITE 8: Review Note Privacy & Customer Isolation
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 8.1] Customer views decision via customer_kyc_decisions view (customer_notes only) ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1 (owner of submission 1)
DO $$
DECLARE
    v_action VARCHAR;
    v_cust_notes TEXT;
    view_count INTEGER;
BEGIN
    SELECT count(*) INTO view_count FROM customer_kyc_decisions WHERE submission_id = 1;
    IF view_count < 1 THEN
        RAISE EXCEPTION 'TEST 8.1 FAILED: Customer saw % decisions in view (expected >= 1)', view_count;
    END IF;

    SELECT action, customer_notes INTO v_action, v_cust_notes
    FROM customer_kyc_decisions
    WHERE submission_id = 1
    ORDER BY id DESC LIMIT 1;

    RAISE NOTICE 'TEST 8.1 PASSED: Customer sees customer_notes ("%") without internal notes.', v_cust_notes;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 8.2] Customer CANNOT retrieve reviews directly from kyc_reviews table (RLS blocks row access) ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM kyc_reviews WHERE submission_id = 1;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'TEST 8.2 FAILED: Customer was able to select % rows directly from kyc_reviews table!', v_count;
    END IF;
    RAISE NOTICE 'TEST 8.2 PASSED: Direct queries on kyc_reviews return 0 rows for customer.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 8.3] Direct query on internal_notes by Customer returns 0 rows ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM kyc_reviews WHERE submission_id = 1 AND internal_notes IS NOT NULL;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'TEST 8.3 FAILED: Customer retrieved internal_notes directly from kyc_reviews!';
    END IF;
    RAISE NOTICE 'TEST 8.3 PASSED: Direct query on internal_notes returns 0 rows for customer.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 8.4] Negative test: Attempt to select internal_notes from customer_kyc_decisions fails ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        EXECUTE 'SELECT internal_notes FROM customer_kyc_decisions WHERE submission_id = 1';
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 8.4 PASSED: Selecting internal_notes on customer view rejected: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 8.4 FAILED: Customer view exposed internal_notes column!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 8.5] Assigned Employee 5 sees reviews including internal notes on assigned case ==='
BEGIN;
SET LOCAL app.current_user_id = '5'; -- Employee 5 (assigned)
DO $$
DECLARE
    v_count INTEGER;
    v_notes TEXT;
BEGIN
    SELECT count(*) INTO v_count FROM kyc_reviews WHERE submission_id = 1;
    IF v_count < 1 THEN
        RAISE EXCEPTION 'TEST 8.5 FAILED: Assigned employee saw % reviews (expected >= 1)', v_count;
    END IF;
    SELECT internal_notes INTO v_notes FROM kyc_reviews WHERE submission_id = 1 AND internal_notes IS NOT NULL LIMIT 1;
    IF v_notes IS NULL THEN
        RAISE EXCEPTION 'TEST 8.5 FAILED: Employee could not read internal_notes on assigned case';
    END IF;
    RAISE NOTICE 'TEST 8.5 PASSED: Assigned Employee 5 has proper visibility into internal reviews.';
END $$;
ROLLBACK;

\echo ''
\echo '=== [TEST 8.6] Manager 7 sees reviews including internal notes bank-wide ==='
BEGIN;
SET LOCAL app.current_user_id = '7'; -- Manager 7
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM kyc_reviews WHERE submission_id = 1;
    IF v_count < 1 THEN
        RAISE EXCEPTION 'TEST 8.6 FAILED: Manager saw % reviews (expected >= 1)', v_count;
    END IF;
    RAISE NOTICE 'TEST 8.6 PASSED: Bank Manager 7 has full bank-wide review visibility.';
END $$;
ROLLBACK;

-- ----------------------------------------------------------------------------
-- TEST SUITE 9: Dual Deferrable Constraint Triggers (Current Version Enforcement)
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== [TEST 9.1] Version transition within transaction succeeds at commit ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
-- Demote current version
UPDATE kyc_versions SET is_current = FALSE WHERE submission_id = 1 AND is_current = TRUE;
-- Insert v3
INSERT INTO kyc_versions (submission_id, version_number, is_current, document_type, auto_validation_status)
VALUES (1, 3, TRUE, 'national_id', 'unassessed');
COMMIT; -- Deferred constraint checks at commit

DO $$
BEGIN
    RAISE NOTICE 'TEST 9.1 PASSED: Version transition succeeded at commit.';
END $$;

\echo ''
\echo '=== [TEST 9.2] Active submission with 0 current versions FAILS at commit ==='
BEGIN;
SET LOCAL app.current_user_id = '1'; -- Customer 1
UPDATE kyc_versions SET is_current = FALSE WHERE submission_id = 1 AND is_current = TRUE;
DO $$
DECLARE
    v_threw BOOLEAN := FALSE;
BEGIN
    BEGIN
        SET CONSTRAINTS trg_version_enforce_current_version IMMEDIATE;
    EXCEPTION WHEN OTHERS THEN
        v_threw := TRUE;
        RAISE NOTICE 'TEST 9.2 PASSED: 0 current versions rejected by deferred trigger: %', SQLERRM;
    END;
    IF NOT v_threw THEN
        RAISE EXCEPTION 'TEST 9.2 FAILED: 0 current versions did not trigger integrity violation!';
    END IF;
END $$;
ROLLBACK;

\echo ''
\echo '=== ALL TEST SUITES COMPLETED AND VERIFIED SUCCESSFULLY! ==='
