from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import timedelta
from typing import Any, Optional

from jose import JWTError, jwt

from app_core import logger, utc_now

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"

_EVENT_NAME_ALLOWED = {
    "user_registered",
    "onboarding_completed",
    "product_added",
    "product_updated",
    "stock_consumed",
    "recipe_generated",
    "ocr_scan_started",
    "ocr_scan_succeeded",
    "ocr_scan_failed",
    "recall_refresh_triggered",
    "premium_paywall_viewed",
    "premium_checkout_started",
    "premium_checkout_succeeded",
    "premium_restored",
}


def _iso_days_ago(days: int) -> str:
    return (utc_now() - timedelta(days=days)).isoformat()


def normalize_endpoint_key(path: str) -> str:
    normalized = re.sub(r"/[0-9a-fA-F]{24}(?=/|$)", "/:id", path)
    normalized = re.sub(r"/\d+(?=/|$)", "/:id", normalized)
    return normalized


def classify_error_type(*, status_code: int, path: str) -> Optional[str]:
    if status_code < 400:
        return None
    if status_code == 422:
        return "validation_error"
    if status_code in (401, 403):
        return "auth_error"
    if status_code in (502, 503):
        return "external_service_error"
    if status_code == 504:
        return "timeout"
    if status_code >= 500:
        return "internal_error"
    if path.startswith("/api/admin"):
        return "auth_error"
    return "client_error"


def extract_user_id_from_auth_header(authorization_header: str | None) -> str | None:
    if not authorization_header or not authorization_header.startswith("Bearer ") or not JWT_SECRET_KEY:
        return None
    token = authorization_header.replace("Bearer ", "", 1).strip()
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if isinstance(user_id, str) and user_id:
            return user_id
    except (JWTError, ValueError):
        return None
    return None


async def log_api_request(
    *,
    api_request_logs_col,
    method: str,
    path: str,
    user_id: str | None,
    status_code: int,
    duration_ms: float,
) -> None:
    endpoint_key = normalize_endpoint_key(path)
    error_type = classify_error_type(status_code=status_code, path=path)
    payload = {
        "method": method,
        "path": path,
        "endpoint_key": endpoint_key,
        "user_id": user_id,
        "status_code": int(status_code),
        "duration_ms": round(float(duration_ms), 2),
        "success": status_code < 400,
        "error_type": error_type,
        "created_at": utc_now().isoformat(),
    }
    try:
        await api_request_logs_col.insert_one(payload)
        logger.info("API_REQUEST_LOG %s", payload)
    except Exception as exc:
        logger.warning("API_REQUEST_LOG insert failed: %s", exc)


async def track_business_event(
    *,
    business_events_col,
    user_id: str | None,
    event_name: str,
    event_category: str,
    metadata_json: dict[str, Any] | None = None,
) -> None:
    if event_name not in _EVENT_NAME_ALLOWED:
        logger.warning("Business event ignored (unknown): %s", event_name)
        return
    payload = {
        "user_id": user_id,
        "event_name": event_name,
        "event_category": event_category,
        "metadata_json": metadata_json or {},
        "created_at": utc_now().isoformat(),
    }
    try:
        await business_events_col.insert_one(payload)
        logger.info("BUSINESS_EVENT %s", payload)
    except Exception as exc:
        logger.warning("BUSINESS_EVENT insert failed: %s", exc)


def resolve_plan_type_at_time(user_doc: dict[str, Any] | None) -> str:
    if not user_doc:
        return "free"
    if bool(user_doc.get("admin_granted")):
        return "admin_granted"
    trial_end = user_doc.get("trial_ends_at")
    if isinstance(trial_end, str) and trial_end > utc_now().isoformat():
        return "trial"
    if bool(user_doc.get("is_premium")):
        return "premium"
    return "free"


async def track_service_usage(
    *,
    service_usage_logs_col,
    user_id: str | None,
    service_name: str,
    action_name: str,
    units_consumed: float,
    estimated_cost: float,
    plan_type_at_time: str,
    metadata_json: dict[str, Any] | None = None,
) -> None:
    payload = {
        "user_id": user_id,
        "service_name": service_name,
        "action_name": action_name,
        "units_consumed": float(units_consumed),
        "estimated_cost": round(float(estimated_cost), 6),
        "plan_type_at_time": plan_type_at_time,
        "metadata_json": metadata_json or {},
        "created_at": utc_now().isoformat(),
    }
    try:
        await service_usage_logs_col.insert_one(payload)
        logger.info("SERVICE_USAGE %s", payload)
    except Exception as exc:
        logger.warning("SERVICE_USAGE insert failed: %s", exc)


async def build_monitoring_kpis(*, users_col, api_request_logs_col, service_usage_logs_col) -> dict[str, Any]:
    now_iso = utc_now().isoformat()
    users_total = await users_col.count_documents({})
    new_users_today = await users_col.count_documents({"created_at": {"$gte": _iso_days_ago(1)}})
    new_users_7d = await users_col.count_documents({"created_at": {"$gte": _iso_days_ago(7)}})
    new_users_30d = await users_col.count_documents({"created_at": {"$gte": _iso_days_ago(30)}})

    async def _distinct_users(days: int) -> int:
        values = await api_request_logs_col.distinct("user_id", {"created_at": {"$gte": _iso_days_ago(days)}, "user_id": {"$nin": [None, ""]}})
        return len(values)

    dau, wau, mau = await _distinct_users(1), await _distinct_users(7), await _distinct_users(30)

    premium_users = await users_col.count_documents({"is_premium": True})
    free_users = max(users_total - premium_users, 0)
    active_subscriptions = await users_col.count_documents({"is_premium": True, "subscription_status": "active"})

    subscriptions_by_plan = {
        "premium_monthly": await users_col.count_documents({"store_product_id": "premium_monthly", "subscription_status": "active"}),
        "premium_other": await users_col.count_documents({"is_premium": True, "subscription_status": "active", "store_product_id": {"$ne": "premium_monthly"}}),
    }

    monthly_price = float(os.getenv("PREMIUM_MONTHLY_PRICE_EUR", "4.99"))
    est_mrr = round(active_subscriptions * monthly_price, 2)

    api_volume = await api_request_logs_col.count_documents({"created_at": {"$gte": _iso_days_ago(7)}})
    service_usage_cost_pipeline = [
        {"$match": {"created_at": {"$gte": _iso_days_ago(30)}}},
        {"$group": {"_id": "$service_name", "units": {"$sum": "$units_consumed"}, "cost": {"$sum": "$estimated_cost"}}},
        {"$sort": {"cost": -1}},
        {"$limit": 5},
    ]
    top_service_usage = await service_usage_logs_col.aggregate(service_usage_cost_pipeline).to_list(length=20)

    return {
        "generated_at": now_iso,
        "users": {
            "total": users_total,
            "new_today": new_users_today,
            "new_7d": new_users_7d,
            "new_30d": new_users_30d,
            "dau": dau,
            "wau": wau,
            "mau": mau,
            "free": free_users,
            "premium": premium_users,
        },
        "subscriptions": {
            "active": active_subscriptions,
            "by_plan": subscriptions_by_plan,
            "estimated_mrr_eur": est_mrr,
            "estimated_arr_eur": round(est_mrr * 12, 2),
        },
        "apis": {"volume_7d": api_volume},
        "services": {
            "top_usage_30d": [
                {"service_name": row.get("_id"), "units": row.get("units", 0), "estimated_cost": round(row.get("cost", 0.0), 4)}
                for row in top_service_usage
            ]
        },
    }


async def summarize_api_metrics(*, api_request_logs_col, start_iso: str, end_iso: str, limit: int = 20) -> dict[str, Any]:
    match = {"created_at": {"$gte": start_iso, "$lte": end_iso}}
    volume = await api_request_logs_col.count_documents(match)

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": "$endpoint_key",
                "count": {"$sum": 1},
                "errors": {"$sum": {"$cond": [{"$gte": ["$status_code", 400]}, 1, 0]}},
                "avg_latency_ms": {"$avg": "$duration_ms"},
                "p95_values": {"$push": "$duration_ms"},
            }
        },
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    rows = await api_request_logs_col.aggregate(pipeline).to_list(length=limit)
    formatted = []
    for row in rows:
        values = sorted(float(v) for v in row.get("p95_values", []) if isinstance(v, (int, float)))
        idx = int(0.95 * (len(values) - 1)) if values else 0
        p95 = round(values[idx], 2) if values else 0.0
        count = int(row.get("count", 0))
        errors = int(row.get("errors", 0))
        formatted.append(
            {
                "endpoint_key": row.get("_id"),
                "volume": count,
                "error_rate": round((errors / count) if count else 0.0, 4),
                "avg_latency_ms": round(float(row.get("avg_latency_ms") or 0.0), 2),
                "p95_latency_ms": p95,
            }
        )

    worst_error = sorted(formatted, key=lambda x: x["error_rate"], reverse=True)[:5]
    worst_latency = sorted(formatted, key=lambda x: x["p95_latency_ms"], reverse=True)[:5]
    return {"volume": volume, "top_endpoints": formatted, "highest_error_rate": worst_error, "highest_latency": worst_latency}


async def summarize_services_usage(*, service_usage_logs_col, start_iso: str, end_iso: str) -> dict[str, Any]:
    match = {"created_at": {"$gte": start_iso, "$lte": end_iso}}
    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": {"service": "$service_name", "action": "$action_name", "plan": "$plan_type_at_time"},
                "units": {"$sum": "$units_consumed"},
                "cost": {"$sum": "$estimated_cost"},
                "calls": {"$sum": 1},
            }
        },
        {"$sort": {"cost": -1, "units": -1}},
    ]
    rows = await service_usage_logs_col.aggregate(pipeline).to_list(length=200)
    by_service: dict[str, dict[str, Any]] = defaultdict(lambda: {"units": 0.0, "estimated_cost": 0.0, "calls": 0, "actions": [], "plans": defaultdict(lambda: {"units": 0.0, "cost": 0.0, "calls": 0})})

    for row in rows:
        sid = row["_id"]["service"]
        action = row["_id"]["action"]
        plan = row["_id"]["plan"]
        units = float(row.get("units") or 0.0)
        cost = float(row.get("cost") or 0.0)
        calls = int(row.get("calls") or 0)

        bucket = by_service[sid]
        bucket["units"] += units
        bucket["estimated_cost"] += cost
        bucket["calls"] += calls
        bucket["actions"].append({"action_name": action, "units": units, "estimated_cost": round(cost, 6), "calls": calls, "plan_type": plan})
        plan_entry = bucket["plans"][plan]
        plan_entry["units"] += units
        plan_entry["cost"] += cost
        plan_entry["calls"] += calls

    services = []
    for service_name, value in by_service.items():
        services.append(
            {
                "service_name": service_name,
                "units": round(value["units"], 4),
                "estimated_cost": round(value["estimated_cost"], 6),
                "calls": value["calls"],
                "actions": value["actions"][:50],
                "plans": {
                    k: {"units": round(v["units"], 4), "estimated_cost": round(v["cost"], 6), "calls": v["calls"]}
                    for k, v in value["plans"].items()
                },
            }
        )
    services.sort(key=lambda x: x["estimated_cost"], reverse=True)
    return {"services": services, "total_estimated_cost": round(sum(s["estimated_cost"] for s in services), 6)}
