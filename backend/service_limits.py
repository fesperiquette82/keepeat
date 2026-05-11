from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .app_core import utc_now


def _parse_int_env(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    token = raw.strip()
    if not token:
        return None
    try:
        value = int(token)
    except ValueError:
        return None
    return value if value >= 0 else None


def _first_non_empty_env(keys: list[str]) -> str | None:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return None


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month_start(now: datetime) -> datetime:
    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    return now.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)


def _day_start(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _status_for_usage(limit_value: int | None, usage: int | None) -> str:
    if limit_value is None or usage is None:
        return "unknown"
    if limit_value <= 0:
        return "critical"
    ratio = usage / limit_value
    if ratio >= 1.0:
        return "critical"
    if ratio >= 0.8:
        return "warning"
    return "ok"


async def build_external_services_quota_snapshot(*, service_usage_logs_col, api_request_logs_col) -> dict[str, Any]:
    now = utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    month_start = _month_start(now)
    next_month_start = _next_month_start(now)
    day_start = _day_start(now)

    async def _usage_from_service_logs(service_name: str, action_name: str | None, start_iso: str, end_iso: str) -> int:
        query: dict[str, Any] = {
            "service_name": service_name,
            "created_at": {"$gte": start_iso, "$lt": end_iso},
        }
        if action_name:
            query["action_name"] = action_name
        return int(await service_usage_logs_col.count_documents(query))

    async def _usage_from_api_logs(start_iso: str, end_iso: str) -> int:
        query = {
            "created_at": {"$gte": start_iso, "$lt": end_iso},
            "path": {"$not": {"$regex": r"^/api/admin"}},
        }
        return int(await api_request_logs_col.count_documents(query))

    services_def: list[dict[str, Any]] = [
        {
            "service_key": "gemini_ocr",
            "display_name": "Gemini OCR",
            "category": "ocr",
            "required_envs": ["GEMINI_OCR_API_KEY"],
            "free_tier_limited": True,
            "quota_env": "SERVICE_LIMIT_GEMINI_OCR_REQUESTS_PER_MONTH",
            "quota_period": "month",
            "quota_unit": "requests",
            "usage_loader": lambda: _usage_from_service_logs("ocr", "receipt_scan", month_start.isoformat(), next_month_start.isoformat()),
            "usage_window": "current_month",
            "source_of_truth": "service_usage_logs:service_name=ocr/action_name=receipt_scan",
            "pricing_note": os.getenv("SERVICE_PRICING_NOTE_GEMINI_OCR", "unknown"),
            "upgrade_note": os.getenv("SERVICE_UPGRADE_NOTE_GEMINI_OCR", "à renseigner"),
        },
        {
            "service_key": "gemini_recipes",
            "display_name": "Gemini Recipes",
            "category": "ai",
            "required_envs": ["GEMINI_RECIPES_API_KEY"],
            "free_tier_limited": True,
            "quota_env": "SERVICE_LIMIT_GEMINI_RECIPES_REQUESTS_PER_MONTH",
            "quota_period": "month",
            "quota_unit": "requests",
            "usage_loader": lambda: _usage_from_service_logs("ai_recipes", "generate_recipes", month_start.isoformat(), next_month_start.isoformat()),
            "usage_window": "current_month",
            "source_of_truth": "service_usage_logs:service_name=ai_recipes/action_name=generate_recipes",
            "pricing_note": os.getenv("SERVICE_PRICING_NOTE_GEMINI_RECIPES", "unknown"),
            "upgrade_note": os.getenv("SERVICE_UPGRADE_NOTE_GEMINI_RECIPES", "à renseigner"),
        },
        {
            "service_key": "openfoodfacts",
            "display_name": "Open Food Facts",
            "category": "catalog",
            "required_envs": ["OPENFOODFACTS_USER_AGENT", "OFF_USER_AGENT"],
            "free_tier_limited": True,
            "quota_env": "SERVICE_LIMIT_OPENFOODFACTS_REQUESTS_PER_MONTH",
            "quota_period": "month",
            "quota_unit": "requests",
            "usage_loader": lambda: _usage_from_service_logs("openfoodfacts", "product_lookup", month_start.isoformat(), next_month_start.isoformat()),
            "usage_window": "current_month",
            "source_of_truth": "service_usage_logs:service_name=openfoodfacts/action_name=product_lookup",
            "pricing_note": os.getenv("SERVICE_PRICING_NOTE_OPENFOODFACTS", "pricing unknown"),
            "upgrade_note": os.getenv("SERVICE_UPGRADE_NOTE_OPENFOODFACTS", "non configuré"),
        },
        {
            "service_key": "brevo_email",
            "display_name": "Brevo Email",
            "category": "email",
            "required_envs": ["BREVO_API_KEY", "MAIL_FROM"],
            "free_tier_limited": True,
            "quota_env": "SERVICE_LIMIT_BREVO_EMAILS_PER_DAY",
            "quota_period": "day",
            "quota_unit": "emails",
            "usage_loader": lambda: None,
            "usage_window": "unknown",
            "source_of_truth": "unknown",
            "pricing_note": os.getenv("SERVICE_PRICING_NOTE_BREVO", "pricing unknown"),
            "upgrade_note": os.getenv("SERVICE_UPGRADE_NOTE_BREVO", "à renseigner"),
        },
        {
            "service_key": "render",
            "display_name": "Render",
            "category": "infra",
            "required_envs": ["RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "RENDER_API_KEY"],
            "free_tier_limited": True,
            "quota_env": "SERVICE_LIMIT_RENDER_REQUESTS_PER_MONTH",
            "quota_period": "month",
            "quota_unit": "requests",
            "usage_loader": lambda: _usage_from_api_logs(month_start.isoformat(), next_month_start.isoformat()),
            "usage_window": "current_month",
            "source_of_truth": "api_request_logs:path!=/api/admin*",
            "pricing_note": os.getenv("SERVICE_PRICING_NOTE_RENDER", "pricing unknown"),
            "upgrade_note": os.getenv("SERVICE_UPGRADE_NOTE_RENDER", "à renseigner"),
        },
    ]

    result_services: list[dict[str, Any]] = []
    for service in services_def:
        configured = _first_non_empty_env(service["required_envs"]) is not None
        quota_limit_value = _parse_int_env(service["quota_env"])

        usage_loader = service["usage_loader"]
        usage_raw = usage_loader()
        usage_current_period: int | None
        if usage_raw is None:
            usage_current_period = None
        else:
            usage_current_period = int(await usage_raw)

        usage_remaining = None if quota_limit_value is None or usage_current_period is None else max(quota_limit_value - usage_current_period, 0)
        usage_percent = None
        if quota_limit_value is not None and usage_current_period is not None and quota_limit_value > 0:
            usage_percent = round((usage_current_period / quota_limit_value) * 100.0, 2)

        status = _status_for_usage(quota_limit_value, usage_current_period)
        source_of_truth = f"env:{service['quota_env']}" if quota_limit_value is not None else "unknown"

        period_start = month_start if service["quota_period"] == "month" else day_start
        period_end = next_month_start if service["quota_period"] == "month" else (day_start + timedelta(days=1))

        result_services.append(
            {
                "service_key": service["service_key"],
                "display_name": service["display_name"],
                "category": service["category"],
                "enabled": configured,
                "configured": configured,
                "free_tier_limited": service["free_tier_limited"],
                "quota_limit_value": quota_limit_value,
                "quota_period": service["quota_period"],
                "quota_unit": service["quota_unit"],
                "usage_current_period": usage_current_period,
                "usage_remaining": usage_remaining,
                "usage_percent": usage_percent,
                "source_of_truth": source_of_truth,
                "usage_source": service["source_of_truth"],
                "usage_window": service["usage_window"],
                "usage_window_start": period_start.isoformat(),
                "usage_window_end": period_end.isoformat(),
                "pricing_note": service["pricing_note"],
                "upgrade_note": service["upgrade_note"],
                "status": status,
            }
        )

    chart = [
        {
            "service_key": item["service_key"],
            "display_name": item["display_name"],
            "capacity_max": item["quota_limit_value"],
            "capacity_used": item["usage_current_period"],
            "capacity_remaining": item["usage_remaining"],
            "usage_percent": item["usage_percent"],
            "status": item["status"],
        }
        for item in result_services
    ]

    return {
        "generated_at": now.isoformat(),
        "services": result_services,
        "comparison_chart": chart,
        "notes": {
            "unknown_quota": "unknown / non configuré / à renseigner",
            "unknown_usage": "quota connu mais consommation indisponible",
        },
    }
