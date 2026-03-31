from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from pymongo import ReturnDocument

FREE_PLAN = "free"
PREMIUM_PLAN = "premium"
PREMIUM_PRODUCT_ID = "premium_monthly"

FEATURE_OCR = "ocr_receipt"
FEATURE_AI = "ai_recipes"
FEATURE_PREDICTIONS = "predictions"
FEATURE_STATS_ADVANCED = "stats_advanced"

FREE_MONTHLY_LIMITS: dict[str, int] = {
    FEATURE_OCR: 10,
    FEATURE_AI: 5,
}

PREMIUM_MONTHLY_LIMITS: dict[str, int] = {
    FEATURE_OCR: 200,
    FEATURE_AI: 200,
}


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def resolve_plan(user_doc: dict[str, Any] | None) -> str:
    if not user_doc:
        return FREE_PLAN

    subscription_status = str(user_doc.get("subscription_status") or "").lower()
    expires_at = _parse_iso_datetime(user_doc.get("subscription_expires_at"))
    now = datetime.now(timezone.utc)

    if subscription_status == "active":
        if expires_at is None or expires_at > now:
            return PREMIUM_PLAN

    if user_doc.get("is_premium") is True:
        if expires_at is None or expires_at > now:
            return PREMIUM_PLAN

    return FREE_PLAN


def feature_policy(plan: str, feature: str) -> dict[str, Any]:
    if plan == PREMIUM_PLAN:
        if feature in PREMIUM_MONTHLY_LIMITS:
            return {"allowed": True, "monthly_limit": PREMIUM_MONTHLY_LIMITS[feature]}
        return {"allowed": True, "monthly_limit": None}

    if feature in (FEATURE_PREDICTIONS, FEATURE_STATS_ADVANCED):
        return {"allowed": False, "monthly_limit": None}

    if feature in FREE_MONTHLY_LIMITS:
        return {"allowed": True, "monthly_limit": FREE_MONTHLY_LIMITS[feature]}

    return {"allowed": True, "monthly_limit": None}


def _quota_exceeded_detail(*, feature: str, remaining: int = 0, reset_at: str | None = None) -> dict[str, Any]:
    detail: dict[str, Any] = {
        "code": "QUOTA_EXCEEDED",
        "feature": feature,
        "remaining": max(0, remaining),
    }
    if reset_at:
        detail["reset_at"] = reset_at
    return detail


def check_access_or_raise(*, plan: str, feature: str) -> dict[str, Any]:
    policy = feature_policy(plan, feature)
    if not policy["allowed"]:
        raise HTTPException(
            status_code=403,
            detail={"code": "PREMIUM_REQUIRED", "feature": feature},
        )
    return policy


async def consume_quota_or_raise(
    *,
    app_state_col,
    user_id: str,
    feature: str,
    monthly_limit: int | None,
    period: str,
    reset_at: str,
) -> dict[str, int | str | None]:
    if monthly_limit is None:
        return {
            "used": 0,
            "limit": None,
            "remaining": 999999,
            "period": period,
            "reset_at": reset_at,
        }

    counter_id = f"usage:{user_id}:{feature}:{period}"
    updated = await app_state_col.find_one_and_update(
        {"_id": counter_id},
        {
            "$setOnInsert": {
                "user_id": user_id,
                "feature": feature,
                "period": period,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            "$inc": {"used": 1},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    used = int((updated or {}).get("used") or 0)
    remaining = monthly_limit - used
    if used > monthly_limit:
        raise HTTPException(
            status_code=429,
            detail=_quota_exceeded_detail(feature=feature, remaining=0, reset_at=reset_at),
        )
    return {
        "used": used,
        "limit": monthly_limit,
        "remaining": max(0, remaining),
        "period": period,
        "reset_at": reset_at,
    }


def build_entitlements_snapshot(user_doc: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    now_utc = now or datetime.now(timezone.utc)
    plan = resolve_plan(user_doc)
    features = {
        FEATURE_OCR: feature_policy(plan, FEATURE_OCR),
        FEATURE_AI: feature_policy(plan, FEATURE_AI),
        FEATURE_PREDICTIONS: feature_policy(plan, FEATURE_PREDICTIONS),
        FEATURE_STATS_ADVANCED: feature_policy(plan, FEATURE_STATS_ADVANCED),
    }

    return {
        "plan": plan,
        "is_premium": plan == PREMIUM_PLAN,
        "subscription_status": user_doc.get("subscription_status") or ("active" if plan == PREMIUM_PLAN else "inactive"),
        "subscription_expires_at": user_doc.get("subscription_expires_at"),
        "features": features,
        "server_time": now_utc.isoformat(),
    }
