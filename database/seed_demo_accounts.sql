-- ============================================================================
-- PrivacyMesh Demo Account Inspection
-- Purpose: List existing demo accounts for the KYC workflow roles
-- Run against: privacymesh database
-- Read-only: This script does not create, update, or delete accounts
-- ============================================================================

SELECT username, role
FROM users
WHERE username IN (
    'demo_customer',
    'demo_employee',
    'demo_manager',
    'demo_admin',
    'privacy_admin',
    'demo_student'
)
ORDER BY role;
