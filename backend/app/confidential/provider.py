
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


# Default provider: software simulation only.
active_tee_provider: TEEProvider = SimulationTEEProvider()


def get_tee_provider() -> TEEProvider:
    """Return the active confidential-computing provider."""
    return active_tee_provider
