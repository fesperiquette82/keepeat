from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx
from fastapi import HTTPException

from app_core import logger, utc_now
from auth_utils import hash_password, validate_password


@dataclass(frozen=True)
class AlertDependencies:
    users_col: Any
    stock_col: Any
    user_alerts_col: Any
    app_state_col: Any
    products_cache_col: Any
    community_recipes_col: Any
    send_push: Callable[[list[str], str, str, dict | None], Any]
    fr_to_en_ingredient: Callable[[str, str], str]


async def send_expo_push(tokens: list[str], title: str, body: str, data: dict | None = None) -> None:
    valid = [t for t in tokens if t.startswith(("ExponentPushToken[", "ExpoPushToken["))]
    if not valid:
        return
    messages = [{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"} for t in valid]
    try:
        async with httpx.AsyncClient(timeout=15) as client_http:
            await client_http.post(
                "https://exp.host/--/push/v2/send",
                json=messages,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
    except Exception as exc:
        logger.warning("Expo push failed: %s", exc)


async def fetch_recent_recalls() -> list[dict]:
    since = (utc_now() - timedelta(days=30)).strftime("%Y-%m-%d")
    url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso0/records"
    params: dict[str, Any] = {
        "where": f"code_barre is not null and date_de_publication >= '{since}'",
        "select": (
            "code_barre,nom_de_la_marque_du_produit,"
            "noms_des_modeles_ou_references,"
            "risques_encourus_par_le_consommateur,"
            "date_de_publication"
        ),
        "limit": 100,
        "offset": 0,
    }
    results: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client_http:
            while True:
                response = await client_http.get(url, params=params)
                if response.status_code != 200:
                    logger.warning("Rappel.conso API returned %s", response.status_code)
                    break
                page_data = response.json()
                page_results = page_data.get("results", [])
                results.extend(page_results)
                if len(page_results) < 100:
                    break
                params["offset"] += 100
    except Exception as exc:
        logger.warning("Rappel.conso fetch failed: %s", exc)
    logger.info("Rappel.conso : %d rappels récupérés", len(results))
    return results


async def check_recalls_and_notify(deps: AlertDependencies) -> None:
    recalls = await fetch_recent_recalls()
    await deps.app_state_col.update_one(
        {"key": "last_recall_check"},
        {"$set": {"key": "last_recall_check", "checked_at": utc_now()}},
        upsert=True,
    )
    if not recalls:
        return

    recall_map = {str(r.get("code_barre", "")).strip(): r for r in recalls if str(r.get("code_barre", "")).strip()}
    if not recall_map:
        return

    async for user_doc in deps.users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])
        cursor = deps.stock_col.find({"user_id": user_id, "status": "active", "barcode": {"$exists": True, "$ne": ""}})
        async for item in cursor:
            barcode = str(item.get("barcode", "")).strip()
            if barcode not in recall_map:
                continue
            alert_key = f"recall_{barcode}"
            already_sent = await deps.user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
            if already_sent:
                continue
            recall_info = recall_map[barcode]
            brand = recall_info.get("nom_de_la_marque_du_produit", "")
            risk = recall_info.get("risques_encourus_par_le_consommateur", "Vérifiez l'emballage")
            item_label = item["name"] + (f" — {brand}" if brand else "")
            await deps.send_push(
                tokens,
                title="⚠️ Produit rappelé",
                body=f"{item_label} fait l'objet d'un rappel officiel. {risk}",
                data={"type": "recall", "itemId": str(item["_id"]), "barcode": barcode},
            )
            await deps.user_alerts_col.insert_one({"user_id": user_id, "key": alert_key, "sent_at": utc_now()})
            logger.info("Recall alert sent — user=%s barcode=%s", user_id, barcode)


async def check_inactivity_and_notify(deps: AlertDependencies) -> None:
    threshold = utc_now() - timedelta(days=7)

    async for user_doc in deps.users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        count = await deps.stock_col.count_documents({"user_id": user_id, "status": "active"})
        if count == 0:
            continue

        last_action_raw = user_doc.get("last_stock_action") or user_doc.get("created_at")
        if not last_action_raw:
            continue
        last_action = datetime.fromisoformat(last_action_raw) if isinstance(last_action_raw, str) else last_action_raw
        if last_action.tzinfo is None:
            last_action = last_action.replace(tzinfo=timezone.utc)
        if last_action > threshold:
            continue

        already_sent = await deps.user_alerts_col.find_one({
            "user_id": user_id,
            "key": "inactivity",
            "sent_at": {"$gte": threshold},
        })
        if already_sent:
            continue

        tokens: list[str] = user_doc.get("push_tokens", [])
        await deps.send_push(
            tokens,
            title="🥗 Votre stock vous attend !",
            body=(
                f"Vous avez {count} produit{'s' if count > 1 else ''} en stock. "
                "Pensez à les consommer pour éviter le gaspillage."
            ),
            data={"type": "inactivity"},
        )
        await deps.user_alerts_col.insert_one({"user_id": user_id, "key": "inactivity", "sent_at": utc_now()})
        logger.info("Inactivity alert sent — user=%s items=%d", user_id, count)


async def check_weekly_expiry_summary(deps: AlertDependencies) -> None:
    today = utc_now().date()
    in_7_days = (today + timedelta(days=7)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")
    iso_week = today.isocalendar()[1]

    async for user_doc in deps.users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])
        alert_key = f"weekly_{user_id}_{today.year}_{iso_week}"
        already_sent = await deps.user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
        if already_sent:
            continue

        cursor = deps.stock_col.find({
            "user_id": user_id,
            "status": "active",
            "expiry_date": {"$nin": [None, ""], "$gte": today_str, "$lte": in_7_days},
        }).sort("expiry_date", 1).limit(5)
        urgent_items = await cursor.to_list(length=5)
        if not urgent_items:
            continue

        names = [item["name"] for item in urgent_items]
        count = len(names)
        body = f"{'Produit' if count == 1 else 'Produits'} à consommer : {', '.join(names)}"
        await deps.send_push(
            tokens,
            title=f"📦 {count} produit{'s' if count > 1 else ''} à consommer cette semaine",
            body=body,
            data={"type": "weekly_summary"},
        )
        await deps.user_alerts_col.insert_one({"user_id": user_id, "key": alert_key, "sent_at": utc_now()})
        logger.info("Weekly summary sent — user=%s items=%d", user_id, count)


async def check_daily_expiry_alert(deps: AlertDependencies) -> None:
    today = utc_now().date()
    in_2_days = (today + timedelta(days=2)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    async for user_doc in deps.users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])
        alert_key = f"daily_expiry_{user_id}_{today_str}"
        already_sent = await deps.user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
        if already_sent:
            continue

        cursor = deps.stock_col.find({
            "user_id": user_id,
            "status": "active",
            "expiry_date": {"$nin": [None, ""], "$gte": today_str, "$lte": in_2_days},
        }).sort("expiry_date", 1).limit(5)
        urgent_items = await cursor.to_list(length=5)
        if not urgent_items:
            continue

        names = [item["name"] for item in urgent_items]
        count = len(names)
        recipe_hint = ""
        if names:
            try:
                en_ingredient = deps.fr_to_en_ingredient(names[0], "autres")
                async with httpx.AsyncClient(timeout=6) as http_client:
                    response = await http_client.get(
                        "https://www.themealdb.com/api/json/v1/1/filter.php",
                        params={"i": en_ingredient},
                    )
                    if response.status_code == 200:
                        meals = response.json().get("meals") or []
                        if meals:
                            recipe_hint = f" → Recette : {meals[0]['strMeal']}"
            except Exception:
                pass

        first = names[0]
        if count == 1:
            when_label = "aujourd'hui" if today_str <= in_2_days else "bientôt"
            title = f"⏰ {first} expire {when_label}"
        else:
            title = f"⏰ {count} produits à utiliser maintenant"
        await deps.send_push(
            tokens,
            title=title,
            body=", ".join(names) + recipe_hint,
            data={"type": "daily_expiry", "count": count},
        )
        await deps.user_alerts_col.insert_one({"user_id": user_id, "key": alert_key, "sent_at": utc_now()})
        logger.info("Daily expiry alert sent — user=%s items=%d recipe=%s", user_id, count, bool(recipe_hint))


async def alert_loop(deps: AlertDependencies) -> None:
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            await check_recalls_and_notify(deps)
            await check_inactivity_and_notify(deps)
            if utc_now().hour < 12:
                await check_daily_expiry_alert(deps)
                await check_weekly_expiry_summary(deps)
        except Exception as exc:
            logger.error("Alert loop error: %s", exc)


async def seed_default_user(users_col) -> None:
    default_email = os.getenv("SEED_EMAIL", "").strip().lower()
    default_password = os.getenv("SEED_PASSWORD", "")
    if not default_email or not default_password:
        logger.info("SEED_EMAIL/SEED_PASSWORD non configurés → seed dev ignoré")
        return
    try:
        validate_password(default_password)
    except HTTPException as exc:
        logger.warning("SEED_PASSWORD trop faible (%s) → seed dev ignoré", exc.detail)
        return
    try:
        existing = await users_col.find_one({"email": default_email})
        if not existing:
            await users_col.insert_one({
                "email": default_email,
                "hashed_password": hash_password(default_password),
                "is_premium": True,
                "email_verified": True,
                "created_at": utc_now(),
                "last_login": None,
            })
            logger.info("Default dev user created: %s", default_email)
        else:
            updates: dict[str, Any] = {}
            if not existing.get("is_premium"):
                updates["is_premium"] = True
            if not existing.get("email_verified"):
                updates["email_verified"] = True
            if updates:
                await users_col.update_one({"email": default_email}, {"$set": updates})
                logger.info("Default dev user updated: %s → %s", default_email, updates)
    except Exception as exc:
        logger.warning("Could not seed default user: %s", exc)
