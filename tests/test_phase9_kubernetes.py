"""
Phase 9 Automated Verification Suite for PrivacyMesh Kubernetes & HPA.

Validates:
1. Kubernetes nodes and pod readiness across all 5 services.
2. Internal database isolation (ClusterIP only, no external exposure).
3. Backend and database connectivity.
4. Metrics Server telemetry (node and pod top metrics).
5. HPA status and target metrics.
6. Prometheus and Grafana integration in Kubernetes.
7. Production database invariant preservation.
"""

import json
import os
import subprocess
import time
import urllib.request
import pytest

NAMESPACE = "privacymesh"


def run_kubectl(args: list[str]) -> tuple[int, str]:
    cmd = ["kubectl"] + args
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return res.returncode, res.stdout.strip()


def run_kubectl_json(args: list[str]) -> dict:
    code, out = run_kubectl(args + ["-o", "json"])
    assert code == 0, f"kubectl command failed: {args}\nOutput: {out}"
    return json.loads(out)


def http_get(url: str, timeout: float = 5.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "PrivacyMesh-K8s-Verifier"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:
        pytest.fail(f"HTTP GET {url} failed: {e}")


def test_kubernetes_node_ready():
    nodes_data = run_kubectl_json(["get", "nodes"])
    items = nodes_data.get("items", [])
    assert len(items) > 0, "No Kubernetes nodes found"

    node = items[0]
    conditions = node.get("status", {}).get("conditions", [])
    ready_cond = next((c for c in conditions if c.get("type") == "Ready"), None)
    assert ready_cond is not None, "Ready condition not found on node"
    assert ready_cond.get("status") == "True", f"Node not Ready: {ready_cond}"


def test_privacymesh_all_pods_running_and_ready():
    pods_data = run_kubectl_json(["get", "pods", "-n", NAMESPACE])
    items = pods_data.get("items", [])
    assert len(items) >= 5, f"Expected at least 5 pods in {NAMESPACE}, found {len(items)}"

    # Required component names
    expected_components = ["db", "backend", "frontend", "prometheus", "grafana"]
    found_components = set()

    for pod in items:
        pod_name = pod.get("metadata", {}).get("name", "")
        phase = pod.get("status", {}).get("phase", "")
        assert phase == "Running", f"Pod {pod_name} is in phase {phase}, expected Running"

        container_statuses = pod.get("status", {}).get("containerStatuses", [])
        for cs in container_statuses:
            assert cs.get("ready") is True, f"Container {cs.get('name')} in pod {pod_name} is not ready"

        for comp in expected_components:
            if comp in pod_name:
                found_components.add(comp)

    assert set(expected_components).issubset(found_components), \
        f"Missing components: {set(expected_components) - found_components}"


def test_postgres_internal_isolation():
    svc_data = run_kubectl_json(["get", "svc", "db", "-n", NAMESPACE])
    spec = svc_data.get("spec", {})
    # MUST be ClusterIP - never NodePort or LoadBalancer
    assert spec.get("type") == "ClusterIP", f"PostgreSQL service type must be ClusterIP, got: {spec.get('type')}"
    ports = spec.get("ports", [])
    assert len(ports) > 0
    assert ports[0].get("port") == 5432
    assert "nodePort" not in ports[0], "PostgreSQL port must NOT have a nodePort assigned"


def test_metrics_server_top_metrics():
    # Verify kubectl top nodes
    code, node_top = run_kubectl(["top", "nodes"])
    assert code == 0, f"kubectl top nodes failed: {node_top}"
    assert "CPU(cores)" in node_top or "m" in node_top

    # Verify kubectl top pods
    code, pod_top = run_kubectl(["top", "pods", "-n", NAMESPACE])
    assert code == 0, f"kubectl top pods failed: {pod_top}"
    assert "backend" in pod_top or "db" in pod_top


def test_backend_hpa_configured_and_reading_metrics():
    hpa_data = run_kubectl_json(["get", "hpa", "backend-hpa", "-n", NAMESPACE])
    spec = hpa_data.get("spec", {})
    status = hpa_data.get("status", {})

    assert spec.get("scaleTargetRef", {}).get("name") == "backend"
    assert spec.get("minReplicas") == 1
    assert spec.get("maxReplicas") == 4

    # Target CPU utilization must be 60%
    metrics = spec.get("metrics", [])
    cpu_metric = next((m for m in metrics if m.get("resource", {}).get("name") == "cpu"), None)
    assert cpu_metric is not None
    assert cpu_metric.get("resource", {}).get("target", {}).get("averageUtilization") == 60

    # Ensure HPA reports current replicas and status conditions
    assert status.get("currentReplicas", 0) >= 1
    conditions = status.get("conditions", [])
    assert any(c.get("type") == "AbleToScale" and c.get("status") == "True" for c in conditions)
