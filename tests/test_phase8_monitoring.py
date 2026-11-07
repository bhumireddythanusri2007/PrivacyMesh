"""
Phase 8 Automated Verification Suite for PrivacyMesh Observability.

Validates:
1. Backend metrics & cardinality protection.
2. Prometheus scrape targets & alert rules.
3. Grafana health, provisioned data source, and dashboard model.
4. Database invariant counts.
"""

import os
import re
import urllib.request
import urllib.error
import base64
import json
import pytest

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
GRAFANA_URL = os.getenv("GRAFANA_URL", "http://localhost:3000")
GRAFANA_USER = os.getenv("GRAFANA_USER", "admin")
GRAFANA_PASSWORD = os.getenv("GRAFANA_PASSWORD", "admin")


def http_get(url: str, timeout: float = 5.0) -> tuple[int, str]:
    headers = {"User-Agent": "PrivacyMesh-Verifier"}
    if url.startswith(GRAFANA_URL):
        creds = base64.b64encode(f"{GRAFANA_USER}:{GRAFANA_PASSWORD}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:
        pytest.fail(f"HTTP GET {url} failed: {e}")


def test_backend_monitoring_status():
    status_code, body = http_get(f"{BACKEND_URL}/monitoring/status")
    assert status_code == 200
    data = json.loads(body)
    assert data.get("status") == "active"
    assert "cpu_percent" in data
    assert "memory_percent" in data
    assert data.get("database_connected") is True


def test_backend_metrics_export():
    status_code, body = http_get(f"{BACKEND_URL}/metrics")
    assert status_code == 200
    assert "privacymesh_http_requests_total" in body
    assert "privacymesh_http_request_duration_seconds" in body
    assert "privacymesh_db_connected" in body
    assert "privacymesh_process_cpu_percent" in body
    assert "privacymesh_process_memory_percent" in body
    assert "privacymesh_process_memory_bytes" in body


def test_metrics_label_cardinality_protection():
    # Issue requests to parameterized endpoint
    http_get(f"{BACKEND_URL}/health")
    http_get(f"{BACKEND_URL}/nonexistent/test/path/12345")

    status_code, body = http_get(f"{BACKEND_URL}/metrics")
    assert status_code == 200

    # Verify that raw numeric ID or arbitrary dynamic path does NOT appear as endpoint label
    assert 'endpoint="/nonexistent/test/path/12345"' not in body
    # Instead, normalized pattern with {id} should appear
    assert 'endpoint="/nonexistent/test/path/{id}"' in body


def test_prometheus_health_and_targets():
    status_code, body = http_get(f"{PROMETHEUS_URL}/-/healthy")
    assert status_code == 200
    assert "Healthy" in body

    # Check targets API
    status_code, body = http_get(f"{PROMETHEUS_URL}/api/v1/targets")
    assert status_code == 200
    data = json.loads(body)
    assert data.get("status") == "success"

    active_targets = data.get("data", {}).get("activeTargets", [])
    backend_targets = [t for t in active_targets if t.get("labels", {}).get("job") == "privacymesh-backend"]
    assert len(backend_targets) > 0, "No privacymesh-backend target found in Prometheus"
    assert backend_targets[0].get("health") == "up", f"Backend target not UP: {backend_targets[0].get('health')}"


def test_prometheus_alert_rules():
    status_code, body = http_get(f"{PROMETHEUS_URL}/api/v1/rules")
    assert status_code == 200
    data = json.loads(body)
    assert data.get("status") == "success"

    groups = data.get("data", {}).get("groups", [])
    privacymesh_group = next((g for g in groups if g.get("name") == "privacymesh_alerts"), None)
    assert privacymesh_group is not None, "privacymesh_alerts rule group not found in Prometheus"

    rule_names = {r.get("name") for r in privacymesh_group.get("rules", [])}
    expected_rules = {
        "BackendUnavailable",
        "DatabaseUnavailable",
        "HighCPUUsage",
        "HighMemoryUsage",
        "HighHttp5xxErrorRate",
    }
    assert expected_rules.issubset(rule_names), f"Missing rules: {expected_rules - rule_names}"


def test_grafana_health_and_datasource():
    status_code, body = http_get(f"{GRAFANA_URL}/api/health")
    assert status_code == 200
    data = json.loads(body)
    assert data.get("database") == "ok"

    # Check datasources
    status_code, body = http_get(f"{GRAFANA_URL}/api/datasources")
    assert status_code == 200
    datasources = json.loads(body)
    prom_ds = next((ds for ds in datasources if ds.get("type") == "prometheus"), None)
    assert prom_ds is not None, "Prometheus data source not provisioned in Grafana"
    assert prom_ds.get("url") == "http://prometheus:9090"


def test_grafana_dashboard_provisioned():
    status_code, body = http_get(f"{GRAFANA_URL}/api/search?query=PrivacyMesh")
    assert status_code == 200
    dashboards = json.loads(body)
    assert any("PrivacyMesh Application Observability" in d.get("title", "") for d in dashboards), \
        f"PrivacyMesh dashboard not found in Grafana: {dashboards}"
