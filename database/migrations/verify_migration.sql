-- ============================================================================
-- Verification: verify_migration.sql
-- Description: Verification queries for pre- and post-migration validation
-- ============================================================================

-- 1. Row counts comparison across all relations
SELECT 'users' as table_name, count(*) as row_count FROM users
UNION ALL
SELECT 'transactions', count(*) FROM transactions
UNION ALL
SELECT 'kyc_records', count(*) FROM kyc_records
UNION ALL
SELECT 'kyc_submissions', count(*) FROM kyc_submissions
UNION ALL
SELECT 'kyc_versions', count(*) FROM kyc_versions
UNION ALL
SELECT 'kyc_reviews', count(*) FROM kyc_reviews
UNION ALL
SELECT 'kyc_audit_log', count(*) FROM kyc_audit_log;

-- 2. User role distribution after migration
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;

-- 3. KYC Submissions status distribution
SELECT status, count(*) FROM kyc_submissions GROUP BY status ORDER BY status;

-- 4. Check for multiple current versions (MUST BE 0)
SELECT submission_id, count(*) as current_version_count
FROM kyc_versions
WHERE is_current = TRUE
GROUP BY submission_id
HAVING count(*) > 1;

-- 5. Check for active submissions with 0 current versions (MUST BE 0)
SELECT s.id as submission_without_current_version
FROM kyc_submissions s
WHERE s.is_archived = FALSE
  AND NOT EXISTS (
      SELECT 1 FROM kyc_versions v
      WHERE v.submission_id = s.id AND v.is_current = TRUE
  );

-- 6. Verify object ownership (MUST be owned by privacy_owner)
SELECT tablename, tableowner
FROM pg_tables
WHERE tablename IN ('users', 'transactions', 'kyc_records', 'kyc_submissions', 'kyc_versions', 'kyc_reviews', 'kyc_audit_log')
ORDER BY tablename;

-- 7. Verify RLS is enabled and forced across all protected relations
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('kyc_submissions', 'kyc_versions', 'kyc_reviews', 'kyc_audit_log', 'transactions')
ORDER BY relname;

-- 8. Verify sequence ownership
SELECT sequencename, sequenceowner
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;

-- 9. Verify migration record in schema_migrations
SELECT version, applied_at, description FROM schema_migrations;

-- 10. Verify secure customer view exists
SELECT table_name, is_insertable_into
FROM information_schema.views
WHERE table_name = 'customer_kyc_decisions';
