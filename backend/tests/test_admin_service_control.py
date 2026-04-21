"""Tests de non-régression — admin_service_control.

Couvre les changements de migration OpenAI → Gemini :
- ocr_engine utilise désormais GEMINI_OCR_API_KEY (plus KEEPEAT_OPENAI_TOKEN)
- gemini_recipes est un nouveau service tracké (GEMINI_RECIPES_API_KEY)
- build_cost_recommendations retourne "Gemini 2.5-flash (Free)" comme plan OCR par défaut
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from admin_service_control import (
    SERVICE_REGISTRY,
    build_cost_recommendations,
    build_usage_metrics,
)


# ---------------------------------------------------------------------------
# SERVICE_REGISTRY — structure
# ---------------------------------------------------------------------------

class TestServiceRegistry:
    def _get(self, service_id: str):
        return next((s for s in SERVICE_REGISTRY if s["id"] == service_id), None)

    def test_ocr_engine_uses_gemini_key(self):
        svc = self._get("ocr_engine")
        assert svc is not None
        assert svc["enabled_env"] == "GEMINI_OCR_API_KEY", (
            "ocr_engine doit utiliser GEMINI_OCR_API_KEY, pas KEEPEAT_OPENAI_TOKEN"
        )

    def test_ocr_engine_old_openai_key_not_referenced(self):
        for svc in SERVICE_REGISTRY:
            assert svc.get("enabled_env") != "KEEPEAT_OPENAI_TOKEN", (
                f"Service '{svc['id']}' référence encore l'ancienne clé OpenAI"
            )

    def test_gemini_recipes_service_present(self):
        svc = self._get("gemini_recipes")
        assert svc is not None, "gemini_recipes doit être dans SERVICE_REGISTRY"
        assert svc["enabled_env"] == "GEMINI_RECIPES_API_KEY"
        assert svc["type"] == "external"

    def test_all_required_services_present(self):
        ids = {s["id"] for s in SERVICE_REGISTRY}
        for required in ("keepeat_backend_api", "mongodb", "openfoodfacts_api",
                         "ocr_engine", "gemini_recipes", "frontend_backend_connectivity"):
            assert required in ids, f"Service manquant dans le registre : {required}"

    def test_ocr_engine_name_updated(self):
        svc = self._get("ocr_engine")
        assert "openai" not in svc["name"].lower(), (
            "Le nom de ocr_engine ne doit plus mentionner OpenAI"
        )
        assert "gemini" in svc["name"].lower(), (
            "Le nom de ocr_engine doit mentionner Gemini"
        )


# ---------------------------------------------------------------------------
# build_cost_recommendations — plan OCR par défaut
# ---------------------------------------------------------------------------

class FakeUsageCollection:
    async def count_documents(self, _query):
        return 0


def _make_empty_usage_payload():
    return asyncio.run(build_usage_metrics(
        users_col=FakeUsageCollection(),
        stock_col=FakeUsageCollection(),
        service_usage_logs_col=FakeUsageCollection(),
    ))


class TestBuildCostRecommendations:
    def test_default_ocr_plan_is_gemini(self, monkeypatch):
        monkeypatch.delenv("MONITORING_OCR_CURRENT_PLAN", raising=False)
        usage = _make_empty_usage_payload()
        result = asyncio.run(build_cost_recommendations(usage_payload=usage))
        ocr_cost = next(c for c in result["costs"] if c["service_id"] == "ocr_engine")
        assert "gemini" in ocr_cost["current_plan"].lower(), (
            f"Le plan OCR par défaut doit mentionner Gemini, obtenu : {ocr_cost['current_plan']}"
        )
        assert "openai" not in ocr_cost["current_plan"].lower(), (
            "Le plan OCR par défaut ne doit plus mentionner OpenAI"
        )

    def test_ocr_plan_overridable_via_env(self, monkeypatch):
        monkeypatch.setenv("MONITORING_OCR_CURRENT_PLAN", "My Custom Plan")
        usage = _make_empty_usage_payload()
        result = asyncio.run(build_cost_recommendations(usage_payload=usage))
        ocr_cost = next(c for c in result["costs"] if c["service_id"] == "ocr_engine")
        assert ocr_cost["current_plan"] == "My Custom Plan"
