"""
PrivacyMesh Phase 6: Comprehensive End-to-End KYC Workflow & Security Test Suite
Targets isolated test container connected to privacymesh_test database.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.getenv("TEST_BASE_URL", "http://127.0.0.1:8001")


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
            try:
                parsed = json.loads(resp_body) if resp_body else {}
            except Exception:
                parsed = {"raw": resp_body}
            if expected_status and status_code != expected_status:
                raise AssertionError(f"Expected status {expected_status}, got {status_code} for {method} {path}: {parsed}")
            return status_code, parsed
    except urllib.error.HTTPError as e:
        status_code = e.code
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"raw": err_body}
        if expected_status and status_code != expected_status:
            raise AssertionError(f"Expected status {expected_status}, got {status_code} for {method} {path}: {parsed}")
        return status_code, parsed


def get_token(username, password):
    status, body = make_request(
        "/auth/login",
        method="POST",
        data={"username": username, "password": password},
    )
    if status != 200:
        raise RuntimeError(
            f"Real login failed for {username}: HTTP {status}: {body}"
        )
    return body["access_token"]


def run_phase6_suite():
    print("=" * 70)
    print("  PrivacyMesh Phase 6: E2E Workflow & Security Integration Suite  ")
    print("=" * 70)
    passed = 0
    failed = 0
    total = 0

    def test(name, fn):
        nonlocal passed, failed, total
        total += 1
        try:
            fn()
            print(f"[PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            failed += 1

    ts = int(time.time())

    # Register 2 fresh customers for multi-tenancy tests
    cust_a_user = f"p6_cust_a_{ts}"
    cust_a_pass = "CustA_Pass_2026!"
    make_request("/auth/register", method="POST", data={"username": cust_a_user, "password": cust_a_pass}, expected_status=201)
    cust_a_token = get_token(cust_a_user, cust_a_pass)

    cust_b_user = f"p6_cust_b_{ts}"
    cust_b_pass = "CustB_Pass_2026!"
    make_request("/auth/register", method="POST", data={"username": cust_b_user, "password": cust_b_pass}, expected_status=201)
    cust_b_token = get_token(cust_b_user, cust_b_pass)

    # Use pre-provisioned bank users in privacymesh_test
    # User 5: alice_1792643092 (bank_employee)
    # User 6: bob_1792643092 (bank_employee)
    # User 7: alice_1792647654 (bank_manager)
    # User 2: privacy_admin (system_admin)
    emp1_token = get_token(os.environ["PM_TEST_EMPLOYEE1_USERNAME"], os.environ["PM_TEST_EMPLOYEE1_PASSWORD"])
    emp2_token = get_token(os.environ["PM_TEST_EMPLOYEE2_USERNAME"], os.environ["PM_TEST_EMPLOYEE2_PASSWORD"])
    mgr_token = get_token(os.environ["PM_TEST_MANAGER_USERNAME"], os.environ["PM_TEST_MANAGER_PASSWORD"])
    admin_token = get_token(os.environ["PM_TEST_ADMIN_USERNAME"], os.environ["PM_TEST_ADMIN_PASSWORD"])

    print(f"\n--- Section 1: Full Happy-Path Approval Lifecycle ---")
    approval_sub_id = None

    def test_cust_creates_approval_sub():
        nonlocal approval_sub_id
        payload = {"submission_ref": f"P6-APP-{ts}", "document_type": "passport"}
        status, body = make_request("/kyc/workflow/submissions", method="POST", data=payload, token=cust_a_token, expected_status=201)
        assert body["status"] == "submitted"
        assert body["current_version"]["version_number"] == 1
        assert body["current_version"]["is_current"] is True
        assert body["current_version"]["document_type"] == "passport"
        approval_sub_id = body["id"]

    test("1.1 Customer A creates submission with Version 1 (passport)", test_cust_creates_approval_sub)

    def test_cust_views_my_submissions():
        status, body = make_request("/kyc/workflow/submissions/my", method="GET", token=cust_a_token, expected_status=200)
        assert any(s["id"] == approval_sub_id for s in body)

    test("1.2 Customer A verifies submission listed in /submissions/my", test_cust_views_my_submissions)

    def test_mgr_views_and_assigns_emp1():
        status, cases = make_request("/kyc/workflow/manager/cases", method="GET", token=mgr_token, expected_status=200)
        assert any(c["id"] == approval_sub_id for c in cases)
        payload = {"assigned_employee_id": 79}
        status, updated = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/assign", method="POST", data=payload, token=mgr_token, expected_status=200)
        assert updated["assigned_employee_id"] == 79

    test("1.3 Bank Manager lists cases bank-wide and assigns Employee 1 (dedicated test account)", test_mgr_views_and_assigns_emp1)

    def test_emp1_views_and_starts_review():
        status, assigned = make_request("/kyc/workflow/employee/assigned", method="GET", token=emp1_token, expected_status=200)
        assert any(s["id"] == approval_sub_id for s in assigned)
        status, started = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/review-start", method="POST", token=emp1_token, expected_status=200)
        assert started["status"] == "under_employee_review"

    test("1.4 Dedicated employee starts review -> status changes to under_employee_review", test_emp1_views_and_starts_review)

    def test_emp1_submits_recommendation():
        payload = {
            "action": "recommend_approve",
            "internal_notes": "Employee verification: Passport scan authentic, holograms confirmed."
        }
        status, recommended = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/recommend", method="POST", data=payload, token=emp1_token, expected_status=200)
        assert recommended["status"] == "pending_manager_decision"

    test("1.5 Dedicated employee submits recommend_approve -> status moves to pending_manager_decision", test_emp1_submits_recommendation)

    def test_mgr_makes_final_approval():
        payload = {
            "action": "approve",
            "internal_notes": "Manager EDD complete: Watchlist clear. Approval granted.",
            "customer_notes": "Welcome to PrivacyMesh! Your KYC verification has been approved."
        }
        status, approved = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="POST", data=payload, token=mgr_token, expected_status=200)
        assert approved["status"] == "approved"

    test("1.6 Bank Manager executes final approve decision -> status moves to approved", test_mgr_makes_final_approval)

    def test_cust_verifies_approval_receipt_and_privacy():
        status, decision = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="GET", token=cust_a_token, expected_status=200)
        assert decision["action"] == "approve"
        assert decision["customer_notes"] == "Welcome to PrivacyMesh! Your KYC verification has been approved."
        assert "internal_notes" not in decision, "CONFIDENTIALITY VIOLATION: internal_notes must not be returned to customer"

    test("1.7 Customer A retrieves decision receipt: approved, customer_notes present, internal_notes omitted", test_cust_verifies_approval_receipt_and_privacy)

    print(f"\n--- Section 2: Correction & Resubmission Flow (Version 1 -> Version 2) ---")
    corr_sub_id = None

    def test_cust_creates_corr_sub():
        nonlocal corr_sub_id
        payload = {"submission_ref": f"P6-CORR-{ts}", "document_type": "passport"}
        status, body = make_request("/kyc/workflow/submissions", method="POST", data=payload, token=cust_a_token, expected_status=201)
        assert body["status"] == "submitted"
        assert body["current_version"]["version_number"] == 1
        corr_sub_id = body["id"]

    test("2.1 Customer A creates submission for correction testing", test_cust_creates_corr_sub)

    def test_mgr_assigns_and_emp_reviews_corr_sub():
        make_request(f"/kyc/workflow/submissions/{corr_sub_id}/assign", method="POST", data={"assigned_employee_id": 79}, token=mgr_token, expected_status=200)
        make_request(f"/kyc/workflow/submissions/{corr_sub_id}/review-start", method="POST", token=emp1_token, expected_status=200)
        rec_payload = {
            "action": "request_correction",
            "internal_notes": "Employee review: Passport photo is blurry and corners are cropped."
        }
        status, body = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/recommend", method="POST", data=rec_payload, token=emp1_token, expected_status=200)
        assert body["status"] == "pending_manager_decision"

    test("2.2 Manager assigns and Dedicated employee requests correction -> status moves to pending_manager_decision", test_mgr_assigns_and_emp_reviews_corr_sub)

    def test_mgr_requests_correction():
        payload = {
            "action": "manager_request_correction",
            "internal_notes": "Manager notes: Document rejected per QA checklist rule 3.2.",
            "customer_notes": "Your passport image was illegible. Please submit a new high-resolution scan or national ID."
        }
        status, sub = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/decision", method="POST", data=payload, token=mgr_token, expected_status=200)
        assert sub["status"] == "correction_requested"

    test("2.3 Bank Manager requests correction -> status moves to correction_requested", test_mgr_requests_correction)

    def test_cust_resubmit_without_new_version_blocked():
        status, body = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/resubmit", method="POST", token=cust_a_token, expected_status=400)
        assert status == 400
        assert "requires creating a new KYC version" in str(body) or "Workflow violation" in str(body)

    test("2.4 Integrity Guard: Customer cannot resubmit without creating Version 2 (400)", test_cust_resubmit_without_new_version_blocked)

    def test_cust_creates_v2_and_resubmits():
        v2_payload = {"document_type": "national_id"}
        status, v2 = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/versions", method="POST", data=v2_payload, token=cust_a_token, expected_status=201)
        assert v2["version_number"] == 2
        assert v2["is_current"] is True
        assert v2["document_type"] == "national_id"

        # Resubmit with new version
        status, resubmitted = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/resubmit", method="POST", token=cust_a_token, expected_status=200)
        assert resubmitted["status"] == "submitted"
        assert resubmitted["current_version"]["version_number"] == 2

    test("2.5 Customer creates Version 2 and successfully resubmits (status: submitted)", test_cust_creates_v2_and_resubmits)

    def test_review_v2_and_mgr_approve():
        make_request(f"/kyc/workflow/submissions/{corr_sub_id}/review-start", method="POST", token=emp1_token, expected_status=200)
        make_request(f"/kyc/workflow/submissions/{corr_sub_id}/recommend", method="POST", data={"action": "recommend_approve", "internal_notes": "V2 National ID verified."}, token=emp1_token, expected_status=200)
        mgr_payload = {
            "action": "approve",
            "internal_notes": "Manager final check on V2 completed.",
            "customer_notes": "Your national ID has been verified. Verification complete!"
        }
        status, final_sub = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/decision", method="POST", data=mgr_payload, token=mgr_token, expected_status=200)
        assert final_sub["status"] == "approved"

    test("2.6 Dedicated employee reviews V2 and Manager approves Version 2", test_review_v2_and_mgr_approve)

    def test_reviews_history_reflects_both_versions():
        status, reviews = make_request(f"/kyc/workflow/submissions/{corr_sub_id}/reviews", method="GET", token=mgr_token, expected_status=200)
        assert len(reviews) >= 2, f"Expected at least 2 reviews, got {len(reviews)}"
        # Verify reviews record both Version 1 recommendation and Version 2 actions
        has_v1_review = any("photo is blurry" in (r.get("internal_notes") or "") or r.get("action") == "request_correction" for r in reviews)
        has_v2_review = any("National ID verified" in (r.get("internal_notes") or "") or r.get("action") == "recommend_approve" for r in reviews)
        assert has_v1_review, "Review history must contain Version 1 review"
        assert has_v2_review, "Review history must contain Version 2 review"

    test("2.7 Review history reflects audit records across both Version 1 and Version 2", test_reviews_history_reflects_both_versions)

    print(f"\n--- Section 3: Rejection Lifecycle ---")
    rej_sub_id = None

    def test_rejection_lifecycle():
        nonlocal rej_sub_id
        # Customer creates
        payload = {"submission_ref": f"P6-REJ-{ts}", "document_type": "passport"}
        _, body = make_request("/kyc/workflow/submissions", method="POST", data=payload, token=cust_a_token, expected_status=201)
        rej_sub_id = body["id"]

        # Manager assigns
        make_request(f"/kyc/workflow/submissions/{rej_sub_id}/assign", method="POST", data={"assigned_employee_id": 79}, token=mgr_token, expected_status=200)

        # Employee starts review and recommends rejection
        make_request(f"/kyc/workflow/submissions/{rej_sub_id}/review-start", method="POST", token=emp1_token, expected_status=200)
        make_request(f"/kyc/workflow/submissions/{rej_sub_id}/recommend", method="POST", data={"action": "recommend_reject", "internal_notes": "Sanctions match."}, token=emp1_token, expected_status=200)

        # Manager rejects
        mgr_rej_payload = {
            "action": "reject",
            "internal_notes": "Manager confirmed sanctions match with Compliance Dept.",
            "customer_notes": "Your submission could not be verified and has been rejected."
        }
        _, rejected_sub = make_request(f"/kyc/workflow/submissions/{rej_sub_id}/decision", method="POST", data=mgr_rej_payload, token=mgr_token, expected_status=200)
        assert rejected_sub["status"] == "rejected"

        # Customer verifies rejection receipt
        _, cust_dec = make_request(f"/kyc/workflow/submissions/{rej_sub_id}/decision", method="GET", token=cust_a_token, expected_status=200)
        assert cust_dec["action"] == "reject"
        assert cust_dec["customer_notes"] == "Your submission could not be verified and has been rejected."
        assert "internal_notes" not in cust_dec

    test("3.1 Full Rejection Lifecycle: submit -> assign -> recommend_reject -> reject -> customer receipt", test_rejection_lifecycle)

    print(f"\n--- Section 4: Security, Authentication & Role-Based Access Control ---")

    def test_unauthenticated_requests():
        paths = [
            ("/kyc/workflow/submissions/my", "GET", None),
            ("/kyc/workflow/submissions", "POST", {"submission_ref": "PROBE", "document_type": "passport"}),
            ("/kyc/workflow/employee/assigned", "GET", None),
            ("/kyc/workflow/manager/cases", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}/decision", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}/reviews", "GET", None),
        ]
        for path, method, data in paths:
            status, _ = make_request(path, method=method, data=data, token=None, expected_status=401)
            assert status == 401

    test("4.1 Unauthenticated requests to all workflow endpoints receive 401 Unauthorized", test_unauthenticated_requests)

    def test_customer_role_restrictions():
        # Customer cannot view employee queue
        status, _ = make_request("/kyc/workflow/employee/assigned", method="GET", token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot view manager cases
        status, _ = make_request("/kyc/workflow/manager/cases", method="GET", token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot assign
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/assign", method="POST", data={"assigned_employee_id": 5}, token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot start review
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/review-start", method="POST", token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot submit recommendation
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/recommend", method="POST", data={"action": "recommend_approve", "internal_notes": "Customer probe"}, token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot submit decision
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="POST", data={"action": "approve", "customer_notes": "Customer probe", "internal_notes": "notes"}, token=cust_a_token, expected_status=403)
        assert status == 403
        # Customer cannot access internal reviews
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/reviews", method="GET", token=cust_a_token, expected_status=403)
        assert status == 403

    test("4.2 Customer role boundaries enforced (strict 403 on employee & manager endpoints)", test_customer_role_restrictions)

    def test_employee_role_restrictions():
        # Employee cannot view manager cases
        status, _ = make_request("/kyc/workflow/manager/cases", method="GET", token=emp1_token, expected_status=403)
        assert status == 403
        # Employee cannot assign submissions
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/assign", method="POST", data={"assigned_employee_id": 6}, token=emp1_token, expected_status=403)
        assert status == 403
        # Employee cannot execute manager decision
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="POST", data={"action": "approve", "customer_notes": "Employee probe", "internal_notes": "notes"}, token=emp1_token, expected_status=403)
        assert status == 403
        # Employee cannot access admin endpoints
        status, _ = make_request("/admin/summary", method="GET", token=emp1_token, expected_status=403)
        assert status == 403

    test("4.3 Bank Employee role boundaries enforced (strict 403 on manager & admin actions)", test_employee_role_restrictions)

    def test_manager_role_restrictions():
        # Manager cannot access admin summary
        status, _ = make_request("/admin/summary", method="GET", token=mgr_token, expected_status=403)
        assert status == 403
        # Manager cannot assign non-employee role (User 1 is customer)
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/assign", method="POST", data={"assigned_employee_id": 1}, token=mgr_token, expected_status=400)
        assert status == 400

    test("4.4 Bank Manager cannot perform admin actions (403) and cannot assign non-employees (400)", test_manager_role_restrictions)

    def test_system_admin_strict_isolation():
        paths = [
            ("/kyc/workflow/submissions/my", "GET", None),
            ("/kyc/workflow/submissions", "POST", {"submission_ref": "ADMIN_PROBE", "document_type": "passport"}),
            ("/kyc/workflow/employee/assigned", "GET", None),
            ("/kyc/workflow/manager/cases", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}/decision", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}/reviews", "GET", None),
            (f"/kyc/workflow/submissions/{approval_sub_id}/assign", "POST", {"assigned_employee_id": 5}),
            (f"/kyc/workflow/submissions/{approval_sub_id}/decision", "POST", {"action": "approve", "customer_notes": "note", "internal_notes": "note"}),
        ]
        for path, method, data in paths:
            status, _ = make_request(path, method=method, data=data, token=admin_token, expected_status=403)
            assert status == 403, f"System Administrator must receive 403 on {method} {path}"

    test("4.5 System Administrator strictly blocked (403 Forbidden) from all KYC workflow endpoints", test_system_admin_strict_isolation)

    def test_cross_customer_isolation():
        # Customer B attempts to view Customer A's submission
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}", method="GET", token=cust_b_token)
        assert status in (403, 404), f"Expected 403 or 404, got {status}"

        # Customer B attempts to get Customer A's decision
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="GET", token=cust_b_token)
        assert status in (403, 404), f"Expected 403 or 404, got {status}"

        # Customer B attempts to add version to Customer A's submission
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/versions", method="POST", data={"document_type": "passport"}, token=cust_b_token)
        assert status in (403, 404), f"Expected 403 or 404, got {status}"

        # Customer B attempts to resubmit Customer A's submission
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/resubmit", method="POST", token=cust_b_token)
        assert status in (403, 404), f"Expected 403 or 404, got {status}"

    test("4.6 Multi-tenant isolation: Customer B strictly blocked from accessing Customer A's data", test_cross_customer_isolation)

    def test_cross_employee_workload_isolation():
        # Employee 6 (unassigned) must NOT see approval_sub_id (assigned to the dedicated employee)
        status, assigned = make_request("/kyc/workflow/employee/assigned", method="GET", token=emp2_token, expected_status=200)
        assert not any(s["id"] == approval_sub_id for s in assigned)

        # Employee 6 cannot call review-start on the dedicated employee's case
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/review-start", method="POST", token=emp2_token, expected_status=403)
        assert status == 403

        # Employee 6 cannot call recommend on the dedicated employee's case
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/recommend", method="POST", data={"action": "recommend_approve", "internal_notes": "Employee 6 probe"}, token=emp2_token)
        assert status in (403, 404)

    test("4.7 Workload isolation: Unassigned Employee cannot view or action another employee's case", test_cross_employee_workload_isolation)

    def test_state_machine_integrity_guards():
        # Cannot start review on an already approved case (400)
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/review-start", method="POST", token=emp1_token, expected_status=400)
        assert status == 400

        # Cannot reject or request correction on an already approved case (trigger rejects invalid transition from approved -> 400)
        mgr_rej_payload = {"action": "reject", "customer_notes": "Late rejection", "internal_notes": "notes"}
        status, _ = make_request(f"/kyc/workflow/submissions/{approval_sub_id}/decision", method="POST", data=mgr_rej_payload, token=mgr_token, expected_status=400)
        assert status == 400

        # Cannot start review on an already rejected case (400)
        status, _ = make_request(f"/kyc/workflow/submissions/{rej_sub_id}/review-start", method="POST", token=emp1_token, expected_status=400)
        assert status == 400

    test("4.8 State machine integrity: Terminal states (approved/rejected) strictly reject new reviews/decisions (400)", test_state_machine_integrity_guards)

    print("\n" + "=" * 70)
    print(f"Phase 6 Test Results: {passed} passed, {failed} failed out of {total} total tests ({passed/total*100:.1f}%)")
    print("=" * 70)
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_phase6_suite()
