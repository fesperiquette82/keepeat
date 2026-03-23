from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("keepeat-backend")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def serialize_mongo(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Convert Mongo _id to string id and remove internal fields."""
    if not doc:
        return doc
    out = dict(doc)
    mongo_id = out.pop("_id", None)
    if mongo_id is not None:
        out["id"] = str(mongo_id)
    return out


def parse_date_yyyy_mm_dd(value: str | None) -> datetime | None:
    """Parse YYYY-MM-DD into UTC datetime (00:00). Returns None if invalid."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def days_until(expiry_date: str | None) -> int | None:
    """Return days until expiry from YYYY-MM-DD (can be negative)."""
    dt = parse_date_yyyy_mm_dd(expiry_date)
    if not dt:
        return None
    today = utc_now().date()
    return (dt.date() - today).days


def redirect_html(title: str, icon: str, heading: str, description: str, deep_link: str) -> str:
    return f"""<!DOCTYPE html>
<html lang=\"fr\"><head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>{title}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}}
    .card{{background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center}}
    .icon{{font-size:52px;margin-bottom:20px}}
    h1{{font-size:22px;font-weight:700;margin-bottom:12px}}
    p{{color:#888;font-size:14px;line-height:1.6;margin-bottom:28px}}
    .btn{{display:block;background:#22c55e;color:#fff;text-decoration:none;border-radius:12px;padding:16px 24px;font-weight:700;font-size:16px;margin-bottom:16px}}
    .note{{color:#555;font-size:12px;line-height:1.5}}
  </style>
</head><body>
  <div class=\"card\">
    <div class=\"icon\">{icon}</div>
    <h1>{heading}</h1>
    <p>{description}</p>
    <a href=\"{deep_link}\" class=\"btn\">Ouvrir KeepEat</a>
    <p class=\"note\">Si l'application ne s'ouvre pas automatiquement, assurez-vous qu'elle est installée sur votre appareil mobile.</p>
  </div>
  <script>setTimeout(function(){{window.location.href=\"{deep_link}\";}},600);</script>
</body></html>"""
