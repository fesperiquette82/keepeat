from __future__ import annotations

from typing import Any


def build_priority_refresh_state(
    previous_state: dict[str, Any] | None,
    *,
    succeeded: bool,
    last_refresh_at: str,
    item_ids: list[str],
    count: int,
    lead_days: int,
    reminders_enabled: bool,
) -> dict[str, Any]:
    if not succeeded:
        return dict(previous_state or {})

    return {
        "last_refresh_at": last_refresh_at,
        "item_ids": item_ids,
        "count": count,
        "lead_days": lead_days,
        "reminders_enabled": reminders_enabled,
    }

