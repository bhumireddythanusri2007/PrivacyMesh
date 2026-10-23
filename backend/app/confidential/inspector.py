import os
import platform
from app.confidential.schemas import HardwareDetectionReport


def inspect_hardware_environment() -> HardwareDetectionReport:
    """
    Inspect the host/container runtime environment for hardware TEE support (Intel SGX, AMD SEV).
    Crucially distinguishes passive detection from operational usability and confirmed attestation.
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

    # Operational usability checks:
    # A genuine hardware enclave requires not only device nodes or flags,
    # but also active driver initialization and reachable attestation endpoints.
    driver_initialized = bool(sgx_nodes_found or sev_nodes_found)
    attestation_configured = False  # PrivacyMesh does not have real attestation configured yet

    summary_parts = []
    if cpu_sgx:
        summary_parts.append("Intel SGX CPU instruction flag detected")
    if cpu_sev:
        summary_parts.append("AMD SEV CPU instruction flag detected")
    if sgx_nodes_found:
        summary_parts.append(f"SGX device nodes present ({', '.join(sgx_nodes_found)})")
    if sev_nodes_found:
        summary_parts.append(f"SEV device nodes present ({', '.join(sev_nodes_found)})")

    if not summary_parts:
        summary_text = (
            f"No hardware TEE device nodes or CPU enclave extensions detected in the current "
            f"{platform.system()} ({platform.machine()}) runtime. Operating in transparent software simulation."
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
    )
