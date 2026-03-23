# backend/server.py
from __future__ import annotations

import asyncio
import json
import os
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
from motor.motor_asyncio import AsyncIOMotorClient
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
    seed_default_user,
    send_expo_push,
)
from app_core import days_until, logger, redirect_html, serialize_mongo, utc_now
from auth_utils import create_token, get_current_user, hash_password, http_bearer, validate_password, verify_password
from models import (
    ForgotPasswordBody,
    ProductBase,
    ProductLookupResponse,
    PushTokenBody,
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
from ocr_service import ocr_receipt
from product_catalog import infer_food_category, infer_shelf_life, lookup_product_openfoodfacts
from recipes_service import (
    _FRIGO_CATS,
    _FRENCH_RECIPE_DB,
    _PLACARD_CATS,
    _RECIPE_MATCH_THRESHOLD,
    _generate_ai_recipe,
    _match_recipe_to_stock,
    _normalize_fr,
    fr_to_en_ingredient,
)

load_dotenv()

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

ADMIN_KEY = os.getenv("ADMIN_KEY", "")
SPOONACULAR_KEY = os.getenv("SPOONACULAR_KEY", "")
_BACKEND_URL = os.getenv("BACKEND_URL", "https://keepeat-backend.onrender.com")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_default_user(users_col)

    await user_alerts_col.create_index("sent_at", expireAfterSeconds=30 * 24 * 3600)
    await products_cache_col.create_index("cached_at", expireAfterSeconds=7 * 24 * 3600)
    await products_cache_col.create_index("barcode", unique=True)
    await community_recipes_col.create_index("created_at")
    await stock_col.create_index([("user_id", 1), ("status", 1), ("expiry_date", 1)])
    await stock_col.create_index([("user_id", 1), ("status", 1), ("consumed_date", 1)])
    await stock_col.create_index([("user_id", 1), ("status", 1), ("thrown_date", 1)])
    await users_col.create_index("email", unique=True)
    await users_col.create_index("verification_token", sparse=True)
    await users_col.create_index("reset_token", sparse=True)

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


async def _send_email(to: str, subject: str, html_body: str) -> None:
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        logger.warning("Email non envoyé vers %s : BREVO_API_KEY non configuré", to)
        return
    sender_email = os.getenv("MAIL_FROM", "fesperiquette@hotmail.com")
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


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "healthy", "timestamp": utc_now().isoformat()}


# -----------------------------------------------------------------------------
# Auth routes
# -----------------------------------------------------------------------------

@api_router.post("/auth/register", response_model=RegisterResponse, status_code=201)
async def register(body: UserCreate):
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
    if not doc or not verify_password(body.password, doc["hashed_password"]):
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
async def resend_verification(body: ResendVerificationBody):
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
async def forgot_password(body: ForgotPasswordBody):
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
async def reset_password(body: ResetPasswordBody):
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


@api_router.get("/stock/priority", response_model=List[StockItem])
async def get_priority_items(current_user: Dict[str, Any] = Depends(_get_current_user)):
    threshold = (utc_now().date() + timedelta(days=3)).strftime("%Y-%m-%d")
    cursor = stock_col.find({
        "user_id": current_user["id"],
        "status": "active",
        "expiry_date": {"$nin": [None, ""], "$lte": threshold},
    }).sort("expiry_date", 1)
    docs = await cursor.to_list(length=500)
    return [serialize_mongo(d) for d in docs]


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
async def get_product(barcode: str):
    product = await lookup_product_openfoodfacts(barcode, products_cache_col)
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


@api_router.get("/recipes/suggestions")
async def get_recipe_suggestions(
    recipe_filter: str = Query("urgent", alias="filter"),
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Suggère des recettes depuis la base française embarquée.
    filter: urgent (≤7j) | all | frigo | placard
    """
    uid = current_user["id"]
    today_str = utc_now().strftime("%Y-%m-%d")

    # Récupérer les items actifs selon le filtre
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

    # Noms du stock normalisés pour la correspondance
    stock_names = [i.get("name", "") for i in items if i.get("name")]
    norm_stock = [_normalize_fr(n) for n in stock_names]

    # Ingrédients urgents (≤2j) pour le boost de pertinence
    norm_urgent: set[str] = set()
    if recipe_filter == "urgent" and items:
        in_2_days = (utc_now().date() + timedelta(days=2)).strftime("%Y-%m-%d")
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
                new_id = f"ai_{int(utc_now().timestamp())}"
                try:
                    await community_recipes_col.insert_one({
                        "_id": new_id,
                        "title": ai_data["title"],
                        "ingredients_keywords": ai_data["ingredients_keywords"],
                        "instructions_summary": ai_data.get("instructions_summary", ""),
                        "created_at": utc_now(),
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
async def ocr_receipt_route(
    request: Request,
    current_user: Dict[str, Any] = Depends(_get_current_user),
):
    """Analyse un ticket de caisse via GPT-4o-mini vision et retourne la liste des produits alimentaires."""
    return await ocr_receipt(request, current_user)


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
    today = utc_now().date()
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
    today = utc_now().date()
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
    if cached and (utc_now() - cached["created_at"]).total_seconds() < 3600:
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

    _ai_recipe_cache[uid] = {"recipes": recipes, "created_at": utc_now()}
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


