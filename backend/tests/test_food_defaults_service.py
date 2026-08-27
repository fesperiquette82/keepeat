"""Tests de non-régression — food_defaults_service.py (BUG-058/BUG-059 suite)

Cache-first (collection food_defaults) + résolution IA en dernier recours
uniquement sur cache-miss. Aucun appel réseau réel : httpx est mocké.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from food_defaults_service import (
    ACTION_NAME,
    SERVICE_NAME,
    _normalize_food_key,
    enrich_food_defaults_from_static,
    resolve_food_defaults,
)


class FakeFoodDefaultsCol:
    def __init__(self, seed: dict[str, dict] | None = None):
        self.docs: dict[str, dict] = {k: dict(v) for k, v in (seed or {}).items()}

    async def find_one(self, query):
        doc = self.docs.get(query.get("key"))
        return dict(doc) if doc is not None else None

    async def update_one(self, query, update, upsert=False):
        key = query.get("key")
        is_new = key not in self.docs
        if is_new:
            if not upsert:
                return None
            self.docs[key] = {"key": key}
        doc = self.docs[key]
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v
        if is_new:
            for k, v in update.get("$setOnInsert", {}).items():
                doc.setdefault(k, v)
        return None


class FakeServiceUsageLogsCol:
    def __init__(self, existing_count: int = 0):
        self.existing_count = existing_count
        self.inserted: list[dict] = []

    async def insert_one(self, doc):
        self.inserted.append(dict(doc))
        return None

    async def count_documents(self, query):
        assert query["service_name"] == SERVICE_NAME
        return self.existing_count


def _gemini_ok_response(payload: dict) -> MagicMock:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(payload)}]}}]
    }
    return resp


class TestNormalizeFoodKey:
    def test_strips_accents_and_case(self):
        assert _normalize_food_key("Chips Pomme de Terre Truffe") == "chips pomme de terre truffe"
        assert _normalize_food_key("Crème fraîche !!") == "creme fraiche"

    def test_empty_input(self):
        assert _normalize_food_key("") == ""
        assert _normalize_food_key(None) == ""  # type: ignore[arg-type]


class TestResolveFoodDefaultsCacheHit:
    @pytest.mark.anyio
    async def test_cache_hit_returns_cached_without_network_call(self):
        col = FakeFoodDefaultsCol(seed={
            "chips pomme de terre truffe": {
                "key": "chips pomme de terre truffe",
                "storage_zone": "placard",
                "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None},
                "source": "ai",
                "hit_count": 2,
            }
        })
        usage_col = FakeServiceUsageLogsCol()
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            result = await resolve_food_defaults(
                name="Chips pomme de terre truffe",
                food_category="epicerie",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key="fake-key",
            )
        mock_client.assert_not_called()
        assert result == {"storage_zone": "placard", "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None}}
        assert col.docs["chips pomme de terre truffe"]["hit_count"] == 3
        assert usage_col.inserted == []


class TestResolveFoodDefaultsCacheMiss:
    @pytest.mark.anyio
    async def test_gemini_success_upserts_cache_and_returns_result(self):
        col = FakeFoodDefaultsCol()
        usage_col = FakeServiceUsageLogsCol()
        resp = _gemini_ok_response({
            "storage_zone": "placard",
            "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None},
            "confidence": 0.9,
        })
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await resolve_food_defaults(
                name="Chips pomme de terre truffe",
                food_category="epicerie",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key="fake-key",
            )
        assert result == {"storage_zone": "placard", "shelf_life_days": {"fridge": None, "pantry": 180, "freezer": None}}
        cached = col.docs["chips pomme de terre truffe"]
        assert cached["source"] == "ai"
        assert cached["storage_zone"] == "placard"
        assert len(usage_col.inserted) == 1
        assert usage_col.inserted[0]["service_name"] == SERVICE_NAME
        assert usage_col.inserted[0]["action_name"] == ACTION_NAME

    @pytest.mark.anyio
    async def test_gemini_http_error_returns_none_without_raising(self):
        col = FakeFoodDefaultsCol()
        usage_col = FakeServiceUsageLogsCol()
        resp = MagicMock()
        resp.status_code = 500
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await resolve_food_defaults(
                name="Produit inconnu",
                food_category="autres",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key="fake-key",
            )
        assert result is None
        assert "produit inconnu" not in col.docs

    @pytest.mark.anyio
    async def test_gemini_invalid_json_returns_none_without_raising(self):
        col = FakeFoodDefaultsCol()
        usage_col = FakeServiceUsageLogsCol()
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not json"}]}}]
        }
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=resp)))
            mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await resolve_food_defaults(
                name="Produit inconnu",
                food_category="autres",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key="fake-key",
            )
        assert result is None

    @pytest.mark.anyio
    async def test_no_api_key_returns_none_without_network_call(self):
        col = FakeFoodDefaultsCol()
        usage_col = FakeServiceUsageLogsCol()
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            result = await resolve_food_defaults(
                name="Produit inconnu",
                food_category="autres",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key=None,
            )
        mock_client.assert_not_called()
        assert result is None


class TestResolveFoodDefaultsMonthlyCap:
    @pytest.mark.anyio
    async def test_monthly_cap_reached_skips_network_call(self, monkeypatch):
        monkeypatch.setenv("SERVICE_LIMIT_GEMINI_FOOD_DEFAULTS_REQUESTS_PER_MONTH", "10")
        col = FakeFoodDefaultsCol()
        usage_col = FakeServiceUsageLogsCol(existing_count=10)
        with patch("food_defaults_service.httpx.AsyncClient") as mock_client:
            result = await resolve_food_defaults(
                name="Produit inconnu",
                food_category="autres",
                food_defaults_col=col,
                service_usage_logs_col=usage_col,
                gemini_api_key="fake-key",
            )
        mock_client.assert_not_called()
        assert result is None
        assert usage_col.inserted == []


class TestEnrichFoodDefaultsFromStatic:
    @pytest.mark.anyio
    async def test_enriches_new_key_from_receipt_item(self):
        col = FakeFoodDefaultsCol()
        items = [{
            "normalized_title": "Chips pomme de terre truffe",
            "storage_zone": "placard",
            "shelf_life_fridge": None,
            "shelf_life_pantry": 180,
            "shelf_life_freezer": None,
        }]
        await enrich_food_defaults_from_static(col, items)
        doc = col.docs["chips pomme de terre truffe"]
        assert doc["source"] == "static_table"
        assert doc["storage_zone"] == "placard"

    @pytest.mark.anyio
    async def test_never_downgrades_an_ai_sourced_entry(self):
        col = FakeFoodDefaultsCol(seed={
            "chips pomme de terre truffe": {
                "key": "chips pomme de terre truffe",
                "storage_zone": "placard",
                "shelf_life_days": {"fridge": None, "pantry": 200, "freezer": None},
                "source": "ai",
            }
        })
        items = [{
            "normalized_title": "Chips pomme de terre truffe",
            "storage_zone": "frigo",  # catégorie fallback erronée, ne doit pas écraser l'IA
            "shelf_life_fridge": 7,
            "shelf_life_pantry": None,
            "shelf_life_freezer": None,
        }]
        await enrich_food_defaults_from_static(col, items)
        doc = col.docs["chips pomme de terre truffe"]
        assert doc["source"] == "ai"
        assert doc["storage_zone"] == "placard"
