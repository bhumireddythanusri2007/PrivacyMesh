import os
import platform
from app.confidential.schemas import HardwareDetectionReport


def detect_azure_confidential_vm() -> tuple[bool, str | None, bool]:
    """
    Check for Azure Confidential VM environment indicators:
    - Microsoft DMI identifiers (/sys/class/dmi/id/sys_vendor, product_name, chassis_asset_tag)
    - vTPM 2.0 character device nodes (/dev/tpmrm0, /dev/tpm0)
    - Optional environment overrides (AZURE_CONFIDENTIAL_VM, AZURE_VM_SIZE)
    Returns (azure_cvm_detected, detected_sku, vtpm_device_found).
    """
    # Environment variable overrides (useful for testing or containerized deployments)
    env_override = os.getenv("AZURE_CONFIDENTIAL_VM", "").lower() in ("true", "1", "yes")
    env_sku = os.getenv("AZURE_VM_SIZE")

    is_azure = env_override
    vtpm_found = False

    # Check vTPM character devices (provided by Azure OpenHCL paravisor for CVMs)
    vtpm_paths = ["/dev/tpmrm0", "/dev/tpm0"]
    for path in vtpm_paths:
        if os.path.exists(path):
            vtpm_found = True
            break

    # Check Linux DMI chassis / system vendor info
    dmi_vendor_path = "/sys/class/dmi/id/sys_vendor"
    dmi_product_path = "/sys/class/dmi/id/product_name"
    dmi_chassis_path = "/sys/class/dmi/id/chassis_asset_tag"

    if os.path.exists(dmi_vendor_path):
        try:
            with open(dmi_vendor_path, "r", encoding="utf-8", errors="ignore") as f:
                vendor = f.read().strip().lower()
                if "microsoft" in vendor:
                    is_azure = True
        except Exception:
            pass

    detected_sku = env_sku
    if os.path.exists(dmi_product_path) and not detected_sku:
        try:
            with open(dmi_product_path, "r", encoding="utf-8", errors="ignore") as f:
                product = f.read().strip()
                if "Virtual Machine" in product:
                    # In Azure, product_name is often "Virtual Machine"
                    is_azure = True
                    detected_sku = detected_sku or "Virtual Machine (Azure)"
        except Exception:
            pass

    if os.path.exists(dmi_chassis_path):
        try:
            with open(dmi_chassis_path, "r", encoding="utf-8", errors="ignore") as f:
                asset_tag = f.read().strip()
                # Azure asset tag pattern
                if "7783-7084-3265-9085-8269-3286-77" in asset_tag:
                    is_azure = True
        except Exception:
            pass

    # In an Azure Confidential VM, Microsoft hypervisor is present and vTPM or AMD SEV is enabled
    is_azure_cvm = is_azure and (vtpm_found or env_override)

    return is_azure_cvm, detected_sku, vtpm_found


def inspect_hardware_environment() -> HardwareDetectionReport:
    """
    Inspect the host/container runtime environment for hardware TEE support (Intel SGX, AMD SEV, Azure CVM).
    Crucially distinguishes passive detection from operational usability and confirmed attestation.
    Does not claim hardware protection is verified merely because Azure environment indicators are detected.
    """
    cpu_sgx = False
    cpu_sev = False
    sgx_nodes_found: list[str] = []
    sev_nodes_found: list[str] = []

    # Check Linux /proc/cpuinfo if available (e.g. inside Docker Linux container)
    cpuinfo_path = "/proc/cpuinfo"
    if os.path.exists(cpuinfo_path):
        try:
            with open(cpuinfo_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read().lower()
                if "sgx" in content:
                    cpu_sgx = True
                if "sev" in content:
                    cpu_sev = True
        except Exception:
            pass

    # Check Linux TEE device paths
    potential_sgx_nodes = [
        "/dev/sgx_enclave",
        "/dev/sgx_provision",
        "/dev/sgx/enclave",
        "/dev/isgx",
    ]
    for node in potential_sgx_nodes:
        if os.path.exists(node):
            sgx_nodes_found.append(node)

    potential_sev_nodes = [
        "/dev/sev",
        "/dev/sev-guest",
    ]
    for node in potential_sev_nodes:
        if os.path.exists(node):
            sev_nodes_found.append(node)

    # Check Azure Confidential VM specific indicators
    azure_cvm_detected, azure_sku, vtpm_found = detect_azure_confidential_vm()

    # Operational usability checks:
    driver_initialized = bool(sgx_nodes_found or sev_nodes_found or vtpm_found)

    # DECISION: Attestation is explicitly NOT implemented in PrivacyMesh Phase 11.
    attestation_configured = False

    summary_parts = []
    if cpu_sgx:
        summary_parts.append("Intel SGX CPU instruction flag detected")
    if cpu_sev:
        summary_parts.append("AMD SEV CPU instruction flag detected")
    if sgx_nodes_found:
        summary_parts.append(f"SGX device nodes present ({', '.join(sgx_nodes_found)})")
    if sev_nodes_found:
        summary_parts.append(f"SEV device nodes present ({', '.join(sev_nodes_found)})")
    if azure_cvm_detected:
        sku_str = f" [SKU: {azure_sku}]" if azure_sku else ""
        summary_parts.append(f"Azure Confidential VM environment indicators detected{sku_str}")
    if vtpm_found:
        summary_parts.append("vTPM 2.0 device node present (/dev/tpmrm0 or /dev/tpm0)")

    if not summary_parts:
        summary_text = (
            f"No hardware TEE device nodes or CPU enclave extensions detected in the current "
            f"{platform.system()} ({platform.machine()}) runtime. Operating in transparent software simulation."
        )
    elif azure_cvm_detected:
        summary_text = (
            f"Hardware/environment markers detected ({'; '.join(summary_parts)}). "
            "Note: Hardware memory encryption integrity is not attested (remote attestation "
            "disabled by design). Operating in unverified Azure Confidential VM mode."
        )
    else:
        summary_text = (
            f"Hardware markers detected ({'; '.join(summary_parts)}), but driver binding and "
            f"remote attestation are not configured. Operating in software simulation."
        )

    return HardwareDetectionReport(
        cpu_sgx_detected=cpu_sgx,
        cpu_sev_detected=cpu_sev,
        sgx_device_nodes_found=sgx_nodes_found,
        sev_device_nodes_found=sev_nodes_found,
        driver_initialized=driver_initialized,
        attestation_configured=attestation_configured,
        detection_summary=summary_text,
        azure_environment_detected=azure_cvm_detected,
        azure_cvm_sku_detected=azure_sku,
        vtpm_device_found=vtpm_found,
    )
