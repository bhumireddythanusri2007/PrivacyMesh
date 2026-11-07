-- ============================================================================
-- Migration Phase 1: 001_bootstrap_roles.sql
-- Description: Idempotent role provisioning and schema ownership transfer
-- Target: PostgreSQL 16+
-- Executed by: Database Administrator / Superuser (privacy_user)
-- Note: Passwords for privacy_migrator and privacy_app are set out-of-band via stdin.
-- ============================================================================

BEGIN;

-- 1. Create dedicated non-superuser roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_owner') THEN
        CREATE ROLE privacy_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_migrator') THEN
        CREATE ROLE privacy_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'privacy_app') THEN
        CREATE ROLE privacy_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

-- 2. Grant schema and database privileges
GRANT USAGE, CREATE ON SCHEMA public TO privacy_owner;
GRANT USAGE ON SCHEMA public TO privacy_migrator, privacy_app;

-- 3. Authorize migration account to switch to schema owner
GRANT privacy_owner TO privacy_migrator;

-- 4. Transfer ownership of existing pre-migration tables and sequences to privacy_owner
ALTER TABLE users OWNER TO privacy_owner;
ALTER TABLE transactions OWNER TO privacy_owner;
ALTER TABLE kyc_records OWNER TO privacy_owner;
ALTER SEQUENCE users_id_seq OWNER TO privacy_owner;
ALTER SEQUENCE transactions_id_seq OWNER TO privacy_owner;
ALTER SEQUENCE kyc_records_id_seq OWNER TO privacy_owner;

-- 5. Restore ownership and privileges of schema version registry if it exists (re-migration support)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations') THEN
        ALTER TABLE schema_migrations OWNER TO privacy_owner;
        GRANT ALL ON TABLE schema_migrations TO privacy_owner;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE schema_migrations TO privacy_migrator;
    END IF;
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_migration_002_user_backup') THEN
        ALTER TABLE _migration_002_user_backup OWNER TO privacy_owner;
        GRANT ALL ON TABLE _migration_002_user_backup TO privacy_owner;
    END IF;
END
$$;

COMMIT;
