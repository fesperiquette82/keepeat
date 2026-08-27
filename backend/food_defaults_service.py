from __future__ import annotations

import asyncio
import json
import os
import re
import unicodedata
from typing import Any

import httpx

from backend.app_core import logger, utc_now
from backend.observability import track_service_usage

# Mêmes conventions que ocr_service.py (endpoint, header d'auth, modèle par
# défaut) — la clé/le modèle OCR sont réutilisés par défaut pour ne pas
# demander de configuration Render supplémentaire (cf. GEMINI_FOOD_DEFAULTS_*
# pour un override optionnel, résolu par l'appelant).
_GEMINI_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite"
_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=5.0)
_RETRY_ATTEMPTS = 2
_RETRYABLE_HTTP_STATUSES = {429, 500, 502, 503, 504}

_VALID_STORAGE_ZONES = {"frigo", "placard", "congelateur"}

# Identifiants de tracking (service_usage_logs) — repris tels quels par
# service_limits.py pour afficher exactement la même consommation au
# dashboard admin que celle utilisée pour le plafond mensuel.
SERVICE_NAME = "ai_food_defaults"
ACTION_NAME = "resolve_food_defaults"
_MONTHLY_LIMIT_ENV = "SERVICE_LIMIT_GEMINI_FOOD_DEFAULTS_REQUESTS_PER_MONTH"
_DEFAULT_MONTHLY_LIMIT = 200

_PROMPT_TEMPLATE = """Pour l'aliment "{name}" (catégorie : {food_category}), détermine sa zone de stockage principale et sa durée de conservation par défaut.

Réponds avec UN OBJET JSON STRICT, valide, sans markdown et sans texte hors JSON :
{{
  "storage_zone": "frigo|placard|congelateur",
  "shelf_life_days": {{"fridge": <int ou null>, "pantry": <int ou null>, "freezer": <int ou null>}},
  "confidence": 0.0
}}

Règles :
- storage_zone = la zone de conservation recommandée en priorité pour cet aliment.
- shelf_life_days = durée de conservation par défaut estimée dans chaque zone, null si non pertinent (ex. surgélation déconseillée pour ce produit).
- confidence entre 0 et 1.
"""


def _normalize_food_key(name: str) -> str:
    token = str(name or "").strip().lower()
    if not token:
        return ""
    normalized = unicodedata.normalize("NFD", token)
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _parse_monthly_limit() -> int:
    raw = os.getenv(_MONTHLY_LIMIT_ENV, "").strip()
    if not raw:
        return _DEFAULT_MONTHLY_LIMIT
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_MONTHLY_LIMIT
    return value if value >= 0 else _DEFAULT_MONTHLY_LIMIT


async def _monthly_usage_count(service_usage_logs_col: Any) -> int:
    now = utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    return int(
        await service_usage_logs_col.count_documents(
            {"service_name": SERVICE_NAME, "created_at": {"$gte": month_start}}
        )
    )


def _extract_gemini_text(data: dict[str, Any]) -> str | None:
    """Extraction défensive, jamais levée : un blocage/refus Gemini est un
    cache-miss silencieux comme n'importe quelle autre erreur ici."""
    if (data.get("promptFeedback") or {}).get("blockReason"):
        return None
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    candidate = candidates[0]
    if candidate.get("finishReason") in ("SAFETY", "RECITATION", "PROHIBITED_CONTENT"):
        return None
    parts = (candidate.get("content") or {}).get("parts") or []
    if not parts:
        return None
    text = parts[0].get("text", "")
    return text.strip() if text else None


def _parse_gemini_food_defaults(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    zone = data.get("storage_zone")
    if zone not in _VALID_STORAGE_ZONES:
        return None
    shelf_life_raw = data.get("shelf_life_days")
    shelf_life_raw = shelf_life_raw if isinstance(shelf_life_raw, dict) else {}

    def _int_or_none(value: Any) -> int | None:
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    shelf_life_days = {
        "fridge": _int_or_none(shelf_life_raw.get("fridge")),
        "pantry": _int_or_none(shelf_life_raw.get("pantry")),
        "freezer": _int_or_none(shelf_life_raw.get("freezer")),
    }
    confidence_raw = data.get("confidence")
    confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) and not isinstance(confidence_raw, bool) else 0.5
    return {"storage_zone": zone, "shelf_life_days": shelf_life_days, "confidence": confidence}


async def _call_gemini_food_defaults(
    *, name: str, food_category: str, gemini_key: str, gemini_model: str
) -> dict[str, Any] | None:
    url = _GEMINI_URL_TEMPLATE.format(model=gemini_model)
    payload = {
        "contents": [{"parts": [{"text": _PROMPT_TEMPLATE.format(name=name, food_category=food_category)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 512,
        },
    }

    response: Any = None
    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as http_client:
                response = await http_client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": gemini_key},
                    json=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "food_defaults Gemini call failed (attempt %d/%d): %s", attempt, _RETRY_ATTEMPTS, exc
            )
            response = None
            if attempt >= _RETRY_ATTEMPTS:
                return None
            await asyncio.sleep(float(2**attempt))
            continue

        if response.status_code in _RETRYABLE_HTTP_STATUSES and attempt < _RETRY_ATTEMPTS:
            await asyncio.sleep(float(2**attempt))
            continue
        break

    if response is None or response.status_code != 200:
        logger.warning(
            "food_defaults Gemini HTTP error: %s", getattr(response, "status_code", "no_response")
        )
        return None

    try:
        data = response.json()
    except Exception as exc:
        logger.warning("food_defaults Gemini response not JSON: %s", exc)
        return None

    text = _extract_gemini_text(data)
    if not text:
        return None
    return _parse_gemini_food_defaults(text)


async def resolve_food_defaults(
    *,
    name: str,
    food_category: str,
    food_defaults_col: Any,
    service_usage_logs_col: Any,
    gemini_api_key: str | None,
    gemini_model: str | None = None,
    plan_type_at_time: str = "system",
) -> dict[str, Any] | None:
    """Résout zone de stockage + durée de conservation par défaut pour un
    aliment, cache-first avec appel IA en dernier recours.

    Ne lève jamais d'exception : tout échec (réseau, quota, parsing, absence
    de clé) se traduit par un retour None, laissant l'appelant retomber sur
    ses tables statiques existantes.
    """
    key = _normalize_food_key(name)
    if not key:
        return None

    cached = await food_defaults_col.find_one({"key": key})
    if cached:
        try:
            await food_defaults_col.update_one({"key": key}, {"$inc": {"hit_count": 1}})
        except Exception as exc:
            logger.warning("food_defaults hit_count update failed: %s", exc)
        return {
            "storage_zone": cached.get("storage_zone"),
            "shelf_life_days": cached.get("shelf_life_days") or {},
        }

    if not gemini_api_key:
        return None

    monthly_limit = _parse_monthly_limit()
    usage = await _monthly_usage_count(service_usage_logs_col)
    if usage >= monthly_limit:
        logger.info(
            "food_defaults plafond mensuel atteint (%d/%d) — repli silencieux sur tables statiques",
            usage, monthly_limit,
        )
        return None

    model = gemini_model or _DEFAULT_GEMINI_MODEL
    try:
        result = await _call_gemini_food_defaults(
            name=name, food_category=food_category, gemini_key=gemini_api_key, gemini_model=model
        )
    except Exception as exc:
        logger.warning("food_defaults Gemini call raised unexpectedly: %s", exc)
        result = None

    await track_service_usage(
        service_usage_logs_col=service_usage_logs_col,
        user_id=None,
        service_name=SERVICE_NAME,
        action_name=ACTION_NAME,
        units_consumed=1,
        estimated_cost=float(os.getenv("GEMINI_FOOD_DEFAULTS_ESTIMATED_COST_EUR", "0.001")),
        plan_type_at_time=plan_type_at_time,
        metadata_json={"success": result is not None},
    )

    if not result:
        return None

    now_iso = utc_now().isoformat()
    try:
        await food_defaults_col.update_one(
            {"key": key},
            {
                "$set": {
                    "storage_zone": result["storage_zone"],
                    "shelf_life_days": result["shelf_life_days"],
                    "source": "ai",
                    "confidence": result.get("confidence", 0.5),
                    "updated_at": now_iso,
                },
                "$setOnInsert": {"created_at": now_iso, "hit_count": 0},
            },
            upsert=True,
        )
    except Exception as exc:
        logger.warning("food_defaults cache upsert failed: %s", exc)

    return {"storage_zone": result["storage_zone"], "shelf_life_days": result["shelf_life_days"]}


async def enrich_food_defaults_from_static(food_defaults_col: Any, items: list[dict[str, Any]]) -> None:
    """Alimente gratuitement le cache à partir d'un ticket déjà analysé par
    Gemini (aucun appel IA supplémentaire — le ticket a déjà classé chaque
    article). N'écrase jamais une entrée déjà affinée par un appel IA dédié
    (source="ai") avec une valeur moins fiable issue d'un simple fallback
    catégorie.
    """
    now_iso = utc_now().isoformat()
    for item in items:
        name = item.get("normalized_title") or item.get("name") or ""
        key = _normalize_food_key(name)
        storage_zone = item.get("storage_zone")
        if not key or storage_zone not in _VALID_STORAGE_ZONES:
            continue
        try:
            existing = await food_defaults_col.find_one({"key": key})
            if existing and existing.get("source") == "ai":
                continue
            await food_defaults_col.update_one(
                {"key": key},
                {
                    "$set": {
                        "storage_zone": storage_zone,
                        "shelf_life_days": {
                            "fridge": item.get("shelf_life_fridge"),
                            "pantry": item.get("shelf_life_pantry"),
                            "freezer": item.get("shelf_life_freezer"),
                        },
                        "source": "static_table",
                        "confidence": 1.0,
                        "updated_at": now_iso,
                    },
                    "$setOnInsert": {"created_at": now_iso, "hit_count": 0},
                },
                upsert=True,
            )
        except Exception as exc:
            logger.warning("food_defaults enrich_from_static failed for %r: %s", name, exc)
