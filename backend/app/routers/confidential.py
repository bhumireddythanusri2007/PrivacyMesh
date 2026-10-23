from fastapi import APIRouter, Depends, status

from app.confidential.provider import TEEProvider, get_tee_provider
from app.confidential.schemas import (
    SyntheticWorkloadInput,
    SyntheticWorkloadResult,
    TEEStatusResponse,
)
from app.security import get_current_user

router = APIRouter(prefix="/confidential-computing", tags=["Confidential Computing"])


@router.get("/status", response_model=TEEStatusResponse)
def get_confidential_computing_status(
    provider: TEEProvider = Depends(get_tee_provider),
):
    """
    Returns the real-time TEE detection report and operational status.
    Clearly distinguishes passive CPU/device detection from operational enclave readiness.
    Permanently labels simulation mode as 'Simulation — not hardware-backed'.
    """
    return provider.get_status()


@router.post(
    "/run-demo",
    response_model=SyntheticWorkloadResult,
    status_code=status.HTTP_200_OK,
)
def run_confidential_workload_demo(
    payload: SyntheticWorkloadInput,
    current_user: dict = Depends(get_current_user),
    provider: TEEProvider = Depends(get_tee_provider),
):
    """
    Executes a sensitive banking credit risk evaluation on synthetic input data.
    Runs inside the configured TEE provider boundary (currently SimulationTEEProvider),
    returning a sanitized trace of simulated memory isolation.
    """
    return provider.execute_synthetic_workload(payload)
