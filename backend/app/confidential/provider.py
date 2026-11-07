
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal

from app.confidential.inspector import inspect_hardware_environment
from app.confidential.schemas import (
    DataTriadStatus,
    SyntheticWorkloadInput,
    SyntheticWorkloadResult,
    TEEStatusResponse,
    WorkloadExecutionStep,
)


class TEEProvider(ABC):
    """Interface for confidential-computing status and workload execution."""

    @abstractmethod
    def get_status(self) -> TEEStatusResponse:
        """Inspect hardware detection and operational readiness."""
        pass

    @abstractmethod
    def execute_synthetic_workload(
        self,
        input_data: SyntheticWorkloadInput,
    ) -> SyntheticWorkloadResult:
        """Execute a synthetic workload using the configured provider."""
        pass


class SimulationTEEProvider(TEEProvider):
    """
    Software-only simulation of confidential computing.
    This provider does not create a hardware-backed enclave.
    """

    def get_status(self) -> TEEStatusResponse:
        detection = inspect_hardware_environment()

        data_triad = DataTriadStatus(
            data_at_rest=(
                "PostgreSQL standard table storage; database-table encryption "
                "is not configured or verified by this application."
            ),
            data_in_transit=(
                "HTTP/REST over the local development connection; "
                "TLS/HTTPS is not configured in this environment."
            ),
            data_in_use=(
                "Standard Python process memory. This simulation does not "
                "provide hardware-backed memory encryption or isolation."
            ),
        )

        limitations = [
            "Execution uses a standard Python runtime and Docker container; "
            "CPU-backed memory encryption is not enabled by this provider.",
            "A privileged host user or hypervisor may be able to inspect process memory.",
            "Hardware remote attestation is not configured or active.",
            "Intel SGX or AMD SEV hardware memory isolation is not enabled by this provider.",
            "This software simulation does not guarantee cryptographic memory scrubbing.",
        ]

        return TEEStatusResponse(
            status="simulation",
            mode_label="Simulation - not hardware-backed",
            operational_readiness="Not configured (Simulation mode active)",
            is_hardware_enclave=False,
            hardware_detection=detection,
            data_triad=data_triad,
            limitations=limitations,
        )

    def execute_synthetic_workload(
        self,
        input_data: SyntheticWorkloadInput,
    ) -> SyntheticWorkloadResult:
        # Step 1: Validate and mask the synthetic account identifier.
        raw_id = input_data.account_id
        prefix_parts = raw_id.split("-")

        if len(prefix_parts) > 2:
            masked_id = f"{prefix_parts[0]}-{prefix_parts[1]}-****"
        else:
            masked_id = "SYNTH-****"

        steps: list[WorkloadExecutionStep] = [
            WorkloadExecutionStep(
                step_number=1,
                phase="1. Input Validation & Masking",
                detail=(
                    f"Validated synthetic account identifier ({masked_id}) "
                    "and input bounds. "
                    f"Monthly income: {input_data.monthly_income}; "
                    f"obligations: {input_data.existing_obligations}. "
                    "The full account identifier is excluded from this trace."
                ),
                simulated_isolation_boundary=(
                    "Application validation and masking; "
                    "not a hardware-enforced enclave boundary"
                ),
            ),
        ]

        # Step 2: Calculate the debt-to-income ratio.
        # Pydantic schema validation requires monthly_income > 0.
        monthly_income = float(input_data.monthly_income)
        existing_obligations = float(input_data.existing_obligations)
        requested_amount = float(input_data.requested_credit_amount)

        dti_ratio = round(
            (existing_obligations / monthly_income) * 100.0,
            2,
        )

        # Simple illustrative score rules, not a production credit model.
        base_score = 750

        if dti_ratio > 50.0:
            base_score -= 150
        elif dti_ratio > 35.0:
            base_score -= 80
        elif dti_ratio > 20.0:
            base_score -= 30

        tier_adjustments = {
            "low": 30,
            "medium": 0,
            "high": -50,
        }

        credit_score = max(
            300,
            min(850, base_score + tier_adjustments[input_data.risk_tier]),
        )

        steps.append(
            WorkloadExecutionStep(
                step_number=2,
                phase="2. Simulated Risk Calculation",
                detail=(
                    f"Calculated DTI ratio ({dti_ratio}%) and illustrative "
                    f"credit score ({credit_score}). "
                    "Processing occurred in a standard Python runtime; "
                    "hardware memory isolation is not provided."
                ),
                simulated_isolation_boundary=(
                    "Standard application process memory; "
                    "no hardware-backed isolation"
                ),
            )
        )

        # Step 3: Apply the demo's illustrative decision rules.
        approved = dti_ratio <= 45.0 and credit_score >= 620

        if approved:
            disposable = max(
                0.0,
                monthly_income - existing_obligations,
            )
            computed_limit = min(
                requested_amount,
                disposable * 3.5,
            )
            approved_limit = Decimal(str(round(computed_limit, 2)))

            recommendation = (
                f"Demo result: approved under the configured rules. "
                f"Illustrative score: {credit_score}. "
                f"Calculated limit: {approved_limit}. "
                "This is a synthetic demonstration, not a lending decision."
            )
        else:
            approved_limit = Decimal("0.00")

            recommendation = (
                f"Demo result: declined under the configured rules. "
                f"Illustrative score: {credit_score}; DTI: {dti_ratio}%. "
                "This is a synthetic demonstration, not a lending decision."
            )

        steps.append(
            WorkloadExecutionStep(
                step_number=3,
                phase="3. Demo Policy Evaluation",
                detail=(
                    f"Applied illustrative policy rules. Result: "
                    f"{'approved' if approved else 'declined'}. "
                    "No hardware-backed memory scrubbing or enclave sealing "
                    "is claimed by this simulation."
                ),
                simulated_isolation_boundary=(
                    "Application-level result generation; "
                    "no hardware-enforced exit boundary"
                ),
            )
        )

        return SyntheticWorkloadResult(
            masked_account_id=masked_id,
            monthly_income=input_data.monthly_income,
            requested_credit_amount=input_data.requested_credit_amount,
            debt_to_income_ratio=dti_ratio,
            credit_risk_score=credit_score,
            approved=approved,
            approved_limit=approved_limit,
            recommendation=recommendation,
            execution_mode="Simulation - not hardware-backed",
            execution_trace=steps,
            timestamp=datetime.now(timezone.utc),
        )


class AzureConfidentialVMProvider(TEEProvider):
    """
    Azure Confidential VM (AMD SEV-SNP) Provider.

    Operates in an Azure Confidential VM environment where hypervisor-level
    memory encryption is active.

    IMPORTANT ARCHITECTURAL RULE:
    Remote hardware attestation is NOT implemented in Phase 11.
    Therefore, this provider explicitly does NOT claim verified hardware protection.
    It transparently documents the unverified state and attestation limitations.
    """

    def get_status(self) -> TEEStatusResponse:
        detection = inspect_hardware_environment()

        data_triad = DataTriadStatus(
            data_at_rest=(
                "Azure Managed Disks with Server-Side Encryption (SSE-PMK); "
                "database-level TEE encryption is not claimed."
            ),
            data_in_transit=(
                "TLS 1.3 encryption across VNet subnets; internal container traffic "
                "within the Confidential VM network namespace."
            ),
            data_in_use=(
                "Guest VM memory space inside Azure Confidential VM (AMD SEV-SNP "
                "hardware memory encryption). Note: Memory encryption is active at "
                "the hypervisor boundary, but remote hardware attestation is not implemented."
            ),
        )

        limitations = [
            "Remote hardware attestation is explicitly disabled by design; cryptographically signed attestation tokens (MAA/EAT) are not requested or verified.",
            "Hardware protection cannot be externally proven without an active attestation service.",
            "Hypervisor memory isolation is enforced by the AMD SEV-SNP processor, but guest kernel integrity is not attested.",
            "PostgreSQL table data at rest relies on standard disk encryption (SSE), not hardware enclave memory protection.",
            "Administrative access to the VM host OS could potentially inspect processes unless lockdown mode is fully configured.",
        ]

        return TEEStatusResponse(
            status="hardware_tee",
            mode_label="Azure Confidential VM (AMD SEV-SNP) - Unattested",
            operational_readiness="Active in Azure Confidential VM environment (Attestation Disabled)",
            is_hardware_enclave=False,  # Unverified without remote attestation
            hardware_detection=detection,
            data_triad=data_triad,
            limitations=limitations,
        )

    def execute_synthetic_workload(
        self,
        input_data: SyntheticWorkloadInput,
    ) -> SyntheticWorkloadResult:
        # Step 1: Input Validation & Masking
        raw_id = input_data.account_id
        prefix_parts = raw_id.split("-")

        if len(prefix_parts) > 2:
            masked_id = f"{prefix_parts[0]}-{prefix_parts[1]}-****"
        else:
            masked_id = "SYNTH-****"

        steps: list[WorkloadExecutionStep] = [
            WorkloadExecutionStep(
                step_number=1,
                phase="1. Input Validation & Masking",
                detail=(
                    f"Validated synthetic account identifier ({masked_id}) "
                    "and input bounds. "
                    f"Monthly income: {input_data.monthly_income}; "
                    f"obligations: {input_data.existing_obligations}. "
                    "The full account identifier is excluded from this trace."
                ),
                simulated_isolation_boundary=(
                    "Azure CVM process memory; "
                    "hardware protection unverified without remote attestation"
                ),
            ),
        ]

        # Step 2: DTI & Credit Score Calculation
        monthly_income = float(input_data.monthly_income)
        existing_obligations = float(input_data.existing_obligations)
        requested_amount = float(input_data.requested_credit_amount)

        dti_ratio = round((existing_obligations / monthly_income) * 100.0, 2)
        base_score = 750

        if dti_ratio > 50.0:
            base_score -= 150
        elif dti_ratio > 35.0:
            base_score -= 80
        elif dti_ratio > 20.0:
            base_score -= 30

        tier_adjustments = {"low": 30, "medium": 0, "high": -50}
        credit_score = max(300, min(850, base_score + tier_adjustments[input_data.risk_tier]))

        steps.append(
            WorkloadExecutionStep(
                step_number=2,
                phase="2. Risk Calculation",
                detail=(
                    f"Calculated DTI ratio ({dti_ratio}%) and illustrative "
                    f"credit score ({credit_score}). "
                    "Execution occurred in Azure Confidential VM guest memory; "
                    "remote hardware attestation is not implemented."
                ),
                simulated_isolation_boundary=(
                    "Azure CVM process memory; "
                    "hardware protection unverified without remote attestation"
                ),
            )
        )

        # Step 3: Policy Evaluation
        approved = dti_ratio <= 45.0 and credit_score >= 620
        if approved:
            disposable = max(0.0, monthly_income - existing_obligations)
            computed_limit = min(requested_amount, disposable * 3.5)
            approved_limit = Decimal(str(round(computed_limit, 2)))
            recommendation = (
                f"Demo result: approved under the configured rules. "
                f"Illustrative score: {credit_score}. "
                f"Calculated limit: {approved_limit}. "
                "This is a synthetic demonstration, not a lending decision."
            )
        else:
            approved_limit = Decimal("0.00")
            recommendation = (
                f"Demo result: declined under the configured rules. "
                f"Illustrative score: {credit_score}; DTI: {dti_ratio}%. "
                "This is a synthetic demonstration, not a lending decision."
            )

        steps.append(
            WorkloadExecutionStep(
                step_number=3,
                phase="3. Policy Evaluation",
                detail=(
                    f"Applied policy rules. Result: {'approved' if approved else 'declined'}. "
                    "Executed inside Azure Confidential VM environment without remote attestation."
                ),
                simulated_isolation_boundary=(
                    "Azure CVM process memory; "
                    "hardware protection unverified without remote attestation"
                ),
            )
        )

        return SyntheticWorkloadResult(
            masked_account_id=masked_id,
            monthly_income=input_data.monthly_income,
            requested_credit_amount=input_data.requested_credit_amount,
            debt_to_income_ratio=dti_ratio,
            credit_risk_score=credit_score,
            approved=approved,
            approved_limit=approved_limit,
            recommendation=recommendation,
            execution_mode="Azure Confidential VM (AMD SEV-SNP) - Unattested",
            execution_trace=steps,
            timestamp=datetime.now(timezone.utc),
        )


def select_tee_provider() -> TEEProvider:
    """
    Select the active confidential computing provider based on configuration
    and runtime environment detection.

    Resolution order:
    1. Explicit environment override via CONFIDENTIAL_PROVIDER:
       - 'azure_cvm': forces AzureConfidentialVMProvider
       - 'simulation': forces SimulationTEEProvider
    2. Auto-detection:
       - If Azure Confidential VM indicators (vTPM or DMI) are present, returns AzureConfidentialVMProvider.
       - Otherwise, safely defaults to SimulationTEEProvider.
    """
    provider_override = os.getenv("CONFIDENTIAL_PROVIDER", "auto").strip().lower()
    if provider_override == "azure_cvm":
        return AzureConfidentialVMProvider()
    if provider_override == "simulation":
        return SimulationTEEProvider()

    # Auto-detection based on environment inspector
    detection = inspect_hardware_environment()
    if detection.azure_environment_detected:
        return AzureConfidentialVMProvider()

    return SimulationTEEProvider()


def get_tee_provider() -> TEEProvider:
    """Return the active confidential-computing provider."""
    return select_tee_provider()
