"""Tests de non-régression — build_activation_funnel (BUG-039).

Constat de l'audit commercial (point « voir ce qui se passe ») : les
événements métier (user_registered, product_added, ocr_scan_succeeded,
premium_paywall_viewed, premium_checkout_succeeded) étaient déjà écrits en
base par track_business_event, mais jamais relus en agrégat — aucune vue
n'existait pour répondre aux questions concrètes du produit : combien de
nouveaux inscrits ajoutent un premier produit ? scannent un ticket ? voient le
paywall ? achètent ?

build_activation_funnel comble cet écart en réutilisant les événements déjà
collectés (aucune nouvelle instrumentation nécessaire), scopés à la cohorte
des utilisateurs inscrits sur la période demandée.
"""
import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from observability import build_activation_funnel


class _FakeUsersCol:
    def __init__(self, ids):
        self._ids = ids

    async def distinct(self, field, query):
        assert field == "_id"
        assert "created_at" in query
        return list(self._ids)


class _FakeBusinessEventsCol:
    def __init__(self, users_by_event):
        self._users_by_event = users_by_event

    async def distinct(self, field, query):
        assert field == "user_id"
        event_name = query["event_name"]
        allowed = set(query["user_id"]["$in"])
        return [uid for uid in self._users_by_event.get(event_name, []) if uid in allowed]


def test_no_registrations_returns_zeroed_funnel_without_querying_events():
    users_col = _FakeUsersCol([])
    business_events_col = _FakeBusinessEventsCol({"product_added": ["u1"]})

    result = asyncio.run(build_activation_funnel(
        users_col=users_col,
        business_events_col=business_events_col,
        start_iso="2026-01-01T00:00:00+00:00",
        end_iso="2026-01-31T23:59:59+00:00",
    ))

    assert result["registered"] == 0
    assert result["added_product"] == 0
    assert result["rates"] == {
        "added_product": 0.0, "scanned_receipt": 0.0, "viewed_paywall": 0.0, "purchased": 0.0,
    }


def test_computes_stage_counts_and_rates_scoped_to_registered_cohort():
    # 4 inscrits sur la période. u5 a déclenché des événements mais ne fait
    # PAS partie de la cohorte (inscrit avant la période, ou après) : il ne
    # doit compter dans aucun étage du funnel.
    users_col = _FakeUsersCol(["u1", "u2", "u3", "u4"])
    business_events_col = _FakeBusinessEventsCol({
        "product_added": ["u1", "u2", "u5"],
        "ocr_scan_succeeded": ["u1"],
        "premium_paywall_viewed": ["u1", "u3"],
        "premium_checkout_succeeded": ["u1"],
    })

    result = asyncio.run(build_activation_funnel(
        users_col=users_col,
        business_events_col=business_events_col,
        start_iso="2026-01-01T00:00:00+00:00",
        end_iso="2026-01-31T23:59:59+00:00",
    ))

    assert result["registered"] == 4
    assert result["added_product"] == 2
    assert result["scanned_receipt"] == 1
    assert result["viewed_paywall"] == 2
    assert result["purchased"] == 1
    assert result["rates"]["added_product"] == 0.5
    assert result["rates"]["scanned_receipt"] == 0.25
    assert result["rates"]["viewed_paywall"] == 0.5
    assert result["rates"]["purchased"] == 0.25


def test_no_events_at_all_yields_full_registered_cohort_with_zero_stages():
    users_col = _FakeUsersCol(["u1", "u2"])
    business_events_col = _FakeBusinessEventsCol({})

    result = asyncio.run(build_activation_funnel(
        users_col=users_col,
        business_events_col=business_events_col,
        start_iso="2026-01-01T00:00:00+00:00",
        end_iso="2026-01-31T23:59:59+00:00",
    ))

    assert result["registered"] == 2
    assert result["added_product"] == 0
    assert result["purchased"] == 0
    assert result["rates"]["purchased"] == 0.0
