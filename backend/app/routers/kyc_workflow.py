from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KYCAuditLog, KYCReview, KYCSubmission, KYCVersion, User
from app.schemas import (
    KYCAssignEmployeeRequest,
    KYCDecisionResponse,
    KYCEmployeeRecommendationRequest,
    KYCManagerDecisionRequest,
    KYCReviewResponse,
    KYCSubmissionCreate,
    KYCSubmissionResponse,
    KYCVersionCreate,
    KYCVersionResponse,
)
from app.security import get_current_user

router = APIRouter(prefix="/kyc/workflow", tags=["KYC Workflow"])


def get_workflow_db(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Session:
    """Set transaction-scoped session identity for PostgreSQL RLS and trigger enforcement."""
    # Ensure system_admin has zero access to KYC workflow endpoints
    if current_user["role"] in ("system_admin", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System administrators are not authorized to access customer KYC workflow content",
        )

    db.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(current_user["id"])},
    )
    return db


# ============================================================================
# Customer Workflow Endpoints
# ============================================================================

@router.post(
    "/submissions",
    response_model=KYCSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_submission(
    payload: KYCSubmissionCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Customer submits new KYC application with initial document version."""
    if current_user["role"] not in ("customer", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers are authorized to create KYC submissions",
        )

    ref = payload.submission_ref.strip()
    doc_type = payload.document_type.strip()

    if not ref or not doc_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission reference and document type are required",
        )

    # Check reference uniqueness
    existing = (
        db.query(KYCSubmission)
        .filter(KYCSubmission.submission_ref == ref)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Submission reference '{ref}' already exists",
        )

    try:
        # Create submission
        submission = KYCSubmission(
            customer_id=current_user["id"],
            submission_ref=ref,
            status="submitted",
        )
        db.add(submission)
        db.flush()

        # Create initial Version 1
        version = KYCVersion(
            submission_id=submission.id,
            version_number=1,
            is_current=True,
            document_type=doc_type,
            auto_validation_status="unassessed",
        )
        db.add(version)
        db.flush()

        # Emit audit log event
        audit = KYCAuditLog(
            submission_id=submission.id,
            actor_id=current_user["id"],
            actor_role="customer",
            event_type="submission_created",
            event_metadata={"version": 1, "document_type": doc_type},
        )
        db.add(audit)
        db.flush()

        res = KYCSubmissionResponse.model_validate(submission)
        res.current_version = KYCVersionResponse.model_validate(version)
        db.commit()
        return res

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/submissions/my",
    response_model=list[KYCSubmissionResponse],
)
def get_my_submissions(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Customer views all their own KYC applications."""
    if current_user["role"] not in ("customer", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to customer accounts",
        )

    submissions = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.customer_id == current_user["id"],
            KYCSubmission.is_archived == False,  # noqa: E712
        )
        .order_by(KYCSubmission.created_at.desc())
        .all()
    )

    results = []
    for sub in submissions:
        curr_ver = (
            db.query(KYCVersion)
            .filter(
                KYCVersion.submission_id == sub.id,
                KYCVersion.is_current == True,  # noqa: E712
            )
            .first()
        )
        sub_resp = KYCSubmissionResponse.model_validate(sub)
        if curr_ver:
            sub_resp.current_version = KYCVersionResponse.model_validate(curr_ver)
        results.append(sub_resp)

    return results


@router.get(
    "/submissions/{submission_id}",
    response_model=KYCSubmissionResponse,
)
def get_submission_detail(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Get single submission details with current version."""
    query = db.query(KYCSubmission).filter(KYCSubmission.id == submission_id)

    if current_user["role"] in ("customer", "user"):
        query = query.filter(KYCSubmission.customer_id == current_user["id"])
    elif current_user["role"] == "bank_employee":
        query = query.filter(KYCSubmission.assigned_employee_id == current_user["id"])

    submission = query.first()
    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found or access denied",
        )

    curr_ver = (
        db.query(KYCVersion)
        .filter(
            KYCVersion.submission_id == submission.id,
            KYCVersion.is_current == True,  # noqa: E712
        )
        .first()
    )

    resp = KYCSubmissionResponse.model_validate(submission)
    if curr_ver:
        resp.current_version = KYCVersionResponse.model_validate(curr_ver)
    return resp


@router.post(
    "/submissions/{submission_id}/versions",
    response_model=KYCVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_new_version(
    submission_id: int,
    payload: KYCVersionCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Customer uploads a new document version for their submission."""
    if current_user["role"] not in ("customer", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can create new KYC versions",
        )

    submission = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.id == submission_id,
            KYCSubmission.customer_id == current_user["id"],
        )
        .first()
    )

    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found or access denied",
        )

    if submission.is_archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add versions to an archived submission",
        )

    try:
        # Demote previous current version
        db.query(KYCVersion).filter(
            KYCVersion.submission_id == submission_id,
            KYCVersion.is_current == True,  # noqa: E712
        ).update({"is_current": False})

        # Find next version number
        max_ver = (
            db.query(func.max(KYCVersion.version_number))
            .filter(KYCVersion.submission_id == submission_id)
            .scalar()
            or 0
        )
        next_ver = max_ver + 1

        new_version = KYCVersion(
            submission_id=submission_id,
            version_number=next_ver,
            is_current=True,
            document_type=payload.document_type.strip(),
            auto_validation_status="unassessed",
        )
        db.add(new_version)
        db.flush()

        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="customer",
            event_type="version_created",
            event_metadata={"version": next_ver, "document_type": payload.document_type},
        )
        db.add(audit)
        db.flush()

        resp = KYCVersionResponse.model_validate(new_version)
        db.commit()
        return resp

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/submissions/{submission_id}/resubmit",
    response_model=KYCSubmissionResponse,
)
def resubmit_correction(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Customer resubmits application after uploading requested correction version."""
    if current_user["role"] not in ("customer", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can resubmit KYC applications",
        )

    submission = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.id == submission_id,
            KYCSubmission.customer_id == current_user["id"],
        )
        .first()
    )

    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found or access denied",
        )

    if submission.status != "correction_requested":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Submission must be in 'correction_requested' status to resubmit (current: {submission.status})",
        )

    # Workflow integrity check: customer must upload a new correction version before resubmitting.
    version_count = (
        db.query(func.count(KYCVersion.id))
        .filter(KYCVersion.submission_id == submission_id)
        .scalar()
        or 0
    )
    curr_ver_check = (
        db.query(KYCVersion)
        .filter(
            KYCVersion.submission_id == submission_id,
            KYCVersion.is_current == True,  # noqa: E712
        )
        .first()
    )

    last_correction_review = (
        db.query(KYCReview)
        .filter(
            KYCReview.submission_id == submission_id,
            KYCReview.action.in_(("request_correction", "manager_request_correction")),
        )
        .order_by(KYCReview.created_at.desc())
        .first()
    )

    if (
        version_count < 2
        or not curr_ver_check
        or curr_ver_check.version_number < 2
        or (last_correction_review and curr_ver_check.id == last_correction_review.version_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow violation: requires creating a new KYC version before resubmitting a correction",
        )

    try:
        submission.status = "submitted"
        submission.updated_at = datetime.now(timezone.utc)

        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="customer",
            event_type="correction_resubmitted",
        )
        db.add(audit)
        db.flush()

        curr_ver = (
            db.query(KYCVersion)
            .filter(
                KYCVersion.submission_id == submission.id,
                KYCVersion.is_current == True,  # noqa: E712
            )
            .first()
        )
        resp = KYCSubmissionResponse.model_validate(submission)
        if curr_ver:
            resp.current_version = KYCVersionResponse.model_validate(curr_ver)

        db.commit()
        return resp

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/submissions/{submission_id}/decision",
    response_model=KYCDecisionResponse,
)
def get_customer_decision(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Customer retrieves manager decision and customer-facing notes via secure view."""
    # Query customer_kyc_decisions view (internal_notes are excluded at database engine level)
    res = db.execute(
        text(
            """
            SELECT id, submission_id, version_id, action, customer_notes, created_at
            FROM customer_kyc_decisions
            WHERE submission_id = :sid
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"sid": submission_id},
    ).mappings().first()

    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No manager decision found for this submission or access denied",
        )

    return KYCDecisionResponse(
        id=res["id"],
        submission_id=res["submission_id"],
        version_id=res["version_id"],
        action=res["action"],
        customer_notes=res["customer_notes"],
        created_at=res["created_at"],
    )


# ============================================================================
# Bank Employee Workflow Endpoints
# ============================================================================

@router.get(
    "/employee/assigned",
    response_model=list[KYCSubmissionResponse],
)
def get_assigned_cases(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Employee views strictly assigned cases."""
    if current_user["role"] != "bank_employee":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Bank Employees",
        )

    submissions = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.assigned_employee_id == current_user["id"],
            KYCSubmission.is_archived == False,  # noqa: E712
        )
        .order_by(KYCSubmission.created_at.desc())
        .all()
    )

    results = []
    for sub in submissions:
        curr_ver = (
            db.query(KYCVersion)
            .filter(
                KYCVersion.submission_id == sub.id,
                KYCVersion.is_current == True,  # noqa: E712
            )
            .first()
        )
        sub_resp = KYCSubmissionResponse.model_validate(sub)
        if curr_ver:
            sub_resp.current_version = KYCVersionResponse.model_validate(curr_ver)
        results.append(sub_resp)

    return results


@router.post(
    "/submissions/{submission_id}/review-start",
    response_model=KYCSubmissionResponse,
)
def start_employee_review(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Assigned Bank Employee starts reviewing a case (moves to under_employee_review)."""
    if current_user["role"] != "bank_employee":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Bank Employees can start review",
        )

    submission = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.id == submission_id,
            KYCSubmission.assigned_employee_id == current_user["id"],
        )
        .first()
    )

    if not submission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Assigned case not found or access denied",
        )

    if submission.status not in ("submitted", "under_employee_review"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot start review on submission in status {submission.status}",
        )

    if submission.status == "submitted":
        submission.status = "under_employee_review"
        audit = KYCAuditLog(
            submission_id=submission.id,
            actor_id=current_user["id"],
            actor_role="bank_employee",
            event_type="review_started",
        )
        db.add(audit)
        db.flush()

    curr_ver = (
        db.query(KYCVersion)
        .filter(
            KYCVersion.submission_id == submission.id,
            KYCVersion.is_current == True,  # noqa: E712
        )
        .first()
    )
    resp = KYCSubmissionResponse.model_validate(submission)
    if curr_ver:
        resp.current_version = KYCVersionResponse.model_validate(curr_ver)
    db.commit()
    return resp


@router.post(
    "/submissions/{submission_id}/recommend",
    response_model=KYCSubmissionResponse,
)
def submit_recommendation(
    submission_id: int,
    payload: KYCEmployeeRecommendationRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Employee records review recommendation and advances case to manager decision."""
    if current_user["role"] != "bank_employee":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Bank Employees can record recommendations",
        )

    submission = (
        db.query(KYCSubmission)
        .filter(
            KYCSubmission.id == submission_id,
            KYCSubmission.assigned_employee_id == current_user["id"],
        )
        .first()
    )

    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assigned case not found or access denied",
        )

    # First move to under_employee_review if not already
    if submission.status == "submitted":
        submission.status = "under_employee_review"
        db.flush()

    curr_ver = (
        db.query(KYCVersion)
        .filter(
            KYCVersion.submission_id == submission_id,
            KYCVersion.is_current == True,  # noqa: E712
        )
        .first()
    )

    if not curr_ver:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission has no active current version",
        )

    try:
        # Record employee review
        review = KYCReview(
            submission_id=submission_id,
            version_id=curr_ver.id,
            reviewer_id=current_user["id"],
            reviewer_role="bank_employee",
            action=payload.action,
            internal_notes=payload.internal_notes.strip(),
        )
        db.add(review)
        db.flush()

        # Advance status to pending_manager_decision
        submission.status = "pending_manager_decision"
        submission.updated_at = datetime.now(timezone.utc)

        # Audit log event
        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="bank_employee",
            event_type="recommendation_submitted",
            event_metadata={"action": payload.action, "version_id": curr_ver.id},
        )
        db.add(audit)
        db.flush()

        resp = KYCSubmissionResponse.model_validate(submission)
        resp.current_version = KYCVersionResponse.model_validate(curr_ver)
        db.commit()
        return resp

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


# ============================================================================
# Bank Manager Workflow Endpoints
# ============================================================================

@router.get(
    "/manager/cases",
    response_model=list[KYCSubmissionResponse],
)
def get_manager_cases(
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Manager views bank-wide cases across all statuses."""
    if current_user["role"] != "bank_manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Bank Managers",
        )

    query = db.query(KYCSubmission).filter(KYCSubmission.is_archived == False)  # noqa: E712

    if status_filter:
        query = query.filter(KYCSubmission.status == status_filter)

    submissions = query.order_by(KYCSubmission.created_at.desc()).all()

    results = []
    for sub in submissions:
        curr_ver = (
            db.query(KYCVersion)
            .filter(
                KYCVersion.submission_id == sub.id,
                KYCVersion.is_current == True,  # noqa: E712
            )
            .first()
        )
        sub_resp = KYCSubmissionResponse.model_validate(sub)
        if curr_ver:
            sub_resp.current_version = KYCVersionResponse.model_validate(curr_ver)
        results.append(sub_resp)

    return results


@router.post(
    "/submissions/{submission_id}/assign",
    response_model=KYCSubmissionResponse,
)
def assign_employee(
    submission_id: int,
    payload: KYCAssignEmployeeRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Manager assigns or reassigns case to a Bank Employee."""
    if current_user["role"] != "bank_manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Bank Managers can assign cases",
        )

    # Verify employee exists and has role bank_employee
    emp = db.query(User).filter(User.id == payload.assigned_employee_id).first()
    if not emp or emp.role != "bank_employee":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target user {payload.assigned_employee_id} does not have role 'bank_employee'",
        )

    submission = db.query(KYCSubmission).filter(KYCSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )

    try:
        submission.assigned_employee_id = payload.assigned_employee_id
        submission.assigned_manager_id = current_user["id"]
        submission.updated_at = datetime.now(timezone.utc)

        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="bank_manager",
            event_type="case_assigned",
            event_metadata={"assigned_employee": payload.assigned_employee_id},
        )
        db.add(audit)
        db.flush()

        curr_ver = (
            db.query(KYCVersion)
            .filter(
                KYCVersion.submission_id == submission.id,
                KYCVersion.is_current == True,  # noqa: E712
            )
            .first()
        )
        resp = KYCSubmissionResponse.model_validate(submission)
        if curr_ver:
            resp.current_version = KYCVersionResponse.model_validate(curr_ver)

        db.commit()
        return resp

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/submissions/{submission_id}/decision",
    response_model=KYCSubmissionResponse,
)
def finalize_decision(
    submission_id: int,
    payload: KYCManagerDecisionRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Manager issues final binding decision (approve, reject, manager_request_correction)."""
    if current_user["role"] != "bank_manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Bank Managers can issue final decisions",
        )

    submission = db.query(KYCSubmission).filter(KYCSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )

    curr_ver = (
        db.query(KYCVersion)
        .filter(
            KYCVersion.submission_id == submission_id,
            KYCVersion.is_current == True,  # noqa: E712
        )
        .first()
    )

    if not curr_ver:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission has no active current version",
        )

    try:
        # Record manager review
        review = KYCReview(
            submission_id=submission_id,
            version_id=curr_ver.id,
            reviewer_id=current_user["id"],
            reviewer_role="bank_manager",
            action=payload.action,
            internal_notes=payload.internal_notes.strip() if payload.internal_notes else "",
            customer_notes=payload.customer_notes.strip(),
        )
        db.add(review)
        db.flush()

        # Update submission status matching decision
        if payload.action == "approve":
            submission.status = "approved"
            audit_event = "decision_approved"
        elif payload.action == "reject":
            submission.status = "rejected"
            audit_event = "decision_rejected"
        elif payload.action == "manager_request_correction":
            submission.status = "correction_requested"
            audit_event = "decision_correction_requested"
        else:
            raise HTTPException(status_code=400, detail="Invalid decision action")

        submission.assigned_manager_id = current_user["id"]
        submission.updated_at = datetime.now(timezone.utc)

        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="bank_manager",
            event_type=audit_event,
            event_metadata={"version_id": curr_ver.id, "action": payload.action},
        )
        db.add(audit)
        db.flush()

        resp = KYCSubmissionResponse.model_validate(submission)
        resp.current_version = KYCVersionResponse.model_validate(curr_ver)
        db.commit()
        return resp

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/submissions/{submission_id}/reviews",
    response_model=list[KYCReviewResponse],
)
def get_submission_reviews(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank staff (Employee/Manager) views review history including internal notes."""
    if current_user["role"] not in ("bank_employee", "bank_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Bank Staff",
        )

    # RLS policy p_kyc_reviews_isolation automatically restricts employees to assigned cases
    reviews = (
        db.query(KYCReview)
        .filter(KYCReview.submission_id == submission_id)
        .order_by(KYCReview.created_at.asc())
        .all()
    )

    return reviews


@router.post(
    "/submissions/{submission_id}/archive",
    response_model=KYCSubmissionResponse,
)
def archive_submission(
    submission_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_workflow_db),
):
    """Bank Manager archives completed or inactive submission."""
    if current_user["role"] != "bank_manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Bank Managers are authorized to archive submissions",
        )

    submission = db.query(KYCSubmission).filter(KYCSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    try:
        submission.is_archived = True
        audit = KYCAuditLog(
            submission_id=submission_id,
            actor_id=current_user["id"],
            actor_role="bank_manager",
            event_type="case_archived",
        )
        db.add(audit)
        db.flush()

        resp = KYCSubmissionResponse.model_validate(submission)
        db.commit()
        return resp
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
