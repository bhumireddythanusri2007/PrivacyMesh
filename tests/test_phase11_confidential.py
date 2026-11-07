"""
PrivacyMesh Phase 11 - Azure Confidential Computing & Provider Selection Tests.

Verifies:
1. Default fallback to SimulationTEEProvider in standard development environments.
2. Azure Confidential VM detection logic.
3. AzureConfidentialVMProvider behavior and explicit unverified/unattested notices.
4. Provider selection via CONFIDENTIAL_PROVIDER environment variable and auto-detection.
5. Strict adherence to the decision that remote hardware attestation is NOT implemented.
"""

import os
import sys
from decimal import Decimal
from unittest.mock import patch
import pytest

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.confidential.inspector import (
    detect_azure_confidential_vm,
    inspect_hardware_environment,
)
from app.confidential.provider import (
    AzureConfidentialVMProvider,
    SimulationTEEProvider,
    get_tee_provider,
    select_tee_provider,
)
from app.confidential.schemas import SyntheticWorkloadInput


def test_simulation_provider_default_status():
    """Verify SimulationTEEProvider returns transparent simulation metadata."""
    provider = SimulationTEEProvider()
    status = provider.get_status()

    assert status.status == "simulation"
    assert "Simulation" in status.mode_label
    assert status.is_hardware_enclave is False
    assert len(status.limitations) >= 4
    assert any("Intel SGX or AMD SEV" in lim for lim in status.limitations)


def test_simulation_workload_execution():
    """Verify SimulationTEEProvider executes synthetic credit calculations with masking."""
    provider = SimulationTEEProvider()
    input_data = SyntheticWorkloadInput(
        account_id="SYNTH-TEST-1234",
        monthly_income=Decimal("8000.00"),
        requested_credit_amount=Decimal("20000.00"),
        existing_obligations=Decimal("1600.00"),
        risk_tier="low",
    )
    result = provider.execute_synthetic_workload(input_data)

    assert result.masked_account_id.startswith("SYNTH-TEST-")
    assert result.masked_account_id.endswith("****")
    assert result.approved is True
    assert result.approved_limit > 0
    assert result.execution_mode == "Simulation - not hardware-backed"
    assert len(result.execution_trace) == 3


def test_azure_cvm_detection_environment_override():
    """Verify detect_azure_confidential_vm correctly identifies environment overrides."""
    with patch.dict(os.environ, {"AZURE_CONFIDENTIAL_VM": "true", "AZURE_VM_SIZE": "Standard_DC2as_v5"}):
        is_cvm, sku, vtpm = detect_azure_confidential_vm()
        assert is_cvm is True
        assert sku == "Standard_DC2as_v5"


def test_inspect_hardware_environment_with_azure_cvm_indicators():
    """Verify inspector marks Azure CVM indicators without claiming verified hardware memory isolation."""
    with patch.dict(os.environ, {"AZURE_CONFIDENTIAL_VM": "true", "AZURE_VM_SIZE": "Standard_DC2as_v5"}):
        report = inspect_hardware_environment()

        assert report.azure_environment_detected is True
        assert report.azure_cvm_sku_detected == "Standard_DC2as_v5"
        # Crucial Rule: Attestation is NOT configured, so hardware memory protection is unverified
        assert report.attestation_configured is False
        assert "Azure Confidential VM" in report.detection_summary
        assert "unverified" in report.detection_summary.lower()


def test_azure_confidential_provider_status_and_limitations():
    """Verify AzureConfidentialVMProvider reports unattested status and explicit limitations."""
    provider = AzureConfidentialVMProvider()
    status = provider.get_status()

    assert status.status == "hardware_tee"
    assert "Azure Confidential VM" in status.mode_label
    assert "Unattested" in status.mode_label
    # Do not claim verified hardware protection when attestation is disabled
    assert status.is_hardware_enclave is False
    assert len(status.limitations) >= 4
    assert any("attestation is explicitly disabled" in lim.lower() for lim in status.limitations)
    assert any("unverified" in lim.lower() or "cannot be externally proven" in lim.lower() for lim in status.limitations)


def test_azure_confidential_workload_execution():
    """Verify AzureConfidentialVMProvider executes credit calculation within CVM trace boundary."""
    provider = AzureConfidentialVMProvider()
    input_data = SyntheticWorkloadInput(
        account_id="SYNTH-CVM-9988",
        monthly_income=Decimal("10000.00"),
        requested_credit_amount=Decimal("30000.00"),
        existing_obligations=Decimal("2000.00"),
        risk_tier="low",
    )
    result = provider.execute_synthetic_workload(input_data)

    assert result.masked_account_id == "SYNTH-CVM-****"
    assert result.approved is True
    assert result.execution_mode == "Azure Confidential VM (AMD SEV-SNP) - Unattested"
    for step in result.execution_trace:
        assert "Azure CVM" in step.simulated_isolation_boundary
        assert "unverified" in step.simulated_isolation_boundary.lower()


def test_provider_selection_logic():
    """Verify select_tee_provider handles explicit overrides and auto-detection fallback."""
    # 1. Force simulation
    with patch.dict(os.environ, {"CONFIDENTIAL_PROVIDER": "simulation"}):
        provider = select_tee_provider()
        assert isinstance(provider, SimulationTEEProvider)

    # 2. Force azure_cvm
    with patch.dict(os.environ, {"CONFIDENTIAL_PROVIDER": "azure_cvm"}):
        provider = select_tee_provider()
        assert isinstance(provider, AzureConfidentialVMProvider)

    # 3. Auto-detection in simulated Azure CVM environment
    with patch.dict(os.environ, {"CONFIDENTIAL_PROVIDER": "auto", "AZURE_CONFIDENTIAL_VM": "true"}):
        provider = select_tee_provider()
        assert isinstance(provider, AzureConfidentialVMProvider)

    # 4. Auto-detection in standard local environment (fallback to Simulation)
    with patch.dict(os.environ, {"CONFIDENTIAL_PROVIDER": "auto", "AZURE_CONFIDENTIAL_VM": "false"}):
        provider = select_tee_provider()
        assert isinstance(provider, SimulationTEEProvider)


def test_no_attestation_claims_across_providers():
    """Strictly verify that neither provider claims active or verified remote attestation."""
    sim_status = SimulationTEEProvider().get_status()
    cvm_status = AzureConfidentialVMProvider().get_status()

    assert sim_status.hardware_detection.attestation_configured is False
    assert cvm_status.hardware_detection.attestation_configured is False
    assert cvm_status.is_hardware_enclave is False
