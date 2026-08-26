"""Tests de non-régression — ocr_service.py

Couvre les fonctions pures et le comportement de ocr_receipt()
en mockant httpx pour éviter tout appel réseau.
"""
from __future__ import annotations

import importlib
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ocr_service import (
    OcrApiError,
    _decode_base64_image,
    _compute_expiry,
    _default_zone_from_shelf,
    _detect_mime_type,
    _enrich_normalizations,
    _extract_gemini_text,
    _normalize_date,
    _normalize_receipt_item,
    _parse_receipt_json,
    _strip_data_uri_prefix,
    ocr_receipt,
)


# ── Helpers purs ──────────────────────────────────────────────────────────────

class TestStripDataUriPrefix:
    def test_no_prefix_unchanged(self):
        b64 = "abc123def456"
        assert _strip_data_uri_prefix(b64) == b64

    def test_jpeg_prefix_stripped(self):
        b64 = "data:image/jpeg;base64,abc123"
        assert _strip_data_uri_prefix(b64) == "abc123"

    def test_png_prefix_stripped(self):
        b64 = "data:image/png;base64,xyz789"
        assert _strip_data_uri_prefix(b64) == "xyz789"


class TestDetectMimeType:
    def _b64(self, raw: bytes) -> str:
        import base64
        return base64.b64encode(raw).decode()

    def test_jpeg_magic(self):
        raw = b"\xff\xd8\xff" + b"\x00" * 20
        assert _detect_mime_type(self._b64(raw)) == "image/jpeg"

    def test_png_magic(self):
        raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        assert _detect_mime_type(self._b64(raw)) == "image/png"

    def test_webp_magic(self):
        raw = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 10
        assert _detect_mime_type(self._b64(raw)) == "image/webp"

    def test_unknown_mime_returns_invalid(self):
        raw = b"\x00\x00\x00\x00" * 10
        assert _detect_mime_type(self._b64(raw)) == "invalid"

    def test_invalid_b64_returns_invalid(self):
        assert _detect_mime_type("not-valid!!!") == "invalid"


class TestDecodeBase64Image:
    def test_valid_base64(self):
        raw = _decode_base64_image("QUJDRA==")
        assert raw == b"ABCD"

    def test_invalid_characters_raise(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            _decode_base64_image("%%%")
        assert exc_info.value.status_code == 400


class TestExtractGeminiText:
    def _response(self, text: str, finish_reason: str = "STOP") -> dict:
        return {
            "candidates": [{
                "finishReason": finish_reason,
                "content": {"parts": [{"text": text}]},
            }]
        }

    def test_nominal(self):
        data = self._response('[{"name":"Lait"}]')
        assert _extract_gemini_text(data) == '[{"name":"Lait"}]'

    def test_strips_whitespace(self):
        data = self._response("  []  ")
        assert _extract_gemini_text(data) == "[]"

    def test_empty_parts_returns_none(self):
        data = {"candidates": [{"finishReason": "STOP", "content": {"parts": []}}]}
        assert _extract_gemini_text(data) is None

    def test_no_candidates_returns_none(self):
        assert _extract_gemini_text({"candidates": []}) is None

    def test_missing_candidates_key_returns_none(self):
        assert _extract_gemini_text({}) is None

    def test_safety_raises(self):
        data = self._response("", finish_reason="SAFETY")
        with pytest.raises(OcrApiError) as exc_info:
            _extract_gemini_text(data)
        assert "SAFETY" in str(exc_info.value)

    def test_prompt_block_reason_raises(self):
        data = {"promptFeedback": {"blockReason": "HARM"}, "candidates": []}
        with pytest.raises(OcrApiError) as exc_info:
            _extract_gemini_text(data)
        assert "HARM" in str(exc_info.value)

    def test_recitation_raises(self):
        data = self._response("", finish_reason="RECITATION")
        with pytest.raises(OcrApiError):
            _extract_gemini_text(data)


# ── OcrApiError ───────────────────────────────────────────────────────────────

class TestOcrApiError:
    def test_default_http_status_is_502(self):
        err = OcrApiError("oops")
        assert err.http_status == 502

    def test_custom_http_status(self):
        err = OcrApiError("timeout", http_status=504)
        assert err.http_status == 504
        assert str(err) == "timeout"

    def test_429_status(self):
        err = OcrApiError("rate limit", http_status=429)
        assert err.http_status == 429


# ── ocr_receipt() — tests avec mock httpx ────────────────────────────────────

def _make_request(image_b64: str | None = None) -> MagicMock:
    """Crée un mock de fastapi.Request avec un body JSON."""
    import base64
    if image_b64 is None:
        # Image JPEG valide minimale
        raw = b"\xff\xd8\xff" + b"\x00" * 30
        image_b64 = base64.b64encode(raw).decode()
    req = MagicMock()
    req.json = AsyncMock(return_value={"image": image_b64})
    return req


def _make_user() -> dict:
    return {"id": "user-test-123", "email": "test@example.com"}


def _gemini_ok_response(payload: list | dict) -> MagicMock:
    """Réponse Gemini 200 avec un payload (liste v1 ou objet v2)."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": json.dumps(payload)}]},
        }]
    }
    return resp


def _gemini_v2_response(purchase_date: str | None, items: list) -> MagicMock:
    """Réponse Gemini 200 au format v2 (objet avec purchase_date + items)."""
    return _gemini_ok_response({"purchase_date": purchase_date, "items": items})


class TestOcrReceiptMocked:
    """Tests de ocr_receipt() avec httpx mocké (pas d'appel réseau réel)."""

    @pytest.mark.anyio
    async def test_accepts_explicit_request_payload_without_request_object(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            fake_client = MagicMock()
            fake_client.__aenter__.return_value = fake_client
            fake_client.post = AsyncMock(return_value=_gemini_ok_response([]))
            mock_client.return_value = fake_client

            result = await ocr_receipt(
                request=None,
                request_payload={"image": _make_request().json.return_value["image"]},
                current_user=_make_user(),
            )

        assert result["items"] == []

    @pytest.mark.anyio
    async def test_missing_image_field_raises_400(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        req = MagicMock()
        req.json = AsyncMock(return_value={})  # pas de champ image
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await ocr_receipt(req, _make_user())
        assert exc_info.value.status_code == 400

    @pytest.mark.anyio
    async def test_invalid_request_structure_raises_422(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        req = MagicMock()
        req.json = AsyncMock(return_value=["not-a-dict"])
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await ocr_receipt(req, _make_user())
        assert exc_info.value.status_code == 422

    @pytest.mark.anyio
    async def test_invalid_mime_type_raises_400(self, monkeypatch):
        import base64
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        raw = b"\x01\x02\x03\x04" * 20
        req = _make_request(base64.b64encode(raw).decode())
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await ocr_receipt(req, _make_user())
        assert exc_info.value.status_code == 400

    @pytest.mark.anyio
    async def test_invalid_base64_payload_raises_400(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        req = _make_request("%%%not-base64%%%")
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await ocr_receipt(req, _make_user())
        assert exc_info.value.status_code == 400

    @pytest.mark.anyio
    async def test_no_api_key_raises_ocr_error(self, monkeypatch):
        monkeypatch.delenv("GEMINI_OCR_API_KEY", raising=False)
        with pytest.raises(OcrApiError) as exc_info:
            await ocr_receipt(_make_request(), _make_user())
        assert "non configuré" in str(exc_info.value)

    @pytest.mark.anyio
    async def test_gemini_404_model_not_found(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        monkeypatch.setenv("GEMINI_OCR_MODEL", "gemini-1.5-flash")
        resp = MagicMock()
        resp.status_code = 404
        resp.text = "Model not found"
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        err = exc_info.value
        assert err.http_status == 502
        assert "404" in str(err) or "introuvable" in str(err).lower()

    @pytest.mark.anyio
    async def test_gemini_429_rate_limit(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 429
        resp.text = "RATE_LIMIT_EXCEEDED"
        post = AsyncMock(return_value=resp)
        with patch("ocr_service.httpx.AsyncClient") as mock_client, patch("ocr_service.asyncio.sleep", new=AsyncMock()) as sleep_mock:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 429
        assert "quota provider gemini atteint" in str(exc_info.value).lower()
        assert post.await_count == 3
        assert sleep_mock.await_count == 2

    @pytest.mark.anyio
    async def test_gemini_timeout_returns_504(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        import httpx as _httpx
        with patch("ocr_service.httpx.AsyncClient") as mock_client, patch("ocr_service.asyncio.sleep", new=AsyncMock()) as sleep_mock:
            mock_client.return_value.__aenter__ = AsyncMock(
                return_value=MagicMock(post=AsyncMock(side_effect=_httpx.TimeoutException("timeout")))
            )
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 504
        assert exc_info.value.stage == "provider_call"
        assert exc_info.value.cause == "TimeoutException"
        assert sleep_mock.await_count == 2

    @pytest.mark.anyio
    async def test_transient_error_retries_then_success(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        transient = MagicMock()
        transient.status_code = 503
        transient.text = "service unavailable"
        success = _gemini_ok_response([{"name": "Lait", "category": "frais"}])
        post = AsyncMock(side_effect=[transient, success])
        with patch("ocr_service.httpx.AsyncClient") as mock_client, patch("ocr_service.asyncio.sleep", new=AsyncMock()) as sleep_mock:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        assert post.await_count == 2
        assert sleep_mock.await_count == 1
        assert len(result["items"]) == 1

    @pytest.mark.anyio
    async def test_invalid_model_json_returns_clear_502_error(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "not-json-response"}]}}]
        }
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 502
        assert exc_info.value.stage == "provider_response_parse"
        assert exc_info.value.cause == "invalid_model_json"

    @pytest.mark.anyio
    async def test_gemini_safety_block(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]
        }
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert "SAFETY" in str(exc_info.value)

    @pytest.mark.anyio
    async def test_gemini_empty_candidates_returns_empty_list(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"candidates": []}
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        assert result["items"] == []

    @pytest.mark.anyio
    async def test_nominal_success_v1_compat(self, monkeypatch):
        """Format v1 (tableau direct) reste compatible."""
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        products = [
            {"name": "Lait demi-écrémé", "category": "frais"},
            {"name": "Pâtes", "category": "feculents"},
        ]
        resp = _gemini_ok_response(products)
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        items = result["items"]
        assert len(items) == 2
        assert items[0]["name"] == "Lait demi-écrémé"
        assert items[0]["category"] == "frais"
        assert items[0]["food_category"] == "frais"
        assert items[0]["shelf_life_fridge"] == 7
        assert items[0]["purchase_date"] is None
        # Pas de date d'achat connue → estimation basée sur aujourd'hui plutôt
        # que perdue (cf. BUG "Date inconnue" / _compute_expiry fallback).
        assert items[0]["expiry_date_fridge"] == (date.today() + timedelta(days=7)).isoformat()
        assert items[1]["name"] == "Pâtes"
        assert items[1]["shelf_life_pantry"] == 365

    @pytest.mark.anyio
    async def test_nominal_success_v2_with_purchase_date(self, monkeypatch):
        """Format v2 : purchase_date + expiry_date précalculées."""
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        items = [
            {"raw_title": "LAI 1/2 ECR 1L", "name": "Lait demi-écrémé 1L", "category": "frais"},
            {"raw_title": "PATES PENNE 500G", "name": "Pâtes penne 500g", "category": "feculents"},
        ]
        resp = _gemini_v2_response("2024-01-15", items)
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        items = result["items"]
        assert len(items) == 2
        p0 = items[0]
        assert p0["name"] == "Lait demi-écrémé 1L"
        assert p0["raw_title"] == "LAI 1/2 ECR 1L"
        assert p0["purchase_date"] == "2024-01-15"
        assert p0["shelf_life_fridge"] == 7
        assert p0["expiry_date_fridge"] == "2024-01-22"   # 2024-01-15 + 7j
        assert p0["expiry_date_pantry"] is None
        p1 = items[1]
        assert p1["shelf_life_pantry"] == 365
        assert p1["expiry_date_pantry"] == "2025-01-14"   # 2024-01-15 + 365j (2024 bissextile)

    @pytest.mark.anyio
    async def test_non_food_items_are_ignored(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        payload = {
            "purchase_date": "2024-04-01",
            "merchant": "Monoprix",
            "currency": "EUR",
            "items": [
                {"raw_title": "SAC CABAS", "normalized_title": "Sac cabas", "is_food": False, "category": "autres"},
                {"raw_title": "POMME GOLDEN", "normalized_title": "Pomme", "is_food": True, "category": "legumes"},
            ],
            "ignored_items": [{"raw_title": "LESSIVE", "reason": "non_food"}],
        }
        resp = _gemini_ok_response(payload)
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        assert len(result["items"]) == 1
        assert result["items"][0]["raw_title"] == "POMME GOLDEN"
        assert len(result["ignored_items"]) == 2

    @pytest.mark.anyio
    async def test_partial_json_item_keeps_raw_title_and_defaults(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        payload = {"purchase_date": None, "items": [{"raw_title": "TOM CR PIZZA 4F"}]}
        resp = _gemini_ok_response(payload)
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        assert len(result["items"]) == 1
        item = result["items"][0]
        assert item["raw_title"] == "TOM CR PIZZA 4F"
        assert item["name"] == "TOM CR PIZZA 4F"
        assert item["purchase_date"] is None

    @pytest.mark.anyio
    async def test_invalid_json_response_raises(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not json {{{"}]}}]
        }
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 502

    @pytest.mark.anyio
    async def test_provider_non_json_http_body_raises_502(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 200
        resp.text = "<html>bad gateway</html>"
        resp.json.side_effect = ValueError("not json")
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 502
        assert exc_info.value.stage == "provider_response_parse"

    @pytest.mark.anyio
    async def test_provider_400_is_mapped_to_400_not_generic_502(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        resp = MagicMock()
        resp.status_code = 400
        resp.text = "INVALID_ARGUMENT"
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 400
        assert exc_info.value.upstream_status == 400
        assert exc_info.value.cause == "provider_invalid_request"

    @pytest.mark.anyio
    async def test_regression_provider_payload_uses_inline_data_camel_case(self, monkeypatch):
        """Régression prod: snake_case inline_data/mime_type => HTTP 400 provider puis 502 API."""
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")

        async def _post(_url, *, headers, json):
            del headers
            parts = json["contents"][0]["parts"]
            has_inline_data = any("inlineData" in part for part in parts)
            has_mime_type = any("mimeType" in part.get("inlineData", {}) for part in parts if isinstance(part, dict))
            resp = MagicMock()
            if not (has_inline_data and has_mime_type):
                resp.status_code = 400
                resp.text = "INVALID_ARGUMENT: Unknown name \"inline_data\""
                return resp
            resp.status_code = 200
            resp.json.return_value = {
                "candidates": [{
                    "finishReason": "STOP",
                    "content": {"parts": [{"text": json_module.dumps({"items": [{"raw_title": "POMME", "normalized_title": "Pomme", "category": "legumes"}]})}]},
                }]
            }
            return resp

        import json as json_module
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(side_effect=_post)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user())
        assert len(result["items"]) == 1
        assert result["items"][0]["raw_title"] == "POMME"

    @pytest.mark.anyio
    async def test_data_uri_prefix_stripped_transparently(self, monkeypatch):
        """Le frontend peut envoyer data:image/jpeg;base64,... — doit fonctionner."""
        import base64
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        raw = b"\xff\xd8\xff" + b"\x00" * 30
        b64_with_prefix = "data:image/jpeg;base64," + base64.b64encode(raw).decode()

        req = MagicMock()
        req.json = AsyncMock(return_value={"image": b64_with_prefix})

        resp = _gemini_ok_response([{"name": "Lait", "category": "frais"}])
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(req, _make_user())
        assert len(result["items"]) == 1


# ── _normalize_date ────────────────────────────────────────────────────────────

class TestNormalizeDate:
    def test_iso_unchanged(self):
        assert _normalize_date("2024-01-15") == "2024-01-15"

    def test_dmy_slash(self):
        assert _normalize_date("15/01/2024") == "2024-01-15"

    def test_dmy_dash(self):
        assert _normalize_date("15-01-2024") == "2024-01-15"

    def test_dmy_dot(self):
        assert _normalize_date("15.01.2024") == "2024-01-15"

    def test_none_returns_none(self):
        assert _normalize_date(None) is None

    def test_empty_returns_none(self):
        assert _normalize_date("") is None

    def test_invalid_returns_none(self):
        assert _normalize_date("not-a-date") is None

    def test_invalid_day_returns_none(self):
        assert _normalize_date("32/01/2024") is None


# ── _parse_receipt_json ────────────────────────────────────────────────────────

class TestParseReceiptJson:
    def test_new_format_parsed(self):
        text = json.dumps({
            "purchase_date": "2024-01-15",
            "items": [{"raw_title": "LAI", "name": "Lait", "category": "frais"}],
        })
        purchase_date, merchant, currency, items, ignored_items = _parse_receipt_json(text)
        assert purchase_date == "2024-01-15"
        assert merchant is None
        assert currency == "EUR"
        assert len(items) == 1
        assert items[0]["name"] == "Lait"
        assert ignored_items == []

    def test_new_format_null_date(self):
        text = json.dumps({"purchase_date": None, "items": []})
        purchase_date, _, _, items, _ = _parse_receipt_json(text)
        assert purchase_date is None
        assert items == []

    def test_old_format_array_compat(self):
        text = json.dumps([{"name": "Lait", "category": "frais"}])
        purchase_date, merchant, currency, items, ignored_items = _parse_receipt_json(text)
        assert purchase_date is None
        assert merchant is None
        assert currency == "EUR"
        assert len(items) == 1
        assert ignored_items == []

    def test_markdown_json_block_stripped(self):
        text = '```json\n{"purchase_date": "2024-03-10", "items": []}\n```'
        purchase_date, _, _, items, _ = _parse_receipt_json(text)
        assert purchase_date == "2024-03-10"
        assert items == []

    def test_markdown_plain_block_stripped(self):
        text = '```\n{"purchase_date": null, "items": []}\n```'
        purchase_date, _, _, items, _ = _parse_receipt_json(text)
        assert purchase_date is None
        assert items == []

    def test_markdown_single_backtick_no_closing(self):
        # BUG-005 : une seule ``` d'ouverture sans fermeture → pas d'IndexError
        text = '```json\n{"purchase_date": "2024-06-01", "items": []}'
        purchase_date, _, _, items, _ = _parse_receipt_json(text)
        assert purchase_date == "2024-06-01"
        assert items == []

    def test_invalid_json_raises(self):
        with pytest.raises(OcrApiError) as exc_info:
            _parse_receipt_json("not json {{{")
        assert exc_info.value.http_status == 502

    def test_non_dict_non_list_raises(self):
        with pytest.raises(OcrApiError):
            _parse_receipt_json('"just a string"')

    def test_dmy_date_normalized(self):
        text = json.dumps({"purchase_date": "15/01/2024", "items": []})
        purchase_date, _, _, _, _ = _parse_receipt_json(text)
        assert purchase_date == "2024-01-15"


# ── _compute_expiry ────────────────────────────────────────────────────────────

class TestComputeExpiry:
    def test_valid_date_and_days(self):
        assert _compute_expiry("2024-01-15", 7) == "2024-01-22"

    def test_leap_year(self):
        assert _compute_expiry("2024-02-25", 5) == "2024-03-01"

    def test_one_year(self):
        # 2024 est bissextile → +365j depuis jan donne jan de l'année suivante - 1 jour
        assert _compute_expiry("2024-01-15", 365) == "2025-01-14"

    def test_null_date_falls_back_to_today(self):
        with patch("ocr_service.utc_now") as mock_utc_now:
            mock_utc_now.return_value = datetime(2024, 1, 15, tzinfo=timezone.utc)
            assert _compute_expiry(None, 7) == "2024-01-22"

    def test_null_days_returns_none(self):
        assert _compute_expiry("2024-01-15", None) is None

    def test_invalid_date_falls_back_to_today(self):
        with patch("ocr_service.utc_now") as mock_utc_now:
            mock_utc_now.return_value = datetime(2024, 1, 15, tzinfo=timezone.utc)
            assert _compute_expiry("not-a-date", 7) == "2024-01-22"

    def test_zero_days_returns_same_date(self):
        assert _compute_expiry("2024-01-15", 0) is None  # 0 est falsy


# ── _enrich_normalizations ─────────────────────────────────────────────────────

class TestEnrichNormalizations:
    @pytest.mark.anyio
    async def test_upsert_called_per_item_with_raw_title(self):
        col = MagicMock()
        col.update_one = AsyncMock()
        items = [
            {"raw_title": "LAI 1/2 ECR", "name": "Lait demi-écrémé", "category": "frais"},
            {"raw_title": "PATES 500G", "name": "Pâtes", "category": "feculents"},
        ]
        await _enrich_normalizations(col, items)
        assert col.update_one.call_count == 2
        # Vérifie que le raw_title est mis en minuscule
        first_call_filter = col.update_one.call_args_list[0][0][0]
        assert first_call_filter == {"raw_title": "lai 1/2 ecr"}

    @pytest.mark.anyio
    async def test_empty_raw_title_skipped(self):
        col = MagicMock()
        col.update_one = AsyncMock()
        items = [
            {"raw_title": "", "name": "Lait", "category": "frais"},
            {"name": "Pâtes", "category": "feculents"},  # pas de raw_title
        ]
        await _enrich_normalizations(col, items)
        col.update_one.assert_not_called()

    @pytest.mark.anyio
    async def test_normalized_name_stored(self):
        col = MagicMock()
        col.update_one = AsyncMock()
        items = [{"raw_title": "LAI BIO 1L", "name": "Lait bio 1L", "category": "frais"}]
        await _enrich_normalizations(col, items)
        _, kwargs = col.update_one.call_args
        update_doc = col.update_one.call_args[0][1]
        assert update_doc["$set"]["normalized_name"] == "Lait bio 1L"
        assert update_doc["$set"]["category"] == "frais"
        assert update_doc["$inc"]["seen_count"] == 1


# ── _normalize_receipt_item — brand + quantity ────────────────────────────────

class TestNormalizeReceiptItemBrandQuantity:
    def _base_item(self, **kwargs) -> dict:
        base = {
            "raw_title": "LAIT BIO 1L",
            "normalized_title": "Lait bio 1L",
            "is_food": True,
            "category": "frais",
        }
        base.update(kwargs)
        return base

    def test_brand_extracted_when_present(self):
        item = self._base_item(brand="Lactel")
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] == "Lactel"

    def test_brand_stripped(self):
        item = self._base_item(brand="  Danone  ")
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] == "Danone"

    def test_brand_absent_returns_none(self):
        item = self._base_item()
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] is None

    def test_brand_whitespace_only_returns_none(self):
        item = self._base_item(brand="   ")
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] is None

    def test_brand_non_string_returns_none(self):
        item = self._base_item(brand=42)
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] is None

    def test_quantity_integer_preserved(self):
        item = self._base_item(quantity=3)
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["quantity"] == 3

    def test_quantity_float_preserved(self):
        item = self._base_item(quantity=1.5)
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["quantity"] == 1.5

    def test_quantity_absent_defaults_to_1(self):
        item = self._base_item()
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["quantity"] == 1

    def test_quantity_invalid_string_defaults_to_1(self):
        item = self._base_item(quantity="deux")
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["quantity"] == 1

    def test_brand_and_quantity_together(self):
        item = self._base_item(brand="Yoplait", quantity=4)
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["brand"] == "Yoplait"
        assert result["quantity"] == 4


# ── _default_zone_from_shelf / storage_zone (BUG-060) ───────────────────────────

class TestDefaultZoneFromShelf:
    def test_fridge_priority(self):
        assert _default_zone_from_shelf({"fridge": 7, "pantry": 365, "freezer": None}) == "frigo"

    def test_pantry_when_no_fridge(self):
        assert _default_zone_from_shelf({"fridge": None, "pantry": 180, "freezer": None}) == "placard"

    def test_freezer_when_only_freezer(self):
        assert _default_zone_from_shelf({"fridge": None, "pantry": None, "freezer": 90}) == "congelateur"

    def test_pantry_fallback_when_nothing_known(self):
        assert _default_zone_from_shelf({"fridge": None, "pantry": None, "freezer": None}) == "placard"


class TestNormalizeReceiptItemStorageZone:
    def test_chips_category_gets_pantry_zone_not_fridge(self):
        # Régression BUG-059/060 : un produit d'épicerie sèche (ex. chips) ne
        # doit jamais recevoir la zone frigo, quel que soit le reste du ticket.
        item = {"raw_title": "CHIPS TRUFFE", "normalized_title": "Chips pomme de terre truffe", "category": "epicerie"}
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["storage_zone"] == "placard"

    def test_fresh_category_gets_fridge_zone(self):
        item = {"raw_title": "LAIT 1L", "normalized_title": "Lait demi-écrémé", "category": "frais"}
        result = _normalize_receipt_item(item, None)
        assert result is not None
        assert result["storage_zone"] == "frigo"


# ── enrichissement food_defaults (BUG-060) ──────────────────────────────────────

class TestOcrReceiptFoodDefaultsEnrichment:
    @pytest.mark.anyio
    async def test_enrich_called_when_food_defaults_col_provided(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        products = [{"name": "Chips pomme de terre truffe", "category": "epicerie"}]
        resp = _gemini_ok_response(products)
        food_defaults_col = MagicMock()
        with patch("ocr_service.httpx.AsyncClient") as mock_client, \
             patch("ocr_service.enrich_food_defaults_from_static", new=AsyncMock()) as mock_enrich:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            await ocr_receipt(_make_request(), _make_user(), food_defaults_col=food_defaults_col)
        mock_enrich.assert_awaited_once()
        assert mock_enrich.await_args.args[0] is food_defaults_col

    @pytest.mark.anyio
    async def test_enrich_not_called_when_food_defaults_col_absent(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        products = [{"name": "Chips pomme de terre truffe", "category": "epicerie"}]
        resp = _gemini_ok_response(products)
        with patch("ocr_service.httpx.AsyncClient") as mock_client, \
             patch("ocr_service.enrich_food_defaults_from_static", new=AsyncMock()) as mock_enrich:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            await ocr_receipt(_make_request(), _make_user())
        mock_enrich.assert_not_awaited()

    @pytest.mark.anyio
    async def test_enrich_failure_does_not_break_ocr_receipt(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        products = [{"name": "Chips pomme de terre truffe", "category": "epicerie"}]
        resp = _gemini_ok_response(products)
        food_defaults_col = MagicMock()
        with patch("ocr_service.httpx.AsyncClient") as mock_client, \
             patch("ocr_service.enrich_food_defaults_from_static", new=AsyncMock(side_effect=RuntimeError("boom"))):
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await ocr_receipt(_make_request(), _make_user(), food_defaults_col=food_defaults_col)
        assert len(result["items"]) == 1
