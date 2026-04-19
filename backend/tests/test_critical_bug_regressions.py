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


class _GeminiResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class _FakeGeminiClient:
    def __init__(self, responses, calls):
        self._responses = list(responses)
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        self._calls.append(url)
        if not self._responses:
            raise AssertionError("No fake Gemini response configured")
        return self._responses.pop(0)


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


def test_gap_fill_default_model_no_longer_uses_gemini_1_5_flash(monkeypatch):
    monkeypatch.delenv("GEMINI_RECIPES_MODEL", raising=False)
    server = _load_server(monkeypatch)
    calls = []
    recipe_payload = [{"title": "Omelette tomate", "ingredients_used": ["Tomate"], "instructions_summary": "Cuire.", "prep_time_min": 10}]
    fake_client = _FakeGeminiClient(
        responses=[
            _GeminiResponse(
                status_code=200,
                payload={"candidates": [{"content": {"parts": [{"text": json.dumps(recipe_payload)}]}}]},
            )
        ],
        calls=calls,
    )
    monkeypatch.setattr(server.httpx, "AsyncClient", MagicMock(return_value=fake_client))

    result = asyncio.run(server._ai_gap_fill(["Tomate"], "test-key"))

    assert result is not None
    assert calls
    assert "models/gemini-2.0-flash-lite:generateContent" in calls[0]
    assert "gemini-1.5-flash" not in calls[0]


def test_gap_fill_uses_configured_recipes_model(monkeypatch):
    monkeypatch.setenv("GEMINI_RECIPES_MODEL", "gemini-2.0-flash")
    server = _load_server(monkeypatch)
    calls = []
    recipe_payload = [{"title": "Soupe tomate", "ingredients_used": ["Tomate"], "instructions_summary": "Cuire.", "prep_time_min": 15}]
    fake_client = _FakeGeminiClient(
        responses=[
            _GeminiResponse(
                status_code=200,
                payload={"candidates": [{"content": {"parts": [{"text": json.dumps(recipe_payload)}]}}]},
            )
        ],
        calls=calls,
    )
    monkeypatch.setattr(server.httpx, "AsyncClient", MagicMock(return_value=fake_client))

    result = asyncio.run(server._ai_gap_fill(["Tomate"], "test-key"))

    assert result is not None
    assert "models/gemini-2.0-flash:generateContent" in calls[0]


def test_gap_fill_invalid_model_falls_back_to_safe_default(monkeypatch):
    monkeypatch.setenv("GEMINI_RECIPES_MODEL", "gemini-1.5-flash")
    server = _load_server(monkeypatch)
    calls = []
    recipe_payload = [{"title": "Salade tomate", "ingredients_used": ["Tomate"], "instructions_summary": "Mélanger.", "prep_time_min": 8}]
    fake_client = _FakeGeminiClient(
        responses=[
            _GeminiResponse(
                status_code=200,
                payload={"candidates": [{"content": {"parts": [{"text": json.dumps(recipe_payload)}]}}]},
            )
        ],
        calls=calls,
    )
    monkeypatch.setattr(server.httpx, "AsyncClient", MagicMock(return_value=fake_client))

    result = asyncio.run(server._ai_gap_fill(["Tomate"], "test-key"))

    assert result is not None
    assert "models/gemini-2.0-flash-lite:generateContent" in calls[0]
    assert "gemini-1.5-flash" not in calls[0]


def test_recipes_model_empty_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("GEMINI_RECIPES_MODEL", "   ")
    server = _load_server(monkeypatch)

    assert server._resolve_recipes_gemini_model() == "gemini-2.0-flash-lite"


def test_gap_fill_runtime_404_retries_with_default_model(monkeypatch, caplog):
    monkeypatch.setenv("GEMINI_RECIPES_MODEL", "gemini-2.5-pro-preview")
    server = _load_server(monkeypatch)
    calls = []
    recipe_payload = [{"title": "Riz tomate", "ingredients_used": ["Tomate"], "instructions_summary": "Cuire.", "prep_time_min": 20}]
    fake_client = _FakeGeminiClient(
        responses=[
            _GeminiResponse(status_code=404, text="model not found"),
            _GeminiResponse(
                status_code=200,
                payload={"candidates": [{"content": {"parts": [{"text": json.dumps(recipe_payload)}]}}]},
            ),
        ],
        calls=calls,
    )
    monkeypatch.setattr(server.httpx, "AsyncClient", MagicMock(return_value=fake_client))

    with caplog.at_level("WARNING"):
        result = asyncio.run(server._ai_gap_fill(["Tomate"], "test-key"))

    assert result is not None
    assert len(calls) == 2
    assert "models/gemini-2.5-pro-preview:generateContent" in calls[0]
    assert "models/gemini-2.0-flash-lite:generateContent" in calls[1]
    assert "fallback model=gemini-2.0-flash-lite" in caplog.text


def test_recipes_suggestions_returns_200_when_gap_fill_provider_fails(monkeypatch, caplog):
    server = _load_server(monkeypatch)

    async def fake_fetch_stock_candidates(*, uid, filter_value):
        return [{"name": "Tomate"}]

    async def failing_ai_gap_fill(stock_names, gemini_key):
        raise RuntimeError("provider 404")

    async def fake_upsert_recipe_gap(**_kwargs):
        return False

    monkeypatch.setattr(server, "_fetch_stock_candidates", fake_fetch_stock_candidates)
    monkeypatch.setattr(server, "_ai_gap_fill", failing_ai_gap_fill)
    monkeypatch.setattr(server, "_upsert_recipe_gap", fake_upsert_recipe_gap)
    monkeypatch.setattr(server, "_get_recipes_ai_api_key", lambda: "recipes-key")
    monkeypatch.setattr(server, "recipes_col", _FakeRecipesCollection([]))
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "user-1"}

    client = TestClient(server.app)
    with caplog.at_level("WARNING"):
        response = client.get("/api/recipes/suggestions?include_meta=true")

    server.app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["recipes"] == []
    assert payload["meta"]["suggest_later"] is True
    assert payload["meta"]["gap_logged"] is False
    assert "AI gap fill: erreur pour user=user-1: provider 404" in caplog.text


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


def _wire_ocr_test_doubles(monkeypatch, server, *, captured_events: list[dict] | None = None):
    async def _noop(*args, **kwargs):
        return None

    async def _track_business_event(*args, **kwargs):
        if captured_events is not None:
            captured_events.append(kwargs)
        return None

    monkeypatch.setattr(server, "track_business_event", _track_business_event)
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


def test_ocr_receipt_route_provider_400_is_not_mapped_to_generic_502(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
    server = _load_server(monkeypatch)
    captured_events: list[dict] = []
    _wire_ocr_test_doubles(monkeypatch, server, captured_events=captured_events)
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1"}
    client = TestClient(server.app)

    http_400 = MagicMock()
    http_400.status_code = 400
    http_400.text = "INVALID_ARGUMENT"
    err_client = MagicMock()
    err_client.__aenter__.return_value = err_client
    err_client.post = AsyncMock(return_value=http_400)
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=err_client))

    response = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert response.status_code == 400
    assert "invalide pour le provider gemini" in response.json()["detail"].lower()

    failed_events = [e for e in captured_events if e.get("event_name") == "ocr_scan_failed"]
    assert failed_events, "Un événement ocr_scan_failed doit être loggé"
    metadata = failed_events[-1]["metadata_json"]
    assert metadata.get("http_status") == 400
    assert metadata.get("upstream_http_status") == 400
    assert metadata.get("failure_cause") == "provider_invalid_request"
    assert metadata.get("failure_stage") == "provider_http_error"

    server.app.dependency_overrides.clear()


def test_ocr_receipt_route_provider_429_returns_explicit_rate_limit(monkeypatch):
    monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
    server = _load_server(monkeypatch)
    captured_events: list[dict] = []
    _wire_ocr_test_doubles(monkeypatch, server, captured_events=captured_events)
    server.app.dependency_overrides[server._get_current_user] = lambda: {"id": "u-1"}
    client = TestClient(server.app)

    http_429 = MagicMock()
    http_429.status_code = 429
    http_429.text = "RATE_LIMIT_EXCEEDED"
    err_client = MagicMock()
    err_client.__aenter__.return_value = err_client
    err_client.post = AsyncMock(return_value=http_429)
    monkeypatch.setattr(ocr_service.httpx, "AsyncClient", MagicMock(return_value=err_client))

    response = client.post("/api/ocr/receipt", json={"image": _jpeg_b64()})
    assert response.status_code == 429
    assert "quota provider gemini atteint" in response.json()["detail"].lower()
    assert err_client.post.await_count == 1

    failed_events = [e for e in captured_events if e.get("event_name") == "ocr_scan_failed"]
    assert failed_events, "Un événement ocr_scan_failed doit être loggé"
    metadata = failed_events[-1]["metadata_json"]
    assert metadata.get("http_status") == 429
    assert "quota provider gemini atteint" in str(metadata.get("reason", "")).lower()

    server.app.dependency_overrides.clear()
