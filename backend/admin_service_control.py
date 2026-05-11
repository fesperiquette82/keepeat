from __future__ import annotations

import os
import time
from calendar import monthrange
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.app_core import utc_now


SERVICE_REGISTRY: list[dict[str, Any]] = [
    {
        "id": "keepeat_backend_api",
        "name": "Backend API KeepEat",
        "type": "internal",
        "category": "infra",
        "verification_source": "health_check",
        "enabled_env": None,
    },
    {
        "id": "mongodb",
        "name": "MongoDB",
        "type": "external",
        "category": "database",
        "verification_source": "health_check",
        "enabled_env": "MONGO_URL",
    },
    {
        "id": "openfoodfacts_api",
        "name": "Open Food Facts API",
        "type": "external",
        "category": "api",
        "verification_source": "health_check+usage_counter",
        "enabled_env": "OFF_USER_AGENT",
    },
    {
        "id": "ocr_engine",
        "name": "OCR engine (Gemini Vision)",
        "type": "external",
        "category": "ocr",
        "verification_source": "env_based+usage_counter",
        "enabled_env": "GEMINI_OCR_API_KEY",
    },
    {
        "id": "gemini_recipes",
        "name": "Gemini Recipes AI",
        "type": "external",
        "category": "ai",
        "verification_source": "env_based",
        "enabled_env": "GEMINI_RECIPES_API_KEY",
    },
    {
        "id": "frontend_backend_connectivity",
        "name": "Frontend → Backend connectivity",
        "type": "internal",
        "category": "connectivity",
        "verification_source": "usage_counter",
        "enabled_env": None,
    },
]


def _is_configured(service: dict[str, Any]) -> bool:
    env_key = service.get("enabled_env")
    if not env_key:
        return True
    value = os.getenv(str(env_key), "").strip()
    return bool(value)


def _month_bounds(reference: datetime | None = None) -> tuple[datetime, datetime]:
    now = reference or utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_day = monthrange(now.year, now.month)[1]
    end = now.replace(day=last_day, hour=23, minute=59, second=59, microsecond=999999)
    return start, end


def _month_projection(current_usage: float, now: datetime) -> tuple[float, str]:
    start, _ = _month_bounds(now)
    elapsed_days = max((now - start).total_seconds() / 86400.0, 0.05)
    total_days = float(monthrange(now.year, now.month)[1])
    if elapsed_days < 1:
        return current_usage, "low"
    projected = current_usage * (total_days / elapsed_days)
    confidence = "medium" if elapsed_days < 7 else "high"
    return projected, confidence


def _warning_level(usage_percent: float | None) -> str:
    if usage_percent is None:
        return "normal"
    if usage_percent >= 0.95:
        return "critical"
    if usage_percent >= 0.75:
        return "warning"
    return "normal"


async def build_services_status(*, db, api_request_logs_col) -> dict[str, Any]:
    now = utc_now()
    now_iso = now.isoformat()
    services: list[dict[str, Any]] = []

    for service in SERVICE_REGISTRY:
        configured = _is_configured(service)
        status = "unknown"
        message = "No check yet"
        latency_ms: float | None = None
        details: dict[str, Any] = {}

        if not configured:
            services.append(
                {
                    "id": service["id"],
                    "name": service["name"],
                    "type": service["type"],
                    "category": service["category"],
                    "status": "not_configured",
                    "latency_ms": None,
                    "last_checked_at": now_iso,
                    "message": "Service not configured",
                    "configured": False,
                    "details": {"verification_source": service["verification_source"]},
                }
            )
            continue

        started = time.perf_counter()
        if service["id"] == "keepeat_backend_api":
            status = "connected"
            message = "API process is running"
            latency_ms = round((time.perf_counter() - started) * 1000, 2)

        elif service["id"] == "mongodb":
            try:
                await db.command("ping")
                status = "connected"
                message = "MongoDB ping succeeded"
            except Exception as exc:
                status = "down"
                message = f"MongoDB ping failed: {type(exc).__name__}"
            latency_ms = round((time.perf_counter() - started) * 1000, 2)

        elif service["id"] == "openfoodfacts_api":
            try:
                headers = {"User-Agent": os.getenv("OFF_USER_AGENT", "KeepEat/1.0 (https://keepeat.app)")}
                async with httpx.AsyncClient(timeout=3.0, headers=headers) as client:
                    response = await client.get("https://world.openfoodfacts.net/api/v2/product/737628064502")
                latency_ms = round((time.perf_counter() - started) * 1000, 2)
                if response.status_code < 500:
                    status = "connected"
                    message = f"Open Food Facts reachable (HTTP {response.status_code})"
                else:
                    status = "degraded"
                    message = f"Open Food Facts server error (HTTP {response.status_code})"
            except Exception as exc:
                latency_ms = round((time.perf_counter() - started) * 1000, 2)
                status = "degraded"
                message = f"Open Food Facts check failed: {type(exc).__name__}"

        elif service["id"] == "ocr_engine":
            status = "connected"
            message = "Gemini OCR API key configured"
            latency_ms = None

        elif service["id"] == "gemini_recipes":
            status = "connected"
            message = "Gemini Recipes API key configured"
            latency_ms = None

        elif service["id"] == "frontend_backend_connectivity":
            recent_count = await api_request_logs_col.count_documents({"created_at": {"$gte": (now.replace(minute=0, second=0, microsecond=0)).isoformat()}})
            failed_count = await api_request_logs_col.count_documents(
                {
                    "created_at": {"$gte": (now.replace(minute=0, second=0, microsecond=0)).isoformat()},
                    "status_code": {"$gte": 500},
                }
            )
            error_rate = (failed_count / recent_count) if recent_count else 0.0
            if recent_count == 0:
                status = "unknown"
                message = "No API traffic detected in the current hour"
            elif error_rate > 0.2:
                status = "degraded"
                message = "High backend error ratio on recent calls"
            else:
                status = "connected"
                message = "Recent frontend/backend traffic looks healthy"
            details = {"recent_calls": recent_count, "server_error_rate": round(error_rate, 4)}

        services.append(
            {
                "id": service["id"],
                "name": service["name"],
                "type": service["type"],
                "category": service["category"],
                "status": status,
                "latency_ms": latency_ms,
                "last_checked_at": now_iso,
                "message": message,
                "configured": configured,
                "details": {"verification_source": service["verification_source"], **details},
            }
        )

    return {"generated_at": now_iso, "services": services}


async def build_usage_metrics(*, users_col, stock_col, service_usage_logs_col) -> dict[str, Any]:
    now = utc_now()
    start, end = _month_bounds(now)
    start_iso, end_iso = start.isoformat(), end.isoformat()

    ocr_count = await service_usage_logs_col.count_documents(
        {
            "service_name": "ocr",
            "action_name": "receipt_scan",
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        }
    )
    off_count = await service_usage_logs_col.count_documents(
        {
            "service_name": "openfoodfacts",
            "action_name": "product_lookup",
            "created_at": {"$gte": start_iso, "$lte": end_iso},
        }
    )

    total_users = await users_col.count_documents({})
    total_products = await stock_col.count_documents({})
    active_products = await stock_col.count_documents({"status": "active"})

    free_quota_ocr = os.getenv("MONITORING_FREE_QUOTA_OCR_CALLS")
    free_quota_off = os.getenv("MONITORING_FREE_QUOTA_OPENFOODFACTS_CALLS")

    def _quota(raw: str | None) -> int | None:
        if raw is None or raw.strip() == "":
            return None
        try:
            value = int(raw)
            return value if value >= 0 else None
        except ValueError:
            return None

    ocr_quota = _quota(free_quota_ocr)
    off_quota = _quota(free_quota_off)

    ocr_pct = (ocr_count / ocr_quota) if ocr_quota else None
    off_pct = (off_count / off_quota) if off_quota else None

    projected_ocr, ocr_conf = _month_projection(float(ocr_count), now)
    projected_off, off_conf = _month_projection(float(off_count), now)

    usage_items = [
        {
            "service_id": "ocr_engine",
            "label": "OCR scans (month-to-date)",
            "current_usage": ocr_count,
            "projected_month_end_usage": round(projected_ocr, 2),
            "free_quota": ocr_quota,
            "usage_percent": round(ocr_pct, 4) if ocr_pct is not None else None,
            "period": "current_month",
            "warning_level": _warning_level(ocr_pct),
            "confidence": ocr_conf,
            "is_estimated": ocr_quota is None,
            "note": "Free quota configurable via MONITORING_FREE_QUOTA_OCR_CALLS." if ocr_quota is None else None,
        },
        {
            "service_id": "openfoodfacts_api",
            "label": "Open Food Facts lookups (month-to-date)",
            "current_usage": off_count,
            "projected_month_end_usage": round(projected_off, 2),
            "free_quota": off_quota,
            "usage_percent": round(off_pct, 4) if off_pct is not None else None,
            "period": "current_month",
            "warning_level": _warning_level(off_pct),
            "confidence": off_conf,
            "is_estimated": off_quota is None,
            "note": "No official hard quota tracked in code; value is informational." if off_quota is None else None,
        },
        {
            "service_id": "mongodb",
            "label": "MongoDB stored products",
            "current_usage": active_products,
            "projected_month_end_usage": None,
            "free_quota": None,
            "usage_percent": None,
            "period": "current_state",
            "warning_level": "normal",
            "confidence": "high",
            "is_estimated": False,
            "note": f"Total products (all statuses): {total_products}",
        },
        {
            "service_id": "keepeat_backend_api",
            "label": "Registered users",
            "current_usage": total_users,
            "projected_month_end_usage": None,
            "free_quota": None,
            "usage_percent": None,
            "period": "current_state",
            "warning_level": "normal",
            "confidence": "high",
            "is_estimated": False,
            "note": "User count from users collection.",
        },
    ]

    return {
        "generated_at": now.isoformat(),
        "period": {"start": start_iso, "end": end_iso, "label": "current_month"},
        "usage": usage_items,
    }


async def build_cost_recommendations(*, usage_payload: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    usage_by_service = {item["service_id"]: item for item in usage_payload.get("usage", [])}

    render_plan = os.getenv("MONITORING_RENDER_CURRENT_PLAN", "Render Free")
    render_free_req = int(os.getenv("MONITORING_RENDER_FREE_REQUESTS", "100000"))
    render_paid_plan = os.getenv("MONITORING_RENDER_NEXT_PLAN", "Render Starter")
    render_paid_cost = float(os.getenv("MONITORING_RENDER_NEXT_PLAN_COST", "7"))

    mongo_plan = os.getenv("MONITORING_MONGO_CURRENT_PLAN", "MongoDB Atlas Free")
    mongo_free_products = int(os.getenv("MONITORING_MONGO_FREE_PRODUCTS", "5000"))
    mongo_next_plan = os.getenv("MONITORING_MONGO_NEXT_PLAN", "MongoDB Atlas M10")
    mongo_next_cost = float(os.getenv("MONITORING_MONGO_NEXT_PLAN_COST", "57"))

    ocr_plan = os.getenv("MONITORING_OCR_CURRENT_PLAN", "Gemini 2.5-flash (Free)")
    ocr_unit_cost = float(os.getenv("OCR_ESTIMATED_COST_EUR", "0.01"))

    projected_ocr = float(usage_by_service.get("ocr_engine", {}).get("projected_month_end_usage") or 0.0)
    projected_off = float(usage_by_service.get("openfoodfacts_api", {}).get("projected_month_end_usage") or 0.0)
    users_count = float(usage_by_service.get("keepeat_backend_api", {}).get("current_usage") or 0.0)
    products_count = float(usage_by_service.get("mongodb", {}).get("current_usage") or 0.0)

    estimated_render_requests = int(users_count * 900)
    render_recommended = render_paid_plan if estimated_render_requests > render_free_req else render_plan
    render_cost = render_paid_cost if render_recommended == render_paid_plan else 0.0

    mongo_recommended = mongo_next_plan if products_count > mongo_free_products else mongo_plan
    mongo_cost = mongo_next_cost if mongo_recommended == mongo_next_plan else 0.0

    cost_items = [
        {
            "service_id": "keepeat_backend_api",
            "current_plan": render_plan,
            "estimated_monthly_usage": estimated_render_requests,
            "recommended_next_plan": render_recommended,
            "estimated_monthly_cost": round(render_cost, 2),
            "currency": "EUR",
            "recommendation_reason": "Based on an indicative request-per-user estimate. Verify with Render dashboard.",
            "confidence": "low",
            "is_estimated": True,
        },
        {
            "service_id": "mongodb",
            "current_plan": mongo_plan,
            "estimated_monthly_usage": int(products_count),
            "recommended_next_plan": mongo_recommended,
            "estimated_monthly_cost": round(mongo_cost, 2),
            "currency": "EUR",
            "recommendation_reason": "Uses stored products count as a simple proxy for database load.",
            "confidence": "medium",
            "is_estimated": True,
        },
        {
            "service_id": "ocr_engine",
            "current_plan": ocr_plan,
            "estimated_monthly_usage": round(projected_ocr, 2),
            "recommended_next_plan": "Optimize prompts / cache scans" if projected_ocr > 0 else "Keep current setup",
            "estimated_monthly_cost": round(projected_ocr * ocr_unit_cost, 2),
            "currency": "EUR",
            "recommendation_reason": "Computed from OCR_ESTIMATED_COST_EUR and projected month-end OCR volume.",
            "confidence": "medium" if projected_ocr > 0 else "low",
            "is_estimated": True,
        },
        {
            "service_id": "openfoodfacts_api",
            "current_plan": "Community API",
            "estimated_monthly_usage": round(projected_off, 2),
            "recommended_next_plan": "No paid tier in app config",
            "estimated_monthly_cost": 0.0,
            "currency": "EUR",
            "recommendation_reason": "Open Food Facts is treated as non-billed usage in this V1 dashboard.",
            "confidence": "high",
            "is_estimated": False,
        },
    ]

    return {"generated_at": now.isoformat(), "costs": cost_items, "pricing_note": "Indicative values only; validate provider pricing before decisions."}
