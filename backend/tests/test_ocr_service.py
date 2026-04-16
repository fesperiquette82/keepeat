"""Tests de non-régression — ocr_service.py

Couvre les fonctions pures et le comportement de ocr_receipt()
en mockant httpx pour éviter tout appel réseau.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ocr_service import (
    OcrApiError,
    _detect_mime_type,
    _extract_gemini_text,
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

    def test_unknown_falls_back_to_jpeg(self):
        raw = b"\x00\x00\x00\x00" * 10
        assert _detect_mime_type(self._b64(raw)) == "image/jpeg"

    def test_invalid_b64_falls_back(self):
        assert _detect_mime_type("not-valid!!!") == "image/jpeg"


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


def _gemini_ok_response(products: list) -> MagicMock:
    """Réponse Gemini 200 avec une liste de produits."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": json.dumps(products)}]},
        }]
    }
    return resp


class TestOcrReceiptMocked:
    """Tests de ocr_receipt() avec httpx mocké (pas d'appel réseau réel)."""

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
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 429

    @pytest.mark.anyio
    async def test_gemini_timeout_returns_504(self, monkeypatch):
        monkeypatch.setenv("GEMINI_OCR_API_KEY", "fake-key")
        import httpx as _httpx
        with patch("ocr_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(
                return_value=MagicMock(post=AsyncMock(side_effect=_httpx.TimeoutException("timeout")))
            )
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(OcrApiError) as exc_info:
                await ocr_receipt(_make_request(), _make_user())
        assert exc_info.value.http_status == 504

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
        assert result == []

    @pytest.mark.anyio
    async def test_nominal_success(self, monkeypatch):
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
        assert len(result) == 2
        assert result[0]["name"] == "Lait demi-écrémé"
        assert result[0]["category"] == "frais"
        assert result[0]["food_category"] == "frais"
        assert result[0]["shelf_life_fridge"] == 7
        assert result[1]["name"] == "Pâtes"
        assert result[1]["shelf_life_pantry"] == 365

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
        assert len(result) == 1
