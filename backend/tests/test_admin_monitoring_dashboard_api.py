import asyncio
import os
import sys
from pathlib import Path
from decimal import Decimal

import httpx
from bson import ObjectId
from bson.decimal128 import Decimal128

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

import server


ADMIN_USER = {"id": "507f1f77bcf86cd799439011", "email": "admin@keepeat.app", "is_admin": True}


async def _noop_log_api_request(**kwargs):
    _ = kwargs


async def _admin_override():
    return ADMIN_USER


def _build_nominal_kpis():
    return {
        "users": {
            "total": 10,
            "new_today": 1,
            "new_7d": 3,
            "new_30d": 7,
            "dau": 4,
            "wau": 6,
            "mau": 8,
            "free": 8,
            "premium": 2,
        },
        "subscriptions": {
            "active": 2,
            "by_plan": {"premium_monthly": 2, "premium_other": 0},
            "estimated_mrr_eur": 9.98,
            "estimated_arr_eur": 119.76,
        },
        "services": {
            "top_usage_30d": [
                {"service_name": "ocr", "units": 22, "estimated_cost": 1.2},
                {"service_name": "recipes_ai", "units": 6, "estimated_cost": 0.8},
            ]
        },
    }


def _build_nominal_overview():
    return {
        "global_status": "critical",
        "global_status_reasons": ["incident"],
        "thresholds": {"critical_error_rate_any_endpoint": 0.5},
        "critical_flows": {
            "/api/ocr/receipt": {
                "endpoint_key": "/api/ocr/receipt",
                "calls": 10,
                "success": 8,
                "errors": 2,
                "error_rate": 0.2,
                "avg_latency_ms": 123.4,
                "dominant_error_type": "external_service_error",
                "last_error": None,
                "severity": "degraded",
                "label": "Scan ticket",
                "business_criticality": "critical",
            }
        },
        "top_incidents": [
            {
                "endpoint_key": "/api/ocr/receipt",
                "errors": 2,
                "error_rate": 0.2,
                "severity": "degraded",
            }
        ],
        "last_critical_error": None,
        "product_funnel": {
            "users_with_receipt_scan": 4,
            "users_with_stock_add": 3,
            "users_with_recipes_view": 2,
        },
        "cost_breakdown": {
            "ocr_cost_eur": 1.2,
            "ocr_cost_per_scan_eur": 0.0545,
        },
    }


def _build_nominal_apis():
    return {
        "highest_error_rate": [
            {
                "endpoint_key": "/api/ocr/receipt",
                "volume": 10,
                "errors": 2,
                "error_rate": 0.2,
                "avg_latency_ms": 123.4,
            }
        ]
    }


def _patch_dashboard_sources(monkeypatch, *, kpis=None, overview=None, apis=None):
    async def _fake_kpis(**kwargs):
        _ = kwargs
        return _build_nominal_kpis() if kpis is None else kpis

    async def _fake_overview(**kwargs):
        _ = kwargs
        return _build_nominal_overview() if overview is None else overview

    async def _fake_apis(**kwargs):
        _ = kwargs
        return _build_nominal_apis() if apis is None else apis

    monkeypatch.setattr(server, "build_monitoring_kpis", _fake_kpis)
    monkeypatch.setattr(server, "build_operational_overview", _fake_overview)
    monkeypatch.setattr(server, "summarize_api_metrics", _fake_apis)
    monkeypatch.setattr(server, "log_api_request", _noop_log_api_request)


def _with_admin_override():
    server.app.dependency_overrides[server._require_admin_user] = _admin_override


async def _request(path: str):
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(path)


def test_dashboard_returns_200_with_nominal_payload(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("users"), dict)
    assert isinstance(payload.get("subscriptions"), dict)
    assert isinstance(payload.get("top_api_issues"), list)
    assert isinstance(payload.get("cost_metrics"), dict)
    assert isinstance(payload.get("critical_flows"), dict)
    assert isinstance(payload.get("product_funnel"), dict)
    assert isinstance(payload.get("frontend_deployment"), dict)


def test_dashboard_supports_partial_data_without_500(monkeypatch):
    partial_kpis = {"users": {"total": None, "premium": None, "wau": None}, "subscriptions": None, "services": {"top_usage_30d": [None, {"estimated_cost": None}]}}
    partial_overview = {
        "global_status": None,
        "global_status_reasons": None,
        "thresholds": None,
        "top_incidents": None,
        "critical_flows": None,
        "last_critical_error": None,
        "product_funnel": None,
        "cost_breakdown": None,
    }
    _patch_dashboard_sources(monkeypatch, kpis=partial_kpis, overview=partial_overview, apis={"highest_error_rate": None})
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert payload["top_api_issues"] == []
    assert payload["critical_flows"] == {}
    assert payload["cost_metrics"]["ocr_cost_eur"] == 0.0
    assert payload["product_funnel"]["premium_conversion_rate"] == 0.0


def test_dashboard_allows_missing_blocks_without_500(monkeypatch):
    overview = _build_nominal_overview()
    overview.pop("critical_flows")
    overview.pop("product_funnel")
    overview.pop("top_incidents")
    overview.pop("cost_breakdown")
    _patch_dashboard_sources(monkeypatch, overview=overview)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=30"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert payload["critical_flows"] == {}
    assert payload["product_funnel"]["premium_conversion_rate"] >= 0
    assert payload["top_api_issues"] == []
    assert payload["cost_metrics"]["ocr_cost_eur"] == 0.0


def test_dashboard_supports_days_1_7_30_90(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _with_admin_override()

    for days in (1, 7, 30, 90):
        response = asyncio.run(_request(f"/api/admin/monitoring/dashboard?days={days}"))
        assert response.status_code == 200
        assert response.json()["days"] == days

    server.app.dependency_overrides = {}


def test_health_ok_and_dashboard_stays_200_on_partial_dashboard_data(monkeypatch):
    async def _fake_health_overview(**kwargs):
        _ = kwargs
        return {
            "global_status": "ok",
            "global_status_reasons": [],
            "thresholds": {},
            "last_critical_error": None,
            "critical_flows": {},
            "top_incidents": [],
            "product_funnel": {},
            "cost_breakdown": {},
        }

    partial_kpis = {
        "users": {"total": None, "premium": None, "wau": None},
        "subscriptions": {"estimated_mrr_eur": None},
        "services": {"top_usage_30d": [{"estimated_cost": None}]},
    }
    _patch_dashboard_sources(monkeypatch, kpis=partial_kpis, overview=_build_nominal_overview(), apis={"highest_error_rate": None})
    monkeypatch.setattr(server, "build_operational_overview", _fake_health_overview)
    _with_admin_override()

    health = asyncio.run(_request("/api/admin/monitoring/health?days=7"))
    dashboard = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert health.status_code == 200
    assert health.json()["status"] in {"ok", "degraded", "critical"}
    assert dashboard.status_code == 200
    assert isinstance(dashboard.json(), dict)


def test_trends_stays_200_with_empty_sources(monkeypatch):
    class _FakeCursor:
        async def to_list(self, length):
            _ = length
            return []

    class _FakeCollection:
        def aggregate(self, pipeline):
            _ = pipeline
            return _FakeCursor()

    monkeypatch.setattr(server, "api_request_logs_col", _FakeCollection())
    monkeypatch.setattr(server, "users_col", _FakeCollection())
    monkeypatch.setattr(server, "service_usage_logs_col", _FakeCollection())
    monkeypatch.setattr(server, "log_api_request", _noop_log_api_request)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/trends?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert payload["days"] == 7
    assert payload["dau"] == []
    assert payload["new_users"] == []
    assert payload["errors"] == []
    assert payload["costs"] == []


def test_dashboard_prod_like_objectid_and_decimal_payload_stays_200(monkeypatch):
    prod_like_overview = _build_nominal_overview()
    prod_like_overview["top_incidents"] = [
        {
            "endpoint_key": "/api/ocr/receipt",
            "errors": 7,
            "error_rate": Decimal128("0.35"),
            "severity": "critical",
            "last_error": {
                "_id": ObjectId("507f1f77bcf86cd799439011"),
                "status_code": 500,
                "created_at": "2026-04-16T12:00:00+00:00",
            },
        }
    ]
    prod_like_overview["cost_breakdown"] = {
        "ocr_cost_eur": Decimal("5.44"),
        "ocr_cost_per_scan_eur": Decimal128("0.08"),
    }
    prod_like_kpis = _build_nominal_kpis()
    prod_like_kpis["services"]["top_usage_30d"] = [
        {"service_name": "ocr", "units": Decimal128("12"), "estimated_cost": Decimal128("2.1")}
    ]
    _patch_dashboard_sources(monkeypatch, kpis=prod_like_kpis, overview=prod_like_overview)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert payload["top_api_issues"][0]["last_error"]["_id"] == "507f1f77bcf86cd799439011"
    assert payload["cost_metrics"]["ocr_cost_per_scan_eur"] == 0.08


def test_dashboard_survives_kpis_source_exception_with_block_fallbacks(monkeypatch):
    async def _failing_kpis(**kwargs):
        _ = kwargs
        raise TypeError("Decimal128 doesn't define __round__")

    async def _fake_overview(**kwargs):
        _ = kwargs
        return _build_nominal_overview()

    async def _fake_apis(**kwargs):
        _ = kwargs
        return _build_nominal_apis()

    monkeypatch.setattr(server, "build_monitoring_kpis", _failing_kpis)
    monkeypatch.setattr(server, "build_operational_overview", _fake_overview)
    monkeypatch.setattr(server, "summarize_api_metrics", _fake_apis)
    monkeypatch.setattr(server, "log_api_request", _noop_log_api_request)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    assert payload["users"] == {}
    assert payload["subscriptions"] == {}
    assert isinstance(payload["top_api_issues"], list)
    assert isinstance(payload["critical_flows"], dict)
    assert payload["cost_metrics"]["ocr_cost_eur"] >= 0.0


def _set_frontend_env(monkeypatch, values: dict[str, str | None]):
    managed_keys = [
        "FRONTEND_DEPLOYED_COMMIT",
        "FRONTEND_EXPECTED_COMMIT",
        "FRONTEND_DEPLOYED_VERSION",
        "FRONTEND_EXPECTED_VERSION",
        "FRONTEND_DEPLOYED_BUILD_TIME",
        "FRONTEND_EXPECTED_BUILD_TIME",
        "FRONTEND_DEPLOYED_DEPLOY_ID",
        "FRONTEND_EXPECTED_DEPLOY_ID",
        "FRONTEND_DEPLOYED_SERVICE_ID",
        "FRONTEND_RENDER_SERVICE_ID",
        "RENDER_API_KEY",
        "FRONTEND_PUBLIC_URL",
        "FRONTEND_BUILD_INFO_URL",
        "FRONTEND_URL",
        "EXPO_PUBLIC_APP_COMMIT",
        "EXPO_PUBLIC_APP_VERSION",
        "EXPO_PUBLIC_BUILD_TIME",
    ]
    for key in managed_keys:
        monkeypatch.delenv(key, raising=False)
    for key, value in values.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


def test_dashboard_frontend_deployment_status_ok_when_commits_match(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "abc1234",
            "FRONTEND_DEPLOYED_VERSION": "1.4.0",
            "FRONTEND_EXPECTED_VERSION": "1.4.0",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["badge"] == "ok"
    assert meta["source"] == "env fallback"
    assert meta["current"]["commit"] == "abc1234"
    assert meta["current"]["source"] == "env:FRONTEND_DEPLOYED_*|EXPO_PUBLIC_*"
    assert meta["expected"]["commit"] == "abc1234"


def test_dashboard_frontend_deployment_status_warning_when_commits_mismatch(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "def5678",
            "FRONTEND_DEPLOYED_DEPLOY_ID": "dep-current",
            "FRONTEND_EXPECTED_DEPLOY_ID": "dep-latest",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "mismatch"
    assert meta["badge"] == "warning"
    assert meta["source"] == "env fallback"
    assert meta["current"]["deploy_id"] == "dep-current"
    assert meta["expected"]["deploy_id"] == "dep-latest"


def test_dashboard_frontend_deployment_status_unknown_when_metadata_missing(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(monkeypatch, {})
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "unknown"
    assert meta["badge"] == "unknown"
    assert meta["source"] == "unknown"
    assert meta["current"]["commit"] == "unknown"
    assert meta["expected"]["commit"] == "unknown"


def test_dashboard_frontend_deployment_status_check_when_partial_metadata(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "deployment_check"
    assert meta["badge"] == "warning"
    assert meta["source"] == "unknown"
    assert meta["current"]["commit"] == "abc1234"
    assert meta["expected"]["commit"] == "unknown"


def test_dashboard_frontend_deployment_uses_render_api_when_configured(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "EXPO_PUBLIC_APP_COMMIT": "2ebc82f",
            "RENDER_API_KEY": "render-token",
            "FRONTEND_RENDER_SERVICE_ID": "srv-frontend",
        },
    )

    async def _fake_fetch_render_latest_deploy(service_id: str, api_key: str):
        assert service_id == "srv-frontend"
        assert api_key == "render-token"
        return {
            "deploy_id": "dep-123",
            "commit": "2ebc82f",
            "build_time": "2026-04-18T12:45:00Z",
            "status": "live",
            "created_at": "2026-04-18T12:40:00Z",
            "updated_at": "2026-04-18T12:45:00Z",
            "finished_at": "2026-04-18T12:45:00Z",
        }

    monkeypatch.setattr(server, "_fetch_render_latest_deploy", _fake_fetch_render_latest_deploy)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["source"] == "Render API"
    assert meta["expected"]["source"] == "render_api"
    assert meta["expected"]["deploy_time"] == "2026-04-18T12:45:00Z"
    assert meta["expected"]["deploy_id"] == "dep-123"
    assert meta["expected"]["commit"] == "2ebc82f"


def test_dashboard_frontend_deployment_prefers_build_metadata_for_current(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "legacy-env-commit",
            "FRONTEND_EXPECTED_COMMIT": "from-build-meta",
        },
    )

    async def _fake_fetch_frontend_build_info():
        return {
            "commit": "from-build-meta",
            "build_time": "2026-04-19T10:00:00Z",
            "version": "2.0.0",
        }

    monkeypatch.setattr(server, "_fetch_frontend_build_info", _fake_fetch_frontend_build_info)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    meta = response.json()["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["current"]["commit"] == "from-build-meta"
    assert meta["current"]["version"] == "2.0.0"
    assert meta["current"]["build_time"] == "2026-04-19T10:00:00Z"
    assert meta["current"]["source"] == "build metadata"


def test_dashboard_frontend_deployment_build_metadata_missing_fallback_non_blocking(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "env-commit",
            "FRONTEND_EXPECTED_COMMIT": "env-commit",
        },
    )

    async def _fake_fetch_frontend_build_info():
        return None

    monkeypatch.setattr(server, "_fetch_frontend_build_info", _fake_fetch_frontend_build_info)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    meta = response.json()["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["current"]["commit"] == "env-commit"
    assert meta["current"]["source"] == "env:FRONTEND_DEPLOYED_*|EXPO_PUBLIC_*"


def test_dashboard_frontend_deployment_mismatch_with_render_api(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "1a2b3c4",
            "RENDER_API_KEY": "render-token",
            "FRONTEND_RENDER_SERVICE_ID": "srv-frontend",
        },
    )

    async def _fake_fetch_render_latest_deploy(service_id: str, api_key: str):
        _ = service_id, api_key
        return {
            "deploy_id": "dep-latest",
            "commit": "2ebc82f",
            "build_time": "2026-04-19T09:00:00Z",
            "status": "live",
            "created_at": "2026-04-19T08:58:00Z",
            "updated_at": "2026-04-19T09:00:00Z",
            "finished_at": "2026-04-19T09:00:00Z",
        }

    monkeypatch.setattr(server, "_fetch_render_latest_deploy", _fake_fetch_render_latest_deploy)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "mismatch"
    assert meta["source"] == "Render API"
    assert meta["current"]["commit"] == "1a2b3c4"
    assert meta["expected"]["commit"] == "2ebc82f"


def test_dashboard_frontend_deployment_fallback_when_render_api_errors(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "abc1234",
            "RENDER_API_KEY": "render-token",
            "FRONTEND_RENDER_SERVICE_ID": "srv-frontend",
        },
    )

    async def _fake_fetch_render_latest_deploy(service_id: str, api_key: str):
        _ = service_id, api_key
        return None

    monkeypatch.setattr(server, "_fetch_render_latest_deploy", _fake_fetch_render_latest_deploy)
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    payload = response.json()
    meta = payload["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["source"] == "env fallback"
    assert meta["expected"]["source"] == "env:FRONTEND_EXPECTED_*|FRONTEND_LATEST_*"


def test_dashboard_frontend_deployment_fallback_when_render_api_key_missing(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "abc1234",
            "FRONTEND_RENDER_SERVICE_ID": "srv-frontend",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    meta = response.json()["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["source"] == "env fallback"
    assert meta["expected"]["source"] == "env:FRONTEND_EXPECTED_*|FRONTEND_LATEST_*"


def test_dashboard_frontend_deployment_fallback_when_render_service_id_missing(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "abc1234",
            "RENDER_API_KEY": "render-token",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    meta = response.json()["frontend_deployment"]
    assert meta["status"] == "up_to_date"
    assert meta["source"] == "env fallback"


def test_dashboard_frontend_deployment_payload_serialization_stable(monkeypatch):
    _patch_dashboard_sources(monkeypatch)
    _set_frontend_env(
        monkeypatch,
        {
            "FRONTEND_DEPLOYED_COMMIT": "abc1234",
            "FRONTEND_EXPECTED_COMMIT": "abc1234",
        },
    )
    _with_admin_override()

    response = asyncio.run(_request("/api/admin/monitoring/dashboard?days=7"))

    server.app.dependency_overrides = {}
    assert response.status_code == 200
    frontend_deployment = response.json()["frontend_deployment"]
    serialized = __import__("json").loads(__import__("json").dumps(frontend_deployment, sort_keys=True))
    assert isinstance(serialized, dict)
    assert set(serialized.keys()) == {"status", "badge", "message", "source", "current", "expected"}
    assert set(serialized["expected"].keys()) == {"commit", "version", "build_time", "deploy_time", "deploy_id", "source"}


def test_extract_frontend_build_info_serialization_stable():
    payload = {
        "commit": "abcd1234",
        "build_time": "2026-04-19T12:00:00Z",
        "version": "1.2.3",
    }
    parsed = server._extract_frontend_build_info(payload)
    serialized = __import__("json").loads(__import__("json").dumps(parsed, sort_keys=True))
    assert serialized == payload


def test_extract_frontend_build_info_returns_none_when_unusable():
    payload = {
        "commit": "",
        "build_time": "",
        "version": "",
    }
    assert server._extract_frontend_build_info(payload) is None
