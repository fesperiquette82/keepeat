# backend/server.py
from __future__ import annotations

import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

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
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Shutdown : fermeture de la connexion MongoDB
    client.close()


app = FastAPI(title="KeepEat Backend", version="1.0.0", lifespan=lifespan)


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
cors_origins = os.getenv("CORS_ORIGINS", "*").strip()
origins = (
    ["*"]
    if cors_origins == "*"
    else [o.strip() for o in cors_origins.split(",") if o.strip()]
)

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

# -----------------------------------------------------------------------------
# Auth configuration
# -----------------------------------------------------------------------------
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "changeme-set-a-real-secret-in-render")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

ADMIN_KEY = os.getenv("ADMIN_KEY", "")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
http_bearer = HTTPBearer(auto_error=False)


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


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
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    is_premium: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


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

@api_router.post("/auth/register", response_model=TokenResponse, status_code=201)
async def register(body: UserCreate):
    existing = await users_col.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    doc = {
        "email": body.email.lower(),
        "hashed_password": _hash_password(body.password),
        "is_premium": False,
        "created_at": _utc_now().isoformat(),
        "last_login": _utc_now().isoformat(),
    }
    res = await users_col.insert_one(doc)
    user_id = str(res.inserted_id)
    token = _create_token(user_id)
    return TokenResponse(
        access_token=token,
        user=UserResponse(id=user_id, email=doc["email"], is_premium=False),
    )


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(body: UserLogin):
    doc = await users_col.find_one({"email": body.email.lower()})
    if not doc or not _verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id = str(doc["_id"])
    await users_col.update_one({"_id": doc["_id"]}, {"$set": {"last_login": _utc_now().isoformat()}})
    token = _create_token(user_id)
    return TokenResponse(
        access_token=token,
        user=UserResponse(id=user_id, email=doc["email"], is_premium=doc.get("is_premium", False)),
    )


@api_router.get("/auth/me", response_model=UserResponse)
async def me(current_user: Dict[str, Any] = Depends(_get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        is_premium=current_user.get("is_premium", False),
    )


# -----------------------------------------------------------------------------
# Admin routes
# -----------------------------------------------------------------------------

@api_router.put("/admin/users/{email}/set-premium")
async def set_premium(email: str, key: str = Query(...), premium: bool = Query(True)):
    if not ADMIN_KEY or key != ADMIN_KEY:
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
# Wire routes
# -----------------------------------------------------------------------------
app.include_router(api_router)


