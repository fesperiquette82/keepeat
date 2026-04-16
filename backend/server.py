# backend/server.py
from __future__ import annotations

import os

from dotenv import load_dotenv
load_dotenv()

import asyncio
import base64
import difflib
import json
import re
import secrets
import subprocess
import time
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

import aiosmtplib
import httpx
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ValidationError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from alerts import (
    AlertDependencies,
    alert_loop,
    check_daily_expiry_alert,
    check_inactivity_and_notify,
    check_recalls_and_notify,
    check_weekly_expiry_summary,
    fetch_recent_recalls,
    seed_default_user,
    send_expo_push,
)
from app_core import days_until, logger, redirect_html, serialize_mongo, utc_now
from auth_utils import create_token, get_current_user, hash_password, http_bearer, validate_password, verify_password
from models import (
    BillingEntitlementsResponse,
    BillingRestoreResponse,
    BillingUsageResponse,
    BillingVerifyRequest,
    AlertPreferences,
    AlertPreferencesUpdate,
    ForgotPasswordBody,
    ProductBase,
    ProductLookupResponse,
    PriorityRefreshBody,
    PriorityRefreshResponse,
    RecallsRefreshResponse,
    PushTokenBody,
    RecipeCatalogResponse,
    RecipeSuggestionGroupsResponse,
    RegisterResponse,
    ResendVerificationBody,
    ResetPasswordBody,
    ShelfLife,
    StatsResponse,
    StockItem,
    StockItemCreate,
    StockItemUpdate,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserResponse,
    VerifyEmailBody,
)
from entitlements import (
    FEATURE_AI,
    FEATURE_OCR,
    FEATURE_PREDICTIONS,
    FEATURE_STATS_ADVANCED,
    PREMIUM_PLAN,
    PREMIUM_PRODUCT_ID,
    build_entitlements_snapshot,
    check_access_or_raise,
    consume_quota_or_raise,
    feature_policy,
    resolve_plan,
)
from ocr_service import OcrApiError, ocr_receipt
from priority_refresh import build_priority_refresh_state
from observability import (
    build_monitoring_kpis,
    extract_user_id_from_auth_header,
    log_api_request,
    resolve_plan_type_at_time,
    summarize_api_metrics,
    summarize_services_usage,
    track_business_event,
    track_service_usage,
)
from admin_service_control import build_cost_recommendations, build_services_status, build_usage_metrics
from product_catalog import infer_food_category, infer_shelf_life, lookup_product_openfoodfacts
from recipes_service import (
    _FRIGO_CATS,
    _PLACARD_CATS,
    append_recipe_to_catalog,
    load_local_recipes,
    get_recipes_catalog,
    get_recipe_catalog_debug_info,
    fr_to_en_ingredient,
    recipe_match_to_grouped_suggestion,
    recipe_match_to_suggestion,
    resolve_suggestion_style,
    suggest_recipe_groups_from_catalog,
    suggest_recipes_from_catalog,
)

MONGO_URL = os.getenv("MONGO_URL")
if not MONGO_URL:
    raise RuntimeError("MONGO_URL is required. Set it in Render > Environment Variables.")

DB_NAME = os.getenv("DB_NAME", "keepeat_db")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
stock_col = db["stock"]
users_col = db["users"]
user_alerts_col = db["user_alerts"]
app_state_col = db["app_state"]
products_cache_col = db["products_cache"]
community_recipes_col = db["community_recipes"]
recipes_col = db["recipes"]
recipe_gap_requests_col = db["recipe_gap_requests"]
api_request_logs_col = db["api_request_logs"]
business_events_col = db["business_events"]
service_usage_logs_col = db["service_usage_logs"]
daily_metrics_col = db["daily_metrics"]
receipt_tickets_col = db["receipt_tickets"]

_BACKEND_URL = os.getenv("BACKEND_URL", "https://keepeat-backend.onrender.com")
_GOOGLE_ANDROID_PACKAGE = os.getenv("GOOGLE_ANDROID_PACKAGE", "com.fesperiquette.keepeat")
APP_STARTED_AT = utc_now()


def _parse_admin_emails(raw: str | None) -> set[str]:
    if not raw:
        return set()
    normalized = raw.replace(";", ",")
    emails: set[str] = set()
    for item in normalized.split(","):
        token = item.strip().lower()
        if not token or "@" not in token:
            continue
        emails.add(token)
    return emails


_ADMIN_EMAILS = _parse_admin_emails(os.getenv("ADMIN_EMAILS"))

# Hash factice utilisé dans le login pour garantir un temps de réponse constant
# même quand l'email n'existe pas (prévention d'oracle timing)
_DUMMY_HASH = hash_password("_keepeat_timing_sentinel_xK9mP2qR7vL3nZ5j")


def _resolve_backend_commit() -> str:
    for key in ("RENDER_GIT_COMMIT", "GIT_COMMIT_SHA", "COMMIT_SHA", "SOURCE_VERSION"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=os.path.dirname(__file__),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.5,
        ).strip()
        if commit:
            return commit
    except Exception:
        pass
    return "unavailable"


def _resolve_backend_version() -> str:
    for key in ("APP_VERSION", "RENDER_SERVICE_VERSION", "RELEASE_VERSION"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return "1.0.0"


_BACKEND_VERSION = _resolve_backend_version()
_BACKEND_COMMIT = _resolve_backend_commit()


def _normalize_locale_tag(raw_locale: Any) -> str | None:
    if not isinstance(raw_locale, str):
        return None
    token = raw_locale.strip()
    if not token:
        return None
    token = token.split(",")[0].split(";")[0].strip().replace("_", "-")
    if not token:
        return None
    parts = token.split("-")
    if len(parts) == 1:
        return parts[0].lower()
    return f"{parts[0].lower()}-{parts[1].upper()}"


def _resolve_recipes_locale(locale_query: str | None, accept_language: str | None) -> tuple[str, str]:
    requested_locale = _normalize_locale_tag(locale_query) or _normalize_locale_tag(accept_language) or "fr-FR"
    # Le catalogue local est actuellement fr-FR; locale effective stable et rétrocompatible.
    effective_locale = "fr-FR"
    return requested_locale, effective_locale


def _build_recipes_debug_meta(
    *,
    endpoint: str,
    recipe_filter: str | None = None,
    effective_filter: str | None = None,
    requested_locale: str | None = None,
    effective_locale: str | None = None,
    suggestion_style: str | None = None,
) -> dict[str, Any]:
    catalog_info = get_recipe_catalog_debug_info()
    return {
        "backend_commit": _BACKEND_COMMIT,
        "backend_version": _BACKEND_VERSION,
        "recipes_source": catalog_info["recipes_source"],
        "catalog_hash": catalog_info["catalog_hash"],
        "catalog_name": catalog_info["catalog_name"],
        "catalog_locale": catalog_info["catalog_locale"],
        "requested_locale": requested_locale or "fr-FR",
        "effective_locale": effective_locale or catalog_info["catalog_locale"],
        "endpoint": endpoint,
        "filter": recipe_filter,
        "filter_effective": effective_filter or recipe_filter,
        "suggestion_style": suggestion_style or "classique",
        "served_at": utc_now().isoformat(),
    }


def _apply_recipes_debug_headers(response: Response | None, meta: dict[str, Any]) -> None:
    if response is None:
        return
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Backend-Commit"] = str(meta.get("backend_commit", "unknown"))
    response.headers["X-Backend-Version"] = str(meta.get("backend_version", "unknown"))
    response.headers["X-Recipes-Source"] = str(meta.get("recipes_source", "unknown"))
    response.headers["X-Catalog-Hash"] = str(meta.get("catalog_hash", "unknown"))
    response.headers["X-Catalog-Locale"] = str(meta.get("catalog_locale", "unknown"))
    response.headers["X-Recipes-Filter"] = str(meta.get("filter_effective", meta.get("filter", "unknown")))
    response.headers["X-Recipes-Suggestion-Style"] = str(meta.get("suggestion_style", "classique"))
    response.headers["X-Requested-Locale"] = str(meta.get("requested_locale", "fr-FR"))
    response.headers["X-Effective-Locale"] = str(meta.get("effective_locale", "fr-FR"))


class _GptRecipePayload(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=240)
    duration_min: int = Field(default=20, ge=5, le=90)
    dish_type: str = Field(default="Recette simple", max_length=60)
    available_ingredients: list[str] = Field(default_factory=list)
    missing_ingredients: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list, min_length=1, max_length=8)
    anti_waste_reason: str = Field(default="", max_length=200)


class _GptRecipesEnvelope(BaseModel):
    recipes: list[_GptRecipePayload] = Field(default_factory=list, max_length=3)


_FILTER_ALIAS_TO_WINDOW_DAYS: dict[str, int | None] = {
    "expiryday": 0,
    "cejour": 0,
    "today": 0,
    "expiryweek": 7,
    "urgent": 7,
    "cettesemaine": 7,
    "expirymonth": 31,
    "cemois": 31,
    "stock": None,
    "all": None,
    "toutes": None,
    "personalized": None,
}


def _normalize_recipe_filter_token(raw_filter: str | None) -> str:
    token = (raw_filter or "all").strip().lower()
    token = re.sub(r"[^a-z0-9]+", "", token)
    return token or "all"


def _resolve_temporal_filter_window_days(recipe_filter: str | None) -> int | None:
    token = _normalize_recipe_filter_token(recipe_filter)
    return _FILTER_ALIAS_TO_WINDOW_DAYS.get(token)


def _is_filter_with_temporal_window(recipe_filter: str | None) -> bool:
    return _resolve_temporal_filter_window_days(recipe_filter) is not None


def _normalize_text_for_dedup(value: str) -> str:
    lowered = value.strip().lower()
    simplified = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", simplified).strip()


def _title_similarity(left: str, right: str) -> float:
    return difflib.SequenceMatcher(a=_normalize_text_for_dedup(left), b=_normalize_text_for_dedup(right)).ratio()


def _ingredients_overlap_ratio(left: list[str], right: list[str]) -> float:
    left_set = {_normalize_text_for_dedup(item) for item in left if item}
    right_set = {_normalize_text_for_dedup(item) for item in right if item}
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def _compute_anti_waste_priority(expiry_date: str | None, today: datetime) -> int:
    if not expiry_date:
        return 5
    try:
        days_left = (datetime.fromisoformat(expiry_date).date() - today.date()).days
    except Exception:
        return 5
    if days_left <= 0:
        return 100
    if days_left <= 2:
        return 95
    if days_left <= 7:
        return 80
    if days_left <= 31:
        return 65
    return 40


def _build_openai_recipes_prompt(*, stock_snapshot: list[dict[str, Any]], active_filter: str) -> str:
    serialized_items = json.dumps(stock_snapshot[:24], ensure_ascii=False)
    return (
        "Tu es un assistant culinaire anti-gaspi pour un utilisateur français.\n"
        "Règles impératives:\n"
        "- Réponds uniquement en français.\n"
        "- Retourne uniquement du JSON valide, sans markdown ni texte hors JSON.\n"
        "- Format STRICT attendu: {\"recipes\": [...]}.\n"
        "- Maximum 3 recettes.\n"
        "- Recettes simples, réalistes, crédibles, non fantaisistes.\n"
        "- Priorise les produits qui expirent le plus vite.\n"
        "- Exclure totalement les produits expirés.\n"
        "- Au moins 1 ingrédient disponible en stock par recette.\n"
        "- Limiter les ingrédients manquants (idéalement 0 à 3).\n"
        "- Profil anti-gaspi, cuisine du quotidien en France.\n"
        "- Évite recettes sophistiquées/exotiques.\n\n"
        f"Filtre actif côté application: {active_filter}\n"
        "Stock disponible (déjà nettoyé côté backend):\n"
        f"{serialized_items}\n\n"
        "Retourne exactement:\n"
        "{\n"
        "  \"recipes\": [\n"
        "    {\n"
        "      \"title\": \"...\",\n"
        "      \"description\": \"...\",\n"
        "      \"duration_min\": 12,\n"
        "      \"dish_type\": \"Poêlée\",\n"
        "      \"available_ingredients\": [\"...\"],\n"
        "      \"missing_ingredients\": [\"...\"],\n"
        "      \"steps\": [\"...\"],\n"
        "      \"anti_waste_reason\": \"...\"\n"
        "    }\n"
        "  ]\n"
        "}\n"
    )


async def _fetch_gpt_recipes(
    *,
    gemini_key: str,
    stock_snapshot: list[dict[str, Any]],
    active_filter: str,
) -> list[_GptRecipePayload]:
    prompt = _build_openai_recipes_prompt(stock_snapshot=stock_snapshot, active_filter=active_filter)
    system_text = "Tu es un assistant culinaire anti-gaspi strict."
    try:
        async with httpx.AsyncClient(timeout=12.0) as http:
            response = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": system_text}]},
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 1200,
                        "responseMimeType": "application/json",
                    },
                },
            )
    except Exception as exc:
        logger.warning("RECIPES_GPT request failed: %s", exc)
        return []

    if response.status_code != 200:
        logger.warning("RECIPES_GPT request error status=%s body=%s", response.status_code, response.text[:200])
        return []

    try:
        raw_content = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        parsed = _GptRecipesEnvelope.model_validate_json(raw_content)
        return parsed.recipes[:3]
    except (KeyError, ValidationError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("RECIPES_GPT invalid payload: %s", exc)
        return []


async def _run_backend_warmup() -> None:
    """Backward-compatible alias for run_backend_warmup."""
    await run_backend_warmup()


async def run_backend_warmup() -> dict[str, Any]:
    """Précharge les éléments critiques pour limiter les cold starts.

    Retourne un résumé exploitable pour les logs/tests sans faire échouer le startup
    en cas d'échec partiel.
    """
    global_start = time.perf_counter()
    logger.info("Warm-up startup: begin")

    catalog_loaded = False
    db_ping_ok = False

    catalog_start = time.perf_counter()
    try:
        recipes = load_local_recipes()
        catalog_loaded = True
        logger.info(
            "Warm-up startup: catalog step success (%s recipes) in %.1fms",
            len(recipes),
            (time.perf_counter() - catalog_start) * 1000,
        )
    except Exception as exc:
        logger.warning(
            "Warm-up startup: catalog step failed in %.1fms (%s)",
            (time.perf_counter() - catalog_start) * 1000,
            exc,
        )

    db_start = time.perf_counter()
    try:
        if db is not None:
            await db.command("ping")
            db_ping_ok = True
            logger.info("Warm-up startup: db step success in %.1fms", (time.perf_counter() - db_start) * 1000)
        else:
            logger.warning("Warm-up startup: db step skipped (db is not configured)")
    except Exception as exc:
        logger.warning("Warm-up startup: db step failed in %.1fms (%s)", (time.perf_counter() - db_start) * 1000, exc)

    summary = {
        "catalog_loaded": catalog_loaded,
        "db_ping_ok": db_ping_ok,
        "duration_ms": round((time.perf_counter() - global_start) * 1000, 1),
    }
    logger.info("Warm-up startup: global summary %s", summary)
    return summary


async def _seed_shared_recipes_collection_if_needed() -> None:
    try:
        existing = await recipes_col.count_documents({}, limit=1)
        if existing > 0:
            return
        seeded_docs: list[dict[str, Any]] = []
        for recipe in load_local_recipes():
            doc = {
                "_id": recipe.id,
                "id": recipe.id,
                "title": recipe.title,
                "description": recipe.summary,
                "dish_type": recipe.meal_type[0].value if recipe.meal_type else "plat",
                "duration_min": int(recipe.prep_time_min + recipe.cook_time_min),
                "difficulty": recipe.difficulty.value,
                "ingredients": [{"name": ingredient, "quantity": "", "optional": False} for ingredient in recipe.ingredients_required]
                + [{"name": ingredient, "quantity": "", "optional": True} for ingredient in recipe.ingredients_optional],
                "steps": recipe.steps,
                "tags": recipe.tags,
                "is_active": True,
                "created_by": "seed_local_catalog",
                "created_at": utc_now().isoformat(),
                "updated_at": utc_now().isoformat(),
                "usage_count": 0,
                "view_count": 0,
            }
            seeded_docs.append(doc)
        if seeded_docs:
            await recipes_col.insert_many(seeded_docs, ordered=False)
            logger.info("Seed recipes collection completed with %d recipes", len(seeded_docs))
    except Exception as exc:
        logger.warning("Seed recipes collection skipped/failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Warm-up startup: trigger from FastAPI lifespan")
    try:
        warmup_summary = await run_backend_warmup()
        logger.info("Warm-up startup: lifespan summary %s", warmup_summary)
    except Exception as exc:
        logger.exception("Warm-up startup: unexpected failure ignored (%s)", exc)
    await seed_default_user(users_col)

    await user_alerts_col.create_index("sent_at", expireAfterSeconds=30 * 24 * 3600)
    await products_cache_col.create_index("cached_at", expireAfterSeconds=7 * 24 * 3600)
    await products_cache_col.create_index("barcode", unique=True)
    await community_recipes_col.create_index("created_at")
    await recipes_col.create_index("id", unique=True)
    await recipes_col.create_index([("is_active", 1), ("updated_at", -1)])
    await recipe_gap_requests_col.create_index("signature", unique=True)
    await recipe_gap_requests_col.create_index([("status", 1), ("last_seen_at", -1)])
    await recipe_gap_requests_col.create_index([("user_id", 1), ("last_seen_at", -1)])
    await api_request_logs_col.create_index([("created_at", -1)])
    await api_request_logs_col.create_index([("endpoint_key", 1), ("created_at", -1)])
    await api_request_logs_col.create_index([("status_code", 1), ("created_at", -1)])
    await business_events_col.create_index([("event_name", 1), ("created_at", -1)])
    await business_events_col.create_index([("user_id", 1), ("created_at", -1)])
    await service_usage_logs_col.create_index([("service_name", 1), ("created_at", -1)])
    await service_usage_logs_col.create_index([("plan_type_at_time", 1), ("created_at", -1)])
    await daily_metrics_col.create_index("date", unique=True)
    await stock_col.create_index([("user_id", 1), ("status", 1), ("expiry_date", 1)])
    await stock_col.create_index([("user_id", 1), ("status", 1), ("consumed_date", 1)])
    await stock_col.create_index([("user_id", 1), ("status", 1), ("thrown_date", 1)])
    await users_col.create_index("email", unique=True)
    await users_col.create_index("verification_token", sparse=True)
    await users_col.create_index("reset_token", sparse=True)
    await receipt_tickets_col.create_index([("status", 1), ("created_at", -1)])
    await receipt_tickets_col.create_index([("user_id", 1), ("created_at", -1)])
    await _seed_shared_recipes_collection_if_needed()

    deps = AlertDependencies(
        users_col=users_col,
        stock_col=stock_col,
        user_alerts_col=user_alerts_col,
        app_state_col=app_state_col,
        products_cache_col=products_cache_col,
        community_recipes_col=community_recipes_col,
        send_push=send_expo_push,
        fr_to_en_ingredient=fr_to_en_ingredient,
    )
    alert_task = asyncio.create_task(alert_loop(deps))
    yield
    alert_task.cancel()
    client.close()


app = FastAPI(title="KeepEat Backend", version="1.0.0", lifespan=lifespan)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/privacy-policy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy():
    """Politique de confidentialité RGPD — URL à fournir dans la fiche Google Play Store."""
    return HTMLResponse(content=_PRIVACY_POLICY_HTML)


_PRIVACY_POLICY_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Politique de confidentialité — KeepEat</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1f2937; line-height: 1.6; }
  h1 { color: #16A34A; } h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  a { color: #16A34A; }
</style>
</head>
<body>
<h1>Politique de confidentialité — KeepEat</h1>
<p><em>Dernière mise à jour : avril 2026</em></p>

<h2>1. Qui sommes-nous ?</h2>
<p>
KeepEat est une application mobile de gestion des stocks alimentaires développée et exploitée par Francois Esperiquette.<br>
Contact : <a href="mailto:fesperiquette@hotmail.com">fesperiquette@hotmail.com</a>
</p>

<h2>2. Données collectées</h2>
<ul>
  <li><strong>Compte</strong> : adresse e-mail, mot de passe sécurisé (haché).</li>
  <li><strong>Stock alimentaire</strong> : produits, codes-barres, dates de péremption, quantités.</li>
  <li><strong>Photos (OCR)</strong> : images envoyées temporairement à un service tiers (OpenAI) pour analyse puis supprimées — aucune photo n’est stockée.</li>
  <li><strong>Achats in-app</strong> : données nécessaires à la gestion des abonnements via Google Play Billing.</li>
  <li><strong>Notifications push</strong> : token technique (Expo) pour l’envoi d’alertes.</li>
  <li><strong>Logs techniques</strong> : informations techniques (ex : adresse IP, appareil) utilisées pour la sécurité et le diagnostic.</li>
</ul>

<h2>3. Finalités</h2>
<ul>
  <li>Fournir les fonctionnalités de l’application (stock, alertes, recettes).</li>
  <li>Gérer les comptes et abonnements Premium.</li>
  <li>Envoyer des notifications.</li>
  <li>Améliorer le service et assurer la sécurité.</li>
</ul>

<h2>4. Services tiers</h2>
<ul>
  <li><strong>Render</strong> : hébergement backend.</li>
  <li><strong>MongoDB Atlas</strong> : base de données.</li>
  <li><strong>OpenAI</strong> : OCR et analyse.</li>
  <li><strong>Google Play Billing</strong> : gestion des abonnements.</li>
  <li><strong>Expo / EAS</strong> : notifications push.</li>
</ul>
<p>Certains services peuvent traiter des données hors UE avec des garanties appropriées.</p>

<h2>5. Conservation</h2>
<p>Les données sont conservées pendant la durée d’utilisation du service puis supprimées dans un délai raisonnable.</p>

<h2>6. Vos droits</h2>
<p>
Vous pouvez demander l’accès, la modification ou la suppression de vos données à tout moment :<br>
<a href="mailto:fesperiquette@hotmail.com">fesperiquette@hotmail.com</a>
</p>

<h2>7. Sécurité</h2>
<p>Les données sont protégées via chiffrement (HTTPS) et accès sécurisé.</p>

<h2>8. Modifications</h2>
<p>Cette politique peut être mise à jour à tout moment.</p>

</body>
</html>"""


@app.get("/health")
async def health_root():
    mongo_ok = True
    try:
        await db.command("ping")
    except Exception:
        mongo_ok = False
    return {"status": "ok" if mongo_ok else "degraded", "mongo": mongo_ok, "timestamp": utc_now().isoformat()}


cors_origins = os.getenv("CORS_ORIGINS", "*").strip()
if cors_origins == "*":
    logger.warning(
        "⚠️  CORS_ORIGINS='*' — Toutes les origines sont autorisées. Acceptable pour une app mobile-only. À restreindre si un frontend web utilise ce backend."
    )
    origins: list[str] = ["*"]
else:
    origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
    logger.info("CORS origines autorisées : %s", origins)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _get_current_user(credentials=Depends(http_bearer)):
    return await get_current_user(users_col, credentials)


def _is_admin_user(user_doc: dict[str, Any] | None) -> bool:
    if not user_doc:
        return False
    if bool(user_doc.get("is_admin")):
        return True
    email = str(user_doc.get("email", "")).strip().lower()
    return bool(email and email in _ADMIN_EMAILS)


async def _require_admin_user(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
) -> Dict[str, Any]:
    user_doc = await users_col.find_one(
        {"_id": ObjectId(current_user["id"])},
        {"email": 1, "is_admin": 1, "is_premium": 1, "subscription_status": 1},
    ) or current_user
    email = str(user_doc.get("email", "")).strip().lower()
    if not _is_admin_user(user_doc):
        logger.warning(
            "ADMIN_ACCESS denied route=%s email=%s result=denied",
            str(request.url.path),
            email or "unknown",
        )
        raise HTTPException(status_code=403, detail="Admin access required")
    logger.info("ADMIN_ACCESS allowed route=%s email=%s result=allowed", str(request.url.path), email or "unknown")
    return user_doc


def _parse_date_param(date_str: str | None, *, default_days_ago: int) -> str:
    if not date_str:
        return (utc_now() - timedelta(days=default_days_ago)).isoformat()
    try:
        parsed = datetime.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid ISO date: {date_str}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


@app.middleware("http")
async def api_request_logging_middleware(request: Request, call_next):
    started = time.perf_counter()
    status_code = 500
    response: Response | None = None
    caught_exc: Exception | None = None

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        caught_exc = exc
        raise
    finally:
        path = str(request.url.path)
        if path.startswith("/api/"):
            user_id = extract_user_id_from_auth_header(request.headers.get("Authorization"))
            duration_ms = (time.perf_counter() - started) * 1000
            status = status_code if response is not None else 500
            try:
                await log_api_request(
                    api_request_logs_col=api_request_logs_col,
                    method=request.method,
                    path=path,
                    user_id=user_id,
                    status_code=status,
                    duration_ms=duration_ms,
                )
            except Exception as log_exc:
                logger.warning("api_request_logging_middleware failed: %s", log_exc)
            if path.startswith("/api/admin/") and status in (401, 403):
                logger.warning(
                    "ADMIN_ACCESS request_denied route=%s method=%s status=%s user_id=%s auth_header=%s",
                    path,
                    request.method,
                    status,
                    user_id or "unknown",
                    "present" if request.headers.get("Authorization") else "missing",
                )
            if caught_exc is not None:
                logger.exception("API request failed method=%s path=%s", request.method, path)


async def _send_email(to: str, subject: str, html_body: str) -> None:
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        logger.warning("Email non envoyé vers %s : BREVO_API_KEY non configuré", to)
        return
    sender_email = os.getenv("MAIL_FROM", "").strip()
    if not sender_email:
        logger.error("Email non envoyé vers %s : MAIL_FROM non configuré", to)
        return
    sender_name = os.getenv("MAIL_FROM_NAME", "KeepEat")
    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html_body,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client_http:
            response = await client_http.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={"api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
        if response.status_code in (200, 201):
            logger.info("Email envoyé à %s : %s", to, subject)
        else:
            logger.error("Échec envoi email à %s : HTTP %s — %s", to, response.status_code, response.text[:200])
    except Exception as exc:
        logger.error("Échec envoi email à %s : %s", to, exc)


def _current_period_key(now: datetime | None = None) -> str:
    dt = now or utc_now()
    return dt.strftime("%Y-%m")


def _next_period_reset_at(now: datetime | None = None) -> str:
    dt = now or utc_now()
    year = dt.year + (1 if dt.month == 12 else 0)
    month = 1 if dt.month == 12 else dt.month + 1
    reset = datetime(year, month, 1, tzinfo=timezone.utc)
    return reset.isoformat()


async def _get_usage_snapshot(*, user_id: str, plan: str, period: str) -> dict[str, dict[str, int | None]]:
    usage: dict[str, dict[str, int | None]] = {}
    for feature in (FEATURE_OCR, FEATURE_AI):
        policy = feature_policy(plan, feature)
        limit = policy.get("monthly_limit")
        if limit is None:
            usage[feature] = {"used": 0, "limit": None, "remaining": 999999}
            continue
        counter_id = f"usage:{user_id}:{feature}:{period}"
        doc = await app_state_col.find_one({"_id": counter_id}, {"used": 1})
        used = int((doc or {}).get("used") or 0)
        usage[feature] = {
            "used": used,
            "limit": int(limit),
            "remaining": max(0, int(limit) - used),
        }
    return usage


async def _enforce_feature_access(
    *,
    current_user: Dict[str, Any],
    feature: str,
    consume_quota: bool = False,
) -> dict[str, Any]:
    plan = resolve_plan(current_user)
    policy = check_access_or_raise(plan=plan, feature=feature)
    if consume_quota:
        period = _current_period_key()
        reset_at = _next_period_reset_at()
        quota_result = await consume_quota_or_raise(
            app_state_col=app_state_col,
            user_id=current_user["id"],
            feature=feature,
            monthly_limit=policy.get("monthly_limit"),
            period=period,
            reset_at=reset_at,
        )
        return {"plan": plan, "policy": policy, "quota": quota_result}
    return {"plan": plan, "policy": policy}


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/build-info")
async def build_info():
    """Retourne des informations de build pour diagnostiquer l'environnement ciblé."""
    return {
        "service": "keepeat-backend",
        "env": os.getenv("APP_ENV", os.getenv("ENV", "unknown")),
        "version": _BACKEND_VERSION,
        "commit": _BACKEND_COMMIT,
        "deployed_at": os.getenv("DEPLOYED_AT", "unknown"),
    }


# -----------------------------------------------------------------------------
# Auth routes
# -----------------------------------------------------------------------------

@api_router.post("/auth/register", response_model=RegisterResponse, status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, body: UserCreate):
    validate_password(body.password)

    existing = await users_col.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    verification_token = secrets.token_urlsafe(32)
    doc = {
        "email": body.email.lower(),
        "hashed_password": hash_password(body.password),
        "is_premium": False,
        "email_verified": False,
        "verification_token": verification_token,
        "verification_token_exp": (utc_now() + timedelta(hours=24)).isoformat(),
        "created_at": utc_now().isoformat(),
        "last_login": None,
    }
    try:
        await users_col.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email already registered")
    created_user = await users_col.find_one({"email": body.email.lower()}, {"_id": 1})
    await track_business_event(
        business_events_col=business_events_col,
        user_id=str(created_user["_id"]) if created_user else None,
        event_name="user_registered",
        event_category="auth",
        metadata_json={"method": "email_password"},
    )

    redirect_link = f"{_BACKEND_URL}/redirect/verify-email?token={verification_token}"
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#4CAF50">Bienvenue sur KeepEat !</h2>
      <p>Merci de vous être inscrit. Cliquez sur le bouton ci-dessous pour confirmer votre adresse email.</p>
      <a href="{redirect_link}" style="display:inline-block;padding:14px 28px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
        Confirmer mon email
      </a>
      <p style="color:#888;font-size:12px">Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet email.</p>
    </div>
    """
    await _send_email(body.email.lower(), "Confirmez votre adresse email — KeepEat", html_body)

    return RegisterResponse(message="verification_sent", email=body.email.lower())


@api_router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: UserLogin):
    doc = await users_col.find_one({"email": body.email.lower()})
    # Toujours appeler verify_password (même avec hash factice) pour éviter
    # l'énumération d'emails par différence de temps de réponse
    hash_to_check = doc["hashed_password"] if doc else _DUMMY_HASH
    password_ok = verify_password(body.password, hash_to_check)
    if not doc or not password_ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not doc.get("email_verified", True):
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")

    user_id = str(doc["_id"])
    await users_col.update_one({"_id": doc["_id"]}, {"$set": {"last_login": utc_now().isoformat()}})
    token = create_token(user_id)
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user_id,
            email=doc["email"],
            is_premium=doc.get("is_premium", False),
            is_verified=doc.get("email_verified", True),
        ),
    )


@api_router.post("/auth/verify-email", response_model=TokenResponse)
async def verify_email(body: VerifyEmailBody):
    doc = await users_col.find_one({"verification_token": body.token})
    if not doc:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")

    exp_raw = doc.get("verification_token_exp")
    if not exp_raw:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")
    exp = datetime.fromisoformat(exp_raw)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if utc_now() > exp:
        raise HTTPException(status_code=400, detail="TOKEN_EXPIRED")

    user_id = str(doc["_id"])
    await users_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"email_verified": True, "last_login": utc_now().isoformat()},
         "$unset": {"verification_token": "", "verification_token_exp": ""}},
    )
    token = create_token(user_id)
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user_id,
            email=doc["email"],
            is_premium=doc.get("is_premium", False),
            is_verified=True,
        ),
    )


@api_router.post("/auth/resend-verification")
@limiter.limit("3/minute")
async def resend_verification(request: Request, body: ResendVerificationBody):
    doc = await users_col.find_one({"email": body.email.lower(), "email_verified": False})
    if doc:
        new_token = secrets.token_urlsafe(32)
        await users_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "verification_token": new_token,
                "verification_token_exp": (utc_now() + timedelta(hours=24)).isoformat(),
            }},
        )
        redirect_link = f"{_BACKEND_URL}/redirect/verify-email?token={new_token}"
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="color:#4CAF50">Confirmation de votre email KeepEat</h2>
          <p>Voici votre nouveau lien de confirmation :</p>
          <a href="{redirect_link}" style="display:inline-block;padding:14px 28px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
            Confirmer mon email
          </a>
          <p style="color:#888;font-size:12px">Ce lien expire dans 24 heures.</p>
        </div>
        """
        await _send_email(body.email.lower(), "Nouveau lien de confirmation — KeepEat", html_body)
    # Réponse identique qu'un email soit trouvé ou non (anti-énumération)
    return {"message": "sent"}


@api_router.post("/auth/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, body: ForgotPasswordBody):
    doc = await users_col.find_one({"email": body.email.lower()})
    if doc:
        reset_token = secrets.token_urlsafe(32)
        await users_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "reset_token": reset_token,
                "reset_token_exp": (utc_now() + timedelta(hours=1)).isoformat(),
            }},
        )
        redirect_link = f"{_BACKEND_URL}/redirect/reset-password?token={reset_token}"
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="color:#4CAF50">Réinitialisation de votre mot de passe KeepEat</h2>
          <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous :</p>
          <a href="{redirect_link}" style="display:inline-block;padding:14px 28px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
            Réinitialiser mon mot de passe
          </a>
          <p style="color:#888;font-size:12px">Ce lien expire dans 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
        </div>
        """
        await _send_email(body.email.lower(), "Réinitialisation du mot de passe — KeepEat", html_body)
    return {"message": "sent"}


@api_router.post("/auth/reset-password")
@limiter.limit("5/minute")
async def reset_password(request: Request, body: ResetPasswordBody):
    validate_password(body.new_password)

    doc = await users_col.find_one({"reset_token": body.token})
    if not doc:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")

    exp_raw = doc.get("reset_token_exp")
    if not exp_raw:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")
    exp = datetime.fromisoformat(exp_raw)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if utc_now() > exp:
        raise HTTPException(status_code=400, detail="TOKEN_EXPIRED")

    await users_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"hashed_password": hash_password(body.new_password)},
         "$unset": {"reset_token": "", "reset_token_exp": ""}},
    )
    return {"message": "password_updated"}


@api_router.get("/auth/me", response_model=UserResponse)
async def me(current_user: Dict[str, Any] = Depends(_get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        is_premium=current_user.get("is_premium", False),
        is_verified=current_user.get("email_verified", True),
    )


# -----------------------------------------------------------------------------
# Billing / Entitlements
# -----------------------------------------------------------------------------

@api_router.get("/billing/entitlements", response_model=BillingEntitlementsResponse)
async def get_billing_entitlements(
    source: str | None = Query(None),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    user_doc = await users_col.find_one({"_id": ObjectId(current_user["id"])}) or current_user
    if source == "paywall":
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="premium_paywall_viewed",
            event_category="premium",
            metadata_json={"source": "billing_entitlements"},
        )
    snapshot = build_entitlements_snapshot(user_doc)
    return BillingEntitlementsResponse(**snapshot)


@api_router.get("/billing/usage", response_model=BillingUsageResponse)
async def get_billing_usage(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    user_doc = await users_col.find_one({"_id": ObjectId(current_user["id"])}) or current_user
    plan = resolve_plan(user_doc)
    period = _current_period_key()
    usage = await _get_usage_snapshot(user_id=current_user["id"], plan=plan, period=period)
    return BillingUsageResponse(period=period, usage=usage)


async def _get_google_play_access_token(credentials_json: str) -> str | None:
    """Obtient un token OAuth2 pour Google Play Developer API via un compte de service."""
    def _sync_refresh() -> str:
        try:
            from google.oauth2 import service_account
            import google.auth.transport.requests as _greq
            creds = service_account.Credentials.from_service_account_info(
                json.loads(credentials_json),
                scopes=["https://www.googleapis.com/auth/androidpublisher"],
            )
            creds.refresh(_greq.Request())
            return creds.token  # type: ignore[return-value]
        except ImportError:
            raise RuntimeError("google-auth non installé — ajouter google-auth aux requirements")

    try:
        return await asyncio.to_thread(_sync_refresh)
    except Exception as exc:
        logger.error("Échec du refresh du token Google Play service account: %s", exc)
        return None


async def _verify_google_play_subscription(
    purchase_token: str,
    subscription_id: str,
) -> dict | None:
    """
    Vérifie un abonnement via Google Play Developer API.
    Retourne le dict de réponse si disponible, None si non configuré ou en cas d'erreur.
    Quand None est retourné en dev (GOOGLE_PLAY_SERVICE_ACCOUNT_JSON absent),
    l'appelant doit appliquer une durée fixe de 30 jours (fail-open contrôlé).
    """
    sa_json = os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "").strip()
    if not sa_json:
        logger.warning(
            "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON non configuré — vérification Google Play ignorée (mode dev)"
        )
        return None

    access_token = await _get_google_play_access_token(sa_json)
    if not access_token:
        return None

    url = (
        f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
        f"/{_GOOGLE_ANDROID_PACKAGE}/purchases/subscriptions/{subscription_id}/tokens/{purchase_token}"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            resp = await http_client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        if resp.status_code == 200:
            return resp.json()
        logger.warning("Google Play Developer API returned HTTP %s", resp.status_code)
        return None
    except Exception as exc:
        logger.error("Google Play Developer API request failed: %s", exc)
        return None


async def _handle_subscription_active(purchase_token: str, subscription_id: str) -> None:
    """Marque l'abonnement comme actif suite à un RTDN d'achat ou de renouvellement."""
    play_data = await _verify_google_play_subscription(purchase_token, subscription_id)
    expiry_millis = play_data.get("expiryTimeMillis") if play_data else None
    if expiry_millis:
        expires_at = datetime.fromtimestamp(int(expiry_millis) / 1000, tz=timezone.utc).isoformat()
    else:
        expires_at = (utc_now() + timedelta(days=30)).isoformat()
    result = await users_col.update_one(
        {"store_purchase_token": purchase_token},
        {"$set": {
            "is_premium": True,
            "subscription_status": "active",
            "subscription_expires_at": expires_at,
            "subscription_updated_at": utc_now().isoformat(),
        }},
    )
    logger.info(
        "RTDN subscription activated token=...%s matched=%d expires_at=%s",
        purchase_token[-6:], result.matched_count, expires_at,
    )


async def _handle_subscription_inactive(purchase_token: str) -> None:
    """Désactive le premium suite à un RTDN d'annulation/expiration."""
    result = await users_col.update_one(
        {"store_purchase_token": purchase_token},
        {"$set": {
            "is_premium": False,
            "subscription_status": "inactive",
            "subscription_updated_at": utc_now().isoformat(),
        }},
    )
    logger.info(
        "RTDN subscription deactivated token=...%s matched=%d",
        purchase_token[-6:], result.matched_count,
    )


@api_router.post("/billing/google/verify", response_model=BillingRestoreResponse)
async def verify_google_subscription(
    body: BillingVerifyRequest,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="premium_checkout_started",
        event_category="premium",
        metadata_json={"platform": body.platform, "product_id": body.product_id},
    )
    if body.product_id != PREMIUM_PRODUCT_ID:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_PRODUCT", "product_id": body.product_id},
        )
    purchase_token = body.purchase_token.strip()
    if not purchase_token:
        raise HTTPException(status_code=400, detail={"code": "INVALID_PURCHASE_TOKEN"})
    if purchase_token.startswith("demo_"):
        logger.warning("BILLING purchase_token demo rejeté user=%s", current_user["id"])
        raise HTTPException(status_code=400, detail={"code": "INVALID_PURCHASE_TOKEN", "reason": "Demo tokens not accepted"})

    # Vérification via Google Play Developer API
    play_data = await _verify_google_play_subscription(
        purchase_token=purchase_token,
        subscription_id=body.product_id,
    )
    if play_data is not None:
        # paymentState : 0=pending, 1=received, 2=free trial — null=deferred
        payment_state = play_data.get("paymentState")
        if payment_state not in (1, 2):
            logger.warning(
                "BILLING paymentState invalide=%s user=%s", payment_state, current_user["id"]
            )
            raise HTTPException(
                status_code=402,
                detail={"code": "PAYMENT_NOT_RECEIVED", "paymentState": payment_state},
            )
        expiry_millis = play_data.get("expiryTimeMillis")
        if expiry_millis:
            expires_at = datetime.fromtimestamp(int(expiry_millis) / 1000, tz=timezone.utc).isoformat()
        else:
            expires_at = (utc_now() + timedelta(days=30)).isoformat()
    else:
        # GOOGLE_PLAY_SERVICE_ACCOUNT_JSON absent (env dev) — durée fixe de 30 jours
        expires_at = (utc_now() + timedelta(days=30)).isoformat()

    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {
            "is_premium": True,
            "subscription_status": "active",
            "subscription_expires_at": expires_at,
            "store_platform": body.platform,
            "store_product_id": body.product_id,
            "store_purchase_token": body.purchase_token,
            "subscription_updated_at": utc_now().isoformat(),
        }},
    )
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="premium_checkout_succeeded",
        event_category="premium",
        metadata_json={"platform": body.platform, "product_id": body.product_id},
    )
    return BillingRestoreResponse(
        ok=True,
        plan=PREMIUM_PLAN,
        subscription_status="active",
        subscription_expires_at=expires_at,
    )


@api_router.post("/billing/restore", response_model=BillingRestoreResponse)
async def restore_subscription(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    user_doc = await users_col.find_one({"_id": ObjectId(current_user["id"])}) or current_user
    plan = resolve_plan(user_doc)
    status = user_doc.get("subscription_status") or ("active" if plan == PREMIUM_PLAN else "inactive")
    if plan == PREMIUM_PLAN:
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="premium_restored",
            event_category="premium",
            metadata_json={"subscription_status": status},
        )
        return BillingRestoreResponse(
            ok=True,
            plan=PREMIUM_PLAN,
            subscription_status=status,
            subscription_expires_at=user_doc.get("subscription_expires_at"),
        )

    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"is_premium": False, "subscription_status": "inactive"}},
    )
    return BillingRestoreResponse(ok=True, plan="free", subscription_status="inactive", subscription_expires_at=None)


@api_router.post("/billing/google/rtdn")
async def google_play_rtdn(request: Request):
    """
    Webhook Pub/Sub pour les Real-Time Developer Notifications (RTDN) Google Play.
    Google Cloud Pub/Sub envoie : {"message": {"data": "<base64_json>"}, "subscription": "..."}
    Toujours retourner HTTP 200 pour éviter les re-livraisons exponentielles Pub/Sub.

    Configuration requise dans Google Play Console > Monétisation > Configuration > Notifications :
      - URL de l'endpoint : https://keepeat-backend.onrender.com/api/billing/google/rtdn
      - Définir GOOGLE_RTDN_TOKEN et ajouter ?token=<valeur> à l'URL OU configurer
        l'authentification Pub/Sub native (recommandé).
    """
    # Vérification optionnelle par token Bearer (défini dans GOOGLE_RTDN_TOKEN)
    rtdn_token = os.getenv("GOOGLE_RTDN_TOKEN", "").strip()
    if rtdn_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header != f"Bearer {rtdn_token}":
            raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    message = body.get("message", {})
    data_b64 = message.get("data", "")
    if not data_b64:
        return {"ok": True}

    try:
        notification = json.loads(base64.b64decode(data_b64).decode("utf-8"))
    except Exception as exc:
        logger.warning("RTDN base64 decode failed: %s", exc)
        return {"ok": True}

    sub_notif = notification.get("subscriptionNotification", {})
    notif_type = sub_notif.get("notificationType")
    purchase_token = sub_notif.get("purchaseToken", "").strip()
    subscription_id = sub_notif.get("subscriptionId", "")

    logger.info("RTDN notificationType=%s subscriptionId=%s", notif_type, subscription_id)

    if not purchase_token:
        return {"ok": True}

    # notificationType : 1=PURCHASED, 2=RENEWED, 4=PURCHASED_WITH_DEFERRED, 7=RESTARTED → actif
    # 3=CANCELED, 6=IN_GRACE_PERIOD, 12=EXPIRED, 13=ON_HOLD → inactif
    try:
        if notif_type in (1, 2, 4, 7):
            await _handle_subscription_active(purchase_token, subscription_id)
        elif notif_type in (3, 12, 13):
            await _handle_subscription_inactive(purchase_token)
    except Exception as exc:
        logger.error("RTDN processing error notificationType=%s: %s", notif_type, exc)

    return {"ok": True}


# -----------------------------------------------------------------------------
# Admin routes
# -----------------------------------------------------------------------------

@api_router.put("/admin/users/{email}/set-premium")
async def set_premium(
    email: str,
    premium: bool = Query(True),
    admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Met à jour le statut premium d'un utilisateur (admin authentifié)."""
    admin_email = str(admin_user.get("email", "")).strip().lower()
    logger.info(
        "ADMIN_ACTION action=set_premium target_email=%s premium=%s actor=%s",
        email.lower(),
        premium,
        admin_email or "unknown",
    )
    res = await users_col.update_one(
        {"email": email.lower()},
        {"$set": {"is_premium": premium}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "email": email.lower(), "is_premium": premium}


# -----------------------------------------------------------------------------
# Stock routes (auth required — isolated by user_id)
# -----------------------------------------------------------------------------

_ALLOWED_STOCK_STATUSES = {"active", "consumed", "thrown", "expired"}

@api_router.get("/stock", response_model=List[StockItem])
async def get_stock(
    status: str = "active",
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    if status not in _ALLOWED_STOCK_STATUSES:
        raise HTTPException(status_code=422, detail=f"Statut invalide. Valeurs acceptées : {sorted(_ALLOWED_STOCK_STATUSES)}")
    cursor = stock_col.find({"user_id": current_user["id"], "status": status}).sort("added_date", -1)
    docs = await cursor.to_list(length=1000)
    return [serialize_mongo(d) for d in docs]


@api_router.post("/stock", response_model=StockItem)
async def add_stock(
    item: StockItemCreate,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    doc = item.model_dump()
    doc["user_id"] = current_user["id"]
    doc["added_date"] = utc_now().isoformat()
    doc["status"] = "active"
    doc["consumed_date"] = None
    doc["thrown_date"] = None
    doc["food_category"] = infer_food_category(ProductBase(**item.model_dump()))

    res = await stock_col.insert_one(doc)
    created = await stock_col.find_one({"_id": res.inserted_id})
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="product_added",
        event_category="stock",
        metadata_json={"food_category": doc.get("food_category"), "has_expiry_date": bool(doc.get("expiry_date"))},
    )
    onboarding_update = await users_col.update_one(
        {"_id": ObjectId(current_user["id"]), "onboarding_completed_at": {"$exists": False}},
        {"$set": {"onboarding_completed_at": utc_now().isoformat()}},
    )
    if getattr(onboarding_update, "modified_count", 0) > 0:
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="onboarding_completed",
            event_category="lifecycle",
            metadata_json={"trigger": "first_product_added"},
        )
    return serialize_mongo(created)


@api_router.put("/stock/{item_id}", response_model=StockItem)
async def update_stock(
    item_id: str,
    item: StockItemUpdate,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    update_data = item.model_dump(exclude_unset=True)
    if not update_data:
        existing = await stock_col.find_one({"_id": oid, "user_id": current_user["id"]})
        if not existing:
            raise HTTPException(status_code=404, detail="Item not found")
        return serialize_mongo(existing)

    res = await stock_col.update_one(
        {"_id": oid, "user_id": current_user["id"], "status": "active"},
        {"$set": update_data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Active item not found")

    updated = await stock_col.find_one({"_id": oid})
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="product_updated",
        event_category="stock",
        metadata_json={"updated_fields": list(update_data.keys())[:20]},
    )
    return serialize_mongo(updated)


@api_router.post("/stock/{item_id}/consume")
async def consume_item(
    item_id: str,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    res = await stock_col.update_one(
        {"_id": oid, "user_id": current_user["id"]},
        {"$set": {"status": "consumed", "consumed_date": utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_stock_action": utc_now().isoformat()}},
    )
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="stock_consumed",
        event_category="stock",
        metadata_json={"item_id": item_id},
    )
    return {"ok": True}


@api_router.post("/stock/{item_id}/throw")
async def throw_item(
    item_id: str,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    res = await stock_col.update_one(
        {"_id": oid, "user_id": current_user["id"]},
        {"$set": {"status": "thrown", "thrown_date": utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_stock_action": utc_now().isoformat()}},
    )
    return {"ok": True}


@api_router.post("/stock/{item_id}/restore")
async def restore_item(
    item_id: str,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    res = await stock_col.update_one(
        {"_id": oid, "user_id": current_user["id"]},
        {"$set": {"status": "active", "consumed_date": None, "thrown_date": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")

    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_stock_action": utc_now().isoformat()}},
    )
    return {"ok": True}


@api_router.get("/stock/priority", response_model=List[StockItem])
async def get_priority_items(current_user: Dict[str, Any] = Depends(_get_current_user)):
    docs = await _compute_priority_items(
        user_id=current_user["id"],
        lead_days=3,
        reminders_enabled=True,
    )
    return [serialize_mongo(d) for d in docs]


def _priority_refresh_state_id(user_id: str) -> str:
    return f"priority_refresh_state:{user_id}"


async def _compute_priority_items(*, user_id: str, lead_days: int, reminders_enabled: bool) -> list[dict[str, Any]]:
    if not reminders_enabled:
        return []

    threshold = (utc_now().date() + timedelta(days=lead_days)).strftime("%Y-%m-%d")
    cursor = stock_col.find({
        "user_id": user_id,
        "status": "active",
        "expiry_date": {"$nin": [None, ""], "$lte": threshold},
    }).sort("expiry_date", 1)
    return await cursor.to_list(length=500)


@api_router.post("/stock/priority/refresh", response_model=PriorityRefreshResponse)
async def refresh_priority_items(
    body: PriorityRefreshBody,
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    state_id = _priority_refresh_state_id(current_user["id"])
    previous_state = await app_state_col.find_one({"_id": state_id})
    logger.info(
        "Priority refresh request user=%s method=%s path=%s payload=%s",
        current_user["id"],
        request.method,
        str(request.url.path),
        body.model_dump(),
    )
    try:
        docs = await _compute_priority_items(
            user_id=current_user["id"],
            lead_days=body.lead_days,
            reminders_enabled=body.reminders_enabled,
        )
        items = [serialize_mongo(d) for d in docs]
        refreshed_at = utc_now().isoformat()
        item_ids = [item["id"] for item in items]

        state_doc = build_priority_refresh_state(
            previous_state,
            succeeded=True,
            last_refresh_at=refreshed_at,
            item_ids=item_ids,
            count=len(item_ids),
            lead_days=body.lead_days,
            reminders_enabled=body.reminders_enabled,
        )
        await app_state_col.update_one(
            {"_id": state_id},
            {"$set": state_doc},
            upsert=True,
        )

        payload = PriorityRefreshResponse(
            items=items,
            last_refresh_at=refreshed_at,
            count=len(item_ids),
            lead_days_used=body.lead_days,
            reminders_enabled=body.reminders_enabled,
        )
        logger.info(
            "Priority refresh success user=%s method=%s path=%s count=%d last_refresh_at=%s",
            current_user["id"],
            request.method,
            str(request.url.path),
            payload.count,
            payload.last_refresh_at,
        )
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        preserved_state = build_priority_refresh_state(
            previous_state,
            succeeded=False,
            last_refresh_at=utc_now().isoformat(),
            item_ids=[],
            count=0,
            lead_days=body.lead_days,
            reminders_enabled=body.reminders_enabled,
        )
        if preserved_state:
            await app_state_col.update_one(
                {"_id": state_id},
                {"$set": preserved_state},
                upsert=True,
            )
        logger.exception(
            "Priority refresh failed user=%s method=%s path=%s payload=%s",
            current_user["id"],
            request.method,
            str(request.url.path),
            body.model_dump(),
        )
        raise HTTPException(status_code=500, detail={"message": "Impossible de mettre à jour les produits prioritaires.", "reason": str(exc)})


@api_router.get("/stock/history")
async def get_stock_history(
    limit: int = Query(default=15, le=50),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Produits récemment consommés/jetés (60j), dédupliqués par nom — pour le réajout rapide."""
    user_id = current_user["id"]
    since = (utc_now() - timedelta(days=60)).isoformat()
    cursor = stock_col.find({
        "user_id": user_id,
        "status": {"$in": ["consumed", "thrown"]},
        "added_date": {"$gte": since},
    }).sort("added_date", -1).limit(200)
    items = await cursor.to_list(length=200)

    seen: set[str] = set()
    result = []
    for item in items:
        key = item.get("name", "").lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append({
            "name": item["name"],
            "brand": item.get("brand") or "",
            "image_url": item.get("image_url") or "",
            "category": item.get("category") or "",
            "food_category": item.get("food_category") or "",
            "barcode": item.get("barcode") or "",
            "shelf_life_fridge": item.get("shelf_life_fridge"),
            "shelf_life_pantry": item.get("shelf_life_pantry"),
            "shelf_life_freezer": item.get("shelf_life_freezer"),
            "shelf_life_category": item.get("shelf_life_category") or "",
            "shelf_life_tips": item.get("shelf_life_tips") or "",
        })
        if len(result) >= limit:
            break
    return result


@api_router.get("/stats", response_model=StatsResponse)
async def get_stats(current_user: Dict[str, Any] = Depends(_get_current_user)):
    uid = current_user["id"]
    today_str = utc_now().strftime("%Y-%m-%d")
    in_3_days_str = (utc_now() + timedelta(days=3)).strftime("%Y-%m-%d")
    week_ago = (utc_now() - timedelta(days=7)).isoformat()

    # Agrégation unique côté MongoDB — aucun document rapatrié en RAM
    pipeline = [
        {"$match": {"user_id": uid, "status": "active"}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "expired": {
                    "$sum": {
                        "$cond": [
                            {"$and": [
                                {"$ne": ["$expiry_date", None]},
                                {"$lt": ["$expiry_date", today_str]},
                            ]},
                            1, 0,
                        ]
                    }
                },
                "expiring_soon": {
                    "$sum": {
                        "$cond": [
                            {"$and": [
                                {"$ne": ["$expiry_date", None]},
                                {"$gte": ["$expiry_date", today_str]},
                                {"$lte": ["$expiry_date", in_3_days_str]},
                            ]},
                            1, 0,
                        ]
                    }
                },
            }
        },
    ]
    agg = await stock_col.aggregate(pipeline).to_list(length=1)
    counts = agg[0] if agg else {"total": 0, "expired": 0, "expiring_soon": 0}

    consumed_this_week = await stock_col.count_documents(
        {"user_id": uid, "status": "consumed", "consumed_date": {"$gte": week_ago}}
    )
    thrown_this_week = await stock_col.count_documents(
        {"user_id": uid, "status": "thrown", "thrown_date": {"$gte": week_ago}}
    )

    return StatsResponse(
        total_items=counts["total"],
        expiring_soon=counts["expiring_soon"],
        expired=counts["expired"],
        consumed_this_week=consumed_this_week,
        thrown_this_week=thrown_this_week,
    )


@api_router.get("/product/{barcode}", response_model=ProductLookupResponse)
async def get_product(
    barcode: str,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    # Valider le format barcode : chiffres uniquement, 4 à 14 caractères (EAN-8, EAN-13, UPC-A…)
    if not barcode.isdigit() or not (4 <= len(barcode) <= 14):
        raise HTTPException(status_code=422, detail="Format de barcode invalide (4-14 chiffres)")
    product = await lookup_product_openfoodfacts(barcode, products_cache_col)
    await track_service_usage(
        service_usage_logs_col=service_usage_logs_col,
        user_id=current_user["id"],
        service_name="openfoodfacts",
        action_name="product_lookup",
        units_consumed=1,
        estimated_cost=float(os.getenv("OPENFOODFACTS_ESTIMATED_COST_EUR", "0")),
        plan_type_at_time="unknown",
        metadata_json={"barcode": barcode, "found": bool(product)},
    )
    shelf_life = infer_shelf_life(product if product else ProductBase(barcode=barcode))
    return ProductLookupResponse(
        found=product is not None,
        product=product,
        shelf_life=shelf_life,
    )


# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# Push tokens
# -----------------------------------------------------------------------------

@api_router.post("/push-token", status_code=204)
async def register_push_token(
    body: PushTokenBody,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Enregistre le push token Expo de l'appareil pour l'utilisateur courant."""
    if not body.token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Invalid Expo push token format")
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$addToSet": {"push_tokens": body.token}},
    )


@api_router.delete("/push-token", status_code=204)
async def unregister_push_token(
    body: PushTokenBody,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Supprime le push token de l'appareil (à appeler lors de la déconnexion)."""
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$pull": {"push_tokens": body.token}},
    )


@api_router.get("/recalls/status")
async def get_recalls_status(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne la date du dernier check rappel.conso (visible dans les paramètres)."""
    doc = await app_state_col.find_one({"key": "last_recall_check"})
    last_check: str | None = None
    if doc and doc.get("checked_at"):
        last_check = doc["checked_at"].replace(tzinfo=timezone.utc).isoformat()
    return {"last_check": last_check}


@api_router.post("/recalls/refresh", response_model=RecallsRefreshResponse)
async def refresh_recalls(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    attempted_at = utc_now().isoformat()
    state_key = "recalls_refresh_state"
    previous_state = await app_state_col.find_one({"key": state_key})
    previous_success = previous_state.get("last_successful_refresh_at") if previous_state else None

    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="recall_refresh_triggered",
        event_category="recall",
        metadata_json={"source": "manual"},
    )
    try:
        recalls = await fetch_recent_recalls(fail_on_error=True)
        refreshed_count = len(recalls)
        new_state = {
            "key": state_key,
            "last_successful_refresh_at": attempted_at,
            "last_attempt_at": attempted_at,
            "last_attempt_status": "success",
            "last_attempt_error": None,
            "refreshed_count": refreshed_count,
            "updated_by_user_id": current_user["id"],
        }
        await app_state_col.update_one({"key": state_key}, {"$set": new_state}, upsert=True)
        user_doc = await users_col.find_one({"_id": ObjectId(current_user["id"])}, {"is_premium": 1, "admin_granted": 1, "trial_ends_at": 1})
        await track_service_usage(
            service_usage_logs_col=service_usage_logs_col,
            user_id=current_user["id"],
            service_name="recall_service",
            action_name="manual_refresh",
            units_consumed=1,
            estimated_cost=float(os.getenv("RECALL_REFRESH_ESTIMATED_COST_EUR", "0")),
            plan_type_at_time=resolve_plan_type_at_time(user_doc or current_user),
            metadata_json={"refreshed_count": refreshed_count},
        )
        logger.info(
            "Manual recalls refresh succeeded user=%s method=%s path=%s count=%d",
            current_user["id"],
            request.method,
            str(request.url.path),
            refreshed_count,
        )
        return RecallsRefreshResponse(
            success=True,
            message="Liste des produits rappelés mise à jour.",
            refreshedCount=refreshed_count,
            lastSuccessfulRefreshAt=attempted_at,
            attemptedAt=attempted_at,
        )
    except Exception as exc:
        logger.exception(
            "Manual recalls refresh failed user=%s method=%s path=%s attempted_at=%s",
            current_user["id"],
            request.method,
            str(request.url.path),
            attempted_at,
        )
        await app_state_col.update_one(
            {"key": state_key},
            {
                "$set": {
                    "key": state_key,
                    "last_attempt_at": attempted_at,
                    "last_attempt_status": "error",
                    "last_attempt_error": str(exc),
                    "updated_by_user_id": current_user["id"],
                }
            },
            upsert=True,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Impossible de mettre à jour les produits rappelés.",
                "attemptedAt": attempted_at,
                "lastSuccessfulRefreshAt": previous_success,
                "reason": str(exc),
            },
        )


@api_router.get("/alerts/preferences", response_model=AlertPreferences)
async def get_alert_preferences(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    doc = await users_col.find_one({"_id": ObjectId(current_user["id"])}, {"alert_prefs": 1})
    prefs = (doc or {}).get("alert_prefs") or {}
    return AlertPreferences(
        alertJ2=bool(prefs.get("alertJ2", True)),
        alertJ0=bool(prefs.get("alertJ0", True)),
        alertWeekly=bool(prefs.get("alertWeekly", False)),
        alertRecall=bool(prefs.get("alertRecall", True)),
    )


@api_router.put("/alerts/preferences", response_model=AlertPreferences)
async def update_alert_preferences(
    body: AlertPreferencesUpdate,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    existing = await users_col.find_one({"_id": ObjectId(current_user["id"])}, {"alert_prefs": 1})
    current = (existing or {}).get("alert_prefs") or {}
    patch = body.model_dump(exclude_none=True)
    merged = {
        "alertJ2": bool(patch.get("alertJ2", current.get("alertJ2", True))),
        "alertJ0": bool(patch.get("alertJ0", current.get("alertJ0", True))),
        "alertWeekly": bool(patch.get("alertWeekly", current.get("alertWeekly", False))),
        "alertRecall": bool(patch.get("alertRecall", current.get("alertRecall", True))),
    }
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"alert_prefs": merged}},
    )
    return AlertPreferences(**merged)


_RECIPES_FILTER_MAP: dict[str, str] = {
    "expiryDay": "day",
    "expiryWeek": "week",
    "expiryMonth": "month",
    "stock": "all",
    "all": "all",
    "urgent": "week",
    "personalized": "all",
}


def _normalize_ingredient_name(raw_name: Any) -> str:
    token = str(raw_name or "").strip().lower()
    if not token:
        return ""
    normalized = unicodedata.normalize("NFD", token)
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    aliases = {
        "oeufs": "oeuf",
        "tomates": "tomate",
        "pommes de terre": "pomme de terre",
        "patates": "pomme de terre",
        "courgettes": "courgette",
        "oignons": "oignon",
    }
    if normalized in aliases:
        normalized = aliases[normalized]
    elif len(normalized) > 3 and normalized.endswith("s"):
        normalized = normalized[:-1]
    return normalized


def _to_iso_date(raw_date: Any) -> datetime | None:
    if not raw_date:
        return None
    if isinstance(raw_date, datetime):
        return raw_date
    value = str(raw_date).strip()
    if not value:
        return None
    try:
        if len(value) <= 10:
            return datetime.fromisoformat(value[:10]).replace(tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _build_gap_signature(*, normalized_ingredients: list[str], recipe_filter: str, criteria: dict[str, Any]) -> str:
    payload = {
        "filter": recipe_filter,
        "ingredients": sorted(set(normalized_ingredients)),
        "criteria": criteria,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


async def _send_recipe_gap_email(gap_doc: dict[str, Any], *, is_new: bool) -> None:
    threshold = int(os.getenv("RECIPE_GAP_EMAIL_THRESHOLD", "3"))
    count = int(gap_doc.get("occurrence_count") or 0)
    if not is_new and (threshold <= 1 or count % threshold != 0):
        return
    destination = os.getenv("RECIPE_GAP_EMAIL_TO", "keepeatfe@gmail.com").strip() or "keepeatfe@gmail.com"
    subject = "KeepEat - Besoin recette non couvert"
    uncovered = gap_doc.get("uncovered_ingredients") or gap_doc.get("normalized_ingredients") or []
    used = gap_doc.get("used_ingredients_in_reference_recipe") or []
    reference_title = gap_doc.get("reference_recipe_title") or ""
    html_body = f"""
    <h3>Besoin recette non couvert</h3>
    <p><b>Signature:</b> {gap_doc.get('signature')}</p>
    <p><b>Filtre:</b> {gap_doc.get('filter')}</p>
    <p><b>Statut:</b> {gap_doc.get('status')}</p>
    <p><b>Occurrences:</b> {gap_doc.get('occurrence_count')}</p>
    <p><b>Recette de référence:</b> {reference_title or 'aucune'}</p>
    <p><b>Ingrédients utilisés (recette de référence):</b> {', '.join(used) if used else 'aucun'}</p>
    <p><b>Ingrédients non couverts:</b> {', '.join(uncovered) if uncovered else 'aucun'}</p>
    <p><b>Dernière détection:</b> {gap_doc.get('last_seen_at')}</p>
    """
    await _send_email(destination, subject, html_body)


async def _mark_coverable_gaps_after_recipe_insert(recipe_doc: dict[str, Any]) -> None:
    ingredient_names = [_normalize_ingredient_name(i.get("name")) for i in recipe_doc.get("ingredients", [])]
    normalized_recipe_ingredients = sorted({name for name in ingredient_names if name})
    if not normalized_recipe_ingredients:
        return
    pending_gaps = await recipe_gap_requests_col.find({"status": {"$in": ["pending", "partially_resolved"]}}).to_list(length=500)
    for gap in pending_gaps:
        target_uncovered = gap.get("uncovered_ingredients")
        if target_uncovered is None:
            target_uncovered = gap.get("normalized_ingredients", [])
        gap_ingredients = set(target_uncovered)
        if not gap_ingredients:
            continue
        covered = gap_ingredients.intersection(normalized_recipe_ingredients)
        if not covered:
            continue
        remaining = sorted(gap_ingredients - covered)
        next_status = "resolved" if not remaining else "partially_resolved"
        await recipe_gap_requests_col.update_one(
            {"_id": gap["_id"]},
            {
                "$set": {
                    "status": next_status,
                    "resolved_at": utc_now().isoformat(),
                    "uncovered_ingredients": remaining,
                },
                "$addToSet": {"resolved_by_recipe_ids": recipe_doc.get("id")},
            },
        )


async def _fetch_stock_candidates(*, uid: str, filter_value: str) -> list[dict[str, Any]]:
    now = utc_now()
    today = now.date()
    max_day = today
    if filter_value == "week":
        max_day = today + timedelta(days=7)
    elif filter_value == "month":
        max_day = today + timedelta(days=31)

    query: dict[str, Any] = {"user_id": uid, "status": "active"}
    items = await stock_col.find(query).to_list(length=1500)
    filtered: list[dict[str, Any]] = []
    for item in items:
        expiry_date = _to_iso_date(item.get("expiry_date"))
        if expiry_date and expiry_date.date() < today:
            continue
        if filter_value in {"day", "week", "month"}:
            if expiry_date is None or expiry_date.date() > max_day:
                continue
        enriched = dict(item)
        enriched["_expiry_dt"] = expiry_date
        filtered.append(enriched)
    filtered.sort(key=lambda product: (product.get("_expiry_dt") is None, product.get("_expiry_dt") or datetime.max.replace(tzinfo=timezone.utc)))
    return filtered


# ── Image fetch helpers ───────────────────────────────────────────────────────

_PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"
_RECIPE_STOPWORDS = {
    "a", "à", "au", "aux", "de", "du", "des", "la", "le", "les",
    "avec", "en", "et", "sur", "pour", "par", "un", "une", "sans",
}


def _recipe_search_keywords(title: str) -> str:
    """Extrait les mots-clés significatifs d'un titre de recette pour la recherche d'images."""
    words = re.sub(r"[^a-zA-ZÀ-ÿ\s]", "", title.lower()).split()
    meaningful = [w for w in words if w not in _RECIPE_STOPWORDS]
    return " ".join(meaningful[:3]) + " recette cuisine"


async def _fetch_recipe_image_url(client: httpx.AsyncClient, title: str) -> str:
    """Interroge Pexels pour obtenir une URL d'image pour le titre de recette donné.
    Nécessite la variable d'environnement PEXELS_API_KEY.
    Retourne une chaîne vide si l'API échoue ou si la clé est absente.
    """
    pexels_key = os.environ.get("PEXELS_API_KEY", "")
    if not pexels_key:
        return ""
    keywords = _recipe_search_keywords(title)
    try:
        resp = await client.get(
            _PEXELS_SEARCH_URL,
            params={"query": keywords, "per_page": 1, "orientation": "landscape"},
            headers={"Authorization": pexels_key},
            timeout=8.0,
        )
        if resp.status_code == 200:
            photos = resp.json().get("photos", [])
            if photos:
                url = photos[0].get("src", {}).get("medium", "")
                if url:
                    return url
    except Exception as exc:
        logger.warning("Pexels image fetch failed for '%s': %s", title, exc)
    return ""


def _score_recipe_match(recipe_doc: dict[str, Any], stock_items: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_units = {
        "piece", "g", "kg", "ml", "cl", "l", "tsp", "tbsp", "pinch", "pot", "jar", "can", "slice",
    }
    display_unit_labels = {
        "piece": "pièce",
        "g": "g",
        "kg": "kg",
        "ml": "ml",
        "cl": "cl",
        "l": "l",
        "tsp": "c. à café",
        "tbsp": "c. à soupe",
        "pinch": "pincée",
        "pot": "pot",
        "jar": "bocal",
        "can": "boîte",
        "slice": "tranche",
    }

    unit_aliases = {
        "g": "g",
        "gr": "g",
        "gramme": "g",
        "grammes": "g",
        "kg": "kg",
        "kilogramme": "kg",
        "kilogrammes": "kg",
        "ml": "ml",
        "cl": "cl",
        "l": "l",
        "litre": "l",
        "litres": "l",
        "cac": "tsp",
        "cuillere a cafe": "tsp",
        "cuillère a cafe": "tsp",
        "cuillere a soupe": "tbsp",
        "cuillère a soupe": "tbsp",
        "cas": "tbsp",
        "pincee": "pinch",
        "pot": "pot",
        "bocal": "jar",
        "boite": "can",
        "tranche": "slice",
        "tranches": "slice",
        "piece": "piece",
        "pieces": "piece",
        "pièce": "piece",
        "pièces": "piece",
    }

    per_serving_inference: list[tuple[list[str], float, str, str]] = [
        (["oeuf", "œuf"], 0.5, "piece", "œuf"),
        (["riz", "pate", "pâtes", "semoule", "quinoa"], 75, "g", "g"),
        (["creme", "crème", "lait", "bouillon"], 50, "ml", "ml"),
        (["huile"], 0.5, "tbsp", "c. à soupe"),
        (["olive"], 3, "piece", "olive"),
    ]

    def _format_quantity_label(quantity: float | None, unit: str | None, display_unit: str | None) -> str | None:
        if quantity is None or not unit:
            return "Quantité à ajuster"
        quantity_label = str(int(quantity)) if float(quantity).is_integer() else f"{quantity:.1f}".rstrip("0").rstrip(".")
        label_unit = display_unit or display_unit_labels.get(unit, unit)
        return f"{quantity_label} {label_unit}".strip()

    def _parse_quantity_and_unit(quantity_raw: Any) -> tuple[float | None, str | None]:
        if isinstance(quantity_raw, (int, float)):
            return float(quantity_raw), "piece"
        if not isinstance(quantity_raw, str):
            return None, None
        raw = quantity_raw.strip().lower()
        if not raw:
            return None, None
        normalized = unicodedata.normalize("NFD", raw)
        normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
        normalized = re.sub(r"[^a-z0-9\s\.,]", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        match = re.match(r"^([0-9]+(?:[\.,][0-9]+)?)\s*([a-zàâäéèêëîïôöùûüç\s]+)?$", normalized)
        if not match:
            return None, None
        quantity = float(match.group(1).replace(",", "."))
        raw_unit = (match.group(2) or "").strip()
        if not raw_unit:
            return quantity, "piece"
        mapped = unit_aliases.get(raw_unit, raw_unit)
        if mapped in normalized_units:
            return quantity, mapped
        return quantity, None

    def _infer_quantity_and_unit(name: str, servings: int) -> tuple[float | None, str | None, str | None, bool]:
        normalized_name = _normalize_ingredient_name(name)
        for keywords, quantity_per_serving, unit, display_unit in per_serving_inference:
            if any(keyword in normalized_name for keyword in keywords):
                estimated_quantity = quantity_per_serving * max(1, servings)
                if estimated_quantity >= 10:
                    estimated_quantity = round(estimated_quantity)
                else:
                    estimated_quantity = round(estimated_quantity * 2) / 2
                return float(estimated_quantity), unit, display_unit, True
        return None, None, None, True

    normalized_stock_names = [_normalize_ingredient_name(i.get("name")) for i in stock_items if i.get("name")]
    stock_set = set(name for name in normalized_stock_names if name)
    stock_id_map: dict[str, list[str]] = {}
    for item in stock_items:
        normalized_name = _normalize_ingredient_name(item.get("name"))
        stock_id = str(item.get("_id") or item.get("id") or "").strip()
        if normalized_name and stock_id:
            stock_id_map.setdefault(normalized_name, []).append(stock_id)
    urgents = {
        _normalize_ingredient_name(item.get("name"))
        for item in stock_items
        if item.get("_expiry_dt") and 0 <= (item["_expiry_dt"].date() - utc_now().date()).days <= 2
    }

    ingredients = recipe_doc.get("ingredients", []) or []
    required_ingredients = [i for i in ingredients if not bool(i.get("optional"))]
    servings = int(recipe_doc.get("servings") or 2)
    structured_ingredients: list[dict[str, Any]] = []
    available: list[str] = []
    missing: list[str] = []
    urgent_hits = 0
    for ingredient in ingredients:
        normalized_name = _normalize_ingredient_name(ingredient.get("name"))
        if not normalized_name:
            continue
        is_optional = bool(ingredient.get("optional"))
        is_available = normalized_name in stock_set
        if not is_optional and is_available:
            available.append(normalized_name)
            if normalized_name in urgents:
                urgent_hits += 1
        elif not is_optional:
            missing.append(normalized_name)

        quantity, unit = _parse_quantity_and_unit(ingredient.get("quantity"))
        display_unit = display_unit_labels.get(unit) if unit else None
        is_estimated = False
        if unit and unit not in normalized_units:
            unit = None
        if quantity is None or unit is None:
            inferred_quantity, inferred_unit, inferred_display, estimated = _infer_quantity_and_unit(
                ingredient.get("name", ""),
                servings,
            )
            quantity = inferred_quantity if quantity is None else quantity
            unit = inferred_unit if unit is None else unit
            display_unit = inferred_display if display_unit is None else display_unit
            is_estimated = estimated
        matched_ids = stock_id_map.get(normalized_name, [])
        structured_ingredients.append(
            {
                "name": ingredient.get("name", ""),
                "quantity": quantity,
                "unit": unit,
                "display_unit": display_unit,
                "display_label": _format_quantity_label(quantity, unit, display_unit),
                "optional": is_optional,
                "available": is_available,
                "matched_stock_item_ids": matched_ids,
                "missing_quantity": None if is_available else quantity,
                "is_estimated": is_estimated,
            }
        )

    available_count = len(available)
    missing_count = len(missing)
    if available_count == 0:
        return {}

    duration = int(recipe_doc.get("duration_min") or 0)
    simple_bonus = 4 if duration and duration <= 20 else (2 if duration <= 35 else 0)
    score = (
        available_count * 3
        + urgent_hits * 5
        + simple_bonus
        - missing_count * 2
    )
    if missing_count >= 4:
        score -= 6
    return {
        "id": recipe_doc.get("id"),
        "title": recipe_doc.get("title"),
        "summary": recipe_doc.get("description", ""),
        "instructions_summary": recipe_doc.get("description", ""),
        "image": recipe_doc.get("image", ""),
        "servings": servings,
        "ingredients": structured_ingredients,
        "duration_min": duration,
        "dish_type": recipe_doc.get("dish_type", "Plat"),
        "available_count": available_count,
        "missing_count": missing_count,
        "available_ingredients": sorted(set(available)),
        "missing_ingredients": sorted(set(missing)),
        "steps": recipe_doc.get("steps", []),
        "score": score,
    }


async def _upsert_recipe_gap(
    *,
    uid: str,
    recipe_filter: str,
    stock_items: list[dict[str, Any]],
    criteria: dict[str, Any],
    uncovered_ingredients: list[str],
    reference_recipe: dict[str, Any] | None = None,
) -> bool:
    normalized_stock = sorted(
        {
            _normalize_ingredient_name(item.get("name"))
            for item in stock_items
            if item.get("name")
        }
    )
    normalized_stock = [name for name in normalized_stock if name]
    normalized_uncovered = sorted({_normalize_ingredient_name(name) for name in uncovered_ingredients if name})
    normalized_uncovered = [name for name in normalized_uncovered if name]
    if not normalized_uncovered:
        # Aucun ingrédient non couvert : pas de gap à signaler.
        return False
    signature = _build_gap_signature(
        normalized_ingredients=normalized_uncovered,
        recipe_filter=recipe_filter,
        criteria=criteria,
    )
    used_by_reference = sorted(set(normalized_stock) - set(normalized_uncovered))
    now_iso = utc_now().isoformat()
    existing = await recipe_gap_requests_col.find_one({"signature": signature})
    if existing:
        await recipe_gap_requests_col.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "last_seen_at": now_iso,
                    "status": "pending",
                    "uncovered_ingredients": normalized_uncovered,
                    "used_ingredients_in_reference_recipe": used_by_reference,
                    "reference_recipe_id": reference_recipe.get("id") if reference_recipe else None,
                    "reference_recipe_title": reference_recipe.get("title") if reference_recipe else None,
                },
                "$inc": {"occurrence_count": 1},
            },
        )
        refreshed = await recipe_gap_requests_col.find_one({"_id": existing["_id"]})
        if refreshed:
            await _send_recipe_gap_email(refreshed, is_new=False)
        return True

    doc = {
        "user_id": uid,
        "filter": recipe_filter,
        "available_ingredients": [item.get("name") for item in stock_items if item.get("name")],
        "normalized_ingredients": normalized_stock,
        "uncovered_ingredients": normalized_uncovered,
        "used_ingredients_in_reference_recipe": used_by_reference,
        "reference_recipe_id": reference_recipe.get("id") if reference_recipe else None,
        "reference_recipe_title": reference_recipe.get("title") if reference_recipe else None,
        "criteria": criteria,
        "signature": signature,
        "status": "pending",
        "occurrence_count": 1,
        "created_at": now_iso,
        "last_seen_at": now_iso,
        "resolved_at": None,
        "resolved_by_recipe_ids": [],
    }
    await recipe_gap_requests_col.insert_one(doc)
    await _send_recipe_gap_email(doc, is_new=True)
    return True


@api_router.get("/recipes/suggestions")
async def get_recipe_suggestions(
    response: Response = None,
    recipe_filter: str = Query("urgent", alias="filter"),
    include_meta: bool = Query(False, alias="include_meta"),
    suggestion_style: str = Query("classique", alias="suggestion_style"),
    locale: str | None = Query(None),
    accept_language: str | None = Header(None, alias="Accept-Language"),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Suggère des recettes depuis la collection backend partagée `recipes`."""
    uid = current_user["id"]
    include_meta_enabled = include_meta is True or str(include_meta).lower() in {"1", "true", "yes"}
    requested_locale, effective_locale = _resolve_recipes_locale(locale, accept_language)
    resolved_suggestion_style = resolve_suggestion_style(suggestion_style)
    effective_filter = _RECIPES_FILTER_MAP.get(recipe_filter, "all")
    logger.debug(
        "RECIPES_DEBUG suggestions called — user=%s filter=%s suggestion_style=%s",
        uid,
        recipe_filter,
        resolved_suggestion_style,
    )

    items = await _fetch_stock_candidates(uid=uid, filter_value=effective_filter)
    logger.debug(
        "RECIPES_DEBUG suggestions stock_items_raw — user=%s filter=%s count=%d sample=%s",
        uid,
        recipe_filter,
        len(items),
        [
            {
                "id": str(i.get("_id", "")),
                "name": i.get("name"),
                "expiry_date": i.get("expiry_date"),
                "food_category": i.get("food_category"),
            }
            for i in items[:10]
        ],
    )
    stock_names = [i.get("name", "") for i in items if i.get("name")]
    recipe_docs = await recipes_col.find({"is_active": True}).to_list(length=500)
    scored = [_score_recipe_match(recipe_doc, items) for recipe_doc in recipe_docs]
    scored = [candidate for candidate in scored if candidate]
    scored.sort(
        key=lambda candidate: (
            candidate.get("score", 0),
            candidate.get("available_count", 0),
            -candidate.get("missing_count", 0),
            -candidate.get("duration_min", 0),
        ),
        reverse=True,
    )
    relevant = [candidate for candidate in scored if candidate.get("available_count", 0) >= 1 and candidate.get("missing_count", 0) <= 3][:5]

    gap_logged = False
    suggest_later = False
    if not relevant:
        gemini_key = _get_recipes_ai_api_key()
        if gemini_key and stock_names:
            try:
                ai_raw = await asyncio.wait_for(
                    _ai_gap_fill(stock_names, gemini_key),
                    timeout=10.0,
                )
                if ai_raw:
                    ai_scored = await _save_ai_recipe_to_stores(ai_raw, stock_names=stock_names)
                    relevant = [ai_scored]
                    logger.info("AI gap fill: recette proposée pour user=%s", uid)
            except asyncio.TimeoutError:
                logger.warning("AI gap fill: timeout 10s dépassé pour user=%s", uid)
            except Exception as exc:
                logger.warning("AI gap fill: erreur pour user=%s: %s", uid, exc)

        if not relevant:
            # Ne signaler un gap que si l'utilisateur a bien des ingrédients en stock
            # correspondant au filtre actif. Un stock vide ou un filtre temporel sans
            # produits expirants ne doit pas déclencher d'e-mail.
            if stock_names:
                normalized_stock_names = sorted(
                    {
                        _normalize_ingredient_name(item.get("name"))
                        for item in items
                        if item.get("name")
                    }
                )
                normalized_stock_names = [name for name in normalized_stock_names if name]
                reference_recipe = scored[0] if scored else None
                used_ingredients = set(reference_recipe.get("available_ingredients", [])) if reference_recipe else set()
                uncovered_ingredients = [
                    ingredient for ingredient in normalized_stock_names if ingredient not in used_ingredients
                ]
                try:
                    gap_logged = await _upsert_recipe_gap(
                        uid=uid,
                        recipe_filter=effective_filter,
                        stock_items=items,
                        criteria={"min_score": 1, "max_missing": 3},
                        uncovered_ingredients=uncovered_ingredients,
                        reference_recipe=reference_recipe,
                    )
                except Exception as exc:
                    logger.warning("Recipe gap upsert failed for user=%s: %s", uid, exc)
            suggest_later = True

    logger.info("Recipes suggestions: filter=%s stock=%s top5=%s", recipe_filter, stock_names[:5], [match.get("title") for match in relevant])
    recipes_payload = relevant
    logger.debug(
        "RECIPES_DEBUG suggestions response — user=%s filter=%s count=%d ids=%s titles=%s",
        uid,
        recipe_filter,
        len(recipes_payload),
        [r.get("id") for r in recipes_payload],
        [r.get("title") for r in recipes_payload],
    )
    meta = _build_recipes_debug_meta(
        endpoint="/api/recipes/suggestions",
        recipe_filter=recipe_filter,
        effective_filter=effective_filter,
        requested_locale=requested_locale,
        effective_locale=effective_locale,
        suggestion_style=resolved_suggestion_style,
    )
    meta["total_candidates"] = len(scored)
    meta["returned"] = len(recipes_payload)
    meta["gap_logged"] = gap_logged
    meta["suggest_later"] = suggest_later
    _apply_recipes_debug_headers(response=response, meta=meta)
    if include_meta_enabled:
        return {"recipes": recipes_payload, "meta": meta}
    return recipes_payload


@api_router.get("/recipes/suggestions-grouped", response_model=RecipeSuggestionGroupsResponse)
async def get_recipe_suggestions_grouped(
    response: Response = None,
    recipe_filter: str = Query("urgent", alias="filter"),
    suggestion_style: str = Query("classique", alias="suggestion_style"),
    per_group_limit: int = Query(5, ge=1, le=20),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Suggère des recettes groupées par faisabilité depuis le catalogue local.
    filter: urgent (≤7j) | all | frigo | placard
    """
    uid = current_user["id"]
    resolved_suggestion_style = resolve_suggestion_style(suggestion_style)
    logger.debug(
        "RECIPES_DEBUG suggestions-grouped called — user=%s filter=%s per_group_limit=%s suggestion_style=%s",
        uid,
        recipe_filter,
        per_group_limit,
        resolved_suggestion_style,
    )
    today_str = utc_now().strftime("%Y-%m-%d")

    match: dict = {"user_id": uid, "status": "active"}
    if recipe_filter == "urgent":
        in_7_days = (utc_now().date() + timedelta(days=7)).strftime("%Y-%m-%d")
        match["expiry_date"] = {"$nin": [None, ""], "$gte": today_str, "$lte": in_7_days}
    elif recipe_filter == "frigo":
        match["food_category"] = {"$in": _FRIGO_CATS}
    elif recipe_filter == "placard":
        match["food_category"] = {"$in": _PLACARD_CATS}

    pipeline = [
        {"$match": match},
        {"$addFields": {"_no_expiry": {"$cond": [{"$or": [{"$eq": ["$expiry_date", None]}, {"$eq": ["$expiry_date", ""]}]}, 1, 0]}}},
        {"$sort": {"_no_expiry": 1, "expiry_date": 1}},
        {"$limit": 20},
    ]
    items = await stock_col.aggregate(pipeline).to_list(length=20)
    logger.debug(
        "RECIPES_DEBUG suggestions-grouped stock_items_raw — user=%s filter=%s count=%d sample=%s",
        uid,
        recipe_filter,
        len(items),
        [
            {
                "id": str(i.get("_id", "")),
                "name": i.get("name"),
                "expiry_date": i.get("expiry_date"),
                "food_category": i.get("food_category"),
            }
            for i in items[:10]
        ],
    )
    stock_names = [i.get("name", "") for i in items if i.get("name")]
    storage_focus = recipe_filter if recipe_filter in {"frigo", "placard"} else None

    grouped_matches = suggest_recipe_groups_from_catalog(
        stock_names,
        limit_per_group=per_group_limit,
        storage_focus=storage_focus,
        suggestion_style=resolved_suggestion_style,
    )

    grouped_response = RecipeSuggestionGroupsResponse(
        ready=[recipe_match_to_grouped_suggestion(m) for m in grouped_matches["ready"]],
        almost=[recipe_match_to_grouped_suggestion(m) for m in grouped_matches["almost"]],
        inspiration=[recipe_match_to_grouped_suggestion(m) for m in grouped_matches["inspiration"]],
    )
    logger.info(
        "Recipes grouped suggestions: filter=%s stock=%s counts=%s",
        recipe_filter,
        stock_names[:5],
        {k: len(v) for k, v in grouped_matches.items()},
    )
    logger.debug(
        "RECIPES_DEBUG suggestions-grouped response — user=%s filter=%s ready=%s almost=%s inspiration=%s",
        uid,
        recipe_filter,
        [r.id for r in grouped_response.ready],
        [r.id for r in grouped_response.almost],
        [r.id for r in grouped_response.inspiration],
    )
    meta = _build_recipes_debug_meta(
        endpoint="/api/recipes/suggestions-grouped",
        recipe_filter=recipe_filter,
        suggestion_style=resolved_suggestion_style,
    )
    _apply_recipes_debug_headers(response=response, meta=meta)
    return grouped_response


@api_router.get("/recipes/catalog", response_model=RecipeCatalogResponse)
async def get_recipe_catalog(
    limit: int = Query(20, ge=1, le=200),
    meal_type: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    cuisine: Optional[str] = Query(None),
):
    logger.debug(
        "RECIPES_DEBUG catalog called — limit=%s meal_type=%s difficulty=%s tag=%s cuisine=%s",
        limit,
        meal_type,
        difficulty,
        tag,
        cuisine,
    )
    recipes = get_recipes_catalog(
        limit=limit,
        meal_type=meal_type,
        difficulty=difficulty,
        tag=tag,
        cuisine=cuisine,
    )
    logger.debug(
        "RECIPES_DEBUG catalog response — count=%d ids=%s",
        len(recipes),
        [r.id for r in recipes[:20]],
    )
    return RecipeCatalogResponse(recipes=recipes, total=len(recipes))


@api_router.get("/recipes/{recipe_id}")
async def get_recipe_by_id(
    recipe_id: str,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    _ = current_user
    recipe_doc = await recipes_col.find_one({"id": recipe_id, "is_active": True}, {"_id": 0})
    if not recipe_doc:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe_doc


@api_router.post("/admin/recipe-gaps/{gap_id}/resolve")
async def admin_resolve_recipe_gap(
    gap_id: str,
    body: Dict[str, Any],
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    status_value = str(body.get("status") or "resolved")
    if status_value not in {"pending", "partially_resolved", "resolved", "ignored"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    recipe_ids = body.get("resolved_by_recipe_ids") or []
    update_doc = {
        "status": status_value,
        "resolved_at": utc_now().isoformat() if status_value in {"partially_resolved", "resolved"} else None,
    }
    if recipe_ids:
        update_doc["resolved_by_recipe_ids"] = recipe_ids
    result = await recipe_gap_requests_col.update_one({"_id": ObjectId(gap_id)}, {"$set": update_doc})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Gap not found")
    return {"ok": True, "gap_id": gap_id, "status": status_value}


# -----------------------------------------------------------------------------
# OCR ticket de caisse (OpenAI GPT-4o-mini vision)
# -----------------------------------------------------------------------------

# Durées de conservation estimées par catégorie alimentaire
_SHELF_BY_CATEGORY: dict[str, dict] = {
    "frais":     {"fridge": 7,   "pantry": None, "freezer": None},
    "proteines": {"fridge": 3,   "pantry": None, "freezer": 90},
    "legumes":   {"fridge": 5,   "pantry": None, "freezer": 365},
    "feculents": {"fridge": None, "pantry": 365,  "freezer": None},
    "desserts":  {"fridge": 5,   "pantry": 180,  "freezer": 90},
    "boissons":  {"fridge": 7,   "pantry": 365,  "freezer": None},
    "epicerie":  {"fridge": None, "pantry": 365,  "freezer": None},
    "autres":    {"fridge": None, "pantry": 365,  "freezer": None},
}

_RECEIPT_PROMPT = """Tu analyses une photo de ticket de caisse français.
Extrait UNIQUEMENT les produits alimentaires visibles.

Pour chaque produit retourne un objet JSON :
- "name" : nom lisible et normalisé en français (ex: "Lait demi-écrémé bio 1L")
- "category" : une valeur EXACTE parmi : frais, proteines, legumes, feculents, desserts, boissons, epicerie, autres

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après.
Si aucun produit alimentaire n'est visible, retourne [].
Ignore les articles non alimentaires (ménager, hygiène, etc.)."""


@api_router.post("/ocr/receipt")
async def ocr_receipt_route(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Analyse un ticket de caisse via GPT-4o-mini vision et retourne la liste des produits alimentaires."""
    await track_business_event(
        business_events_col=business_events_col,
        user_id=current_user["id"],
        event_name="ocr_scan_started",
        event_category="ocr",
        metadata_json={},
    )
    # Vérification d'accès SANS consommer le quota (évite de drainer le quota si l'appel OpenAI échoue)
    await _enforce_feature_access(
        current_user=current_user,
        feature=FEATURE_OCR,
        consume_quota=False,
    )
    try:
        result = await ocr_receipt(request, current_user)
    except OcrApiError as exc:
        logger.warning("OCR receipt failed for user=%s http=%s: %s", current_user["id"], exc.http_status, exc)
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="ocr_scan_failed",
            event_category="ocr",
            metadata_json={"reason": str(exc), "http_status": exc.http_status},
        )
        raise HTTPException(status_code=exc.http_status, detail=str(exc))
    # Quota consommé APRÈS l'appel externe réussi
    await _enforce_feature_access(
        current_user=current_user,
        feature=FEATURE_OCR,
        consume_quota=True,
    )
    plan_type = resolve_plan_type_at_time(current_user)
    await track_service_usage(
        service_usage_logs_col=service_usage_logs_col,
        user_id=current_user["id"],
        service_name="ocr",
        action_name="receipt_scan",
        units_consumed=1,
        estimated_cost=float(os.getenv("OCR_ESTIMATED_COST_EUR", "0.01")),
        plan_type_at_time=plan_type,
        metadata_json={"items_count": len(result)},
    )
    if result:
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="ocr_scan_succeeded",
            event_category="ocr",
            metadata_json={"items_count": len(result)},
        )
    else:
        await track_business_event(
            business_events_col=business_events_col,
            user_id=current_user["id"],
            event_name="ocr_scan_failed",
            event_category="ocr",
            metadata_json={"reason": "empty_or_parse_failed"},
        )
    return result


@api_router.post("/ocr/receipt/report")
async def report_receipt_ticket(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Sauvegarde un ticket de caisse non reconnu et notifie l'équipe par email (premium uniquement)."""
    await _enforce_feature_access(current_user=current_user, feature=FEATURE_OCR, consume_quota=False)

    body = await request.json()
    image_b64: str = body.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")
    _MAX_IMAGE_B64_LEN = 5_500_000
    if len(image_b64) > _MAX_IMAGE_B64_LEN:
        raise HTTPException(status_code=413, detail="Image trop grande (max 4 MB)")

    ticket_doc = {
        "user_id": current_user["id"],
        "user_email": current_user.get("email", ""),
        "image_b64": image_b64,
        "created_at": utc_now().isoformat(),
        "status": "pending",
        "note": "",
        "items_added": [],
    }
    res = await receipt_tickets_col.insert_one(ticket_doc)
    ticket_id = str(res.inserted_id)

    html_body = f"""
    <h2>Nouveau ticket de caisse à traiter — KeepEat</h2>
    <p><strong>Utilisateur :</strong> {current_user.get('email', current_user['id'])}</p>
    <p><strong>ID ticket :</strong> {ticket_id}</p>
    <p><strong>Date :</strong> {utc_now().strftime('%d/%m/%Y %H:%M')} UTC</p>
    <p>L'OCR n'a pas pu identifier les produits. Rendez-vous sur l'interface admin pour traiter ce ticket.</p>
    """
    await _send_email("keepeatfe@gmail.com", f"Ticket caisse à traiter — {current_user.get('email', ticket_id)}", html_body)

    logger.info("Receipt ticket reported user=%s ticket_id=%s", current_user["id"], ticket_id)
    return {"ok": True, "ticket_id": ticket_id}


@api_router.get("/admin/receipt-tickets")
async def list_receipt_tickets(
    status: str = Query(default="pending"),
    limit: int = Query(default=20, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Liste les tickets de caisse (admin uniquement)."""
    query: Dict[str, Any] = {}
    if status != "all":
        query["status"] = status
    cursor = receipt_tickets_col.find(query, {"image_b64": 0}).sort("created_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    total = await receipt_tickets_col.count_documents(query)
    return {
        "tickets": [serialize_mongo(d) for d in docs],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@api_router.get("/admin/receipt-tickets/{ticket_id}")
async def get_receipt_ticket(
    ticket_id: str,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Récupère un ticket de caisse avec son image (admin uniquement)."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    doc = await receipt_tickets_col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")
    return serialize_mongo(doc)


class ReceiptTicketItem(BaseModel):
    name: str
    category: str = "autres"
    expiry_date: Optional[str] = None
    storageZone: Optional[str] = None


class ProcessReceiptTicketBody(BaseModel):
    items: List[ReceiptTicketItem]
    note: str = ""


@api_router.post("/admin/receipt-tickets/{ticket_id}/process")
async def process_receipt_ticket(
    ticket_id: str,
    body: ProcessReceiptTicketBody,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Ajoute manuellement des produits au stock de l'utilisateur et clôture le ticket (admin uniquement)."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    doc = await receipt_tickets_col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")

    user_id = doc["user_id"]
    added_items = []
    now_iso = utc_now().isoformat()

    for item in body.items:
        food_cat = item.category if item.category in _SHELF_BY_CATEGORY else "autres"
        stock_doc = {
            "user_id": user_id,
            "name": item.name,
            "category": item.category,
            "food_category": food_cat,
            "expiry_date": item.expiry_date,
            "quantity": None,
            "barcode": None,
            "brand": None,
            "image_url": None,
            "notes": None,
            "storageZone": item.storageZone,
            "added_date": now_iso,
            "status": "active",
            "consumed_date": None,
            "thrown_date": None,
        }
        res = await stock_col.insert_one(stock_doc)
        added_items.append({"id": str(res.inserted_id), "name": item.name})

    await receipt_tickets_col.update_one(
        {"_id": oid},
        {"$set": {
            "status": "processed",
            "processed_at": now_iso,
            "processed_by": _admin_user.get("email", "admin"),
            "note": body.note,
            "items_added": [{"name": i.name, "category": i.category} for i in body.items],
        }},
    )

    logger.info(
        "Receipt ticket processed ticket_id=%s user_id=%s items=%d by=%s",
        ticket_id, user_id, len(added_items), _admin_user.get("email", "admin"),
    )
    return {"ok": True, "ticket_id": ticket_id, "items_added": len(added_items)}


@api_router.post("/admin/receipt-tickets/{ticket_id}/dismiss")
async def dismiss_receipt_ticket(
    ticket_id: str,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Marque un ticket comme ignoré (admin uniquement)."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    res = await receipt_tickets_col.update_one(
        {"_id": oid},
        {"$set": {"status": "dismissed", "dismissed_at": utc_now().isoformat(), "dismissed_by": _admin_user.get("email", "admin")}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")
    return {"ok": True}


@api_router.post("/admin/receipt-tickets/{ticket_id}/reopen")
async def reopen_receipt_ticket(
    ticket_id: str,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Remet un ticket en attente (annule traitement ou ignoré)."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")
    res = await receipt_tickets_col.update_one(
        {"_id": oid},
        {"$set": {"status": "pending"}, "$unset": {"processed_at": "", "dismissed_at": "", "items_added": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")
    logger.info("Receipt ticket reopened ticket_id=%s by=%s", ticket_id, _admin_user.get("email", "admin"))
    return {"ok": True}


# -----------------------------------------------------------------------------
# Stats mensuelles (score anti-gaspillage)
# -----------------------------------------------------------------------------

_SAVINGS_BY_CATEGORY: dict[str, float] = {
    "frais":     3.0,
    "proteines": 5.0,
    "legumes":   2.0,
    "feculents": 1.5,
    "desserts":  2.5,
    "boissons":  2.0,
    "epicerie":  2.0,
    "autres":    2.0,
}
_DEFAULT_SAVINGS = 2.5  # € par produit si catégorie inconnue

@api_router.get("/stats/monthly")
async def get_monthly_stats(
    months: int = Query(default=6, ge=1, le=24),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne les stats mensuelles (consommé/jeté/score/saved_euros) sur les N derniers mois."""
    uid = current_user["id"]
    plan = resolve_plan(current_user)
    effective_months = min(months, 24 if plan == PREMIUM_PLAN else 6)

    # Générer la liste des N derniers mois (YYYY-MM)
    today = utc_now().date()
    month_list = []
    for i in range(effective_months - 1, -1, -1):
        target = today.replace(day=1) - timedelta(days=i * 30)
        month_list.append(target.strftime("%Y-%m"))

    # Agrégation consommés par mois (+ catégorie pour estimer les économies)
    consumed_pipeline = [
        {"$match": {"user_id": uid, "status": "consumed", "consumed_date": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": {"month": {"$substr": ["$consumed_date", 0, 7]}, "cat": "$food_category"},
            "count": {"$sum": 1},
        }},
    ]
    thrown_pipeline = [
        {"$match": {"user_id": uid, "status": "thrown", "thrown_date": {"$nin": [None, ""]}}},
        {"$group": {"_id": {"$substr": ["$thrown_date", 0, 7]}, "count": {"$sum": 1}}},
    ]

    consumed_agg = await stock_col.aggregate(consumed_pipeline).to_list(length=500)
    thrown_agg = await stock_col.aggregate(thrown_pipeline).to_list(length=100)

    # consumed_by_month : { "YYYY-MM": { total_count, saved_euros } }
    consumed_by_month: dict[str, dict] = {}
    for doc in consumed_agg:
        month = doc["_id"]["month"]
        cat = (doc["_id"].get("cat") or "").lower()
        coeff = _SAVINGS_BY_CATEGORY.get(cat, _DEFAULT_SAVINGS)
        entry = consumed_by_month.setdefault(month, {"count": 0, "euros": 0.0})
        entry["count"] += doc["count"]
        entry["euros"] += doc["count"] * coeff

    thrown_by_month = {doc["_id"]: doc["count"] for doc in thrown_agg}

    result = []
    for month in month_list:
        c_entry = consumed_by_month.get(month, {"count": 0, "euros": 0.0})
        consumed = c_entry["count"]
        thrown = thrown_by_month.get(month, 0)
        total = consumed + thrown
        score = round(consumed / total * 100) if total > 0 else 0
        result.append({
            "month": month,
            "consumed": consumed,
            "thrown": thrown,
            "score": score,
            "saved_euros": round(c_entry["euros"], 1),
        })

    return result


# ── Gamification ──────────────────────────────────────────────────────────────

_LEVELS = [
    (0,   "Débutant",          "🌱", 10),
    (10,  "Éco-citoyen",       "♻️",  30),
    (30,  "Chasseur de gaspi", "🎯", 60),
    (60,  "Expert anti-gaspi", "⭐", 100),
    (100, "Champion 🌍",       "🏆", None),
]


async def _compute_streak(uid: str) -> int:
    """Nombre de jours consécutifs depuis aujourd'hui sans aucun item jeté (1 seule requête DB)."""
    today = utc_now().date()
    since = (today - timedelta(days=59)).strftime("%Y-%m-%d")
    # Une seule agrégation pour récupérer toutes les dates de jets des 60 derniers jours
    pipeline = [
        {"$match": {"user_id": uid, "status": "thrown", "thrown_date": {"$gte": since}}},
        {"$project": {"day": {"$substr": ["$thrown_date", 0, 10]}}},
        {"$group": {"_id": "$day"}},
    ]
    thrown_days: set[str] = set()
    async for doc in stock_col.aggregate(pipeline):
        thrown_days.add(doc["_id"])
    streak = 0
    for i in range(60):
        day_str = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        if day_str in thrown_days:
            break
        streak += 1
    return streak


@api_router.get("/gamification")
async def get_gamification(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne les données de gamification : niveau, streak, économies totales."""
    uid = current_user["id"]

    total_consumed, total_thrown = await asyncio.gather(
        stock_col.count_documents({"user_id": uid, "status": "consumed"}),
        stock_col.count_documents({"user_id": uid, "status": "thrown"}),
    )
    streak = await _compute_streak(uid)

    # Agrégation pour le calcul des économies : évite de charger N×10000 docs en mémoire
    total_saved = 0.0
    async for cat_doc in stock_col.aggregate([
        {"$match": {"user_id": uid, "status": "consumed"}},
        {"$group": {"_id": "$food_category", "count": {"$sum": 1}}},
    ]):
        cat = (cat_doc["_id"] or "").lower()
        total_saved += cat_doc["count"] * _SAVINGS_BY_CATEGORY.get(cat, _DEFAULT_SAVINGS)

    # Niveau basé sur total_consumed
    level_index = 0
    for i, (threshold, _n, _e, _nt) in enumerate(_LEVELS):
        if total_consumed >= threshold:
            level_index = i
    current_threshold, level_name, level_emoji, next_threshold = _LEVELS[level_index]

    if next_threshold is not None:
        progress = (total_consumed - current_threshold) / max(next_threshold - current_threshold, 1)
        next_level = _LEVELS[level_index + 1][1] if level_index + 1 < len(_LEVELS) else None
    else:
        progress = 1.0
        next_level = None

    return {
        "total_consumed":    total_consumed,
        "total_thrown":      total_thrown,
        "total_saved_euros": round(total_saved, 1),
        "current_streak":    streak,
        "level_index":       level_index,
        "level_name":        level_name,
        "level_emoji":       level_emoji,
        "progress_to_next":  round(min(progress, 1.0), 3),
        "next_level":        next_level,
    }


# ── Gap-fill IA : génération automatique quand le catalogue est vide ──────────

async def _ai_gap_fill(stock_names: list[str], gemini_key: str) -> dict | None:
    """Appelle Gemini pour générer une recette française à partir des articles en stock.
    Retourne le premier dict recette valide, ou None en cas d'échec.
    Timeout géré par l'appelant via asyncio.wait_for.
    """
    ingredients_list = "\n".join(f"- {name}" for name in stock_names[:10])
    prompt = _AI_RECIPE_PROMPT.format(ingredients=ingredients_list)
    try:
        async with httpx.AsyncClient(timeout=12) as http:
            r = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": _AI_RECIPE_SYSTEM}]},
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 600},
                },
            )
            if r.status_code != 200:
                logger.warning("AI gap fill Gemini HTTP %s: %s", r.status_code, r.text[:200])
                return None
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as exc:
        logger.warning("AI gap fill request failed: %s", exc)
        return None

    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        recipes = json.loads(text)
        if not isinstance(recipes, list):
            recipes = [recipes]
    except Exception:
        logger.warning("AI gap fill JSON parse failed: %s", text[:200])
        return None

    for recipe in recipes:
        if _is_french_ai_recipe(recipe) and isinstance(recipe.get("title"), str):
            return recipe
    return None


async def _save_ai_recipe_to_stores(ai_recipe: dict, *, stock_names: list[str]) -> dict:
    """Sauvegarde une recette générée par l'IA dans MongoDB recipes_col ET le catalogue JSON.
    Retourne un dict scoré compatible avec le format de réponse /api/recipes/suggestions.
    """
    title = str(ai_recipe.get("title", "Recette IA")).strip()
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", title.lower()))[:40].strip("-")
    recipe_id = f"ai-{slug}-{secrets.token_hex(4)}"

    prep_time = int(ai_recipe.get("prep_time_min") or 30)
    ingredients_used = [str(i) for i in ai_recipe.get("ingredients_used", []) if i]
    summary = str(ai_recipe.get("instructions_summary", "")).strip()
    steps = [summary] if summary else ["Préparer selon les instructions."]
    now_iso = utc_now().isoformat()

    # Sauvegarde MongoDB
    mongo_doc: dict[str, Any] = {
        "_id": recipe_id,
        "id": recipe_id,
        "title": title,
        "description": summary,
        "dish_type": "plat",
        "duration_min": prep_time,
        "difficulty": "easy",
        "ingredients": [{"name": i, "quantity": "", "optional": False} for i in ingredients_used],
        "steps": steps,
        "tags": ["anti-gaspi", "ia"],
        "is_active": True,
        "created_by": "ai_gap_fill",
        "created_at": now_iso,
        "updated_at": now_iso,
        "usage_count": 0,
        "view_count": 0,
    }
    try:
        await recipes_col.insert_one(mongo_doc)
        logger.info("AI gap fill: recette sauvée en MongoDB id=%s title=%s", recipe_id, title)
    except Exception as exc:
        logger.warning("AI gap fill: MongoDB insert échoué: %s", exc)

    # Sauvegarde catalogue JSON
    catalog_entry = {
        "id": recipe_id,
        "title": title,
        "summary": summary,
        "ingredients_required": ingredients_used,
        "ingredients_optional": [],
        "steps": steps,
        "prep_time_min": prep_time,
        "cook_time_min": 0,
        "difficulty": "easy",
        "tags": ["anti-gaspi", "ia"],
        "meal_type": ["dinner"],
        "cuisine": "française",
        "servings": 2,
        "search_terms": ingredients_used,
        "compat": {"storage_focus": []},
        "source": {"type": "ai_generated", "name": "KeepEat AI"},
        "version": 1,
    }
    try:
        append_recipe_to_catalog(catalog_entry)
        logger.info("AI gap fill: recette ajoutée au catalogue JSON id=%s", recipe_id)
    except Exception as exc:
        logger.warning("AI gap fill: ajout catalogue JSON échoué: %s", exc)

    # Mise à jour des gaps couverts
    try:
        await _mark_coverable_gaps_after_recipe_insert(mongo_doc)
    except Exception as exc:
        logger.warning("AI gap fill: marquage gaps échoué: %s", exc)

    structured_ingredients = [
        {
            "name": ingredient,
            "quantity": None,
            "unit": None,
            "display_unit": None,
            "display_label": "Quantité à ajuster",
            "optional": False,
            "available": True,
            "matched_stock_item_ids": [],
            "missing_quantity": None,
            "is_estimated": True,
        }
        for ingredient in ingredients_used
    ]

    return {
        "id": recipe_id,
        "title": title,
        "summary": summary,
        "description": summary,
        "servings": 2,
        "ingredients": structured_ingredients,
        "duration_min": prep_time,
        "dish_type": "plat",
        "available_count": len(ingredients_used),
        "missing_count": 0,
        "available_ingredients": ingredients_used,
        "missing_ingredients": [],
        "steps": steps,
        "score": 10,
        "is_ai": True,
    }


# ── Recettes IA (OpenAI GPT-4o-mini) ─────────────────────────────────────────

_AI_RECIPE_SYSTEM = """\
Tu es un chef cuisinier expert UNIQUEMENT en cuisine FRANÇAISE (brasserie, bistrot, cuisine familiale, \
pâtisserie française, cuisine régionale française). Tu ne génères AUCUNE recette étrangère, sans exception.

CUISINES STRICTEMENT INTERDITES : asiatique, japonaise, thaïlandaise, chinoise, coréenne, vietnamienne, \
indienne, scandinave, danoise, américaine, mexicaine, arabe, maghrébine, africaine, caribéenne.

RECETTES INTERDITES PAR EXEMPLE : Pad Thai, Pad See Ew, Lo Mein, Chow Mein, Aebleskiver, Sushi, \
Curry, Ramen, Tacos, Burrito, Stir Fry, Wok, Naan, Falafel, Hummus, Pho, Bibimbap, Tagine, Shakshuka, \
Satay, Tom Yum, Laksa, Gyoza, Tempura, Bulgogi, Kimchi.

RÈGLE ABSOLUE : si les ingrédients fournis ne correspondent pas à la cuisine française, propose quand même \
3 recettes FRANÇAISES classiques en utilisant ces ingrédients comme base OU en les substituant par leurs \
équivalents français. Un "lait de coco" peut devenir un dessert au lait français, une "purée d'amande" \
peut servir dans des financiers ou un gâteau aux amandes.\
"""

_AI_RECIPE_PROMPT = """\
L'utilisateur a ces produits dans son frigo/placard :

{ingredients}

Génère exactement 3 recettes de cuisine FRANÇAISE simple et saine (brasserie, bistrot, plats familiaux). \
Utilise certains de ces ingrédients — pas nécessairement tous.

Réponds UNIQUEMENT en JSON valide (pas de markdown), dans ce format :
[
  {{
    "title": "Nom de la recette en français",
    "ingredients_used": ["ingrédient 1", "ingrédient 2"],
    "instructions_summary": "Instructions simples en 2-3 phrases, max 80 mots.",
    "prep_time_min": 20
  }}
]
Langue : français. Recettes simples (< 45 min), saines, sans friture."""

# Mots-clés dans les titres indiquant une recette étrangère — blacklist de sécurité
_FOREIGN_RECIPE_KEYWORDS: frozenset[str] = frozenset({
    "pad see ew", "pad thai", "lo mein", "chow mein", "aebleskiver",
    "stir fry", "stir-fry", "yakitori", "teriyaki", "sushi", "ramen",
    "curry ", "tikka", "masala", " naan", "falafel", "hummus", " pho ",
    "banh mi", "dim sum", "gyoza", "tempura", "bibimbap", "bulgogi",
    "kimchi", "tagine", "shakshuka", "tajine",
    "burrito", " taco ", "enchilada", "quesadilla", "nachos",
    "tom yum", "laksa", "rendang", "satay",
})


def _is_french_ai_recipe(recipe: dict) -> bool:
    """Retourne False si le titre contient des marqueurs de cuisine étrangère."""
    title_lower = recipe.get("title", "").lower()
    return not any(kw in title_lower for kw in _FOREIGN_RECIPE_KEYWORDS)

# Cache en mémoire (uid -> {recipes, created_at}) — borné à 500 entrées pour éviter la fuite mémoire
_ai_recipe_cache: dict[str, dict] = {}
_AI_CACHE_MAX_SIZE = 500


def _get_recipes_ai_api_key() -> str:
    """Retourne la clé provider IA recettes (Gemini)."""
    return os.environ.get("GEMINI_RECIPES_API_KEY", "").strip()


def _extract_ai_recipe_payload_text(payload: dict[str, Any]) -> str:
    """Extrait le texte JSON de réponse IA pour les formats Gemini et legacy OpenAI."""
    candidates = payload.get("candidates")
    if isinstance(candidates, list) and candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        if isinstance(parts, list) and parts:
            text = parts[0].get("text", "")
            if isinstance(text, str) and text.strip():
                return text.strip()

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {})
        content = message.get("content", "")
        if isinstance(content, str) and content.strip():
            return content.strip()

    raise KeyError("missing_ai_response_text")


@api_router.get("/recipes/ai")
async def get_ai_recipes(
    response: Response = None,
    include_meta: bool = Query(False, alias="include_meta"),
    suggestion_style: str = Query("classique", alias="suggestion_style"),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Génère 3 recettes personnalisées via GPT-4o-mini basées sur le stock de l'utilisateur."""
    # Vérification d'accès SANS consommer le quota (consommation après appel OpenAI réussi)
    await _enforce_feature_access(
        current_user=current_user,
        feature=FEATURE_AI,
        consume_quota=False,
    )
    uid = current_user["id"]
    resolved_suggestion_style = resolve_suggestion_style(suggestion_style)
    include_meta_enabled = include_meta is True or str(include_meta).lower() in {"1", "true", "yes"}
    logger.debug("RECIPES_DEBUG ai called — user=%s", uid)
    gemini_key = _get_recipes_ai_api_key()
    if not gemini_key:
        raise HTTPException(status_code=503, detail="IA non configurée")

    # Cache 1h par utilisateur
    cached = _ai_recipe_cache.get(uid)
    if cached and (utc_now() - cached["created_at"]).total_seconds() < 3600:
        logger.debug(
            "RECIPES_DEBUG ai cache_hit — user=%s age_s=%.2f count=%d",
            uid,
            (utc_now() - cached["created_at"]).total_seconds(),
            len(cached["recipes"]),
        )
        meta = _build_recipes_debug_meta(endpoint="/api/recipes/ai", suggestion_style=resolved_suggestion_style)
        _apply_recipes_debug_headers(response=response, meta=meta)
        if include_meta_enabled:
            return {"recipes": cached["recipes"], "meta": meta}
        return cached["recipes"]

    items = await stock_col.find(
        {"user_id": uid, "status": "active"},
    ).sort("expiry_date", 1).limit(8).to_list(length=8)

    if not items:
        logger.debug("RECIPES_DEBUG ai empty_stock — user=%s", uid)
        meta = _build_recipes_debug_meta(endpoint="/api/recipes/ai", suggestion_style=resolved_suggestion_style)
        _apply_recipes_debug_headers(response=response, meta=meta)
        if include_meta_enabled:
            return {"recipes": [], "meta": meta}
        return []

    stock_names = [i.get("name", "") for i in items if i.get("name")]
    logger.debug(
        "RECIPES_DEBUG ai stock_items_raw — user=%s count=%d sample=%s",
        uid,
        len(items),
        [
            {
                "id": str(i.get("_id", "")),
                "name": i.get("name"),
                "expiry_date": i.get("expiry_date"),
                "food_category": i.get("food_category"),
            }
            for i in items[:10]
        ],
    )

    ingredients_list = "\n".join(
        f"- {i['name']}" + (f" ({i.get('food_category', '')})" if i.get('food_category') else "")
        for i in items
    )
    prompt = _AI_RECIPE_PROMPT.format(ingredients=ingredients_list)

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": _AI_RECIPE_SYSTEM}]},
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 800},
                },
            )
            if r.status_code != 200:
                logger.warning("Gemini recipes/ai error %s: %s", r.status_code, r.text[:200])
                raise HTTPException(status_code=502, detail="Erreur IA externe")
            text = _extract_ai_recipe_payload_text(r.json())
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Gemini recipes/ai request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Erreur réseau IA")

    # Nettoyage du bloc markdown éventuel
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        recipes = json.loads(text)
    except Exception:
        logger.warning("Gemini recipes/ai invalid JSON: %s", text[:200])
        raise HTTPException(status_code=502, detail="Réponse IA invalide")

    for recipe in recipes:
        recipe["is_ai"] = True

    # ── Validation : rejeter les recettes étrangères et les remplacer par le catalogue ──
    valid: list[dict] = []
    rejected_titles: list[str] = []
    for r in recipes:
        if _is_french_ai_recipe(r):
            valid.append(r)
        else:
            rejected_titles.append(r.get("title", "?"))
            logger.warning(
                "RECIPES_DEBUG ai rejected_foreign — user=%s title=%s",
                uid, r.get("title", "?"),
            )

    if rejected_titles:
        needed = len(rejected_titles)
        catalog_fallbacks = suggest_recipes_from_catalog(
            stock_names,
            limit=needed + 2,
            suggestion_style=resolved_suggestion_style,
        )
        existing_lower = {r["title"].lower() for r in valid}
        for match in catalog_fallbacks:
            if len(valid) >= 3:
                break
            if match.recipe.title.lower() not in existing_lower:
                valid.append({
                    "title": match.recipe.title,
                    "ingredients_used": match.used_required,
                    "instructions_summary": match.recipe.summary,
                    "prep_time_min": match.recipe.prep_time_min + match.recipe.cook_time_min,
                    "is_ai": True,
                })
                existing_lower.add(match.recipe.title.lower())
        logger.debug(
            "RECIPES_DEBUG ai validation — user=%s rejected=%s final_count=%d",
            uid, rejected_titles, len(valid),
        )
        recipes = valid

    # Quota consommé APRÈS l'appel OpenAI réussi
    await _enforce_feature_access(
        current_user=current_user,
        feature=FEATURE_AI,
        consume_quota=True,
    )
    # Éviction LRU simplifiée : supprimer l'entrée la plus ancienne si cache plein
    if len(_ai_recipe_cache) >= _AI_CACHE_MAX_SIZE:
        oldest_uid = min(_ai_recipe_cache, key=lambda k: _ai_recipe_cache[k]["created_at"])
        del _ai_recipe_cache[oldest_uid]
    _ai_recipe_cache[uid] = {"recipes": recipes, "created_at": utc_now()}
    plan_type = resolve_plan_type_at_time(current_user)
    await track_service_usage(
        service_usage_logs_col=service_usage_logs_col,
        user_id=uid,
        service_name="ai_recipes",
        action_name="generate_recipes",
        units_consumed=1,
        estimated_cost=float(os.getenv("AI_RECIPE_ESTIMATED_COST_EUR", "0.03")),
        plan_type_at_time=plan_type,
        metadata_json={"recipes_count": len(recipes)},
    )
    await track_business_event(
        business_events_col=business_events_col,
        user_id=uid,
        event_name="recipe_generated",
        event_category="recipes",
        metadata_json={"count": len(recipes), "source": "openai"},
    )
    logger.info("AI recipes generated — user=%s count=%d", uid, len(recipes))
    logger.debug(
        "RECIPES_DEBUG ai response — user=%s titles=%s",
        uid,
        [r.get("title") for r in recipes],
    )
    meta = _build_recipes_debug_meta(endpoint="/api/recipes/ai", suggestion_style=resolved_suggestion_style)
    _apply_recipes_debug_headers(response=response, meta=meta)
    if include_meta_enabled:
        return {"recipes": recipes, "meta": meta}
    return recipes


# ── Prévisions de consommation ────────────────────────────────────────────────

@api_router.get("/predictions")
async def get_predictions(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne les items actifs dont la catégorie a un taux de gaspillage > 40% dans l'historique."""
    await _enforce_feature_access(
        current_user=current_user,
        feature=FEATURE_PREDICTIONS,
        consume_quota=False,
    )
    uid = current_user["id"]

    pipeline = [
        {"$match": {"user_id": uid, "status": {"$in": ["consumed", "thrown"]}}},
        {"$group": {
            "_id": "$food_category",
            "consumed": {"$sum": {"$cond": [{"$eq": ["$status", "consumed"]}, 1, 0]}},
            "thrown":   {"$sum": {"$cond": [{"$eq": ["$status", "thrown"]},   1, 0]}},
        }},
    ]
    stats_agg = await stock_col.aggregate(pipeline).to_list(length=20)
    logger.info("RISK_DEBUG predictions aggregates — user=%s stats=%s", uid, stats_agg)
    risky_cats: set[str] = set()
    for s in stats_agg:
        total = s["consumed"] + s["thrown"]
        ratio = (s["thrown"] / total) if total else 0.0
        logger.info(
            "RISK_DEBUG predictions category_eval — user=%s category=%s consumed=%s thrown=%s total=%s ratio=%.3f threshold_total=%s threshold_ratio=%s",
            uid,
            s.get("_id"),
            s.get("consumed"),
            s.get("thrown"),
            total,
            ratio,
            3,
            0.4,
        )
        if total >= 3 and ratio > 0.4:  # seuil minimum de 3 données
            risky_cats.add(s["_id"])

    if not risky_cats:
        logger.info("RISK_DEBUG predictions no_risky_categories — user=%s", uid)
        return []

    today_str = utc_now().strftime("%Y-%m-%d")
    in_7_days = (utc_now().date() + timedelta(days=7)).strftime("%Y-%m-%d")

    items = await stock_col.find(
        {
            "user_id": uid,
            "status": "active",
            "food_category": {"$in": list(risky_cats)},
            "expiry_date": {"$nin": [None, ""], "$gte": today_str, "$lte": in_7_days},
        },
        {"_id": 1, "name": 1, "food_category": 1},
    ).to_list(length=30)
    logger.info(
        "RISK_DEBUG predictions active_items_flagged — user=%s risky_cats=%s expiry_window=%s..%s items=%s",
        uid,
        list(risky_cats),
        today_str,
        in_7_days,
        [{"id": str(i.get("_id", "")), "name": i.get("name"), "food_category": i.get("food_category")} for i in items],
    )

    return [
        {"id": str(i["_id"]), "name": i["name"], "category": i.get("food_category", "")}
        for i in items
    ]


# -----------------------------------------------------------------------------
# Admin Monitoring / Observability
# -----------------------------------------------------------------------------

@api_router.get("/admin/monitoring/health")
async def admin_monitoring_health(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    db_ok = True
    try:
        await db.command("ping")
    except Exception:
        db_ok = False

    external_status = {
        "gemini_ocr_configured": bool(os.getenv("GEMINI_OCR_API_KEY")),
        "gemini_recipes_configured": bool(_get_recipes_ai_api_key()),
        "brevo_configured": bool(os.getenv("BREVO_API_KEY")),
        "openfoodfacts_configured": bool(os.getenv("OPENFOODFACTS_USER_AGENT", "KeepEat/1.0")),
    }
    last_critical = await api_request_logs_col.find_one(
        {"status_code": {"$gte": 500}},
        sort=[("created_at", -1)],
        projection={"method": 1, "path": 1, "status_code": 1, "error_type": 1, "created_at": 1},
    )
    uptime_seconds = max(0, int((utc_now() - APP_STARTED_AT).total_seconds()))
    global_ok = db_ok
    return {
        "status": "ok" if global_ok else "degraded",
        "db": {"ok": db_ok},
        "external_services": external_status,
        "uptime_seconds": uptime_seconds,
        "last_critical_error": serialize_mongo(last_critical),
        "generated_at": utc_now().isoformat(),
    }


@api_router.get("/admin/monitoring/dashboard")
async def admin_monitoring_dashboard(
    days: int = Query(7, ge=1, le=90),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    kpis = await build_monitoring_kpis(
        users_col=users_col,
        api_request_logs_col=api_request_logs_col,
        service_usage_logs_col=service_usage_logs_col,
    )
    apis = await summarize_api_metrics(
        api_request_logs_col=api_request_logs_col,
        start_iso=(utc_now() - timedelta(days=days)).isoformat(),
        end_iso=utc_now().isoformat(),
        limit=10,
    )
    return {
        "generated_at": utc_now().isoformat(),
        "days": days,
        "users": kpis["users"],
        "subscriptions": kpis["subscriptions"],
        "top_api_issues": apis["highest_error_rate"][:5],
        "top_service_usage": kpis["services"]["top_usage_30d"],
        "estimated_cost_summary": {
            "services_30d_estimated_cost_eur": round(sum(x.get("estimated_cost", 0.0) for x in kpis["services"]["top_usage_30d"]), 6)
        },
    }


@api_router.get("/admin/monitoring/apis")
async def admin_monitoring_apis(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    start_iso = _parse_date_param(start_date, default_days_ago=7)
    end_iso = _parse_date_param(end_date, default_days_ago=0)
    return await summarize_api_metrics(
        api_request_logs_col=api_request_logs_col,
        start_iso=start_iso,
        end_iso=end_iso,
        limit=limit,
    )


@api_router.get("/admin/monitoring/users")
async def admin_monitoring_users(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    kpis = await build_monitoring_kpis(
        users_col=users_col,
        api_request_logs_col=api_request_logs_col,
        service_usage_logs_col=service_usage_logs_col,
    )
    return {"generated_at": utc_now().isoformat(), **kpis["users"]}


@api_router.get("/admin/monitoring/subscriptions")
async def admin_monitoring_subscriptions(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    kpis = await build_monitoring_kpis(
        users_col=users_col,
        api_request_logs_col=api_request_logs_col,
        service_usage_logs_col=service_usage_logs_col,
    )
    active = kpis["subscriptions"]["active"]
    inactive = await users_col.count_documents({"$or": [{"is_premium": False}, {"subscription_status": {"$in": ["inactive", "cancelled", "expired"]}}]})
    return {
        "generated_at": utc_now().isoformat(),
        "active_subscriptions": active,
        "subscriptions_by_plan": kpis["subscriptions"]["by_plan"],
        "inactive_or_expired": inactive,
        "estimated_mrr_eur": kpis["subscriptions"]["estimated_mrr_eur"],
        "estimated_arr_eur": kpis["subscriptions"]["estimated_arr_eur"],
    }


@api_router.get("/admin/monitoring/services-usage")
async def admin_monitoring_services_usage(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    start_iso = _parse_date_param(start_date, default_days_ago=30)
    end_iso = _parse_date_param(end_date, default_days_ago=0)
    return await summarize_services_usage(
        service_usage_logs_col=service_usage_logs_col,
        start_iso=start_iso,
        end_iso=end_iso,
    )


@api_router.get("/admin/monitoring/services")
async def admin_monitoring_services(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    payload = await build_services_status(
        db=db,
        api_request_logs_col=api_request_logs_col,
    )
    payload["uptime_seconds"] = max(0, int((utc_now() - APP_STARTED_AT).total_seconds()))
    return payload


@api_router.get("/admin/monitoring/usage")
async def admin_monitoring_usage(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    return await build_usage_metrics(
        users_col=users_col,
        stock_col=stock_col,
        service_usage_logs_col=service_usage_logs_col,
    )


@api_router.get("/admin/monitoring/costs")
async def admin_monitoring_costs(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    usage_payload = await build_usage_metrics(
        users_col=users_col,
        stock_col=stock_col,
        service_usage_logs_col=service_usage_logs_col,
    )
    return await build_cost_recommendations(usage_payload=usage_payload)


@api_router.get("/admin/monitoring/events")
async def admin_monitoring_events(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    event_name: str | None = Query(None),
    event_category: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    start_iso = _parse_date_param(start_date, default_days_ago=7)
    end_iso = _parse_date_param(end_date, default_days_ago=0)
    query: dict[str, Any] = {"created_at": {"$gte": start_iso, "$lte": end_iso}}
    if event_name:
        query["event_name"] = event_name
    if event_category:
        query["event_category"] = event_category
    total = await business_events_col.count_documents(query)
    cursor = business_events_col.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    rows = await cursor.to_list(length=page_size)
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "events": [serialize_mongo(r) for r in rows],
    }


@api_router.get("/admin/monitoring/trends")
async def admin_monitoring_trends(
    days: int = Query(30, ge=1, le=90),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Séries temporelles pour les graphiques du dashboard admin."""
    now = utc_now()
    iso_start = (now - timedelta(days=days)).isoformat()
    max_points = days + 1

    # DAU quotidiens (utilisateurs distincts par jour)
    dau_pipeline = [
        {"$match": {"created_at": {"$gte": iso_start}, "user_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "users": {"$addToSet": "$user_id"}}},
        {"$project": {"date": "$_id", "count": {"$size": "$users"}}},
        {"$sort": {"date": 1}},
    ]
    dau_rows = await api_request_logs_col.aggregate(dau_pipeline).to_list(length=max_points)

    # Nouveaux utilisateurs par jour
    new_users_pipeline = [
        {"$match": {"created_at": {"$gte": iso_start}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    new_users_rows = await users_col.aggregate(new_users_pipeline).to_list(length=max_points)

    # Erreurs API par jour
    errors_pipeline = [
        {"$match": {"created_at": {"$gte": iso_start}, "status_code": {"$gte": 400}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    errors_rows = await api_request_logs_col.aggregate(errors_pipeline).to_list(length=max_points)

    # Coûts services par jour
    costs_pipeline = [
        {"$match": {"created_at": {"$gte": iso_start}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "cost": {"$sum": "$estimated_cost"}}},
        {"$sort": {"_id": 1}},
    ]
    costs_rows = await service_usage_logs_col.aggregate(costs_pipeline).to_list(length=max_points)

    return {
        "generated_at": now.isoformat(),
        "days": days,
        "dau": [{"date": r["date"], "count": r["count"]} for r in dau_rows],
        "new_users": [{"date": r["_id"], "count": r["count"]} for r in new_users_rows],
        "errors": [{"date": r["_id"], "count": r["count"]} for r in errors_rows],
        "costs": [{"date": r["_id"], "cost": round(float(r["cost"]), 6)} for r in costs_rows],
    }


@api_router.get("/admin/monitoring/api-drill")
async def admin_monitoring_api_drill(
    endpoint_key: str = Query(...),
    days: int = Query(7, ge=1, le=90),
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Détail d'un endpoint : breakdown par status code + dernières erreurs."""
    start_iso = (utc_now() - timedelta(days=days)).isoformat()
    match = {"endpoint_key": endpoint_key, "created_at": {"$gte": start_iso}}

    status_pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$status_code",
            "count": {"$sum": 1},
            "avg_ms": {"$avg": "$duration_ms"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    status_rows = await api_request_logs_col.aggregate(status_pipeline).to_list(length=10)

    last_errors = await api_request_logs_col.find(
        {**match, "status_code": {"$gte": 400}},
        projection={"method": 1, "path": 1, "status_code": 1, "duration_ms": 1, "error_type": 1, "created_at": 1},
    ).sort("created_at", -1).limit(5).to_list(length=5)

    total = await api_request_logs_col.count_documents(match)
    return {
        "endpoint_key": endpoint_key,
        "days": days,
        "total_calls": total,
        "by_status": [
            {"status_code": r["_id"], "count": r["count"], "avg_ms": round(float(r.get("avg_ms") or 0), 1)}
            for r in status_rows
        ],
        "last_errors": [serialize_mongo(e) for e in last_errors],
    }


# ── Endpoint admin : ajout manuel d'une recette dans les deux stores ──────────

class AdminRecipePayload(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    summary: str = Field(..., min_length=10)
    ingredients_required: list[str] = Field(..., min_length=1)
    ingredients_optional: list[str] = Field(default_factory=list)
    steps: list[str] = Field(..., min_length=1)
    prep_time_min: int = Field(..., ge=0)
    cook_time_min: int = Field(0, ge=0)
    difficulty: str = Field("easy", pattern="^(easy|medium|hard)$")
    tags: list[str] = Field(default_factory=list)
    meal_type: list[str] = Field(default_factory=list)
    servings: int = Field(2, ge=1)


@api_router.post("/admin/recipes", status_code=201)
async def admin_add_recipe(
    payload: AdminRecipePayload,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Ajoute manuellement une recette dans MongoDB recipes_col ET le catalogue JSON.
    Requiert un compte admin (is_admin=True).
    """
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", payload.title.lower()))[:40].strip("-")
    recipe_id = f"manual-{slug}-{secrets.token_hex(4)}"
    now_iso = utc_now().isoformat()

    # Sauvegarde MongoDB
    mongo_doc: dict[str, Any] = {
        "_id": recipe_id,
        "id": recipe_id,
        "title": payload.title,
        "description": payload.summary,
        "dish_type": payload.meal_type[0] if payload.meal_type else "plat",
        "duration_min": payload.prep_time_min + payload.cook_time_min,
        "difficulty": payload.difficulty,
        "ingredients": [{"name": i, "quantity": "", "optional": False} for i in payload.ingredients_required]
            + [{"name": i, "quantity": "", "optional": True} for i in payload.ingredients_optional],
        "steps": payload.steps,
        "tags": payload.tags,
        "is_active": True,
        "created_by": f"admin:{_admin_user.get('email', 'unknown')}",
        "created_at": now_iso,
        "updated_at": now_iso,
        "usage_count": 0,
        "view_count": 0,
    }
    try:
        await recipes_col.insert_one(mongo_doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Une recette avec cet identifiant existe déjà.")

    # Sauvegarde catalogue JSON
    catalog_entry = {
        "id": recipe_id,
        "title": payload.title,
        "summary": payload.summary,
        "ingredients_required": payload.ingredients_required,
        "ingredients_optional": payload.ingredients_optional,
        "steps": payload.steps,
        "prep_time_min": payload.prep_time_min,
        "cook_time_min": payload.cook_time_min,
        "difficulty": payload.difficulty,
        "tags": payload.tags,
        "meal_type": payload.meal_type or ["dinner"],
        "cuisine": "française",
        "servings": payload.servings,
        "search_terms": payload.ingredients_required,
        "compat": {"storage_focus": []},
        "source": {"type": "manual_admin", "name": "KeepEat Admin"},
        "version": 1,
    }
    try:
        append_recipe_to_catalog(catalog_entry)
    except Exception as exc:
        logger.warning("admin_add_recipe: ajout catalogue JSON échoué: %s", exc)

    await _mark_coverable_gaps_after_recipe_insert(mongo_doc)
    logger.info(
        "ADMIN_ACTION action=add_recipe id=%s title=%s actor=%s",
        recipe_id, payload.title, _admin_user.get("email", "unknown"),
    )
    return {"id": recipe_id, "title": payload.title, "saved": True}


# ── Endpoint admin : import en masse depuis un tableau JSON ───────────────────

class AdminRecipeImportPayload(BaseModel):
    recipes: list[AdminRecipePayload] = Field(..., min_length=1, max_length=200)


@api_router.post("/admin/recipes/import", status_code=201)
async def admin_import_recipes(
    payload: AdminRecipeImportPayload,
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Importe un tableau de recettes dans MongoDB ET le catalogue JSON en une seule requête.
    Requiert un compte admin (is_admin=True).
    Retourne le détail de chaque recette : ajoutée, ignorée (doublon) ou en erreur.
    """
    now_iso = utc_now().isoformat()
    actor = _admin_user.get("email", "unknown")
    results: list[dict] = []

    for recipe in payload.recipes:
        slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", recipe.title.lower()))[:40].strip("-")
        recipe_id = f"manual-{slug}-{secrets.token_hex(4)}"

        mongo_doc: dict[str, Any] = {
            "_id": recipe_id,
            "id": recipe_id,
            "title": recipe.title,
            "description": recipe.summary,
            "dish_type": recipe.meal_type[0] if recipe.meal_type else "plat",
            "duration_min": recipe.prep_time_min + recipe.cook_time_min,
            "difficulty": recipe.difficulty,
            "ingredients": [{"name": i, "quantity": "", "optional": False} for i in recipe.ingredients_required]
                + [{"name": i, "quantity": "", "optional": True} for i in recipe.ingredients_optional],
            "steps": recipe.steps,
            "tags": recipe.tags,
            "is_active": True,
            "created_by": f"admin:{actor}",
            "created_at": now_iso,
            "updated_at": now_iso,
            "usage_count": 0,
            "view_count": 0,
        }
        try:
            await recipes_col.insert_one(mongo_doc)
        except DuplicateKeyError:
            results.append({"title": recipe.title, "status": "skipped", "reason": "duplicate"})
            continue
        except Exception as exc:
            results.append({"title": recipe.title, "status": "error", "reason": str(exc)})
            continue

        catalog_entry = {
            "id": recipe_id,
            "title": recipe.title,
            "summary": recipe.summary,
            "ingredients_required": recipe.ingredients_required,
            "ingredients_optional": recipe.ingredients_optional,
            "steps": recipe.steps,
            "prep_time_min": recipe.prep_time_min,
            "cook_time_min": recipe.cook_time_min,
            "difficulty": recipe.difficulty,
            "tags": recipe.tags,
            "meal_type": recipe.meal_type or ["dinner"],
            "cuisine": "française",
            "servings": recipe.servings,
            "search_terms": recipe.ingredients_required,
            "compat": {"storage_focus": []},
            "source": {"type": "manual_admin", "name": "KeepEat Admin"},
            "version": 1,
        }
        try:
            append_recipe_to_catalog(catalog_entry)
        except Exception as exc:
            logger.warning("admin_import_recipes: ajout catalogue JSON échoué id=%s: %s", recipe_id, exc)

        await _mark_coverable_gaps_after_recipe_insert(mongo_doc)
        results.append({"title": recipe.title, "id": recipe_id, "status": "added"})

    added = sum(1 for r in results if r["status"] == "added")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    errors = sum(1 for r in results if r["status"] == "error")
    logger.info("ADMIN_ACTION action=import_recipes added=%d skipped=%d errors=%d actor=%s", added, skipped, errors, actor)
    return {"added": added, "skipped": skipped, "errors": errors, "details": results}


# ── Endpoint admin : dédoublonnage MongoDB ────────────────────────────────────

@api_router.post("/admin/recipes/dedup", status_code=200)
async def admin_dedup_recipes(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Supprime les recettes en double dans MongoDB (même titre, insensible à la casse).
    Pour chaque groupe de doublons, garde la première recette insérée (id lexicographiquement min)
    et supprime les autres.
    Retourne le nombre de recettes supprimées et le nombre de groupes concernés.
    """
    pipeline = [
        {"$group": {
            "_id": {"$toLower": "$title"},
            "count": {"$sum": 1},
            "ids": {"$push": "$_id"},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]
    duplicates = await recipes_col.aggregate(pipeline).to_list(length=None)

    removed_total = 0
    groups: list[dict] = []
    for group in duplicates:
        ids = sorted(group["ids"])  # garde l'id lexicographiquement le plus petit (le plus ancien)
        ids_to_remove = ids[1:]
        result = await recipes_col.delete_many({"_id": {"$in": ids_to_remove}})
        removed_total += result.deleted_count
        groups.append({"title": group["_id"], "kept": ids[0], "removed": ids_to_remove})

    logger.info(
        "ADMIN_ACTION action=dedup_recipes groups=%d removed=%d actor=%s",
        len(groups), removed_total, _admin_user.get("email", "unknown"),
    )
    return {"groups": len(groups), "removed": removed_total, "details": groups}


# ── Endpoint admin : enrichissement images ────────────────────────────────────

@api_router.post("/admin/recipes/fetch-images", status_code=200)
async def admin_fetch_recipe_images(
    _admin_user: Dict[str, Any] = Depends(_require_admin_user),
):
    """Enrichit les recettes MongoDB sans image en cherchant une URL photo sur Pexels
    Stocke uniquement l'URL (chaîne ~150 octets), pas le binaire.
    Nécessite la variable d'environnement PEXELS_API_KEY.
    """
    recipes_without_image = await recipes_col.find(
        {"is_active": True, "$or": [{"image": {"$exists": False}}, {"image": ""}, {"image": None}]},
        {"_id": 1, "title": 1},
    ).to_list(length=500)

    updated = 0
    skipped = 0
    errors = 0

    async with httpx.AsyncClient() as client:
        for recipe in recipes_without_image:
            title = recipe.get("title", "")
            if not title:
                skipped += 1
                continue
            url = await _fetch_recipe_image_url(client, title)
            if url:
                await recipes_col.update_one(
                    {"_id": recipe["_id"]},
                    {"$set": {"image": url, "updated_at": utc_now().isoformat()}},
                )
                updated += 1
            else:
                errors += 1
            # Pause courte pour respecter les rate limits (200 req/h Pexels, 50 req/h Unsplash)
            await asyncio.sleep(0.4)

    logger.info(
        "ADMIN_ACTION action=fetch_recipe_images updated=%d skipped=%d errors=%d actor=%s",
        updated, skipped, errors, _admin_user.get("email", "unknown"),
    )
    return {"updated": updated, "skipped": skipped, "errors": errors}


# ── Page admin : import de recettes ──────────────────────────────────────────

_ADMIN_RECIPES_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Import recettes</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header span{font-size:22px}
  .container{max-width:860px;margin:32px auto;padding:0 16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px;margin-bottom:20px}
  .card h2{font-size:15px;font-weight:700;color:#166534;margin-bottom:16px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password],input[type=text]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#16a34a;border:1px solid #16a34a}
  button.secondary:hover{background:#f0fdf4}
  button:disabled{opacity:.5;cursor:not-allowed}
  textarea{width:100%;height:320px;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-family:monospace;font-size:12px;resize:vertical;outline:none}
  textarea:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .drop-zone{border:2px dashed #86efac;border-radius:10px;padding:28px;text-align:center;color:#166534;cursor:pointer;transition:.2s;background:#f0fdf4;margin-bottom:12px}
  .drop-zone:hover,.drop-zone.drag-over{border-color:#16a34a;background:#dcfce7}
  .drop-zone p{font-size:14px;font-weight:600;margin-bottom:4px}
  .drop-zone small{font-size:12px;color:#4ade80}
  .or{text-align:center;font-size:12px;color:#9ca3af;margin:12px 0;position:relative}
  .or::before,.or::after{content:"";position:absolute;top:50%;width:44%;height:1px;background:#e5e7eb}
  .or::before{left:0}.or::after{right:0}
  .result{border-radius:8px;padding:14px;font-size:13px;line-height:1.6;margin-top:16px}
  .result.success{background:#f0fdf4;border:1px solid #86efac;color:#166534}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .result.info{background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8}
  .detail-row{display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06)}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
  .badge.added{background:#dcfce7;color:#166534}
  .badge.skipped{background:#fef9c3;color:#854d0e}
  .badge.error{background:#fee2e2;color:#991b1b}
  #login-section{display:block}
  #import-section{display:none}
  .logged-as{font-size:12px;color:#6b7280;margin-left:auto}
  a.logout{font-size:12px;color:#dc2626;cursor:pointer;margin-left:12px;text-decoration:underline}
  .hint{font-size:12px;color:#6b7280;margin-top:6px}
</style>
</head>
<body>
<div class="header">
  <span>🥗</span>
  <h1>KeepEat — Import de recettes</h1>
  <nav style="display:flex;gap:8px;margin-left:auto;align-items:center">
    <a href="/admin/dashboard" style="color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)">Dashboard</a>
    <a href="/admin/tickets" style="color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)">Tickets</a>
  </nav>
  <span id="logged-info" class="logged-as" style="display:none"></span>
  <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Deconnexion</a>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2>Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="login()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- IMPORT -->
  <div class="card" id="import-section">
    <h2>Importer des recettes</h2>
    <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
      <p>Glisser-deposer un fichier JSON ici</p>
      <small>ou cliquer pour choisir un fichier</small>
    </div>
    <input id="file-input" type="file" accept=".json,application/json" style="display:none" onchange="loadFile(this)">
    <div class="or">ou coller le JSON directement</div>
    <label>Contenu JSON <span style="font-weight:400;color:#9ca3af">(tableau de recettes ou objet avec clé "recipes")</span></label>
    <textarea id="json-input" placeholder='[&#10;  {&#10;    "title": "Ma recette",&#10;    "summary": "Description...",&#10;    "ingredients_required": ["ingredient1"],&#10;    "ingredients_optional": [],&#10;    "steps": ["Etape 1.", "Etape 2."],&#10;    "prep_time_min": 10,&#10;    "cook_time_min": 15,&#10;    "difficulty": "easy",&#10;    "tags": [],&#10;    "meal_type": ["dinner"],&#10;    "servings": 2&#10;  }&#10;]'></textarea>
    <p class="hint">Champs obligatoires : title, summary, ingredients_required, steps, prep_time_min</p>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button onclick="importRecipes()" id="btn-import">Importer</button>
      <button class="secondary" onclick="document.getElementById('json-input').value=''">Effacer</button>
    </div>
    <div id="import-result"></div>
  </div>

</div>
<script>
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
if (token) showImportSection();

function showImportSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('import-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showImportSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur reseau : ' + e.message + '</div>'; }
}

function logout() {
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('import-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function loadFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('json-input').value = e.target.result; };
  reader.readAsText(file);
}

const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) { const r = new FileReader(); r.onload = ev => { document.getElementById('json-input').value = ev.target.result; }; r.readAsText(file); }
});

async function importRecipes() {
  const raw = document.getElementById('json-input').value.trim();
  const res = document.getElementById('import-result');
  const btn = document.getElementById('btn-import');
  if (!raw) { res.innerHTML = '<div class="result error">Collez ou chargez un fichier JSON d abord.</div>'; return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { res.innerHTML = '<div class="result error">JSON invalide : ' + e.message + '</div>'; return; }
  const recipes = Array.isArray(parsed) ? parsed : (parsed.recipes || null);
  if (!recipes) { res.innerHTML = '<div class="result error">Format attendu : tableau JSON ou objet avec cle "recipes".</div>'; return; }
  btn.disabled = true; btn.textContent = 'Import en cours...';
  try {
    const r = await fetch('/api/admin/recipes/import', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({recipes})
    });
    const data = await r.json();
    if (r.status === 401) { logout(); res.innerHTML = '<div class="result error">Session expiree. Reconnectez-vous.</div>'; return; }
    if (!r.ok) { res.innerHTML = '<div class="result error">' + JSON.stringify(data.detail || data) + '</div>'; return; }
    let html = '<div class="result success"><strong>Resultat : ' + data.added + ' ajoutee(s), ' + data.skipped + ' ignoree(s), ' + data.errors + ' erreur(s).</strong><br><br>';
    for (const d of data.details) {
      const badge = '<span class="badge ' + d.status + '">' + d.status + '</span>';
      html += '<div class="detail-row">' + badge + ' ' + d.title + (d.reason ? ' <em style=\\"color:#9ca3af\\">(' + d.reason + ')</em>' : '') + '</div>';
    }
    html += '</div>';
    res.innerHTML = html;
  } catch(e) { res.innerHTML = '<div class="result error">Erreur reseau : ' + e.message + '</div>'; }
  finally { btn.disabled = false; btn.textContent = 'Importer'; }
}

document.getElementById('password').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
</script>
</body>
</html>"""


@app.get("/admin/recipes", response_class=HTMLResponse, include_in_schema=False)
async def admin_recipes_page():
    """Page web d'import de recettes pour les administrateurs KeepEat."""
    return HTMLResponse(content=_ADMIN_RECIPES_HTML)


# ── Page admin : traitement tickets de caisse ─────────────────────────────────

_ADMIN_TICKETS_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Tickets de caisse</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header nav{display:flex;gap:8px;margin-left:auto;align-items:center}
  .header nav a{color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)}
  .header nav a:hover{opacity:1;background:rgba(255,255,255,.15)}
  .logged-as{font-size:12px;color:rgba(255,255,255,.75);margin-right:4px}
  a.logout{font-size:12px;color:#fca5a5;cursor:pointer;text-decoration:underline}
  .container{max-width:1100px;margin:28px auto;padding:0 16px;display:flex;flex-direction:column;gap:16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px}
  .card h2{font-size:15px;font-weight:700;color:#166534;margin-bottom:16px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password],input[type=text]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
  button.secondary:hover{background:#f9fafb}
  button.danger{background:#ef4444}
  button.danger:hover{background:#dc2626}
  button:disabled{opacity:.5;cursor:not-allowed}
  .result{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;margin-top:12px}
  .result.success{background:#f0fdf4;border:1px solid #86efac;color:#166534}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .result.info{background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8}
  /* Filters */
  .filter-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .filter-btn{padding:6px 14px;border-radius:999px;border:1.5px solid #d1d5db;background:#fff;font-size:13px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
  .filter-btn:hover{border-color:#16a34a;color:#166534}
  .filter-btn.active{border-color:#16a34a;background:#f0fdf4;color:#166534}
  .filter-count{font-size:12px;color:#9ca3af;margin-left:auto}
  /* Tickets list */
  .tickets-grid{display:flex;flex-direction:column;gap:10px}
  .ticket-card{background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:.15s}
  .ticket-card:hover{border-color:#86efac;box-shadow:0 2px 8px rgba(0,0,0,.07)}
  .ticket-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
  .ticket-info{flex:1;min-width:0}
  .ticket-email{font-size:14px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ticket-meta{font-size:12px;color:#6b7280;margin-top:2px}
  .ticket-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;flex-shrink:0}
  /* Modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;z-index:100;overflow-y:auto}
  .modal{background:#fff;border-radius:16px;width:100%;max-width:780px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18)}
  .modal-header{background:#f0fdf4;padding:16px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #d1fae5}
  .modal-header h3{font-size:16px;font-weight:800;color:#111827;flex:1}
  .modal-close{background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;padding:0 4px;line-height:1}
  .modal-close:hover{color:#374151}
  .modal-body{padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:640px){.modal-body{grid-template-columns:1fr}}
  .receipt-img{width:100%;border-radius:10px;border:1px solid #e5e7eb;max-height:420px;object-fit:contain;background:#f9fafb}
  .receipt-placeholder{width:100%;height:200px;border-radius:10px;border:1.5px dashed #d1d5db;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:14px}
  .form-section{display:flex;flex-direction:column;gap:12px}
  .items-list{display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto}
  .item-row{background:#f9fafb;border-radius:8px;padding:10px;border:1px solid #e5e7eb;display:flex;flex-direction:column;gap:8px}
  .item-row-top{display:flex;gap:8px}
  .item-row-top input{flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
  .remove-btn{background:#fee2e2;color:#ef4444;border:none;border-radius:6px;padding:0 10px;font-weight:700;cursor:pointer;font-size:16px}
  .remove-btn:hover{background:#fecaca}
  .cats{display:flex;gap:5px;flex-wrap:wrap}
  .cat-btn{padding:3px 9px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;font-size:11px;font-weight:600;color:#6b7280;cursor:pointer}
  .cat-btn:hover{border-color:#16a34a;color:#166534}
  .cat-btn.active{border-color:#16a34a;background:#dcfce7;color:#166534}
  .expiry-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;color:#374151}
  .add-item-btn{border:1.5px dashed #86efac;background:#f0fdf4;color:#166534;font-size:13px;font-weight:700;border-radius:8px;padding:10px;cursor:pointer;width:100%;text-align:center}
  .add-item-btn:hover{background:#dcfce7}
  .note-input{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;resize:vertical;min-height:60px;outline:none}
  .note-input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .action-row{display:flex;gap:10px;margin-top:4px}
  .action-row button{flex:1}
  /* Status colors */
  .dot-pending{background:#f59e0b}
  .dot-processed{background:#16a34a}
  .dot-dismissed{background:#9ca3af}
  .badge-pending{background:#fef3c7;color:#92400e}
  .badge-processed{background:#dcfce7;color:#166534}
  .badge-dismissed{background:#f3f4f6;color:#6b7280}
  /* Processed info */
  .processed-banner{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:13px;color:#166534}
  .items-added-list{margin-top:8px;font-size:12px;color:#374151;list-style:disc;padding-left:18px}
  /* Loader */
  .spinner{display:inline-block;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle}
  @keyframes spin{to{transform:rotate(360deg)}}
  #login-section{display:block}
  #tickets-section{display:none}
</style>
</head>
<body>
<div class="header">
  <span>🧾</span>
  <h1>KeepEat — Tickets de caisse</h1>
  <nav>
    <a href="/admin/dashboard">Dashboard</a>
    <a href="/admin/recipes">Recettes</a>
    <span id="logged-info" class="logged-as" style="display:none"></span>
    <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Déconnexion</a>
  </nav>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2>Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="doLogin()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- TICKETS -->
  <div id="tickets-section">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">Tickets de caisse</h2>
        <button class="secondary" onclick="loadTickets()" style="padding:7px 14px;font-size:13px">Actualiser</button>
      </div>
      <div class="filter-bar" style="margin-bottom:14px">
        <button class="filter-btn active" data-status="pending"   onclick="setFilter('pending')">En attente</button>
        <button class="filter-btn"        data-status="processed" onclick="setFilter('processed')">Traités</button>
        <button class="filter-btn"        data-status="dismissed" onclick="setFilter('dismissed')">Ignorés</button>
        <button class="filter-btn"        data-status="all"       onclick="setFilter('all')">Tous</button>
        <span class="filter-count" id="filter-count"></span>
      </div>
      <div class="tickets-grid" id="tickets-list">
        <div class="result info">Chargement des tickets...</div>
      </div>
      <div id="list-result"></div>
    </div>
  </div>

</div>

<!-- MODAL -->
<div class="modal-overlay" id="modal-overlay" style="display:none" onclick="closeModal(event)">
  <div class="modal" id="modal-box">
    <div class="modal-header">
      <h3 id="modal-title">Ticket</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="modal-body">
      <div class="result info">Chargement...</div>
    </div>
  </div>
</div>

<script>
const CATS = ['frais','proteines','legumes','feculents','desserts','boissons','epicerie','autres'];
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
let currentFilter = 'pending';
let currentTicketId = null;

if (token) showTicketsSection();

function showTicketsSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
  loadTickets();
}

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showTicketsSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur réseau : ' + e.message + '</div>'; }
}

function logout() {
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function setFilter(status) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.status === status);
  });
  loadTickets();
}

async function loadTickets() {
  const list = document.getElementById('tickets-list');
  list.innerHTML = '<div class="result info">Chargement...</div>';
  document.getElementById('list-result').innerHTML = '';
  try {
    const r = await fetch('/api/admin/receipt-tickets?status=' + currentFilter + '&limit=50&skip=0', {
      headers: {'Authorization':'Bearer '+token}
    });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    document.getElementById('filter-count').textContent = data.total + ' ticket' + (data.total > 1 ? 's' : '');
    if (data.tickets.length === 0) {
      list.innerHTML = '<div class="result info">Aucun ticket dans cette catégorie.</div>';
      return;
    }
    list.innerHTML = data.tickets.map(t => {
      const dotClass = 'dot-' + t.status;
      const badgeClass = 'badge-' + t.status;
      const labels = {pending:'En attente', processed:'Traité', dismissed:'Ignoré'};
      const date = new Date(t.created_at).toLocaleString('fr-FR');
      const itemsInfo = t.status === 'processed' && t.items_added && t.items_added.length > 0
        ? '<span style="font-size:11px;color:#16a34a;margin-left:8px">✓ ' + t.items_added.length + ' produit(s) ajouté(s)</span>'
        : '';
      return '<div class="ticket-card" onclick="openTicket(\'' + t.id + '\')">'
        + '<div class="ticket-dot ' + dotClass + '"></div>'
        + '<div class="ticket-info">'
        + '<div class="ticket-email">' + escHtml(t.user_email || t.user_id) + '</div>'
        + '<div class="ticket-meta">' + date + itemsInfo + '</div>'
        + '</div>'
        + '<span class="ticket-badge ' + badgeClass + '">' + (labels[t.status] || t.status) + '</span>'
        + '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="result error">Erreur : ' + e.message + '</div>';
  }
}

async function openTicket(ticketId) {
  currentTicketId = ticketId;
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  title.textContent = 'Chargement…';
  body.innerHTML = '<div style="padding:20px"><div class="result info">Chargement du ticket...</div></div>';
  overlay.style.display = 'flex';

  try {
    const r = await fetch('/api/admin/receipt-tickets/' + ticketId, {
      headers: {'Authorization':'Bearer '+token}
    });
    if (r.status === 401) { logout(); closeModal(); return; }
    const ticket = await r.json();
    title.textContent = 'Ticket — ' + (ticket.user_email || ticket.user_id);
    renderModal(ticket);
  } catch(e) {
    body.innerHTML = '<div style="padding:20px"><div class="result error">Erreur : ' + e.message + '</div></div>';
  }
}

function renderModal(ticket) {
  const body = document.getElementById('modal-body');
  const date = new Date(ticket.created_at).toLocaleString('fr-FR');
  const imgHtml = ticket.image_b64
    ? '<img class="receipt-img" src="data:image/jpeg;base64,' + ticket.image_b64 + '" alt="Ticket de caisse">'
    : '<div class="receipt-placeholder">Pas d\'image disponible</div>';

  let rightPanel = '';
  if (ticket.status !== 'pending') {
    // Read-only view for processed/dismissed
    const labels = {processed:'Traité ✓', dismissed:'Ignoré'};
    let itemsList = '';
    if (ticket.items_added && ticket.items_added.length > 0) {
      itemsList = '<ul class="items-added-list">' + ticket.items_added.map(i => '<li>' + escHtml(i.name) + ' <em>(' + escHtml(i.category) + ')</em></li>').join('') + '</ul>';
    }
    rightPanel = '<div class="form-section">'
      + '<div class="processed-banner"><strong>' + (labels[ticket.status] || ticket.status) + '</strong>'
      + (ticket.note ? '<br>' + escHtml(ticket.note) : '')
      + (itemsList ? '<br>' + itemsList : '')
      + '</div>'
      + (ticket.status === 'processed' ? '' : '<div style="margin-top:12px"><button onclick="reopenTicket(\'' + ticket.id + '\')">Remettre en attente</button></div>')
      + '</div>';
  } else {
    // Editable form
    rightPanel = '<div class="form-section">'
      + '<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:4px">Produits à ajouter au stock</div>'
      + '<div class="items-list" id="items-list"><div class="item-row">' + buildItemRow(0) + '</div></div>'
      + '<button class="add-item-btn" onclick="addItemRow()">+ Ajouter un produit</button>'
      + '<div>'
      + '<label style="margin-top:4px">Note admin (optionnel)</label>'
      + '<textarea class="note-input" id="admin-note" placeholder="Commentaire interne..."></textarea>'
      + '</div>'
      + '<div class="action-row">'
      + '<button id="btn-process" onclick="processTicket()">Valider et ajouter au stock</button>'
      + '<button class="danger" onclick="dismissTicket()">Ignorer</button>'
      + '</div>'
      + '<div id="modal-result"></div>'
      + '</div>';
  }

  body.innerHTML = '<div>' + imgHtml + '</div>' + rightPanel;
  initItemRows();
}

let itemCount = 1;

const ZONES = [{k:'frigo',l:'❄️ Frigo'},{k:'placard',l:'🏠 Placard'},{k:'congelateur',l:'🧊 Congélo'}];

function buildItemRow(idx) {
  return '<div class="item-row-top">'
    + '<input type="text" id="item-name-' + idx + '" placeholder="Nom du produit" oninput="syncItems()">'
    + '<button class="remove-btn" onclick="removeItemRow(' + idx + ')">×</button>'
    + '</div>'
    + '<div class="cats" id="cats-' + idx + '">'
    + CATS.map(c => '<button class="cat-btn' + (c === 'autres' ? ' active' : '') + '" data-cat="' + c + '" data-idx="' + idx + '" onclick="selectCat(this)">' + c + '</button>').join('')
    + '</div>'
    + '<div class="cats" id="zones-' + idx + '" style="margin-top:4px">'
    + ZONES.map((z,i) => '<button class="cat-btn' + (i===0?' active':'') + '" data-zone="' + z.k + '" data-idx="' + idx + '" onclick="selectZone(this)">' + z.l + '</button>').join('')
    + '</div>'
    + '<input class="expiry-input" id="item-expiry-' + idx + '" type="text" placeholder="DLC YYYY-MM-DD (optionnel)">';
}

function initItemRows() { itemCount = 1; }

function addItemRow() {
  const list = document.getElementById('items-list');
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id = 'item-row-' + itemCount;
  div.innerHTML = buildItemRow(itemCount);
  list.appendChild(div);
  itemCount++;
}

function removeItemRow(idx) {
  const row = document.getElementById('item-row-' + idx);
  if (row) row.remove();
}

function selectCat(btn) {
  const idx = btn.dataset.idx;
  document.querySelectorAll('#cats-' + idx + ' .cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function selectZone(btn) {
  const idx = btn.dataset.idx;
  document.querySelectorAll('#zones-' + idx + ' .cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function syncItems() {}

function collectItems() {
  const items = [];
  for (let i = 0; i < itemCount + 10; i++) {
    const nameEl = document.getElementById('item-name-' + i);
    if (!nameEl) continue;
    const name = nameEl.value.trim();
    if (!name) continue;
    const activeCat = document.querySelector('#cats-' + i + ' .cat-btn.active');
    const category = activeCat ? activeCat.dataset.cat : 'autres';
    const activeZone = document.querySelector('#zones-' + i + ' .cat-btn.active');
    const storageZone = activeZone ? activeZone.dataset.zone : 'frigo';
    const expiryEl = document.getElementById('item-expiry-' + i);
    const expiry = expiryEl ? expiryEl.value.trim() : '';
    items.push({ name, category, storageZone, expiry_date: expiry || null });
  }
  return items;
}

async function processTicket() {
  const items = collectItems();
  if (items.length === 0) {
    document.getElementById('modal-result').innerHTML = '<div class="result error">Ajoutez au moins un produit.</div>';
    return;
  }
  const note = (document.getElementById('admin-note') || {}).value || '';
  const btn = document.getElementById('btn-process');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Traitement...';
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + currentTicketId + '/process', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({items, note})
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || JSON.stringify(data));
    document.getElementById('modal-result').innerHTML = '<div class="result success"><strong>' + data.items_added + ' produit(s) ajouté(s) au stock.</strong></div>';
    setTimeout(() => { closeModal(); loadTickets(); }, 1500);
  } catch(e) {
    document.getElementById('modal-result').innerHTML = '<div class="result error">Erreur : ' + e.message + '</div>';
    btn.disabled = false;
    btn.textContent = 'Valider et ajouter au stock';
  }
}

async function dismissTicket() {
  if (!confirm('Ignorer ce ticket ? Il sera marqué comme ignoré.')) return;
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + currentTicketId + '/dismiss', {
      method: 'POST',
      headers: {'Authorization':'Bearer '+token}
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Erreur'); }
    closeModal();
    loadTickets();
  } catch(e) {
    alert('Erreur : ' + e.message);
  }
}

async function reopenTicket(ticketId) {
  if (!confirm('Remettre ce ticket en attente ?')) return;
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + ticketId + '/reopen', {
      method: 'POST',
      headers: {'Authorization':'Bearer '+token}
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Erreur'); }
    closeModal();
    loadTickets();
  } catch(e) {
    alert('Erreur : ' + e.message);
  }
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').style.display = 'none';
  currentTicketId = null;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>"""


@app.get("/admin/tickets", response_class=HTMLResponse, include_in_schema=False)
async def admin_tickets_page():
    """Page web de traitement des tickets de caisse pour les administrateurs KeepEat."""
    return HTMLResponse(content=_ADMIN_TICKETS_HTML)


# ── Page admin : dashboard Vue d'ensemble / Santé système ─────────────────────

_ADMIN_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header nav{display:flex;gap:8px;margin-left:auto;align-items:center}
  .header nav a{color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)}
  .header nav a:hover{opacity:1;background:rgba(255,255,255,.15)}
  .logged-as{font-size:12px;color:rgba(255,255,255,.75);margin-right:4px}
  a.logout{font-size:12px;color:#fca5a5;cursor:pointer;text-decoration:underline}
  .container{max-width:1100px;margin:28px auto;padding:0 16px;display:flex;flex-direction:column;gap:16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px}
  .card-title{font-size:15px;font-weight:700;color:#166534;margin-bottom:14px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
  button.secondary:hover{background:#f9fafb}
  .result{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;margin-top:12px}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:4px}
  .stat{background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;padding:12px 14px}
  .stat-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px}
  .stat-value{font-size:20px;font-weight:800;color:#111827;line-height:1.2}
  .stat-sub{font-size:11px;color:#9ca3af;margin-top:2px}
  .health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
  .health-item{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#fafafa;font-size:13px}
  .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .ok{background:#16a34a}
  .warn{background:#f59e0b}
  .err{background:#ef4444}
  .uptime-bar{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:9px 14px;font-size:13px;color:#166534;display:flex;gap:20px;flex-wrap:wrap;margin-top:10px}
  .error-banner{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:9px 14px;font-size:12px;color:#dc2626;margin-top:8px}
  .api-table{width:100%;border-collapse:collapse;font-size:12px}
  .api-table th{text-align:left;padding:7px 10px;background:#f0fdf4;color:#166534;font-weight:700;border-bottom:1px solid #d1fae5}
  .api-table td{padding:6px 10px;border-bottom:1px solid #f3f4f6;color:#374151;word-break:break-all}
  .api-table tr:last-child td{border-bottom:none}
  .api-table tr:hover td{background:#f9fafb}
  .rate-high{color:#ef4444;font-weight:700}
  .rate-med{color:#f59e0b;font-weight:700}
  .rate-ok{color:#16a34a}
  .svc-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
  .svc-row:last-child{border-bottom:none}
  .svc-name{flex:1;font-weight:600;color:#374151}
  .svc-units{color:#6b7280;font-size:12px}
  .svc-cost{font-weight:700;color:#166534;min-width:60px;text-align:right}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:680px){.two-col{grid-template-columns:1fr}.stats-grid{grid-template-columns:repeat(2,1fr)}}
  .refresh-note{font-size:11px;color:#9ca3af;text-align:right}
  #login-section{display:block}
  #dashboard-section{display:none}
  .chart-card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:20px}
  .chart-card .card-title{font-size:14px;font-weight:700;color:#166534;margin-bottom:12px}
  .period-bar{display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap}
  .period-btn{padding:4px 14px;border-radius:999px;border:1.5px solid #d1d5db;background:#fff;font-size:12px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
  .period-btn:hover{border-color:#16a34a;color:#166534}
  .period-btn.active{border-color:#16a34a;background:#f0fdf4;color:#166534}
  .drill-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center;padding:24px}
  .drill-box{background:#fff;border-radius:16px;width:100%;max-width:600px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18)}
  .drill-header{background:#f0fdf4;padding:14px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #d1fae5}
  .drill-title{font-size:12px;font-weight:800;color:#111827;flex:1;font-family:monospace;word-break:break-all}
  .drill-body{padding:20px;max-height:400px;overflow-y:auto}
</style>
</head>
<body>
<div class="header">
  <span>📊</span>
  <h1>KeepEat — Dashboard</h1>
  <nav>
    <a href="/admin/tickets">Tickets</a>
    <a href="/admin/recipes">Recettes</a>
    <span id="logged-info" class="logged-as" style="display:none"></span>
    <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Déconnexion</a>
  </nav>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2 style="font-size:15px;font-weight:700;color:#166534;margin-bottom:16px">Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="doLogin()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- DASHBOARD -->
  <div id="dashboard-section">

    <!-- Filtre période -->
    <div class="period-bar">
      <span style="font-size:12px;color:#6b7280;font-weight:600">Période :</span>
      <button class="period-btn" data-days="1"  onclick="setDays(1)">24h</button>
      <button class="period-btn active" data-days="7"  onclick="setDays(7)">7j</button>
      <button class="period-btn" data-days="30" onclick="setDays(30)">30j</button>
      <button class="period-btn" data-days="90" onclick="setDays(90)">90j</button>
    </div>

    <!-- Santé système -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0">🔍 Santé système</div>
        <button class="secondary" onclick="loadAll()" style="padding:7px 14px;font-size:13px">Actualiser</button>
      </div>
      <div id="health-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- KPIs utilisateurs + abonnements -->
    <div class="two-col">
      <div class="card">
        <div class="card-title">👥 Utilisateurs</div>
        <div id="users-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
      <div class="card">
        <div class="card-title">💳 Abonnements</div>
        <div id="subscriptions-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
    </div>

    <!-- Top issues API + coûts services -->
    <div class="two-col">
      <div class="card">
        <div class="card-title">⚠️ Top endpoints en erreur <small style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <div id="api-issues-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
      <div class="card">
        <div class="card-title">💰 Coûts services <small style="font-weight:400;color:#9ca3af;font-size:11px">(30j)</small></div>
        <div id="services-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
    </div>

    <!-- Graphiques de tendance -->
    <div class="two-col">
      <div class="chart-card">
        <div class="card-title">📈 Utilisateurs actifs / jour <small style="font-weight:400;color:#9ca3af;font-size:11px">(30j)</small></div>
        <canvas id="chart-dau" height="140"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-title">🆕 Nouveaux utilisateurs / jour <small style="font-weight:400;color:#9ca3af;font-size:11px">(30j)</small></div>
        <canvas id="chart-new-users" height="140"></canvas>
      </div>
    </div>
    <div class="two-col">
      <div class="chart-card">
        <div class="card-title">⚠️ Erreurs API / jour <small style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <canvas id="chart-errors" height="140"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-title">💰 Coûts services / jour <small style="font-weight:400;color:#9ca3af;font-size:11px">(30j)</small></div>
        <canvas id="chart-costs" height="140"></canvas>
      </div>
    </div>

    <div class="refresh-note" id="last-updated"></div>
  </div>
</div>

<!-- DRILL-DOWN MODAL -->
<div class="drill-overlay" id="drill-overlay" onclick="closeDrill(event)">
  <div class="drill-box">
    <div class="drill-header">
      <span class="drill-title" id="drill-title"></span>
      <button onclick="closeDrill()" style="background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;padding:0 2px">×</button>
    </div>
    <div class="drill-body" id="drill-body">
      <div style="color:#9ca3af;font-size:13px">Chargement...</div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<script>
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
let refreshTimer = null;
let _charts = {};
let selectedDays = 7;
let _apiIssueKeys = [];

function setDays(d) {
  selectedDays = d;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === d);
  });
  loadAll();
}

if (token) showDashboardSection();

function showDashboardSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
  loadAll();
  if (!refreshTimer) refreshTimer = setInterval(loadAll, 60000);
}

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showDashboardSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur réseau : ' + e.message + '</div>'; }
}

function logout() {
  clearInterval(refreshTimer); refreshTimer = null;
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

async function apiFetch(path) {
  const r = await fetch(path, {headers:{'Authorization':'Bearer '+token}});
  if (r.status === 401) { logout(); return null; }
  return r.json();
}

async function loadAll() {
  const [health, dash] = await Promise.all([
    apiFetch('/api/admin/monitoring/health'),
    apiFetch('/api/admin/monitoring/dashboard?days=' + selectedDays),
  ]);
  if (health) renderHealth(health);
  if (dash) {
    renderUsers(dash.users);
    renderSubscriptions(dash.subscriptions, dash.estimated_cost_summary);
    renderApiIssues(dash.top_api_issues || []);
    renderServices(dash.top_service_usage || []);
  }
  loadTrends();
  document.getElementById('last-updated').textContent = 'Mis à jour : ' + new Date().toLocaleTimeString('fr-FR') + ' (' + selectedDays + 'j)';
}

async function loadTrends() {
  const data = await apiFetch('/api/admin/monitoring/trends?days=' + selectedDays);
  if (!data) return;
  renderChart('chart-dau',       'line', data.dau,       r => r.date, r => r.count, 'Actifs/j',   '#16a34a');
  renderChart('chart-new-users', 'bar',  data.new_users, r => r.date, r => r.count, 'Nouveaux/j', '#3b82f6');
  renderChart('chart-errors',    'bar',  data.errors,    r => r.date, r => r.count, 'Erreurs/j',  '#ef4444');
  renderChart('chart-costs',     'line', data.costs,     r => r.date, r => r.cost,  'Coût €/j',   '#f59e0b');
}

function renderChart(id, type, rows, getLabel, getValue, label, color) {
  const labels = (rows || []).map(getLabel);
  const values = (rows || []).map(getValue);
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: color,
        backgroundColor: type === 'bar' ? color + 'bb' : color + '22',
        borderWidth: 2,
        tension: 0.3,
        fill: type === 'line',
        pointRadius: labels.length > 20 ? 2 : 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'min ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'min';
}

function renderHealth(h) {
  const svcLabels = {
    gemini_ocr_configured: 'Gemini OCR',
    gemini_recipes_configured: 'Gemini Recettes',
    brevo_configured: 'Brevo (email)',
    openfoodfacts_configured: 'OpenFoodFacts',
  };
  let html = '<div class="health-grid">';
  html += '<div class="health-item"><span class="dot ' + (h.db.ok ? 'ok' : 'err') + '"></span>MongoDB : ' + (h.db.ok ? 'OK' : 'ERREUR') + '</div>';
  for (const [k, lbl] of Object.entries(svcLabels)) {
    const on = h.external_services[k];
    html += '<div class="health-item"><span class="dot ' + (on ? 'ok' : 'warn') + '"></span>' + lbl + ' : ' + (on ? 'Configuré' : 'Non configuré') + '</div>';
  }
  html += '</div>';
  html += '<div class="uptime-bar"><span>⏱ Uptime : <strong>' + fmtUptime(h.uptime_seconds) + '</strong></span>';
  html += '<span>Statut : <strong style="color:' + (h.status === 'ok' ? '#16a34a' : '#ef4444') + '">' + (h.status === 'ok' ? '✓ OK' : '⚠ DÉGRADÉ') + '</strong></span></div>';
  if (h.last_critical_error) {
    const e = h.last_critical_error;
    html += '<div class="error-banner">⛔ Dernière erreur critique : <strong>' + escHtml((e.method||'') + ' ' + (e.path||'')) + '</strong> → HTTP ' + (e.status_code||'') + ' — ' + escHtml(e.error_type||'') + ' (' + escHtml((e.created_at||'').replace('T',' ').slice(0,19)) + ')</div>';
  }
  document.getElementById('health-content').innerHTML = html;
}

function statCard(label, value, sub) {
  return '<div class="stat"><div class="stat-label">' + escHtml(String(label)) + '</div><div class="stat-value">' + escHtml(String(value)) + '</div>' + (sub ? '<div class="stat-sub">' + escHtml(sub) + '</div>' : '') + '</div>';
}

function renderUsers(u) {
  if (!u) return;
  document.getElementById('users-content').innerHTML =
    '<div class="stats-grid">'
    + statCard('Total', u.total, '')
    + statCard('Nouveaux 24h', u.new_today, '')
    + statCard('Nouveaux 7j', u.new_7d, '')
    + statCard('Nouveaux 30j', u.new_30d, '')
    + statCard('DAU', u.dau, 'actifs/j')
    + statCard('WAU', u.wau, 'actifs/sem')
    + statCard('Premium', u.premium, '')
    + '</div>';
}

function renderSubscriptions(s, cost) {
  if (!s) return;
  const costVal = cost ? cost.services_30d_estimated_cost_eur : null;
  document.getElementById('subscriptions-content').innerHTML =
    '<div class="stats-grid">'
    + statCard('Actifs', s.active, '')
    + statCard('MRR', (s.estimated_mrr_eur||0).toFixed(2) + '\u00a0€', '')
    + statCard('ARR', (s.estimated_arr_eur||0).toFixed(2) + '\u00a0€', '')
    + (costVal !== null ? statCard('Coûts 30j', costVal.toFixed(4) + '\u00a0€', 'estimé') : '')
    + '</div>'
    + '<div style="font-size:12px;color:#6b7280;margin-top:8px">Mensuel : ' + (s.by_plan.premium_monthly||0) + ' · Autre : ' + (s.by_plan.premium_other||0) + '</div>';
}

function renderApiIssues(issues) {
  _apiIssueKeys = (issues || []).map(r => r.endpoint_key || '');
  if (!issues.length) {
    document.getElementById('api-issues-content').innerHTML = '<div style="color:#16a34a;font-size:13px">Aucun problème détecté 🎉</div>';
    return;
  }
  let html = '<table class="api-table"><thead><tr><th>Endpoint</th><th>Appels</th><th>Erreurs</th><th>Lat. moy.</th></tr></thead><tbody>';
  for (let i = 0; i < issues.length; i++) {
    const row = issues[i];
    const rate = row.error_rate || 0;
    const cls = rate >= 0.3 ? 'rate-high' : rate >= 0.1 ? 'rate-med' : 'rate-ok';
    html += '<tr style="cursor:pointer" title="Cliquer pour détails" onclick="drillDown(' + i + ')">';
    html += '<td>' + escHtml(row.endpoint_key||'') + '</td><td>' + (row.volume||0) + '</td><td class="' + cls + '">' + (rate*100).toFixed(1) + '%</td><td>' + (row.avg_latency_ms ? Math.round(row.avg_latency_ms) + 'ms' : '—') + '</td></tr>';
  }
  html += '</tbody></table><div style="font-size:11px;color:#9ca3af;margin-top:4px">Cliquer sur une ligne pour le détail</div>';
  document.getElementById('api-issues-content').innerHTML = html;
}

async function drillDown(idx) {
  const endpointKey = _apiIssueKeys[idx] || '';
  if (!endpointKey) return;
  const overlay = document.getElementById('drill-overlay');
  overlay.style.display = 'flex';
  document.getElementById('drill-title').textContent = endpointKey;
  document.getElementById('drill-body').innerHTML = '<div style="color:#9ca3af;font-size:13px">Chargement...</div>';
  const data = await apiFetch('/api/admin/monitoring/api-drill?endpoint_key=' + encodeURIComponent(endpointKey) + '&days=' + selectedDays);
  if (!data) { closeDrill(); return; }
  let html = '<div style="font-size:13px;color:#374151;margin-bottom:14px"><strong>' + data.total_calls + '</strong> appel(s) sur ' + data.days + 'j</div>';
  html += '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">Par code HTTP</div>';
  html += '<table class="api-table" style="margin-bottom:16px"><thead><tr><th>Status</th><th>Appels</th><th>Lat. moy.</th></tr></thead><tbody>';
  for (const r of data.by_status) {
    const cls = r.status_code >= 500 ? 'rate-high' : r.status_code >= 400 ? 'rate-med' : 'rate-ok';
    html += '<tr><td class="' + cls + '"><strong>' + r.status_code + '</strong></td><td>' + r.count + '</td><td>' + r.avg_ms + 'ms</td></tr>';
  }
  html += '</tbody></table>';
  if (data.last_errors && data.last_errors.length) {
    html += '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">Dernières erreurs</div>';
    for (const e of data.last_errors) {
      html += '<div style="font-size:11px;color:#6b7280;padding:5px 0;border-bottom:1px solid #f3f4f6;line-height:1.5">';
      html += escHtml((e.created_at||'').replace('T',' ').slice(0,19)) + '<br>';
      html += '<span style="color:#ef4444;font-family:monospace">' + escHtml((e.method||'') + ' ' + (e.path||'')) + '</span>';
      html += ' → HTTP <strong>' + (e.status_code||'') + '</strong>';
      if (e.error_type) html += ' <span style="color:#9ca3af">(' + escHtml(e.error_type) + ')</span>';
      if (e.duration_ms) html += ' — ' + Math.round(e.duration_ms) + 'ms';
      html += '</div>';
    }
  } else {
    html += '<div style="color:#16a34a;font-size:12px">Aucune erreur récente.</div>';
  }
  document.getElementById('drill-body').innerHTML = html;
}

function closeDrill(event) {
  if (event && event.target !== document.getElementById('drill-overlay')) return;
  document.getElementById('drill-overlay').style.display = 'none';
}

function renderServices(svcs) {
  if (!svcs.length) {
    document.getElementById('services-content').innerHTML = '<div style="color:#9ca3af;font-size:13px">Aucune donnée.</div>';
    return;
  }
  let html = '<div>';
  for (const s of svcs) {
    html += '<div class="svc-row"><span class="svc-name">' + escHtml(s.service_name||'—') + '</span><span class="svc-units">' + Number(s.units||0).toFixed(0) + ' unités</span><span class="svc-cost">' + Number(s.estimated_cost||0).toFixed(4) + '\u00a0€</span></div>';
  }
  html += '</div>';
  document.getElementById('services-content').innerHTML = html;
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('password').addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });
</script>
</body>
</html>"""


@app.get("/admin/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def admin_dashboard_page():
    """Page web de dashboard Vue d'ensemble / Santé système pour les administrateurs KeepEat."""
    return HTMLResponse(content=_ADMIN_DASHBOARD_HTML)


# Redirect pages (deep link fallback for email clients)
# -----------------------------------------------------------------------------
@app.get("/redirect/reset-password", response_class=HTMLResponse, include_in_schema=False)
async def redirect_reset_password(token: str = Query(...)):
    deep_link = f"keepeat://reset-password?token={token}"
    return redirect_html(
        title="KeepEat — Réinitialisation du mot de passe",
        icon="🔒",
        heading="Réinitialiser votre mot de passe",
        description="Cliquez sur le bouton ci-dessous pour ouvrir l'application KeepEat et choisir un nouveau mot de passe.",
        deep_link=deep_link,
    )


@app.get("/redirect/verify-email", response_class=HTMLResponse, include_in_schema=False)
async def redirect_verify_email(token: str = Query(...)):
    deep_link = f"keepeat://verify-email?token={token}"
    return redirect_html(
        title="KeepEat — Confirmation de l'email",
        icon="✉️",
        heading="Confirmer votre adresse email",
        description="Cliquez sur le bouton ci-dessous pour ouvrir l'application KeepEat et confirmer votre adresse email.",
        deep_link=deep_link,
    )


# Wire routes
# -----------------------------------------------------------------------------
app.include_router(api_router)
