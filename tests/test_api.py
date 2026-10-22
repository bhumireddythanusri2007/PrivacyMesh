"""
PrivacyMesh API Integration & Security Test Suite
Tests:
  - System health and database connectivity
  - User registration & public registration role restriction
  - User login & JWT issuance
  - Protected endpoint authentication
  - Role-based authorization (Admin vs User)
  - Transaction creation, validation, and multi-tenant isolation
  - KYC record creation, query parameter handling, validation, and isolation
  - CORS headers check
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "http://localhost:8000"


def make_request(path, method="GET", data=None, token=None, expected_status=None):
    url = f"{BASE_URL}{path}"
    headers = {"Accept": "application/json"}
    body = None

    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")

    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            resp_body = resp.read().decode("utf-8")
            parsed = json.loads(resp_body) if resp_body else {}
            if expected_status and status_code != expected_status:
                raise AssertionError(f"Expected status {expected_status}, got {status_code} for {method} {path}")
            return status_code, parsed, resp.headers
    except urllib.error.HTTPError as e:
        status_code = e.code
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"raw": err_body}
        if expected_status and status_code != expected_status:
            raise AssertionError(f"Expected status {expected_status}, got {status_code} for {method} {path}: {parsed}")
        return status_code, parsed, e.headers


def run_tests():
    print("==================================================================")
    print("           PrivacyMesh Automated Verification Suite               ")
    print("==================================================================")
    passed = 0
    total = 0

    def test(name, fn):
        nonlocal passed, total
        total += 1
        try:
            fn()
            print(f"[PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")

    # 1. Health Checks
    def test_health():
        status, body, _ = make_request("/health", expected_status=200)
        assert body.get("status") == "healthy", f"Unexpected body: {body}"

    test("1.1 GET /health returns 200 and healthy status", test_health)

    def test_db_health():
        status, body, _ = make_request("/db-health", expected_status=200)
        assert body.get("status") == "connected", f"Unexpected body: {body}"
        assert body.get("database") == "PostgreSQL", f"Unexpected db: {body}"

    test("1.2 GET /db-health returns 200 connected to PostgreSQL", test_db_health)

    # 2. CORS Preflight Check
    def test_cors():
        req = urllib.request.Request(
            f"{BASE_URL}/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
            method="OPTIONS",
        )
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200
            allow_origin = resp.headers.get("access-control-allow-origin")
            assert allow_origin == "http://localhost:5173", f"Wrong origin: {allow_origin}"

    test("2.1 CORS preflight allows http://localhost:5173", test_cors)

    # Generate unique test usernames per test run
    ts = int(time.time())
    user_a_name = f"alice_{ts}"
    user_b_name = f"bob_{ts}"
    test_password = "SecurePassword2026!"

    # 3. User Registration
    def test_register_user_a():
        payload = {"username": user_a_name, "password": test_password}
        status, body, _ = make_request("/auth/register", method="POST", data=payload, expected_status=201)
        assert body.get("username") == user_a_name
        assert body.get("role") == "user", "Role must be user"

    test("3.1 Public registration creates ordinary user", test_register_user_a)

    def test_register_duplicate():
        payload = {"username": user_a_name, "password": test_password}
        status, body, _ = make_request("/auth/register", method="POST", data=payload, expected_status=409)
        assert "already exists" in body.get("detail", "")

    test("3.2 Duplicate username returns 409 Conflict", test_register_duplicate)

    def test_register_privilege_escalation_prevented():
        # Attempting to register as admin should be rejected or coerced to user
        payload = {"username": f"attacker_{ts}", "password": test_password, "role": "admin"}
        status, body, _ = make_request("/auth/register", method="POST", data=payload)
        # Should either be 422 (validation error on role) or coerced to 'user'
        if status == 201:
            assert body.get("role") == "user", "Attacker must NOT get admin role"
        else:
            assert status in (422, 400), f"Expected 422/400 or coerced role, got {status}"

    test("3.3 Registration rejects or neutralizes role='admin'", test_register_privilege_escalation_prevented)

    # Register user B
    def test_register_user_b():
        payload = {"username": user_b_name, "password": test_password}
        status, body, _ = make_request("/auth/register", method="POST", data=payload, expected_status=201)
        assert body.get("username") == user_b_name

    test("3.4 Register second user for multi-tenancy testing", test_register_user_b)

    # 4. Authentication / Login
    token_a = None
    token_b = None

    def test_login_invalid():
        payload = {"username": user_a_name, "password": "WrongPassword!"}
        status, body, _ = make_request("/auth/login", method="POST", data=payload, expected_status=401)
        assert "Invalid username or password" in body.get("detail", "")

    test("4.1 Login with invalid credentials returns 401 Unauthorized", test_login_invalid)

    def test_login_success():
        nonlocal token_a
        payload = {"username": user_a_name, "password": test_password}
        status, body, _ = make_request("/auth/login", method="POST", data=payload, expected_status=200)
        token_a = body.get("access_token")
        assert token_a and len(token_a) > 20, "Access token missing"
        assert body.get("token_type") == "bearer"

    test("4.2 Login with valid credentials returns JWT bearer token", test_login_success)

    def test_login_user_b():
        nonlocal token_b
        payload = {"username": user_b_name, "password": test_password}
        status, body, _ = make_request("/auth/login", method="POST", data=payload, expected_status=200)
        token_b = body.get("access_token")
        assert token_b

    test("4.3 Login second user successfully", test_login_user_b)

    # 5. Protected Endpoint Access
    def test_protected_valid():
        status, body, _ = make_request("/protected", token=token_a, expected_status=200)
        assert body.get("user", {}).get("username") == user_a_name
        assert body.get("user", {}).get("role") == "user"

    test("5.1 GET /protected with valid JWT returns user info", test_protected_valid)

    def test_protected_invalid():
        status, body, _ = make_request("/protected", token="invalid.token.here", expected_status=401)
        assert "Invalid" in body.get("detail", "")

    test("5.2 GET /protected with malformed JWT returns 401", test_protected_invalid)

    # 6. Role-Based Access Control (RBAC)
    def test_user_cannot_access_admin():
        status, body, _ = make_request("/admin/summary", token=token_a, expected_status=403)
        assert "Admin access required" in body.get("detail", "")
        status2, body2, _ = make_request("/admin/users", token=token_a, expected_status=403)
        assert "Admin access required" in body2.get("detail", "")

    test("6.1 Ordinary user access to /admin endpoints is blocked (403 Forbidden)", test_user_cannot_access_admin)

    # 7. Transactions and Multi-Tenant Isolation
    def test_create_and_isolate_transactions():
        # User A creates transaction
        txn_payload = {
            "account_id": "ACC-ALICE-01",
            "amount": 2500.00,
            "transaction_type": "deposit",
        }
        status, body, _ = make_request("/transactions", method="POST", data=txn_payload, token=token_a, expected_status=201)
        assert body.get("account_id") == "ACC-ALICE-01"
        assert body.get("amount") == "2500.00"

        # User B creates transaction
        txn_b_payload = {
            "account_id": "ACC-BOB-01",
            "amount": 750.50,
            "transaction_type": "withdrawal",
        }
        make_request("/transactions", method="POST", data=txn_b_payload, token=token_b, expected_status=201)

        # User A views transactions -> must ONLY see Alice's transaction
        status_a, txns_a, _ = make_request("/transactions", token=token_a, expected_status=200)
        alice_accounts = [t["account_id"] for t in txns_a]
        assert "ACC-ALICE-01" in alice_accounts, "Alice's transaction must be present"
        assert "ACC-BOB-01" not in alice_accounts, "Alice must NEVER see Bob's transaction (violation of ownership)"

        # User B views transactions -> must ONLY see Bob's transaction
        status_b, txns_b, _ = make_request("/transactions", token=token_b, expected_status=200)
        bob_accounts = [t["account_id"] for t in txns_b]
        assert "ACC-BOB-01" in bob_accounts, "Bob's transaction must be present"
        assert "ACC-ALICE-01" not in bob_accounts, "Bob must NEVER see Alice's transaction"

    test("7.1 Transaction creation and strict ownership isolation", test_create_and_isolate_transactions)

    def test_transaction_validation():
        # Invalid amount (<= 0)
        bad_payload = {
            "account_id": "ACC-INVALID",
            "amount": -50.00,
            "transaction_type": "deposit",
        }
        status, _, _ = make_request("/transactions", method="POST", data=bad_payload, token=token_a, expected_status=422)

        # Invalid transaction type
        bad_type = {
            "account_id": "ACC-INVALID",
            "amount": 100.00,
            "transaction_type": "gambling",
        }
        status, _, _ = make_request("/transactions", method="POST", data=bad_type, token=token_a, expected_status=422)

    test("7.2 Transaction input validation (rejects negative amounts & invalid types)", test_transaction_validation)

    # 8. KYC Records and Ownership Isolation
    def test_kyc_operations_and_isolation():
        cust_ref_a = f"CUST-ALICE-{ts}"
        cust_ref_b = f"CUST-BOB-{ts}"

        # Create KYC record for Alice via query parameters
        status, kyc_a, _ = make_request(
            f"/kyc?customer_ref={cust_ref_a}&document_type=Passport",
            method="POST",
            token=token_a,
            expected_status=201,
        )
        assert kyc_a.get("customer_ref") == cust_ref_a

        # Create KYC record for Bob
        make_request(
            f"/kyc?customer_ref={cust_ref_b}&document_type=DriverLicense",
            method="POST",
            token=token_b,
            expected_status=201,
        )

        # Alice views KYC -> must only see Alice's records
        status_a, records_a, _ = make_request("/kyc", token=token_a, expected_status=200)
        alice_refs = [r["customer_ref"] for r in records_a]
        assert cust_ref_a in alice_refs
        assert cust_ref_b not in alice_refs, "Alice must not see Bob's KYC record"

        # Duplicate customer reference check
        status_dup, _, _ = make_request(
            f"/kyc?customer_ref={cust_ref_a}&document_type=PAN",
            method="POST",
            token=token_a,
            expected_status=409,
        )

    test("8.1 KYC query-parameter creation, duplicate rejection, and isolation", test_kyc_operations_and_isolation)

    print("==================================================================")
    print(f"Results: {passed} / {total} tests passed ({passed/total*100:.1f}%)")
    print("==================================================================")

    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
