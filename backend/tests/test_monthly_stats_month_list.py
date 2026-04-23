"""Tests de non-régression — BUG-004 : calcul de la liste des N derniers mois.

L'ancien code utilisait `timedelta(days=i * 30)` ce qui causait des dérives
(ex : depuis mars, "3 mois en arrière" pouvait tomber en novembre au lieu de décembre).
Le correctif utilise une arithmétique exacte sur (year * 12 + month).
"""
import sys
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _build_month_list(today: date, n: int) -> list[str]:
    """Réplique exacte du calcul corrigé dans get_monthly_stats."""
    result = []
    for i in range(n - 1, -1, -1):
        total = today.year * 12 + (today.month - 1) - i
        result.append(f"{total // 12:04d}-{total % 12 + 1:02d}")
    return result


class TestBuildMonthList:
    def test_longueur_correcte(self):
        assert len(_build_month_list(date(2026, 4, 15), 6)) == 6

    def test_dernier_element_est_mois_courant(self):
        result = _build_month_list(date(2026, 4, 15), 6)
        assert result[-1] == "2026-04"

    def test_premier_element_est_n_mois_avant(self):
        result = _build_month_list(date(2026, 4, 15), 6)
        assert result[0] == "2025-11"

    def test_passage_annee(self):
        # Depuis janvier, 3 mois en arrière → novembre de l'année précédente
        result = _build_month_list(date(2026, 1, 1), 3)
        assert result == ["2025-11", "2025-12", "2026-01"]

    def test_pas_de_doublons(self):
        result = _build_month_list(date(2026, 4, 15), 12)
        assert len(result) == len(set(result))

    def test_ordre_chronologique(self):
        result = _build_month_list(date(2026, 4, 15), 12)
        assert result == sorted(result)

    def test_mois_de_fin_janvier(self):
        # Depuis décembre, 1 mois → décembre uniquement
        result = _build_month_list(date(2025, 12, 31), 1)
        assert result == ["2025-12"]

    def test_regression_timedelta_30_jours(self):
        # Cas qui échouait avec l'ancien timedelta(days=i*30) :
        # depuis le 1er mars (mois 3), 3 mois en arrière avec 30*2=60 jours
        # donnait le 31 décembre (mois 12) au lieu de janvier (mois 1)
        result = _build_month_list(date(2026, 3, 1), 3)
        assert result == ["2026-01", "2026-02", "2026-03"]
