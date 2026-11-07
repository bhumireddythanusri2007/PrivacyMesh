
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HardwareDetectionReport(BaseModel):
    cpu_sgx_detected: bool
    cpu_sev_detected: bool
    sgx_device_nodes_found: list[str]
    sev_device_nodes_found: list[str]
    driver_initialized: bool
    attestation_configured: bool
    detection_summary: str
    azure_environment_detected: bool = False
    azure_cvm_sku_detected: str | None = None
    vtpm_device_found: bool = False


class DataTriadStatus(BaseModel):
    data_at_rest: str
    data_in_transit: str
    data_in_use: str


class TEEStatusResponse(BaseModel):
    status: Literal["simulation", "hardware_tee", "not_configured"]
    mode_label: str = "Simulation - not hardware-backed"
    operational_readiness: str
    is_hardware_enclave: bool = False
    hardware_detection: HardwareDetectionReport
    data_triad: DataTriadStatus
    limitations: list[str]


class SyntheticWorkloadInput(BaseModel):
    account_id: str = Field(
        min_length=4,
        max_length=50,
        pattern=r"^SYNTH-[A-Za-z0-9_-]+$",
        description="Synthetic account identifier must start with SYNTH- prefix",
    )
    monthly_income: Decimal = Field(
        gt=0,
        le=1_000_000,
        decimal_places=2,
        description="Simulated monthly income in standard currency units",
    )
    requested_credit_amount: Decimal = Field(
        gt=0,
        le=5_000_000,
        decimal_places=2,
        description="Simulated credit facility request amount",
    )
    existing_obligations: Decimal = Field(
        ge=0,
        le=1_000_000,
        decimal_places=2,
        description="Simulated monthly debt or obligation burden",
    )
    risk_tier: Literal["low", "medium", "high"] = "low"


class WorkloadExecutionStep(BaseModel):
    step_number: int
    phase: str
    detail: str
    simulated_isolation_boundary: str


class SyntheticWorkloadResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    masked_account_id: str
    monthly_income: Decimal
    requested_credit_amount: Decimal
    debt_to_income_ratio: float
    credit_risk_score: int
    approved: bool
    approved_limit: Decimal
    recommendation: str
    execution_mode: str = "Simulation - not hardware-backed"
    execution_trace: list[WorkloadExecutionStep]
    timestamp: datetime
