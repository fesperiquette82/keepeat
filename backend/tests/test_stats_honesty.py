"""Non-régression BUG-071 — indicateurs qui mesurent ce qu'ils annoncent.

Deux écarts relevés par la revue externe du 08/09/2026 :
  - `_compute_streak` comptait les jours sans jet enregistré sans tenir compte
    de l'ancienneté du compte : un compte créé le jour même, vide, affichait
    « 60 jours sans gaspillage » — l'absence de saisie était comptée comme une
    absence de gaspillage ;
  - le paywall construisait l'argumentaire Premium à partir des droits
    **courants** de l'utilisateur, si bien qu'un compte gratuit lisait ses
    propres limites gratuites (8) présentées comme l'offre Premium (200).
"""

import asyncio
import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

from backend import server
from backend.app_core import utc_now


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def _gen():
            for doc in self._docs:
                yield doc

        return _gen()


class _FakeStockCol:
    def __init__(self, thrown_days=()):
        self._thrown_days = list(thrown_days)

    def aggregate(self, pipeline):
        _ = pipeline
        return _FakeCursor([{"_id": day} for day in self._thrown_days])


def _streak(thrown_days=(), first_activity=None):
    async def _run():
        with patch.object(server, "stock_col", _FakeStockCol(thrown_days)):
            return await server._compute_streak(["user-1"], first_activity)

    return asyncio.run(_run())


class ComputeStreakTests(unittest.TestCase):
    def test_brand_new_account_does_not_claim_sixty_days(self):
        """[REGRESSION] BUG-071 — un compte créé aujourd'hui, sans le moindre
        produit, affichait 60 jours sans gaspillage."""
        today_iso = utc_now().isoformat()
        self.assertEqual(_streak(first_activity=today_iso), 1)

    def test_streak_is_capped_by_account_age(self):
        five_days_ago = (utc_now() - timedelta(days=4)).isoformat()
        self.assertEqual(_streak(first_activity=five_days_ago), 5)

    def test_old_account_without_waste_reaches_the_ceiling(self):
        one_year_ago = (utc_now() - timedelta(days=365)).isoformat()
        self.assertEqual(_streak(first_activity=one_year_ago), 60)

    def test_a_thrown_item_breaks_the_streak(self):
        one_year_ago = (utc_now() - timedelta(days=365)).isoformat()
        yesterday = (utc_now() - timedelta(days=1)).strftime("%Y-%m-%d")
        self.assertEqual(_streak(thrown_days=[yesterday], first_activity=one_year_ago), 1)

    def test_missing_or_invalid_creation_date_keeps_previous_behaviour(self):
        """Un compte sans date de création exploitable ne doit pas afficher 0."""
        self.assertEqual(_streak(first_activity=None), 60)
        self.assertEqual(_streak(first_activity="pas-une-date"), 60)


class PrivacyAndScoreWordingTests(unittest.TestCase):
    def test_score_wording_matches_the_actual_formula(self):
        """[REGRESSION] BUG-071 — l'écran annonçait « consommés avant
        péremption » alors que la formule est consommés / (consommés + jetés),
        qui ne compare aucune date."""
        screen = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "app"
            / "(tabs)"
            / "stats.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("consommés plutôt que jetés", screen)
        self.assertNotIn("% de produits consommés avant péremption", screen)


if __name__ == "__main__":
    unittest.main()
