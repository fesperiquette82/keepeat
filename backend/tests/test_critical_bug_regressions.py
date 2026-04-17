import asyncio
import base64
import importlib
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from starlette.responses import Response

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

import ocr_service


def _load_server(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    # Vider aussi "models" pour éviter les TypeAdapters Pydantic v2 stale
    # (ForwardRef('UserCreate') non résolu quand server est rechargé sans models).
    for mod in ("server", "models"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


def test_admin_add_recipe_route_registered_once(monkeypatch):
    server = _load_server(monkeypatch)

    admin_post_routes = [
        route
        for route in server.api_router.routes
        if getattr(route, "path", None) == "/api/admin/recipes" and "POST" in getattr(route, "methods", set())
    ]

    assert len(admin_post_routes) == 1


class _FakeCursor:
    def __init__(self, payload):
        self._payload = payload

    async def to_list(self, length=500):
        return self._payload


class _FakeRecipesCollection:
    def __init__(self, payload):
        self._payload = payload

    def find(self, _query):
        return _FakeCursor(self._payload)


def test_recipe_suggestions_survives_gap_upsert_failure(monkeypatch):
    server = _load_server(monkeypatch)

    async def fake_fetch_stock_candidates(*, uid, filter_value):
        return [{"name": "Tomate"}]

    async def fake_upsert_recipe_gap(**_kwargs):
        raise RuntimeError("db unavailable")

    captured_meta = {}

    def fake_apply_debug_headers(*, response, meta):
        captured_meta.update(meta)

    monkeypatch.setattr(server, "_fetch_stock_candidates", fake_fetch_stock_candidates)
    monkeypatch.setattr(server, "_upsert_recipe_gap", fake_upsert_recipe_gap)
    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: None)
    monkeypatch.setattr(server, "recipes_col", _FakeRecipesCollection([]))
    monkeypatch.setattr(server, "_apply_recipes_debug_headers", fake_apply_debug_headers)

    result = asyncio.run(
        server.get_recipe_suggestions(
            response=Response(),
            recipe_filter="urgent",
            include_meta=True,
            suggestion_style="classique",
            locale=None,
            accept_language=None,
            current_user={"id": "user-1"},
        )
    )

    assert result["recipes"] == []
    assert result["meta"]["suggest_later"] is True
    assert result["meta"]["gap_logged"] is False
    assert captured_meta.get("suggest_later") is True


def test_openapi_ocr_receipt_declares_json_body_and_bearer_auth(monkeypatch):
    server = _load_server(monkeypatch)
    client = TestClient(server.app)

    response = client.get("/openapi.json")
    assert response.status_code == 200
    openapi = response.json()

    operation = openapi["paths"]["/api/ocr/receipt"]["post"]
    request_body = operation.get("requestBody")
    assert request_body is not None
    assert request_body.get("required") is True

    json_schema = request_body["content"]["application/json"]["schema"]
    assert json_schema == {"$ref": "#/components/schemas/OcrReceiptRequest"}
    assert operation.get("security") == [{"HTTPBearer": []}]


def _wire_ocr_test_doubles(monkeypatch, server):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(server, "track_business_event", _noop)
    monkeypatch.setattr(server, "track_service_usage", _noop)
    monkeypatch.setattr(server, "_enforce_feature_access", _noop)
    monkeypatch.setattr(server, "log_api_request", _noop)
    monkeypatch.setattr(server, "ocr_normalizations_col", None)


def _jpeg_b64() -> str:
    raw = b"\xff\xd8\xff" + b"\x00" * 32
    return base64.b64encode(raw).decode()


def test_ocr_receipt_route_missing_image_returns_400(monkeypatch):
    server = _load_server(monkeypatch)
    _wire_ocr_test_doubles(monkeypatch, server)
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1"}
    client = TestClient(server.app)

    response = client.post("/api/ocr/receipt", json={})
    assert response.status_code == 400
    assert response.json()["detail"] == "Champ 'image' manquant"

    server.app.dependency_overrides.clear()


def test_ocr_receipt_route_auth_missing_or_invalid_returns_401(monkeypatch):
    server = _load_server(monkeypatch)
    _wire_ocr_test_doubles(monkeypatch, server)
    client = TestClient(server.app)

    missing = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert missing.status_code == 401

    invalid = client.post(
        "/api/ocr/receipt",
        json={"image": _jpeg_b64()},
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert invalid.status_code == 401


def test_ocr_receipt_route_nominal_flow_with_mocked_provider(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
    server = _load_server(monkeypatch)
    _wire_ocr_test_doubles(monkeypatch, server)
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1"}

    provider_resp = MagicMock()
    provider_resp.status_code = 200
    provider_resp.json.return_value = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{
                    "text": json.dumps(
                        {
                            "purchase_date": "2026-04-01",
                            "merchant": "Monoprix",
                            "currency": "eur",
                            "items": [
                                {
                                    "raw_title": "LAIT DEMI ECREME 1L",
                                    "normalized_title": "Lait demi-écrémé 1L",
                                    "is_food": True,
                                    "category": "frais",
                                    "quantity": 1,
                                    "unit": "unit",
                                    "confidence": 0.91,
                                }
                            ],
                            "ignored_items": [{"raw_title": "EPONGE", "reason": "non_food"}],
                        }
                    )
                }]
            },
        }]
    }
    fake_client = MagicMock()
    fake_client.__aenter__.return_value = fake_client
    fake_client.post = AsyncMock(return_value=provider_resp)
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=fake_client))

    client = TestClient(server.app)
    response = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})

    assert response.status_code == 200
    payload = response.json()
    assert payload["purchase_date"] == "2026-04-01"
    assert payload["merchant"] == "Monoprix"
    assert payload["currency"] == "EUR"
    assert payload["items"][0]["raw_title"] == "LAIT DEMI ECREME 1L"
    assert payload["items"][0]["normalized_title"] == "Lait demi-écrémé 1L"
    assert payload["ignored_items"][0]["raw_title"] == "EPONGE"
    assert payload["items"][0]["estimated_expiration_date"] == "2026-04-08"

    server.app.dependency_overrides.clear()


def test_ocr_receipt_route_provider_failures_mapping(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
    server = _load_server(monkeypatch)
    _wire_ocr_test_doubles(monkeypatch, server)
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1"}
    client = TestClient(server.app)

    timeout_client = MagicMock()
    timeout_client.__aenter__.return_value = timeout_client
    timeout_client.post = AsyncMock(side_effect=ocr_service.httpx.TimeoutException("timeout"))
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=timeout_client))
    timeout_resp = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert timeout_resp.status_code == 504

    http_503 = MagicMock()
    http_503.status_code = 503
    http_503.text = "upstream unavailable"
    err_client = MagicMock()
    err_client.__aenter__.return_value = err_client
    err_client.post = AsyncMock(return_value=http_503)
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=err_client))
    provider_resp = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert provider_resp.status_code == 502

    non_json_200 = MagicMock()
    non_json_200.status_code = 200
    non_json_200.text = "<html>oops</html>"
    non_json_200.json.side_effect = ValueError("no json")
    non_json_client = MagicMock()
    non_json_client.__aenter__.return_value = non_json_client
    non_json_client.post = AsyncMock(return_value=non_json_200)
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=non_json_client))
    non_json_resp = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert non_json_resp.status_code == 502

    server.app.dependency_overrides.clear()
