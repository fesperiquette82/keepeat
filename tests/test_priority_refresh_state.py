import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from priority_refresh import build_priority_refresh_state


class PriorityRefreshStateTests(unittest.TestCase):
    def test_keeps_previous_state_when_refresh_fails(self):
        previous = {
            "last_refresh_at": "2026-03-30T09:00:00+00:00",
            "item_ids": ["a", "b"],
            "count": 2,
            "lead_days": 2,
            "reminders_enabled": True,
        }

        state = build_priority_refresh_state(
            previous,
            succeeded=False,
            last_refresh_at="2026-03-31T09:00:00+00:00",
            item_ids=["c"],
            count=1,
            lead_days=3,
            reminders_enabled=False,
        )

        self.assertEqual(state, previous)

    def test_updates_timestamp_and_payload_when_refresh_succeeds(self):
        state = build_priority_refresh_state(
            None,
            succeeded=True,
            last_refresh_at="2026-03-31T09:00:00+00:00",
            item_ids=["x", "y", "z"],
            count=3,
            lead_days=3,
            reminders_enabled=True,
        )

        self.assertEqual(state["last_refresh_at"], "2026-03-31T09:00:00+00:00")
        self.assertEqual(state["item_ids"], ["x", "y", "z"])
        self.assertEqual(state["count"], 3)
        self.assertEqual(state["lead_days"], 3)
        self.assertTrue(state["reminders_enabled"])


if __name__ == "__main__":
    unittest.main()
