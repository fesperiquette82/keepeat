import asyncio
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alerts import AlertDependencies, _resolve_alert_prefs, check_daily_expiry_alert


class _AsyncCursor:
    def __init__(self, items):
        self._items = items

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, n):
        self._items = self._items[:n]
        return self

    async def to_list(self, length=1000):
        return self._items[:length]

    def __aiter__(self):
        self._iter = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _UsersCol:
    def __init__(self, users):
        self._users = users

    def find(self, *_args, **_kwargs):
        return _AsyncCursor(self._users)


class _StockCol:
    def __init__(self, items_by_user):
        self._items_by_user = items_by_user

    def find(self, query, *_args, **_kwargs):
        user_id = query.get("user_id")
        return _AsyncCursor(self._items_by_user.get(user_id, []))


class _UserAlertsCol:
    def __init__(self):
        self.inserted = []

    async def find_one(self, *_args, **_kwargs):
        return None

    async def insert_one(self, doc):
        self.inserted.append(doc)


class _DummyCol:
    async def update_one(self, *_args, **_kwargs):
        return None


class AlertsPreferencesTests(unittest.TestCase):
    def test_resolve_alert_prefs_defaults(self):
        prefs = _resolve_alert_prefs({})
        self.assertEqual(
            prefs,
            {"alertJ2": True, "alertJ0": True, "alertWeekly": False, "alertRecall": True},
        )

    def test_daily_alert_is_skipped_when_j0_and_j2_are_disabled(self):
        users_col = _UsersCol([
            {"_id": "u1", "push_tokens": ["ExpoPushToken[test]"], "alert_prefs": {"alertJ0": False, "alertJ2": False}},
        ])
        stock_col = _StockCol({
            "u1": [{"name": "Lait", "expiry_date": "2099-01-01"}],
        })
        user_alerts_col = _UserAlertsCol()
        sent_payloads = []

        async def _send_push(tokens, title, body, data=None):
            sent_payloads.append({"tokens": tokens, "title": title, "body": body, "data": data})

        deps = AlertDependencies(
            users_col=users_col,
            stock_col=stock_col,
            user_alerts_col=user_alerts_col,
            app_state_col=_DummyCol(),
            products_cache_col=_DummyCol(),
            community_recipes_col=_DummyCol(),
            send_push=_send_push,
            fr_to_en_ingredient=lambda name, _cat: name,
        )

        asyncio.run(check_daily_expiry_alert(deps))
        self.assertEqual(sent_payloads, [])
        self.assertEqual(user_alerts_col.inserted, [])


if __name__ == "__main__":
    unittest.main()
