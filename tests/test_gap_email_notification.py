"""
Tests de non-régression : envoi d'email gap-recette et flag suggest_later.

Scénarios couverts :
  1. Destination par défaut = keepeatfe@gmail.com
  2. RECIPE_GAP_EMAIL_TO surcharge la destination
  3. Le corps de l'email contient les ingrédients non couverts
  4. Le sujet de l'email mentionne "KeepEat"
  5. Pas d'email si le seuil d'occurrences n'est pas atteint
  6. Email envoyé quand l'occurrence est un multiple du seuil
  7. suggest_later=True quand KEEPEAT_OPENAI_TOKEN est absent
  8. suggest_later=True quand OpenAI ne retourne pas de recette valide
  9. suggest_later=False et recette présente quand OpenAI réussit
  10. suggest_later=True quand asyncio.TimeoutError (timeout 10 s)
"""

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from server import _send_recipe_gap_email, get_recipe_suggestions
from starlette.responses import Response


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _gap_doc(occurrence_count: int = 1, **kwargs) -> dict:
    return {
        "signature": "test-sig",
        "filter": "all",
        "status": "pending",
        "occurrence_count": occurrence_count,
        "available_ingredients": ["poulet", "tomate", "courgette"],
        "normalized_ingredients": ["poulet", "tomate", "courgette"],
        "last_seen_at": "2026-04-08T12:00:00+00:00",
        **kwargs,
    }


class _EmptyRecipesCursor:
    async def to_list(self, length=1000):
        return []


class _EmptyRecipesCollection:
    def find(self, *_a, **_kw):
        return _EmptyRecipesCursor()


# ─── Tests envoi email ─────────────────────────────────────────────────────────

class SendRecipeGapEmailTests(unittest.TestCase):
    """Vérifie que _send_recipe_gap_email appelle _send_email correctement."""

    def test_destination_par_defaut_est_keepeatfe_gmail(self):
        """Sans RECIPE_GAP_EMAIL_TO, l'email doit partir vers keepeatfe@gmail.com."""
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                env = {k: v for k, v in os.environ.items() if k != "RECIPE_GAP_EMAIL_TO"}
                with patch.dict(os.environ, env, clear=True):
                    await _send_recipe_gap_email(_gap_doc(), is_new=True)
                return mock_send

        mock_send = asyncio.run(_run())
        mock_send.assert_awaited_once()
        destinataire = mock_send.call_args[0][0]
        self.assertEqual(destinataire, "keepeatfe@gmail.com")

    def test_recipe_gap_email_to_surcharge_destination(self):
        """RECIPE_GAP_EMAIL_TO doit remplacer la destination par défaut."""
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                with patch.dict(os.environ, {"RECIPE_GAP_EMAIL_TO": "admin@monapp.fr"}):
                    await _send_recipe_gap_email(_gap_doc(), is_new=True)
                return mock_send

        mock_send = asyncio.run(_run())
        destinataire = mock_send.call_args[0][0]
        self.assertEqual(destinataire, "admin@monapp.fr")

    def test_corps_contient_les_ingredients(self):
        """Le corps HTML de l'email doit lister les ingrédients non couverts."""
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                env = {k: v for k, v in os.environ.items() if k != "RECIPE_GAP_EMAIL_TO"}
                with patch.dict(os.environ, env, clear=True):
                    await _send_recipe_gap_email(_gap_doc(), is_new=True)
                return mock_send

        mock_send = asyncio.run(_run())
        corps_html = mock_send.call_args[0][2]
        self.assertIn("poulet", corps_html)
        self.assertIn("tomate", corps_html)
        self.assertIn("courgette", corps_html)

    def test_sujet_mentionne_keepeat(self):
        """Le sujet de l'email doit contenir 'KeepEat'."""
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                env = {k: v for k, v in os.environ.items() if k != "RECIPE_GAP_EMAIL_TO"}
                with patch.dict(os.environ, env, clear=True):
                    await _send_recipe_gap_email(_gap_doc(), is_new=True)
                return mock_send

        mock_send = asyncio.run(_run())
        sujet = mock_send.call_args[0][1]
        self.assertIn("KeepEat", sujet)

    def test_pas_email_si_seuil_non_atteint(self):
        """Pas d'email quand occurrence_count n'est pas un multiple du seuil (is_new=False)."""
        # seuil=3, occurrence=2 → 2 % 3 != 0 → silence
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                with patch.dict(os.environ, {"RECIPE_GAP_EMAIL_THRESHOLD": "3"}):
                    await _send_recipe_gap_email(_gap_doc(occurrence_count=2), is_new=False)
                return mock_send

        mock_send = asyncio.run(_run())
        mock_send.assert_not_awaited()

    def test_email_envoye_quand_seuil_atteint(self):
        """Email envoyé quand occurrence_count est un multiple du seuil (is_new=False)."""
        # seuil=3, occurrence=3 → 3 % 3 == 0 → envoi
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                with patch.dict(os.environ, {"RECIPE_GAP_EMAIL_THRESHOLD": "3"}):
                    await _send_recipe_gap_email(_gap_doc(occurrence_count=3), is_new=False)
                return mock_send

        mock_send = asyncio.run(_run())
        mock_send.assert_awaited_once()

    def test_email_toujours_envoye_si_is_new_true(self):
        """Pour un nouveau gap (is_new=True), l'email est toujours envoyé peu importe le seuil."""
        async def _run():
            with patch("server._send_email", new_callable=AsyncMock) as mock_send:
                with patch.dict(os.environ, {"RECIPE_GAP_EMAIL_THRESHOLD": "99"}):
                    await _send_recipe_gap_email(_gap_doc(occurrence_count=1), is_new=True)
                return mock_send

        mock_send = asyncio.run(_run())
        mock_send.assert_awaited_once()


# ─── Tests suggest_later dans /api/recipes/suggestions ────────────────────────

class SuggestLaterFlagTests(unittest.TestCase):
    """Vérifie le flag suggest_later dans la réponse de l'endpoint."""

    def test_suggest_later_true_quand_pas_de_cle_openai(self):
        """suggest_later=True si KEEPEAT_OPENAI_TOKEN absent et catalogue vide."""
        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}])):
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)):
                        env = {k: v for k, v in os.environ.items() if k != "KEEPEAT_OPENAI_TOKEN"}
                        with patch.dict(os.environ, env, clear=True):
                            return await get_recipe_suggestions(
                                response=Response(),
                                recipe_filter="all",
                                include_meta=True,
                                current_user={"id": "u1"},
                            )

        payload = asyncio.run(_run())
        self.assertEqual(payload["recipes"], [])
        self.assertTrue(payload["meta"]["suggest_later"])

    def test_suggest_later_true_quand_openai_retourne_none(self):
        """suggest_later=True si OpenAI est appelé mais ne retourne aucune recette valide."""
        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}])):
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)):
                        with patch("server._ai_gap_fill", AsyncMock(return_value=None)):
                            with patch.dict(os.environ, {"KEEPEAT_OPENAI_TOKEN": "sk-test"}):
                                return await get_recipe_suggestions(
                                    response=Response(),
                                    recipe_filter="all",
                                    include_meta=True,
                                    current_user={"id": "u1"},
                                )

        payload = asyncio.run(_run())
        self.assertEqual(payload["recipes"], [])
        self.assertTrue(payload["meta"]["suggest_later"])

    def test_suggest_later_false_et_recette_presente_quand_openai_reussit(self):
        """suggest_later=False et recette retournée quand OpenAI génère avec succès."""
        recette_ia = {
            "id": "ai-soupe-tomate-abc123",
            "title": "Soupe de tomate",
            "description": "Cuire les tomates.",
            "available_count": 1,
            "missing_count": 0,
            "score": 10,
            "is_ai": True,
        }

        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}])):
                    with patch("server._ai_gap_fill", AsyncMock(return_value={"title": "Soupe de tomate"})):
                        with patch("server._save_ai_recipe_to_stores", AsyncMock(return_value=recette_ia)):
                            with patch.dict(os.environ, {"KEEPEAT_OPENAI_TOKEN": "sk-test"}):
                                return await get_recipe_suggestions(
                                    response=Response(),
                                    recipe_filter="all",
                                    include_meta=True,
                                    current_user={"id": "u1"},
                                )

        payload = asyncio.run(_run())
        self.assertFalse(payload["meta"]["suggest_later"])
        self.assertEqual(len(payload["recipes"]), 1)
        self.assertEqual(payload["recipes"][0]["title"], "Soupe de tomate")

    def test_suggest_later_true_sur_timeout_openai(self):
        """suggest_later=True quand asyncio.TimeoutError (timeout 10 s dépassé)."""
        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}])):
                    with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)):
                        # Simule un TimeoutError levé par asyncio.wait_for
                        with patch("server.asyncio.wait_for", new_callable=AsyncMock,
                                   side_effect=asyncio.TimeoutError()):
                            with patch.dict(os.environ, {"KEEPEAT_OPENAI_TOKEN": "sk-test"}):
                                return await get_recipe_suggestions(
                                    response=Response(),
                                    recipe_filter="all",
                                    include_meta=True,
                                    current_user={"id": "u1"},
                                )

        payload = asyncio.run(_run())
        self.assertEqual(payload["recipes"], [])
        self.assertTrue(payload["meta"]["suggest_later"])

    def test_upsert_gap_appele_quand_openai_echoue(self):
        """_upsert_recipe_gap doit être appelé quand OpenAI ne fournit pas de recette."""
        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "tomate"}])):
                    with patch("server._ai_gap_fill", AsyncMock(return_value=None)):
                        with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)) as mock_gap:
                            with patch.dict(os.environ, {"KEEPEAT_OPENAI_TOKEN": "sk-test"}):
                                await get_recipe_suggestions(
                                    response=Response(),
                                    recipe_filter="all",
                                    include_meta=True,
                                    current_user={"id": "u1"},
                                )
                            return mock_gap

        mock_gap = asyncio.run(_run())
        mock_gap.assert_awaited_once()

    def test_upsert_gap_non_appele_quand_openai_reussit(self):
        """_upsert_recipe_gap NE doit PAS être appelé quand OpenAI retourne une recette."""
        recette_ia = {"id": "ai-test", "title": "Tarte aux légumes", "available_count": 1,
                      "missing_count": 0, "score": 10}

        async def _run():
            with patch("server.recipes_col", _EmptyRecipesCollection()):
                with patch("server._fetch_stock_candidates", AsyncMock(return_value=[{"name": "courgette"}])):
                    with patch("server._ai_gap_fill", AsyncMock(return_value={"title": "Tarte"})):
                        with patch("server._save_ai_recipe_to_stores", AsyncMock(return_value=recette_ia)):
                            with patch("server._upsert_recipe_gap", AsyncMock(return_value=True)) as mock_gap:
                                with patch.dict(os.environ, {"KEEPEAT_OPENAI_TOKEN": "sk-test"}):
                                    await get_recipe_suggestions(
                                        response=Response(),
                                        recipe_filter="all",
                                        include_meta=True,
                                        current_user={"id": "u1"},
                                    )
                                return mock_gap

        mock_gap = asyncio.run(_run())
        mock_gap.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
