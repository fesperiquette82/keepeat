# backend/server.py
from __future__ import annotations

import asyncio
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


async def _alert_loop() -> None:
    """Boucle de fond : vérifie toutes les 6h les rappels et l'inactivité."""
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            await _check_recalls_and_notify()
            await _check_inactivity_and_notify()
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
    # Index TTL sur user_alerts : auto-suppression après 30 jours
    await user_alerts_col.create_index("sent_at", expireAfterSeconds=30 * 24 * 3600)
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
user_alerts_col = db["user_alerts"]  # alertes envoyées (dedup, TTL 30j)

# -----------------------------------------------------------------------------
# Auth configuration
# -----------------------------------------------------------------------------
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY is required. Set it in Render > Environment Variables.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

ADMIN_KEY = os.getenv("ADMIN_KEY", "")

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
    """Envoie un email HTML via Brevo SMTP relay (aiosmtplib)."""
    smtp_login = os.getenv("BREVO_SMTP_LOGIN")
    if not smtp_login:
        logger.warning("Email non envoyé vers %s : BREVO_SMTP_LOGIN non configuré", to)
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{os.getenv('MAIL_FROM_NAME', 'KeepEat')} <{os.getenv('MAIL_FROM', 'noreply@keepeat.app')}>"
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    try:
        await aiosmtplib.send(
            msg,
            hostname=os.getenv("BREVO_SMTP_HOST", "smtp-relay.brevo.com"),
            port=int(os.getenv("BREVO_SMTP_PORT", "587")),
            username=smtp_login,
            password=os.getenv("BREVO_SMTP_PASSWORD", ""),
            start_tls=True,
        )
        logger.info("Email envoyé à %s : %s", to, subject)
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
    try:
        url = f"https://world.openfoodfacts.net/api/v2/product/{barcode}"
        headers = {"User-Agent": OFF_USER_AGENT}
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as c:
            r = await c.get(url)

        if r.status_code != 200:
            logger.info("OFF lookup failed status=%s barcode=%s", r.status_code, barcode)
            return None

        data = r.json()
        if data.get("status") != 1 or not data.get("product"):
            return None

        p = data["product"]
        return ProductBase(
            barcode=barcode,
            name=p.get("product_name") or p.get("product_name_fr") or "Produit inconnu",
            brand=p.get("brands", "") or "",
            image_url=p.get("image_front_small_url") or p.get("image_url") or "",
            category=(p.get("categories_tags") or [None])[0],
            quantity=p.get("quantity", "") or "",
        )
    except Exception as e:
        logger.warning("OFF lookup exception barcode=%s err=%s", barcode, e)
        return None


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
@limiter.limit("5/minute")
async def register(request: Request, body: UserCreate):
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

    deep_link = f"keepeat://verify-email?token={verification_token}"
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#4CAF50">Bienvenue sur KeepEat !</h2>
      <p>Merci de vous être inscrit. Cliquez sur le bouton ci-dessous pour confirmer votre adresse email.</p>
      <a href="{deep_link}" style="display:inline-block;padding:14px 28px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
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
@limiter.limit("3/minute")
async def resend_verification(request: Request, body: ResendVerificationBody):
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
        deep_link = f"keepeat://verify-email?token={new_token}"
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="color:#4CAF50">Confirmation de votre email KeepEat</h2>
          <p>Voici votre nouveau lien de confirmation :</p>
          <a href="{deep_link}" style="display:inline-block;padding:14px 28px;background:#4CAF50;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
            Confirmer mon email
          </a>
          <p style="color:#888;font-size:12px">Ce lien expire dans 24 heures.</p>
        </div>
        """
        await _send_email(body.email.lower(), "Nouveau lien de confirmation — KeepEat", html_body)
    # Réponse identique qu'un email soit trouvé ou non (anti-énumération)
    return {"message": "sent"}


@api_router.post("/auth/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, body: ForgotPasswordBody):
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
        deep_link = f"keepeat://reset-password?token={reset_token}"
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="color:#4CAF50">Réinitialisation de votre mot de passe KeepEat</h2>
          <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous :</p>
          <a href="{deep_link}" style="display:inline-block;padding:14px 28px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">
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


@api_router.get("/stats", response_model=StatsResponse)
async def get_stats(current_user: Dict[str, Any] = Depends(_get_current_user)):
    uid = current_user["id"]
    # active
    total_items = await stock_col.count_documents({"user_id": uid, "status": "active"})

    # expiring soon / expired among active
    cursor = stock_col.find({"user_id": uid, "status": "active"})
    active_docs = await cursor.to_list(length=2000)

    expiring_soon = 0
    expired = 0
    for d in active_docs:
        days = _days_until(d.get("expiry_date"))
        if days is None:
            continue
        if days < 0:
            expired += 1
        elif days <= 3:
            expiring_soon += 1

    # week stats based on ISO timestamps we write (utc isoformat)
    week_ago = (_utc_now() - timedelta(days=7)).isoformat()

    consumed_this_week = await stock_col.count_documents(
        {"user_id": uid, "status": "consumed", "consumed_date": {"$gte": week_ago}}
    )
    thrown_this_week = await stock_col.count_documents(
        {"user_id": uid, "status": "thrown", "thrown_date": {"$gte": week_ago}}
    )

    return StatsResponse(
        total_items=total_items,
        expiring_soon=expiring_soon,
        expired=expired,
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


# Wire routes
# -----------------------------------------------------------------------------
app.include_router(api_router)


