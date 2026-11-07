"""
PrivacyMesh KYC Workflow End-to-End API Test Suite
Tests:
  1. Customer creates KYC submission and initial Version 1
  2. Customer views own submissions via /kyc/workflow/submissions/my
  3. Bank Manager lists submissions and assigns Employee
  4. Non-employee assignment is rejected
  5. Unassigned Employee cannot view or action case
  6. Assigned Employee reviews case and submits recommendation
  7. Direct approval by employee is forbidden
  8. Bank Manager requests correction
  9. Customer CANNOT resubmit without creating a new version (Blocker 2 verification)
  10. Customer creates Version 2 and successfully resubmits
  11. Case moves through review and Bank Manager approves Version 2
  12. Customer views decision via view: customer_notes visible, internal_notes omitted (Blocker 1 verification)
  13. System Administrator is strictly blocked (403 Forbidden) from all workflow endpoints
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


def run_e2e_tests():
    print("==================================================================")
    print("      PrivacyMesh KYC Workflow End-to-End API Test Suite         ")
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

    ts = int(time.time())

    # Register test customer
    cust_username = f"wf_cust_{ts}"
    cust_password = "CustomerSecure2026!"
    make_request("/auth/register", method="POST", data={"username": cust_username, "password": cust_password}, expected_status=201)
    cust_token = get_token(cust_username, cust_password)

    # Tokens for dedicated test accounts
    emp1_token = get_token(os.environ["PM_TEST_EMPLOYEE1_USERNAME"], os.environ["PM_TEST_EMPLOYEE1_PASSWORD"])   # Dedicated Employee 1
    emp2_token = get_token(os.environ["PM_TEST_EMPLOYEE2_USERNAME"], os.environ["PM_TEST_EMPLOYEE2_PASSWORD"])     # Dedicated Employee 2
    mgr_token = get_token(os.environ["PM_TEST_MANAGER_USERNAME"], os.environ["PM_TEST_MANAGER_PASSWORD"])    # Dedicated Manager
    admin_token = get_token(os.environ["PM_TEST_ADMIN_USERNAME"], os.environ["PM_TEST_ADMIN_PASSWORD"])  # Dedicated System Admin

    submission_id = None

    # 1. Customer creates submission + initial version 1
    def test_customer_create_submission():
        nonlocal submission_id
        payload = {
            "submission_ref": f"SUB-{ts}",
            "document_type": "passport",
        }
        status, body = make_request("/kyc/workflow/submissions", method="POST", data=payload, token=cust_token, expected_status=201)
        assert body["status"] == "submitted"
        assert body["current_version"] is not None
        assert body["current_version"]["version_number"] == 1
        assert body["current_version"]["is_current"] is True
        assert body["current_version"]["document_type"] == "passport"
        submission_id = body["id"]

    test("1. Customer creates KYC submission with initial Version 1", test_customer_create_submission)

    # 2. Customer views own submissions
    def test_customer_view_my():
        status, body = make_request("/kyc/workflow/submissions/my", method="GET", token=cust_token, expected_status=200)
        assert any(s["id"] == submission_id for s in body)

    test("2. Customer views own submissions via /kyc/workflow/submissions/my", test_customer_view_my)

    # 3. Manager lists submissions bank-wide & assigns dedicated Employee 1
    def test_manager_assign():
        status, body = make_request("/kyc/workflow/manager/cases", method="GET", token=mgr_token, expected_status=200)
        assert any(s["id"] == submission_id for s in body)

        payload = {"assigned_employee_id": 79}
        status, updated = make_request(f"/kyc/workflow/submissions/{submission_id}/assign", method="POST", data=payload, token=mgr_token, expected_status=200)
        assert updated["assigned_employee_id"] == 79

    test("3. Bank Manager lists bank-wide submissions and assigns dedicated Employee 1", test_manager_assign)

    # 4. Negative test: Manager cannot assign non-employee
    def test_manager_assign_invalid_role():
        payload = {"assigned_employee_id": 1}  # User 1 is customer
        status, _ = make_request(f"/kyc/workflow/submissions/{submission_id}/assign", method="POST", data=payload, token=mgr_token, expected_status=400)
        assert status == 400

    test("4. Negative test: Assigning non-employee is strictly rejected (400)", test_manager_assign_invalid_role)

    # 5. Employee isolation: Unassigned Employee 6 cannot view or action case
    def test_unassigned_employee_isolation():
        status, assigned = make_request("/kyc/workflow/employee/assigned", method="GET", token=emp2_token, expected_status=200)
        assert not any(s["id"] == submission_id for s in assigned), "Unassigned employee must not see case"

        # Attempt to action case
        status, _ = make_request(f"/kyc/workflow/submissions/{submission_id}/review-start", method="POST", token=emp2_token, expected_status=403)
        assert status == 403

    test("5. Employee isolation: Unassigned Employee cannot view or action case", test_unassigned_employee_isolation)

    # 6. Assigned Employee 1 starts review and recommends approval
    def test_assigned_employee_recommend():
        # View assigned
        status, assigned = make_request("/kyc/workflow/employee/assigned", method="GET", token=emp1_token, expected_status=200)
        assert any(s["id"] == submission_id for s in assigned)

        # Move to under_employee_review
        status, body = make_request(f"/kyc/workflow/submissions/{submission_id}/review-start", method="POST", token=emp1_token, expected_status=200)
        assert body["status"] == "under_employee_review"

        # Recommend approval
        payload = {
            "action": "recommend_approve",
            "internal_notes": "Employee review: Passport photo valid and biometric match confirmed.",
        }
        status, body = make_request(f"/kyc/workflow/submissions/{submission_id}/recommend", method="POST", data=payload, token=emp1_token, expected_status=200)
        assert body["status"] == "pending_manager_decision"

    test("6. Assigned Employee moves case to under_employee_review and submits recommendation", test_assigned_employee_recommend)

    # 7. Negative test: Employee cannot directly approve or reject
    def test_employee_direct_decision_blocked():
        payload = {
            "action": "approve",
            "internal_notes": "Attempt direct approval",
            "customer_notes": "Unauthorized approval notes",
        }
        status, _ = make_request(f"/kyc/workflow/submissions/{submission_id}/decision", method="POST", data=payload, token=emp1_token, expected_status=403)
        assert status == 403

    test("7. Security check: Direct approval by Employee is forbidden (403)", test_employee_direct_decision_blocked)

    # 8. Bank Manager requests correction
    def test_manager_request_correction():
        payload = {
            "action": "manager_request_correction",
            "internal_notes": "CONFIDENTIAL: MRZ checksum unreadable in bottom-right scan.",
            "customer_notes": "Please upload a clearer, uncropped passport scan showing the MRZ code.",
        }
        status, body = make_request(f"/kyc/workflow/submissions/{submission_id}/decision", method="POST", data=payload, token=mgr_token, expected_status=200)
        assert body["status"] == "correction_requested"

    test("8. Bank Manager requests correction from pending_manager_decision", test_manager_request_correction)

    # 9. Blocker 2 verification: Resubmission WITHOUT new version is strictly rejected
    def test_resubmission_without_new_version_blocked():
        status, body = make_request(f"/kyc/workflow/submissions/{submission_id}/resubmit", method="POST", token=cust_token, expected_status=400)
        assert status == 400
        detail = str(body)
        assert "requires creating a new KYC version" in detail or "Workflow violation" in detail

    test("9. Integrity check: Resubmission from correction_requested WITHOUT new version is rejected (400)", test_resubmission_without_new_version_blocked)

    # 10. Customer creates Version 2 and successfully resubmits
    def test_customer_create_v2_and_resubmit():
        v2_payload = {
            "document_type": "passport",
        }
        status, v2 = make_request(f"/kyc/workflow/submissions/{submission_id}/versions", method="POST", data=v2_payload, token=cust_token, expected_status=201)
        assert v2["version_number"] == 2
        assert v2["is_current"] is True

        # Now resubmit
        status, sub = make_request(f"/kyc/workflow/submissions/{submission_id}/resubmit", method="POST", token=cust_token, expected_status=200)
        assert sub["status"] == "submitted"
        assert sub["current_version"]["version_number"] == 2

    test("10. Customer creates Version 2 and successfully resubmits (status: submitted)", test_customer_create_v2_and_resubmit)

    # 11. Workflow continues: Employee recommends V2, Manager approves V2
    def test_employee_and_manager_approve_v2():
        # Employee moves to under_employee_review
        make_request(f"/kyc/workflow/submissions/{submission_id}/review-start", method="POST", token=emp1_token, expected_status=200)

        # Employee recommends approve on V2
        rec_payload = {
            "action": "recommend_approve",
            "internal_notes": "V2 MRZ scan verified and clear.",
        }
        make_request(f"/kyc/workflow/submissions/{submission_id}/recommend", method="POST", data=rec_payload, token=emp1_token, expected_status=200)

        # Manager approves
        mgr_payload = {
            "action": "approve",
            "internal_notes": "CONFIDENTIAL EDD: Full compliance verified under AML Reg 14.",
            "customer_notes": "Your identity documents have been approved. Welcome to PrivacyMesh!",
        }
        status, approved_sub = make_request(f"/kyc/workflow/submissions/{submission_id}/decision", method="POST", data=mgr_payload, token=mgr_token, expected_status=200)
        assert approved_sub["status"] == "approved"

    test("11. Assigned Employee recommends and Bank Manager approves Version 2", test_employee_and_manager_approve_v2)

    # 12. Blocker 1 verification: Customer views decision (customer_notes present, internal_notes omitted)
    def test_customer_decision_privacy():
        status, decision = make_request(f"/kyc/workflow/submissions/{submission_id}/decision", method="GET", token=cust_token, expected_status=200)
        assert decision["action"] == "approve"
        assert decision["customer_notes"] == "Your identity documents have been approved. Welcome to PrivacyMesh!"
        # Verify internal_notes is strictly absent from customer schema/payload
        assert "internal_notes" not in decision, "Security violation: internal_notes must NOT be exposed to customer"

    test("12. Privacy check: Customer retrieves decision with customer_notes, internal_notes strictly excluded", test_customer_decision_privacy)

    # 13. System Administrator isolation: Zero access to workflow endpoints (403 Forbidden)
    def test_admin_workflow_isolation():
        endpoints = [
            ("/kyc/workflow/submissions/my", "GET", None),
            ("/kyc/workflow/manager/cases", "GET", None),
            ("/kyc/workflow/employee/assigned", "GET", None),
            (f"/kyc/workflow/submissions/{submission_id}/decision", "GET", None),
            ("/kyc/workflow/submissions", "POST", {"submission_ref": "SUB-PROBE", "document_type": "passport"}),
        ]
        for path, method, data in endpoints:
            status, _ = make_request(path, method=method, data=data, token=admin_token, expected_status=403)
            assert status == 403, f"Admin must receive 403 Forbidden for {method} {path}"

    test("13. System Administrator isolation: Strict 403 Forbidden across all workflow endpoints", test_admin_workflow_isolation)

    print("==================================================================")
    print(f"Results: {passed} / {total} tests passed ({(passed / total) * 100:.1f}%)")
    print("==================================================================")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    import sys
    run_e2e_tests()
