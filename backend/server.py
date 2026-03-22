# backend/server.py
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

import aiosmtplib

import httpx
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Load local environment variables from backend/.env (safe in Render too)
load_dotenv()

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("keepeat-backend")

# -----------------------------------------------------------------------------
# App
# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# Push notifications (Expo Push API)
# -----------------------------------------------------------------------------

async def _send_expo_push(tokens: list[str], title: str, body: str, data: dict | None = None) -> None:
    """Envoie une push notification via l'API Expo Push."""
    valid = [t for t in tokens if t.startswith(("ExponentPushToken[", "ExpoPushToken["))]
    if not valid:
        return
    messages = [
        {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"}
        for t in valid
    ]
    try:
        async with httpx.AsyncClient(timeout=15) as client_http:
            await client_http.post(
                "https://exp.host/--/push/v2/send",
                json=messages,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
    except Exception as exc:
        logger.warning("Expo push failed: %s", exc)


# -----------------------------------------------------------------------------
# Rappels produits — rappel.conso.gouv.fr
# -----------------------------------------------------------------------------

async def _fetch_recent_recalls() -> list[dict]:
    """Récupère les rappels des 30 derniers jours avec code-barres depuis rappel.conso.gouv.fr."""
    since = (_utc_now() - timedelta(days=30)).strftime("%Y-%m-%d")
    url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso0/records"
    params: dict = {
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
                r = await client_http.get(url, params=params)
                if r.status_code != 200:
                    logger.warning("Rappel.conso API returned %s", r.status_code)
                    break
                page_data = r.json()
                page_results = page_data.get("results", [])
                results.extend(page_results)
                if len(page_results) < 100:
                    break
                params["offset"] += 100
    except Exception as exc:
        logger.warning("Rappel.conso fetch failed: %s", exc)
    logger.info("Rappel.conso : %d rappels récupérés", len(results))
    return results


async def _check_recalls_and_notify() -> None:
    """Vérifie si des produits en stock sont rappelés et envoie une push notification."""
    recalls = await _fetch_recent_recalls()
    # Enregistrer la date du dernier check (même si aucun rappel trouvé)
    await app_state_col.update_one(
        {"key": "last_recall_check"},
        {"$set": {"key": "last_recall_check", "checked_at": _utc_now()}},
        upsert=True,
    )
    if not recalls:
        return

    recall_map: dict[str, dict] = {}
    for r in recalls:
        bc = str(r.get("code_barre", "")).strip()
        if bc:
            recall_map[bc] = r

    if not recall_map:
        return

    async for user_doc in users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])
        cursor = stock_col.find({"user_id": user_id, "status": "active", "barcode": {"$exists": True, "$ne": ""}})
        async for item in cursor:
            bc = str(item.get("barcode", "")).strip()
            if bc not in recall_map:
                continue
            alert_key = f"recall_{bc}"
            already_sent = await user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
            if already_sent:
                continue
            recall_info = recall_map[bc]
            brand = recall_info.get("nom_de_la_marque_du_produit", "")
            risk = recall_info.get("risques_encourus_par_le_consommateur", "Vérifiez l'emballage")
            item_label = item["name"] + (f" — {brand}" if brand else "")
            await _send_expo_push(
                tokens,
                title="⚠️ Produit rappelé",
                body=f"{item_label} fait l'objet d'un rappel officiel. {risk}",
                data={"type": "recall", "itemId": str(item["_id"]), "barcode": bc},
            )
            await user_alerts_col.insert_one({
                "user_id": user_id,
                "key": alert_key,
                "sent_at": _utc_now(),
            })
            logger.info("Recall alert sent — user=%s barcode=%s", user_id, bc)


async def _check_inactivity_and_notify() -> None:
    """Envoie une push si l'utilisateur n'a pas interagi avec son stock depuis 7 jours."""
    threshold = _utc_now() - timedelta(days=7)

    async for user_doc in users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        count = await stock_col.count_documents({"user_id": user_id, "status": "active"})
        if count == 0:
            continue

        last_action_raw = user_doc.get("last_stock_action") or user_doc.get("created_at")
        if not last_action_raw:
            continue
        last_action = (
            datetime.fromisoformat(last_action_raw)
            if isinstance(last_action_raw, str)
            else last_action_raw
        )
        # Normaliser en UTC
        if last_action.tzinfo is None:
            last_action = last_action.replace(tzinfo=timezone.utc)
        if last_action > threshold:
            continue  # Activité récente, pas d'alerte

        # Dedup : pas plus d'une alerte inactivité par semaine
        already_sent = await user_alerts_col.find_one({
            "user_id": user_id,
            "key": "inactivity",
            "sent_at": {"$gte": threshold},
        })
        if already_sent:
            continue

        tokens: list[str] = user_doc.get("push_tokens", [])
        nb = count
        await _send_expo_push(
            tokens,
            title="🥗 Votre stock vous attend !",
            body=(
                f"Vous avez {nb} produit{'s' if nb > 1 else ''} en stock. "
                "Pensez à les consommer pour éviter le gaspillage."
            ),
            data={"type": "inactivity"},
        )
        await user_alerts_col.insert_one({
            "user_id": user_id,
            "key": "inactivity",
            "sent_at": _utc_now(),
        })
        logger.info("Inactivity alert sent — user=%s items=%d", user_id, nb)


async def _check_weekly_expiry_summary() -> None:
    """Envoie un résumé hebdomadaire des produits urgents (expiry <= 7j)."""
    today = _utc_now().date()
    in_7_days = (today + timedelta(days=7)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")
    iso_week = today.isocalendar()[1]  # numéro de semaine ISO

    async for user_doc in users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])

        # Dedup : une seule notif par semaine ISO
        alert_key = f"weekly_{user_id}_{today.year}_{iso_week}"
        already_sent = await user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
        if already_sent:
            continue

        # Produits actifs expirant dans les 7 prochains jours
        cursor = stock_col.find({
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
        await _send_expo_push(
            tokens,
            title=f"📦 {count} produit{'s' if count > 1 else ''} à consommer cette semaine",
            body=body,
            data={"type": "weekly_summary"},
        )
        await user_alerts_col.insert_one({
            "user_id": user_id,
            "key": alert_key,
            "sent_at": _utc_now(),
        })
        logger.info("Weekly summary sent — user=%s items=%d", user_id, count)


async def _check_daily_expiry_alert() -> None:
    """Alerte quotidienne J-2 : produits expirant dans ≤2 jours, avec suggestion de recette."""
    today = _utc_now().date()
    in_2_days = (today + timedelta(days=2)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    async for user_doc in users_col.find({"push_tokens": {"$exists": True, "$ne": []}}):
        user_id = str(user_doc["_id"])
        tokens: list[str] = user_doc.get("push_tokens", [])

        # Dedup : une seule alerte J-2 par jour par utilisateur
        alert_key = f"daily_expiry_{user_id}_{today_str}"
        already_sent = await user_alerts_col.find_one({"user_id": user_id, "key": alert_key})
        if already_sent:
            continue

        # Produits actifs expirant dans 0-2 jours
        cursor = stock_col.find({
            "user_id": user_id,
            "status": "active",
            "expiry_date": {"$nin": [None, ""], "$gte": today_str, "$lte": in_2_days},
        }).sort("expiry_date", 1).limit(5)
        urgent_items = await cursor.to_list(length=5)
        if not urgent_items:
            continue

        names = [item["name"] for item in urgent_items]
        count = len(names)

        # Suggestion de recette via TheMealDB (gratuit, sans clé)
        recipe_hint = ""
        if names:
            try:
                en_ingredient = _fr_to_en_ingredient(names[0], "autres")
                async with httpx.AsyncClient(timeout=6) as hclient:
                    r = await hclient.get(
                        "https://www.themealdb.com/api/json/v1/1/filter.php",
                        params={"i": en_ingredient},
                    )
                    if r.status_code == 200:
                        meals = (r.json().get("meals") or [])
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
        body = ", ".join(names) + recipe_hint
        await _send_expo_push(
            tokens,
            title=title,
            body=body,
            data={"type": "daily_expiry", "count": count},
        )
        await user_alerts_col.insert_one({
            "user_id": user_id,
            "key": alert_key,
            "sent_at": _utc_now(),
        })
        logger.info("Daily expiry alert sent — user=%s items=%d recipe=%s", user_id, count, bool(recipe_hint))


async def _alert_loop() -> None:
    """Boucle de fond : vérifie toutes les 6h les rappels, l'inactivité et les résumés."""
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            await _check_recalls_and_notify()
            await _check_inactivity_and_notify()
            # Alertes matinales uniquement (heure UTC < 12)
            if _utc_now().hour < 12:
                await _check_daily_expiry_alert()
                await _check_weekly_expiry_summary()
        except Exception as exc:
            logger.error("Alert loop error: %s", exc)


async def _seed_default_user() -> None:
    """Crée le compte dev par défaut s'il n'existe pas encore.

    Nécessite les variables d'environnement SEED_EMAIL et SEED_PASSWORD.
    Si absentes, le seed est silencieusement ignoré.
    Le mot de passe doit respecter les critères de sécurité de _validate_password.
    """
    DEFAULT_EMAIL = os.getenv("SEED_EMAIL", "").strip().lower()
    DEFAULT_PASSWORD = os.getenv("SEED_PASSWORD", "")
    if not DEFAULT_EMAIL or not DEFAULT_PASSWORD:
        logger.info("SEED_EMAIL/SEED_PASSWORD non configurés → seed dev ignoré")
        return
    try:
        _validate_password(DEFAULT_PASSWORD)
    except HTTPException as e:
        logger.warning("SEED_PASSWORD trop faible (%s) → seed dev ignoré", e.detail)
        return
    try:
        existing = await users_col.find_one({"email": DEFAULT_EMAIL})
        if not existing:
            await users_col.insert_one({
                "email": DEFAULT_EMAIL,
                "hashed_password": _hash_password(DEFAULT_PASSWORD),
                "is_premium": True,
                "email_verified": True,
                "created_at": _utc_now(),
                "last_login": None,
            })
            logger.info("Default dev user created: %s", DEFAULT_EMAIL)
        else:
            updates: dict = {}
            if not existing.get("is_premium"):
                updates["is_premium"] = True
            if not existing.get("email_verified"):
                updates["email_verified"] = True
            if updates:
                await users_col.update_one({"email": DEFAULT_EMAIL}, {"$set": updates})
                logger.info("Default dev user updated: %s → %s", DEFAULT_EMAIL, updates)
    except Exception as e:
        logger.warning("Could not seed default user: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _seed_default_user()

    # ── Index TTL (auto-nettoyage) ─────────────────────────────────────────────
    await user_alerts_col.create_index("sent_at", expireAfterSeconds=30 * 24 * 3600)
    await products_cache_col.create_index("cached_at", expireAfterSeconds=7 * 24 * 3600)
    await products_cache_col.create_index("barcode", unique=True)
    await community_recipes_col.create_index("created_at")

    # ── Index stock_col ────────────────────────────────────────────────────────
    # Toutes les requêtes filtrent sur user_id+status ; ajout de expiry_date
    # couvre l'agrégation stats + get_priority_items sans surcoût.
    await stock_col.create_index([("user_id", 1), ("status", 1), ("expiry_date", 1)])
    # Stats semaine : comptage consumed/thrown par date
    await stock_col.create_index([("user_id", 1), ("status", 1), ("consumed_date", 1)])
    await stock_col.create_index([("user_id", 1), ("status", 1), ("thrown_date", 1)])

    # ── Index users_col ────────────────────────────────────────────────────────
    # email : login, register, forgot-password, resend-verification, set-premium
    await users_col.create_index("email", unique=True)
    # Tokens à usage unique : sparse=True évite d'indexer les docs sans le champ
    await users_col.create_index("verification_token", sparse=True)
    await users_col.create_index("reset_token", sparse=True)

    # Lancer la boucle d'alertes en arrière-plan
    alert_task = asyncio.create_task(_alert_loop())
    yield
    alert_task.cancel()
    client.close()


app = FastAPI(title="KeepEat Backend", version="1.0.0", lifespan=lifespan)

# Rate limiting (in-memory, par adresse IP)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/health")
async def health_root():
    """
    Simple health endpoint for Render / monitoring / CI.
    Also tries to ping Mongo to detect DB issues.
    """
    mongo_ok = True
    try:
        # ping Mongo
        # (db is defined below; this function runs after module import is complete)
        await db.command("ping")  # type: ignore[name-defined]
    except Exception:
        mongo_ok = False

    return {
        "status": "ok" if mongo_ok else "degraded",
        "mongo": mongo_ok,
        "timestamp": _utc_now().isoformat(),
    }


# -----------------------------------------------------------------------------
# CORS (middleware must be added BEFORE routers)
# -----------------------------------------------------------------------------
# CORS_ORIGINS : origines autorisées, séparées par des virgules.
# Pour une app React Native pure, "*" est correct car CORS n'est pas enforced
# par les clients mobiles (pas de navigateur). À restreindre uniquement si
# un frontend web accède aussi à ce backend.
# Exemples : "*" | "https://keepeat.app,https://admin.keepeat.app"
cors_origins = os.getenv("CORS_ORIGINS", "*").strip()

if cors_origins == "*":
    logger.warning(
        "⚠️  CORS_ORIGINS='*' — Toutes les origines sont autorisées. "
        "Acceptable pour une app mobile-only. À restreindre si un frontend web utilise ce backend."
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

# -----------------------------------------------------------------------------
# MongoDB
# -----------------------------------------------------------------------------
MONGO_URL = os.getenv("MONGO_URL")
if not MONGO_URL:
    raise RuntimeError("MONGO_URL is required. Set it in Render > Environment Variables.")

DB_NAME = os.getenv("DB_NAME", "keepeat_db")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
stock_col = db["stock"]
users_col = db["users"]
user_alerts_col = db["user_alerts"]      # alertes envoyées (dedup, TTL 30j)
app_state_col = db["app_state"]          # état global de l'app (last_recall_check, ...)
products_cache_col = db["products_cache"]  # cache OFF (TTL 7j)
community_recipes_col = db["community_recipes"]  # recettes générées par IA (partagées)

# -----------------------------------------------------------------------------
# Auth configuration
# -----------------------------------------------------------------------------
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY is required. Set it in Render > Environment Variables.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

ADMIN_KEY = os.getenv("ADMIN_KEY", "")
SPOONACULAR_KEY = os.getenv("SPOONACULAR_KEY", "")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
http_bearer = HTTPBearer(auto_error=False)


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _validate_password(password: str) -> None:
    """Lève HTTPException 422 si le mot de passe ne respecte pas les critères de sécurité."""
    errors = []
    if len(password) < 8:
        errors.append("8 caractères minimum")
    if not re.search(r"[A-Z]", password):
        errors.append("au moins une majuscule")
    if not re.search(r"[a-z]", password):
        errors.append("au moins une minuscule")
    if not re.search(r"[0-9]", password):
        errors.append("au moins un chiffre")
    if not re.search(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>?/\\|`~]', password):
        errors.append("au moins un caractère spécial")
    if errors:
        raise HTTPException(
            status_code=422,
            detail=f"WEAK_PASSWORD: {', '.join(errors)}",
        )


async def _send_email(to: str, subject: str, html_body: str) -> None:
    """Envoie un email HTML via Brevo API HTTP (port 443, jamais bloqué par les hébergeurs)."""
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        logger.warning("Email non envoyé vers %s : BREVO_API_KEY non configuré", to)
        return
    sender_email = os.getenv("MAIL_FROM", "fesperiquette@hotmail.com")
    sender_name  = os.getenv("MAIL_FROM_NAME", "KeepEat")
    payload = {
        "sender":     {"name": sender_name, "email": sender_email},
        "to":         [{"email": to}],
        "subject":    subject,
        "htmlContent": html_body,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={"api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code in (200, 201):
            logger.info("Email envoyé à %s : %s", to, subject)
        else:
            logger.error("Échec envoi email à %s : HTTP %s — %s", to, r.status_code, r.text[:200])
    except Exception as e:
        logger.error("Échec envoi email à %s : %s", to, e)


def _create_token(user_id: str) -> str:
    expire = _utc_now() + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


async def _get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
) -> Dict[str, Any]:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise ValueError("missing sub")
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    try:
        doc = await users_col.find_one({"_id": ObjectId(user_id)})
    except Exception:
        doc = None
    if not doc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return _serialize_mongo(doc)

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _serialize_mongo(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Mongo _id to string id and remove internal fields."""
    if not doc:
        return doc
    out = dict(doc)
    _id = out.pop("_id", None)
    if _id is not None:
        out["id"] = str(_id)
    return out


def _parse_date_yyyy_mm_dd(value: Optional[str]) -> Optional[datetime]:
    """Parse YYYY-MM-DD into UTC datetime (00:00). Returns None if invalid."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _days_until(expiry_date: Optional[str]) -> Optional[int]:
    """Return days until expiry from YYYY-MM-DD (can be negative)."""
    dt = _parse_date_yyyy_mm_dd(expiry_date)
    if not dt:
        return None
    today = _utc_now().date()
    return (dt.date() - today).days


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

# --- Auth models ---

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    is_premium: bool
    is_verified: bool = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class RegisterResponse(BaseModel):
    message: str
    email: str


class VerifyEmailBody(BaseModel):
    token: str


class ResendVerificationBody(BaseModel):
    email: EmailStr


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


# --- Stock models ---

class ProductBase(BaseModel):
    barcode: Optional[str] = None
    name: str = ""
    brand: Optional[str] = ""
    image_url: Optional[str] = ""
    category: Optional[str] = None
    quantity: Optional[str] = ""


class StockItemCreate(ProductBase):
    expiry_date: Optional[str] = None  # "YYYY-MM-DD"
    notes: Optional[str] = None


class StockItem(StockItemCreate):
    id: str
    added_date: str
    status: str  # active/consumed/thrown
    consumed_date: Optional[str] = None
    thrown_date: Optional[str] = None
    food_category: Optional[str] = None  # frais/proteines/legumes/feculents/desserts/boissons/epicerie/autres


class StockItemUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    quantity: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class ShelfLife(BaseModel):
    category_fr: str = ""
    refrigerator_days: Optional[int] = None
    freezer_days: Optional[int] = None
    pantry_days: Optional[int] = None
    tips_fr: str = ""


class ProductLookupResponse(BaseModel):
    found: bool
    product: Optional[ProductBase] = None
    shelf_life: Optional[ShelfLife] = None


class StatsResponse(BaseModel):
    total_items: int
    expiring_soon: int
    expired: int
    consumed_this_week: int
    thrown_this_week: int


# -----------------------------------------------------------------------------
# OpenFoodFacts
# -----------------------------------------------------------------------------
OFF_USER_AGENT = os.getenv("OFF_USER_AGENT", "KeepEat/1.0 (https://keepeat.app)")


async def lookup_product_openfoodfacts(barcode: str) -> Optional[ProductBase]:
    # 1. Vérifier le cache MongoDB (TTL 7j)
    cached = await products_cache_col.find_one({"barcode": barcode})
    if cached:
        logger.info("OFF cache hit barcode=%s", barcode)
        return ProductBase(**{k: v for k, v in cached.items() if k in ProductBase.model_fields})

    # 2. Cache miss → appel OpenFoodFacts
    product: Optional[ProductBase] = None
    try:
        url = f"https://world.openfoodfacts.net/api/v2/product/{barcode}"
        headers = {"User-Agent": OFF_USER_AGENT}
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as c:
            r = await c.get(url)

        if r.status_code != 200:
            logger.info("OFF lookup failed status=%s barcode=%s", r.status_code, barcode)
        else:
            data = r.json()
            if data.get("status") == 1 and data.get("product"):
                p = data["product"]
                product = ProductBase(
                    barcode=barcode,
                    name=p.get("product_name") or p.get("product_name_fr") or "Produit inconnu",
                    brand=p.get("brands", "") or "",
                    image_url=p.get("image_front_small_url") or p.get("image_url") or "",
                    category=(p.get("categories_tags") or [None])[0],
                    quantity=p.get("quantity", "") or "",
                )
    except Exception as e:
        logger.warning("OFF lookup exception barcode=%s err=%s", barcode, e)

    # 3. Stocker en cache (même si None → évite de re-interroger un produit inconnu)
    try:
        doc = {"barcode": barcode, "cached_at": _utc_now()}
        if product:
            doc.update(product.model_dump())
            doc["found"] = True
        else:
            doc["found"] = False
        await products_cache_col.update_one(
            {"barcode": barcode}, {"$set": doc}, upsert=True
        )
    except Exception as e:
        logger.warning("OFF cache write failed barcode=%s err=%s", barcode, e)

    return product


# -----------------------------------------------------------------------------
# Shelf-life heuristics (simple + safe)
# -----------------------------------------------------------------------------
SHELF_LIFE_BY_KEYWORD = [
    # keyword, fridge, freezer, pantry, category_fr, tips_fr
    ("milk", 7, None, None, "Produits laitiers", "Conserver au réfrigérateur après ouverture."),
    ("yogurt", 10, None, None, "Produits laitiers", "Conserver au réfrigérateur."),
    ("cheese", 14, None, None, "Produits laitiers", "Bien emballer pour éviter le dessèchement."),
    ("meat", 2, 90, None, "Viandes", "Réfrigérer rapidement et respecter la chaîne du froid."),
    ("fish", 2, 90, None, "Poissons", "À consommer rapidement après achat."),
    ("bread", 5, 30, 3, "Boulangerie", "Éviter le frigo (durcit). Congeler si besoin."),
    ("egg", 21, None, 21, "Œufs", "Conserver au frais et vérifier la fraîcheur."),
    ("pasta", None, None, 365, "Épicerie", "Stocker au sec, à l’abri de la chaleur."),
    ("rice", None, None, 365, "Épicerie", "Stocker au sec, à l’abri de l’humidité."),
]


def infer_shelf_life(product: Optional[ProductBase]) -> ShelfLife:
    name = (product.name if product else "").lower()
    brand = ((product.brand or "") if product else "").lower()
    blob = f"{name} {brand}"

    for kw, fridge, freezer, pantry, cat_fr, tips_fr in SHELF_LIFE_BY_KEYWORD:
        if kw in blob:
            return ShelfLife(
                category_fr=cat_fr,
                refrigerator_days=fridge,
                freezer_days=freezer,
                pantry_days=pantry,
                tips_fr=tips_fr,
            )

    # default fallback
    return ShelfLife(
        category_fr="Général",
        refrigerator_days=7,
        freezer_days=90,
        pantry_days=180,
        tips_fr="Adapter selon l’emballage et respecter la chaîne du froid.",
    )


# -----------------------------------------------------------------------------
# Food category heuristics (filtrage automatique par type)
# -----------------------------------------------------------------------------

# Mapping des tags OpenFoodFacts vers nos catégories standardisées
_OFF_CATEGORY_MAP: dict[str, str] = {
    # Boissons
    "en:beverages": "boissons", "en:waters": "boissons", "en:sodas": "boissons",
    "en:juices-and-nectars": "boissons", "en:coffees": "boissons", "en:teas": "boissons",
    "en:plant-based-milks": "boissons", "en:fruit-juices": "boissons",
    "fr:boissons": "boissons",
    # Frais (laitier / frais)
    "en:dairies": "frais", "en:milks": "frais", "en:cheeses": "frais",
    "en:yogurts": "frais", "en:butters": "frais", "en:creams": "frais",
    "en:eggs": "frais",
    "fr:laits": "frais", "fr:yaourts": "frais", "fr:fromages": "frais",
    "fr:produits-laitiers": "frais",
    # Protéines
    "en:meats": "proteines", "en:fish": "proteines", "en:seafoods": "proteines",
    "en:poultry": "proteines", "en:deli-meats": "proteines",
    "fr:viandes": "proteines", "fr:poissons": "proteines",
    # Légumes & fruits
    "en:vegetables": "legumes", "en:fruits": "legumes",
    "en:fresh-vegetables": "legumes", "en:fresh-fruits": "legumes",
    "fr:legumes": "legumes", "fr:fruits": "legumes",
    # Féculents / Céréales
    "en:pastas": "feculents", "en:rices": "feculents", "en:breads": "feculents",
    "en:cereals-and-their-products": "feculents", "en:breakfast-cereals": "feculents",
    "fr:pates": "feculents", "fr:riz": "feculents", "fr:pains": "feculents",
    # Desserts
    "en:sweet-snacks": "desserts", "en:chocolates": "desserts",
    "en:biscuits-and-cakes": "desserts", "en:ice-creams": "desserts",
    "en:confectioneries": "desserts", "en:desserts": "desserts",
    "fr:desserts": "desserts", "fr:chocolats": "desserts",
    # Épicerie
    "en:condiments": "epicerie", "en:sauces": "epicerie", "en:spices": "epicerie",
    "en:canned-foods": "epicerie", "en:soups": "epicerie",
}

# Mots-clés (dans name+brand) → catégorie
_FOOD_CATEGORY_KEYWORDS: list[tuple[list[str], str]] = [
    # Boissons (priorité haute — vérifier avant lait)
    (["jus", "juice", "soda", "cola", "limonade", "lemonade", "thé", "café", "coffee", "tea",
      "boisson", "drink", "smoothie", "sirop", "nectar", "biere", "beer", "wine", "vin",
      "eau ", "water"], "boissons"),
    # Frais — produits laitiers & œufs
    (["yogurt", "yaourt", "fromage", "cheese", "beurre", "butter", "crème fraîche", "cream",
      "kéfir", "skyr", "lait", "milk", "œuf", "oeuf", "egg"], "frais"),
    # Protéines — viandes, poissons
    (["poulet", "chicken", "bœuf", "boeuf", "beef", "porc", "pork", "agneau", "lamb",
      "dinde", "turkey", "veau", "veal", "saumon", "salmon", "thon", "tuna",
      "poisson", "fish", "crevette", "shrimp", "fruits de mer", "seafood",
      "jambon", "ham", "saucisse", "sausage", "bacon", "viande", "meat",
      "lardons", "merguez", "chipolata"], "proteines"),
    # Légumes & fruits
    (["tomate", "tomato", "carotte", "carrot", "courgette", "aubergine", "eggplant",
      "poivron", "pepper", "champignon", "mushroom", "brocoli", "broccoli",
      "épinard", "spinach", "chou", "cabbage", "oignon", "onion", "ail", "garlic",
      "salade", "lettuce", "légume", "vegetable",
      "pomme", "apple", "banane", "banana", "orange", "citron", "lemon",
      "fraise", "strawberry", "framboise", "raspberry", "poire", "pear",
      "raisin", "grape", "cerise", "cherry", "ananas", "pineapple",
      "melon", "pastèque", "watermelon", "fruit", "avocat", "avocado"], "legumes"),
    # Féculents & céréales
    (["spaghetti", "tagliatelle", "penne", "macaroni", "fusilli", "pasta", "pâte",
      "riz", "rice", "quinoa", "boulgour", "bulgur", "couscous", "semoule", "polenta",
      "farine", "flour", "pain", "bread", "baguette", "brioche",
      "céréale", "cereal", "muesli", "granola", "avoine", "oat", "blé", "wheat",
      "biscotte", "crackers", "biscottes"], "feculents"),
    # Desserts & confiseries
    (["chocolat", "chocolate", "gâteau", "cake", "biscuit", "cookie",
      "glace", "ice cream", "sorbet", "crème dessert", "mousse",
      "confiture", "jam", "miel", "honey", "nutella", "pâte à tartiner",
      "bonbon", "candy", "caramel", "tarte", "pie", "croissant",
      "viennoiserie", "éclair", "madeleine", "brownie", "compote",
      "sucette", "nougat", "praline", "dessert"], "desserts"),
    # Épicerie
    (["huile", "oil", "vinaigre", "vinegar", "sel", "poivre", "épice", "spice",
      "sauce", "ketchup", "moutarde", "mustard", "mayonnaise",
      "conserve", "soupe", "soup", "bouillon",
      "lentille", "lentil", "haricot", "bean", "pois chiche", "chickpea",
      "fève", "légumineuse"], "epicerie"),
]


def infer_food_category(product: Optional[ProductBase]) -> str:
    """Infère la catégorie alimentaire standardisée à partir des données produit."""
    if not product:
        return "autres"

    name = (product.name or "").lower()
    brand = (product.brand or "").lower()
    off_tag = (product.category or "").lower()

    # 1. Vérifier le tag OFF en priorité (données structurées)
    for tag, food_cat in _OFF_CATEGORY_MAP.items():
        if tag in off_tag:
            return food_cat

    # 2. Fallback : recherche par mots-clés dans le nom/marque
    blob = f"{name} {brand}"
    for keywords, food_cat in _FOOD_CATEGORY_KEYWORDS:
        for kw in keywords:
            if kw in blob:
                return food_cat

    return "autres"


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "healthy", "timestamp": _utc_now().isoformat()}


# -----------------------------------------------------------------------------
# Auth routes
# -----------------------------------------------------------------------------

@api_router.post("/auth/register", response_model=RegisterResponse, status_code=201)
async def register(body: UserCreate):
    _validate_password(body.password)

    existing = await users_col.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    verification_token = secrets.token_urlsafe(32)
    doc = {
        "email": body.email.lower(),
        "hashed_password": _hash_password(body.password),
        "is_premium": False,
        "email_verified": False,
        "verification_token": verification_token,
        "verification_token_exp": (_utc_now() + timedelta(hours=24)).isoformat(),
        "created_at": _utc_now().isoformat(),
        "last_login": None,
    }
    await users_col.insert_one(doc)

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
async def login(body: UserLogin):
    doc = await users_col.find_one({"email": body.email.lower()})
    if not doc or not _verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not doc.get("email_verified", True):
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")

    user_id = str(doc["_id"])
    await users_col.update_one({"_id": doc["_id"]}, {"$set": {"last_login": _utc_now().isoformat()}})
    token = _create_token(user_id)
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
    if _utc_now() > exp:
        raise HTTPException(status_code=400, detail="TOKEN_EXPIRED")

    user_id = str(doc["_id"])
    await users_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"email_verified": True, "last_login": _utc_now().isoformat()},
         "$unset": {"verification_token": "", "verification_token_exp": ""}},
    )
    token = _create_token(user_id)
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
async def resend_verification(body: ResendVerificationBody):
    doc = await users_col.find_one({"email": body.email.lower(), "email_verified": False})
    if doc:
        new_token = secrets.token_urlsafe(32)
        await users_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "verification_token": new_token,
                "verification_token_exp": (_utc_now() + timedelta(hours=24)).isoformat(),
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
async def forgot_password(body: ForgotPasswordBody):
    doc = await users_col.find_one({"email": body.email.lower()})
    if doc:
        reset_token = secrets.token_urlsafe(32)
        await users_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "reset_token": reset_token,
                "reset_token_exp": (_utc_now() + timedelta(hours=1)).isoformat(),
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
async def reset_password(body: ResetPasswordBody):
    _validate_password(body.new_password)

    doc = await users_col.find_one({"reset_token": body.token})
    if not doc:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")

    exp_raw = doc.get("reset_token_exp")
    if not exp_raw:
        raise HTTPException(status_code=400, detail="TOKEN_INVALID")
    exp = datetime.fromisoformat(exp_raw)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if _utc_now() > exp:
        raise HTTPException(status_code=400, detail="TOKEN_EXPIRED")

    await users_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"hashed_password": _hash_password(body.new_password)},
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
# Admin routes
# -----------------------------------------------------------------------------

@api_router.put("/admin/users/{email}/set-premium")
async def set_premium(
    email: str,
    premium: bool = Query(True),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    """Met à jour le statut premium d'un utilisateur.

    Authentification : header HTTP `X-Admin-Key: <valeur de ADMIN_KEY>`.
    """
    if not ADMIN_KEY or x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")
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

@api_router.get("/stock", response_model=List[StockItem])
async def get_stock(
    status: str = "active",
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    cursor = stock_col.find({"user_id": current_user["id"], "status": status}).sort("added_date", -1)
    docs = await cursor.to_list(length=1000)
    return [_serialize_mongo(d) for d in docs]


@api_router.post("/stock", response_model=StockItem)
async def add_stock(
    item: StockItemCreate,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    doc = item.model_dump()
    doc["user_id"] = current_user["id"]
    doc["added_date"] = _utc_now().isoformat()
    doc["status"] = "active"
    doc["consumed_date"] = None
    doc["thrown_date"] = None
    doc["food_category"] = infer_food_category(item)

    res = await stock_col.insert_one(doc)
    created = await stock_col.find_one({"_id": res.inserted_id})
    return _serialize_mongo(created)


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
        return _serialize_mongo(existing)

    res = await stock_col.update_one(
        {"_id": oid, "user_id": current_user["id"], "status": "active"},
        {"$set": update_data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Active item not found")

    updated = await stock_col.find_one({"_id": oid})
    return _serialize_mongo(updated)


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
        {"$set": {"status": "consumed", "consumed_date": _utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_stock_action": _utc_now().isoformat()}},
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
        {"$set": {"status": "thrown", "thrown_date": _utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    await users_col.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_stock_action": _utc_now().isoformat()}},
    )
    return {"ok": True}


@api_router.get("/stock/priority", response_model=List[StockItem])
async def get_priority_items(current_user: Dict[str, Any] = Depends(_get_current_user)):
    threshold = (_utc_now().date() + timedelta(days=3)).strftime("%Y-%m-%d")
    cursor = stock_col.find({
        "user_id": current_user["id"],
        "status": "active",
        "expiry_date": {"$nin": [None, ""], "$lte": threshold},
    }).sort("expiry_date", 1)
    docs = await cursor.to_list(length=500)
    return [_serialize_mongo(d) for d in docs]


@api_router.get("/stock/history")
async def get_stock_history(
    limit: int = Query(default=15, le=50),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Produits récemment consommés/jetés (60j), dédupliqués par nom — pour le réajout rapide."""
    user_id = current_user["id"]
    since = (_utc_now() - timedelta(days=60)).isoformat()
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
    today_str = _utc_now().strftime("%Y-%m-%d")
    in_3_days_str = (_utc_now() + timedelta(days=3)).strftime("%Y-%m-%d")
    week_ago = (_utc_now() - timedelta(days=7)).isoformat()

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
async def get_product(barcode: str):
    product = await lookup_product_openfoodfacts(barcode)
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

class PushTokenBody(BaseModel):
    token: str


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


# -----------------------------------------------------------------------------
# Recettes — base française embarquée
# -----------------------------------------------------------------------------

_FRIGO_CATS   = ["frais", "proteines", "legumes", "boissons"]
_PLACARD_CATS = ["feculents", "desserts", "epicerie", "autres"]

# Base de ~40 recettes françaises simples et saines
_FRENCH_RECIPE_DB: list[dict] = [
    # Pâtes
    {"id": "fr001", "title": "Pâtes carbonara maison",         "category": "placard", "ingredients": ["pates", "lardons", "oeuf", "parmesan", "creme"]},
    {"id": "fr002", "title": "Pâtes à la bolognaise",          "category": "placard", "ingredients": ["pates", "boeuf", "tomate", "oignon", "ail"]},
    {"id": "fr003", "title": "Pâtes au pesto maison",          "category": "placard", "ingredients": ["pates", "basilic", "parmesan", "ail", "huile"]},
    {"id": "fr004", "title": "Gratin de pâtes au fromage",     "category": "placard", "ingredients": ["pates", "fromage", "lait", "beurre", "farine"]},
    {"id": "fr035", "title": "Minestrone de légumes",          "category": "placard", "ingredients": ["tomate", "courgette", "carotte", "oignon", "pates"]},
    # Riz / féculents
    {"id": "fr005", "title": "Riz sauté aux légumes",          "category": "placard", "ingredients": ["riz", "carotte", "oignon", "ail", "huile"]},
    {"id": "fr006", "title": "Riz au lait maison",             "category": "placard", "ingredients": ["riz", "lait", "sucre"]},
    {"id": "fr007", "title": "Risotto aux champignons",        "category": "placard", "ingredients": ["riz", "champignon", "oignon", "ail", "parmesan"]},
    {"id": "fr041", "title": "Taboulé maison",                 "category": "placard", "ingredients": ["semoule", "tomate", "concombre", "oignon", "citron"]},
    # Oeufs
    {"id": "fr008", "title": "Omelette aux herbes",            "category": "frigo",   "ingredients": ["oeuf", "beurre"]},
    {"id": "fr009", "title": "Oeufs brouillés crémeux",        "category": "frigo",   "ingredients": ["oeuf", "beurre", "creme"]},
    {"id": "fr010", "title": "Quiche lorraine",                "category": "frigo",   "ingredients": ["oeuf", "lardons", "creme", "fromage"]},
    {"id": "fr011", "title": "Frittata aux légumes",           "category": "frigo",   "ingredients": ["oeuf", "courgette", "poivron", "oignon"]},
    {"id": "fr037", "title": "Crêpes sucrées",                 "category": "placard", "ingredients": ["farine", "oeuf", "lait", "sucre", "beurre"]},
    # Poulet
    {"id": "fr012", "title": "Poulet rôti aux herbes",         "category": "frigo",   "ingredients": ["poulet", "ail", "citron", "huile"]},
    {"id": "fr013", "title": "Sauté de poulet aux légumes",    "category": "frigo",   "ingredients": ["poulet", "carotte", "oignon", "ail", "tomate"]},
    {"id": "fr014", "title": "Poulet au curry doux",           "category": "frigo",   "ingredients": ["poulet", "curry", "oignon", "tomate", "creme"]},
    {"id": "fr015", "title": "Poulet à la moutarde",           "category": "frigo",   "ingredients": ["poulet", "moutarde", "creme", "oignon"]},
    # Poisson
    {"id": "fr016", "title": "Saumon grillé citron-herbes",    "category": "frigo",   "ingredients": ["saumon", "citron", "huile"]},
    {"id": "fr017", "title": "Cabillaud en papillote",         "category": "frigo",   "ingredients": ["cabillaud", "citron", "tomate"]},
    {"id": "fr018", "title": "Salade niçoise au thon",         "category": "frigo",   "ingredients": ["thon", "tomate", "oeuf", "haricot", "oignon"]},
    # Légumes
    {"id": "fr019", "title": "Ratatouille provençale",         "category": "frigo",   "ingredients": ["courgette", "aubergine", "tomate", "poivron", "oignon"]},
    {"id": "fr020", "title": "Gratin dauphinois",              "category": "frigo",   "ingredients": ["pomme de terre", "creme", "ail", "fromage"]},
    {"id": "fr021", "title": "Poêlée de courgettes à l'ail",   "category": "frigo",   "ingredients": ["courgette", "ail", "huile"]},
    {"id": "fr022", "title": "Carottes glacées au miel",       "category": "frigo",   "ingredients": ["carotte", "miel", "beurre"]},
    {"id": "fr023", "title": "Soupe de légumes maison",        "category": "frigo",   "ingredients": ["carotte", "pomme de terre", "oignon", "poireau"]},
    {"id": "fr024", "title": "Velouté de courgettes",          "category": "frigo",   "ingredients": ["courgette", "oignon", "creme"]},
    {"id": "fr025", "title": "Purée de carottes",              "category": "frigo",   "ingredients": ["carotte", "beurre", "creme"]},
    {"id": "fr036", "title": "Soupe à l'oignon gratinée",      "category": "frigo",   "ingredients": ["oignon", "pain", "fromage", "beurre"]},
    {"id": "fr042", "title": "Salade composée",                "category": "frigo",   "ingredients": ["tomate", "concombre", "oignon", "huile", "vinaigre"]},
    # Légumineuses
    {"id": "fr026", "title": "Lentilles à la française",       "category": "placard", "ingredients": ["lentilles", "lardons", "carotte", "oignon", "ail"]},
    {"id": "fr027", "title": "Curry de pois chiches",          "category": "placard", "ingredients": ["pois chiches", "tomate", "oignon", "ail", "curry"]},
    {"id": "fr028", "title": "Salade de lentilles vinaigrette","category": "placard", "ingredients": ["lentilles", "oignon", "moutarde", "vinaigre"]},
    # Viande rouge
    {"id": "fr029", "title": "Hachis parmentier",              "category": "frigo",   "ingredients": ["boeuf", "pomme de terre", "oignon", "lait", "beurre"]},
    {"id": "fr030", "title": "Steak haché sauce tomate",       "category": "frigo",   "ingredients": ["boeuf", "tomate", "oignon", "ail"]},
    {"id": "fr031", "title": "Porc sauté aux légumes",         "category": "frigo",   "ingredients": ["porc", "carotte", "oignon", "ail"]},
    # Fromage / charcuterie
    {"id": "fr032", "title": "Croque-monsieur",                "category": "frigo",   "ingredients": ["pain", "jambon", "fromage", "beurre"]},
    {"id": "fr033", "title": "Tarte tomate mozzarella",        "category": "frigo",   "ingredients": ["tomate", "mozzarella", "oeuf", "creme"]},
    {"id": "fr034", "title": "Salade caprese",                 "category": "frigo",   "ingredients": ["tomate", "mozzarella", "huile"]},
    # Desserts
    {"id": "fr038", "title": "Mousse au chocolat",             "category": "frigo",   "ingredients": ["chocolat", "oeuf", "sucre", "beurre"]},
    {"id": "fr039", "title": "Tarte aux pommes",               "category": "placard", "ingredients": ["pomme", "farine", "beurre", "sucre", "oeuf"]},
    {"id": "fr040", "title": "Yaourt maison",                  "category": "frigo",   "ingredients": ["lait", "yaourt"]},
]

# Dictionnaire FR → EN pour les alertes quotidiennes (daily alert, _check_daily_expiry_alert)
_FR_EN: dict[str, str] = {
    "pomme de terre": "potato", "pommes de terre": "potato",
    "sauce tomate": "tomato", "petits pois": "peas",
    "pois chiche": "chickpeas", "patate douce": "sweet potato",
    "poulet": "chicken", "boeuf": "beef", "porc": "pork",
    "veau": "veal", "agneau": "lamb", "dinde": "turkey",
    "saumon": "salmon", "thon": "tuna", "cabillaud": "cod",
    "crevettes": "shrimp", "jambon": "ham", "lardons": "bacon",
    "saucisse": "sausage", "merguez": "sausage",
    "lait": "milk", "beurre": "butter", "fromage": "cheese",
    "oeuf": "egg", "oeufs": "egg",
    "yaourt": "yogurt", "creme": "cream",
    "mozzarella": "mozzarella", "parmesan": "parmesan",
    "tomate": "tomato", "carotte": "carrot", "oignon": "onion",
    "ail": "garlic", "echalote": "shallot", "courgette": "zucchini",
    "aubergine": "aubergine", "poivron": "pepper",
    "epinard": "spinach", "brocoli": "broccoli",
    "champignon": "mushroom", "poireau": "leek",
    "haricot": "green beans", "lentille": "lentils", "lentilles": "lentils",
    "pates": "pasta", "riz": "rice", "pain": "bread", "farine": "flour",
    "quinoa": "quinoa", "semoule": "semolina",
    "pomme": "apple", "banane": "banana", "citron": "lemon",
    "orange": "orange", "fraise": "strawberry", "fraises": "strawberry",
    "mangue": "mango", "ananas": "pineapple", "avocat": "avocado",
    "huile": "olive oil", "vinaigre": "vinegar", "moutarde": "mustard",
    "chocolat": "chocolate", "sucre": "sugar", "miel": "honey",
}

import unicodedata as _ud

_CATEGORY_TO_EN: dict[str, str] = {
    "frais": "milk", "proteines": "chicken", "legumes": "tomato",
    "feculents": "pasta", "desserts": "chocolate", "boissons": "milk",
    "epicerie": "garlic", "autres": "egg",
}

def _fr_to_en_ingredient(name: str, category: str = "autres") -> str:
    """Convertit un nom de produit français en ingrédient anglais (pour les alertes quotidiennes)."""
    norm = _ud.normalize("NFD", name.lower())
    norm = "".join(c for c in norm if _ud.category(c) != "Mn")
    for fr_word in sorted(_FR_EN, key=len, reverse=True):
        fr_norm = _ud.normalize("NFD", fr_word)
        fr_norm = "".join(c for c in fr_norm if _ud.category(c) != "Mn")
        if fr_norm in norm:
            return _FR_EN[fr_word]
    return _CATEGORY_TO_EN.get(category, "chicken")


_RECIPE_MATCH_THRESHOLD = 0.2  # Sous ce score → aucune correspondance utile → fallback IA

_AI_SUGGEST_PROMPT = """\
Tu es un chef cuisinier français spécialisé en cuisine du quotidien. \
Génère 1 recette de cuisine FRANÇAISE simple et saine avec ces ingrédients :
{ingredients}

Retourne UNIQUEMENT ce JSON (sans markdown, sans explication) :
{{"title": "nom de la recette en français", "ingredients_keywords": ["mot1", "mot2"], "instructions_summary": "..."}}

Règles IMPÉRATIVES :
- Recette de cuisine FRANÇAISE du quotidien (brasserie, bistrot, maison) — PAS de cuisine étrangère
- Simple : max 6 étapes, temps total < 45 min, ingrédients disponibles dans tout supermarché français
- Saine : éviter les fritures, privilégier légumes et protéines
- ingredients_keywords : mots-clés courts en français minuscules (ex: "poulet", "tomate")
- instructions_summary : max 80 mots, en français
"""


async def _generate_ai_recipe(stock_names: list[str], openai_key: str) -> dict | None:
    """Appelle GPT-4o-mini pour générer 1 recette française depuis les ingrédients du stock.
    Retourne None en cas d'échec ou si KEEPEAT_OPENAI_TOKEN n'est pas configuré.
    """
    prompt = _AI_SUGGEST_PROMPT.format(ingredients="\n".join(f"- {n}" for n in stock_names))
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                json={"model": "gpt-4o-mini", "max_tokens": 350,
                      "messages": [{"role": "user", "content": prompt}]},
            )
            if r.status_code != 200:
                logger.warning("OpenAI suggest recipe error %s: %s", r.status_code, r.text[:200])
                return None
            text = r.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("OpenAI suggest recipe failed: %s", exc)
        return None

    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        data = json.loads(text)
        if not isinstance(data.get("title"), str) or not isinstance(data.get("ingredients_keywords"), list):
            logger.warning("OpenAI suggest recipe invalid structure: %s", text[:200])
            return None
        return data
    except Exception:
        logger.warning("OpenAI suggest recipe invalid JSON: %s", text[:200])
        return None


# Synonymes et variantes produits → mot-clé recette
# Permet de matcher "Gruyère" → "fromage", "Steak haché" → "boeuf", "Spaghetti" → "pates", etc.
_ING_EXPAND: dict[str, list[str]] = {
    "fromage":        ["gruyere", "emmental", "comte", "cheddar", "camembert", "brie", "chevre",
                       "roquefort", "raclette", "tomme", "mimolette", "coulommiers", "maroilles",
                       "reblochon", "munster", "ossau", "beaufort", "feta", "ricotta"],
    "boeuf":          ["steak", "hache", "bifteck", "entrecote", "bavette", "rumsteck", "bourguignon",
                       "viande", "tartare", "roti", "braise"],
    "lardons":        ["bacon", "poitrine", "pancetta", "fumee", "allumettes"],
    "creme":          ["fraiche", "fleurette", "liquide", "epaisse", "semi-epaisse", "entiere"],
    "pates":          ["spaghetti", "penne", "fusilli", "tagliatelle", "linguine", "rigatoni",
                       "macaroni", "farfalle", "coquillette", "vermicelle", "lasagne", "gnocchi"],
    "poulet":         ["blanc", "cuisse", "escalope", "filet", "aiguillette", "cocotte"],
    "porc":           ["cochon", "longe", "chop", "filet mignon", "cote", "rillette"],
    "saumon":         ["pavé", "truite"],
    "pomme de terre": ["patate", "vitelotte", "ratte", "charlotte", "grenaille"],
    "riz":            ["basmati", "arborio", "rond", "long"],
    "oeuf":           ["oeufs", "oeuf"],
    "tomate":         ["tomates", "cherry", "cerises", "concassee", "pelees"],
    "carotte":        ["carottes"],
    "champignon":     ["champignons", "shiitake", "portobello", "girolles", "cèpes", "cepes"],
    "oignon":         ["oignons", "echalote", "echalotes", "cive", "ciboulette"],
    "ail":            ["gousses"],
    "poisson":        ["merlu", "lieu", "daurade", "bar", "sole", "cabillaud", "tilapia", "pangasius"],
    "lentilles":      ["lentille", "beluga", "corail", "verte", "puy"],
    "pois chiches":   ["pois chiche", "chickpeas"],
    "courgette":      ["courgettes", "zucchini"],
    "aubergine":      ["aubergines"],
    "poivron":        ["poivrons", "capsicum"],
    "concombre":      ["concombres"],
}


def _normalize_fr(text: str) -> str:
    """Minuscule + suppression des accents."""
    n = _ud.normalize("NFD", text.lower())
    return "".join(c for c in n if _ud.category(c) != "Mn")


def _match_recipe_to_stock(
    recipe: dict,
    norm_stock: list[str],
    norm_urgent: set[str],
    boost_urgent: bool,
) -> tuple[float, list[str], list[str]]:
    """Retourne (score, ingrédients_utilisés, ingrédients_manquants).

    Score = nb_ingrédients_trouvés / nb_total + bonus urgence.
    Correspondance bidirectionnelle : le mot-clé recette dans le nom produit OU vice-versa.
    """
    used: list[str] = []
    missed: list[str] = []
    has_urgent_match = False

    for ing in recipe["ingredients"]:
        norm_ing = _normalize_fr(ing)
        ing_words = [w for w in norm_ing.split() if len(w) > 2]
        # Synonymes/variantes produits (ex: "fromage" → gruyere, emmental…)
        synonyms = [_normalize_fr(s) for s in _ING_EXPAND.get(ing, [])]
        found = False
        for ns in norm_stock:
            if (norm_ing in ns
                    or any(w in ns for w in ing_words)
                    or any(syn in ns for syn in synonyms)):
                found = True
                if ing not in used:
                    used.append(ing)
                if boost_urgent and any(norm_ing in nu or nu in norm_ing for nu in norm_urgent):
                    has_urgent_match = True
                break
        if not found:
            missed.append(ing)

    n_total = len(recipe["ingredients"])
    if n_total == 0:
        return 0.0, [], []

    score = len(used) / n_total
    if has_urgent_match:
        score += 0.3  # Boost si au moins un ingrédient urgent est utilisé
    return score, used, missed


@api_router.get("/recipes/suggestions")
async def get_recipe_suggestions(
    recipe_filter: str = Query("urgent", alias="filter"),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Suggère des recettes depuis la base française embarquée.
    filter: urgent (≤7j) | all | frigo | placard
    """
    uid = current_user["id"]
    today_str = _utc_now().strftime("%Y-%m-%d")

    # Récupérer les items actifs selon le filtre
    match: dict = {"user_id": uid, "status": "active"}
    if recipe_filter == "urgent":
        in_7_days = (_utc_now().date() + timedelta(days=7)).strftime("%Y-%m-%d")
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

    # Noms du stock normalisés pour la correspondance
    stock_names = [i.get("name", "") for i in items if i.get("name")]
    norm_stock = [_normalize_fr(n) for n in stock_names]

    # Ingrédients urgents (≤2j) pour le boost de pertinence
    norm_urgent: set[str] = set()
    if recipe_filter == "urgent" and items:
        in_2_days = (_utc_now().date() + timedelta(days=2)).strftime("%Y-%m-%d")
        for item in items:
            ed = item.get("expiry_date", "")
            if ed and ed <= in_2_days:
                norm_urgent.add(_normalize_fr(item.get("name", "")))

    boost_urgent = recipe_filter == "urgent"

    # Filtrer les recettes candidates par catégorie
    if recipe_filter == "frigo":
        base_candidates = [r for r in _FRENCH_RECIPE_DB if r["category"] == "frigo"]
    elif recipe_filter == "placard":
        base_candidates = [r for r in _FRENCH_RECIPE_DB if r["category"] == "placard"]
    else:
        base_candidates = _FRENCH_RECIPE_DB

    # Charger les recettes IA communautaires (partagées, persistantes) — toujours incluses
    community_docs = await community_recipes_col.find({}).sort("created_at", -1).limit(200).to_list(length=200)
    community_extras = [
        {
            "id": str(d["_id"]),
            "title": d["title"],
            "category": "all",
            "ingredients": d.get("ingredients_keywords", []),
            "is_ai": True,
            "instructions_summary": d.get("instructions_summary", ""),
        }
        for d in community_docs
    ]
    candidates = base_candidates + community_extras

    # Si le stock est vide, retourner les premières recettes sans score
    if not stock_names:
        top5 = candidates[:5]
        logger.info("Recipes suggestions: stock vide, retour top5 par défaut filter=%s", recipe_filter)
        return [
            {
                "id": r["id"],
                "title": r["title"],
                "image": "",
                "usedIngredients": [],
                "missedIngredients": r["ingredients"],
                "sourceUrl": "https://www.marmiton.org/recettes/recherche.aspx?aqt=" + r["title"].replace(" ", "+"),
                "is_fallback": True,
            }
            for r in top5
        ]

    # Scorer toutes les recettes
    scored = []
    for recipe in candidates:
        score, used, missed = _match_recipe_to_stock(recipe, norm_stock, norm_urgent, boost_urgent)
        scored.append((score, recipe, used, missed))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score = scored[0][0] if scored else 0.0

    # Fallback IA : générer une recette si aucune correspondance suffisante
    if best_score < _RECIPE_MATCH_THRESHOLD:
        openai_key = os.environ.get("KEEPEAT_OPENAI_TOKEN", "")
        if openai_key:
            logger.info("Recipes suggestions: best_score=%.2f < %.2f → génération IA", best_score, _RECIPE_MATCH_THRESHOLD)
            ai_data = await _generate_ai_recipe(stock_names[:8], openai_key)
            if ai_data:
                new_id = f"ai_{int(_utc_now().timestamp())}"
                try:
                    await community_recipes_col.insert_one({
                        "_id": new_id,
                        "title": ai_data["title"],
                        "ingredients_keywords": ai_data["ingredients_keywords"],
                        "instructions_summary": ai_data.get("instructions_summary", ""),
                        "created_at": _utc_now(),
                    })
                    logger.info("Recette IA sauvegardée en base : %s", ai_data["title"])
                except Exception as exc:
                    logger.warning("community_recipes insert failed: %s", exc)

                ai_recipe_obj = {
                    "id": new_id,
                    "title": ai_data["title"],
                    "category": "all",
                    "ingredients": ai_data["ingredients_keywords"],
                    "is_ai": True,
                    "instructions_summary": ai_data.get("instructions_summary", ""),
                }
                ai_score, ai_used, ai_missed = _match_recipe_to_stock(ai_recipe_obj, norm_stock, norm_urgent, boost_urgent)
                # Placer la recette IA en tête (score minimum = best_score + 0.1)
                scored.insert(0, (max(ai_score, best_score + 0.1), ai_recipe_obj, ai_used, ai_missed))
                scored.sort(key=lambda x: x[0], reverse=True)

    top5 = scored[:5]

    logger.info(
        "Recipes suggestions: filter=%s stock=%s top5=%s",
        recipe_filter, stock_names[:5], [r["title"] for _, r, _, _ in top5],
    )
    return [
        {
            "id": recipe["id"],
            "title": recipe["title"],
            "image": "",
            "usedIngredients": used,
            "missedIngredients": missed,
            "sourceUrl": "https://www.marmiton.org/recettes/recherche.aspx?aqt=" + recipe["title"].replace(" ", "+"),
            "is_fallback": len(used) == 0,
            **({"instructions_summary": recipe.get("instructions_summary", ""), "is_ai": True} if recipe.get("is_ai") else {}),
        }
        for _, recipe, used, missed in top5
    ]


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
async def ocr_receipt(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Analyse un ticket de caisse via GPT-4o-mini vision et retourne la liste des produits alimentaires."""
    openai_key = os.environ.get("KEEPEAT_OPENAI_TOKEN", "")
    if not openai_key:
        logger.warning("KEEPEAT_OPENAI_TOKEN non configuré — scan ticket désactivé")
        return []

    body = await request.json()
    image_b64: str = body.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Champ 'image' manquant")

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _RECEIPT_PROMPT},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "low",
                            }},
                        ],
                    }],
                },
            )
            if r.status_code != 200:
                logger.warning("OpenAI receipt OCR error %s: %s", r.status_code, r.text[:200])
                return []
            text = r.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("OpenAI request failed: %s", exc)
        return []

    # Nettoyage éventuel du bloc markdown
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("```").strip()

    try:
        products: list[dict] = __import__("json").loads(text)
    except Exception:
        logger.warning("OCR receipt: JSON parse failed — raw=%s", text[:200])
        return []

    result = []
    for p in products:
        if not isinstance(p, dict) or not p.get("name"):
            continue
        cat = p.get("category", "autres")
        if cat not in _SHELF_BY_CATEGORY:
            cat = "autres"
        shelf = _SHELF_BY_CATEGORY[cat]
        result.append({
            "name": p["name"],
            "category": cat,
            "food_category": cat,
            "shelf_life_fridge":   shelf["fridge"],
            "shelf_life_pantry":   shelf["pantry"],
            "shelf_life_freezer":  shelf["freezer"],
        })

    logger.info("Receipt OCR — user=%s products=%d", current_user["id"], len(result))
    return result


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

    # Générer la liste des N derniers mois (YYYY-MM)
    today = _utc_now().date()
    month_list = []
    for i in range(months - 1, -1, -1):
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
    """Nombre de jours consécutifs depuis aujourd'hui sans aucun item jeté."""
    today = _utc_now().date()
    streak = 0
    for i in range(60):
        day = today - timedelta(days=i)
        day_str = day.strftime("%Y-%m-%d")
        thrown_today = await stock_col.count_documents({
            "user_id": uid,
            "status": "thrown",
            "thrown_date": {"$regex": f"^{day_str}"},
        })
        if thrown_today > 0:
            break
        streak += 1
    return streak


@api_router.get("/gamification")
async def get_gamification(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne les données de gamification : niveau, streak, économies totales."""
    uid = current_user["id"]

    total_consumed, total_thrown, consumed_docs = await asyncio.gather(
        stock_col.count_documents({"user_id": uid, "status": "consumed"}),
        stock_col.count_documents({"user_id": uid, "status": "thrown"}),
        stock_col.find({"user_id": uid, "status": "consumed"}, {"food_category": 1}).to_list(length=10000),
    )
    streak = await _compute_streak(uid)

    total_saved = sum(
        _SAVINGS_BY_CATEGORY.get((d.get("food_category") or "").lower(), _DEFAULT_SAVINGS)
        for d in consumed_docs
    )

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


# ── Recettes IA (OpenAI GPT-4o-mini) ─────────────────────────────────────────

_AI_RECIPE_PROMPT = """Tu es un chef cuisinier français spécialisé en cuisine du quotidien. \
L'utilisateur a ces produits dans son frigo/placard :

{ingredients}

Génère exactement 3 recettes de cuisine FRANÇAISE simple et saine en utilisant ces ingrédients \
(tu peux utiliser un sous-ensemble). Inspiration : cuisine bourgeoise française, brasserie, bistrot, \
plats familiaux. PAS de cuisine étrangère ni de recettes complexes.

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

# Cache en mémoire (uid -> {recipes, created_at})
_ai_recipe_cache: dict[str, dict] = {}


@api_router.get("/recipes/ai")
async def get_ai_recipes(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Génère 3 recettes personnalisées via GPT-4o-mini basées sur le stock de l'utilisateur."""
    uid = current_user["id"]
    openai_key = os.environ.get("KEEPEAT_OPENAI_TOKEN", "")
    if not openai_key:
        raise HTTPException(status_code=503, detail="IA non configurée")

    # Cache 1h par utilisateur
    cached = _ai_recipe_cache.get(uid)
    if cached and (_utc_now() - cached["created_at"]).total_seconds() < 3600:
        return cached["recipes"]

    items = await stock_col.find(
        {"user_id": uid, "status": "active"},
    ).sort("expiry_date", 1).limit(8).to_list(length=8)

    if not items:
        return []

    ingredients_list = "\n".join(
        f"- {i['name']}" + (f" ({i.get('food_category', '')})" if i.get('food_category') else "")
        for i in items
    )
    prompt = _AI_RECIPE_PROMPT.format(ingredients=ingredients_list)

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": 800,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if r.status_code != 200:
                logger.warning("OpenAI recipes/ai error %s: %s", r.status_code, r.text[:200])
                raise HTTPException(status_code=502, detail="Erreur IA externe")
            text = r.json()["choices"][0]["message"]["content"].strip()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("OpenAI recipes/ai request failed: %s", exc)
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
        logger.warning("OpenAI recipes/ai invalid JSON: %s", text[:200])
        raise HTTPException(status_code=502, detail="Réponse IA invalide")

    for recipe in recipes:
        recipe["is_ai"] = True

    _ai_recipe_cache[uid] = {"recipes": recipes, "created_at": _utc_now()}
    logger.info("AI recipes generated — user=%s count=%d", uid, len(recipes))
    return recipes


# ── Prévisions de consommation ────────────────────────────────────────────────

@api_router.get("/predictions")
async def get_predictions(
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Retourne les items actifs dont la catégorie a un taux de gaspillage > 40% dans l'historique."""
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
    risky_cats: set[str] = set()
    for s in stats_agg:
        total = s["consumed"] + s["thrown"]
        if total >= 3 and s["thrown"] / total > 0.4:  # seuil minimum de 3 données
            risky_cats.add(s["_id"])

    if not risky_cats:
        return []

    items = await stock_col.find(
        {"user_id": uid, "status": "active", "food_category": {"$in": list(risky_cats)}},
        {"_id": 1, "name": 1, "food_category": 1},
    ).to_list(length=30)

    return [
        {"id": str(i["_id"]), "name": i["name"], "category": i.get("food_category", "")}
        for i in items
    ]


# Redirect pages (deep link fallback for email clients)
# -----------------------------------------------------------------------------
_BACKEND_URL = os.getenv("BACKEND_URL", "https://keepeat-backend.onrender.com")


def _redirect_html(title: str, icon: str, heading: str, description: str, deep_link: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="fr"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
  <div class="card">
    <div class="icon">{icon}</div>
    <h1>{heading}</h1>
    <p>{description}</p>
    <a href="{deep_link}" class="btn">Ouvrir KeepEat</a>
    <p class="note">Si l'application ne s'ouvre pas automatiquement, assurez-vous qu'elle est installée sur votre appareil mobile.</p>
  </div>
  <script>setTimeout(function(){{window.location.href="{deep_link}";}},600);</script>
</body></html>"""


@app.get("/redirect/reset-password", response_class=HTMLResponse, include_in_schema=False)
async def redirect_reset_password(token: str = Query(...)):
    deep_link = f"keepeat://reset-password?token={token}"
    return _redirect_html(
        title="KeepEat — Réinitialisation du mot de passe",
        icon="🔒",
        heading="Réinitialiser votre mot de passe",
        description="Cliquez sur le bouton ci-dessous pour ouvrir l'application KeepEat et choisir un nouveau mot de passe.",
        deep_link=deep_link,
    )


@app.get("/redirect/verify-email", response_class=HTMLResponse, include_in_schema=False)
async def redirect_verify_email(token: str = Query(...)):
    deep_link = f"keepeat://verify-email?token={token}"
    return _redirect_html(
        title="KeepEat — Confirmation de l'email",
        icon="✉️",
        heading="Confirmer votre adresse email",
        description="Cliquez sur le bouton ci-dessous pour ouvrir l'application KeepEat et confirmer votre adresse email.",
        deep_link=deep_link,
    )


# Wire routes
# -----------------------------------------------------------------------------
app.include_router(api_router)


