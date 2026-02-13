# backend/server.py
from __future__ import annotations

import base64
import io
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

# Optional OCR dependencies (EasyOCR + Pillow)
# If you don't deploy OCR, you can remove these imports & endpoint safely.
try:
    import easyocr  # type: ignore
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    easyocr = None
    Image = None

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
app = FastAPI(title="KeepEat Backend", version="1.0.0")

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

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


class OCRRequest(BaseModel):
    image_base64: str = Field(..., description="Base64 image, optionally data URL.")


class OCRDateResult(BaseModel):
    date: Optional[str] = None  # "YYYY-MM-DD"
    confidence: float = 0.0
    raw: Optional[str] = None


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
        async with httpx.AsyncClient(timeout=10.0, headers=headers) as c:
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
# OCR (expiry date) - robust minimal implementation
# -----------------------------------------------------------------------------
_OCR_READER = None


def _get_ocr_reader():
    global _OCR_READER
    if _OCR_READER is not None:
        return _OCR_READER
    if easyocr is None:
        raise RuntimeError("EasyOCR is not installed. Install easyocr + pillow.")
    # languages: French + English usually enough for expiry strings
    _OCR_READER = easyocr.Reader(["fr", "en"], gpu=False)
    return _OCR_READER


DATE_PATTERNS = [
    # 12/03/2026 or 12-03-26 etc
    re.compile(r"\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b"),
    # 2026-03-12
    re.compile(r"\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b"),
]


def _normalize_date(d: int, m: int, y: int) -> Optional[str]:
    if y < 100:
        y += 2000
    if not (1 <= m <= 12 and 1 <= d <= 31 and 2000 <= y <= 2100):
        return None
    try:
        dt = datetime(y, m, d, tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


def _extract_date_from_text(text: str) -> Optional[str]:
    t = text.strip()
    # pattern: dd/mm/yyyy
    m = DATE_PATTERNS[0].search(t)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _normalize_date(d, mo, y)

    # pattern: yyyy-mm-dd
    m = DATE_PATTERNS[1].search(t)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _normalize_date(d, mo, y)

    return None


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "healthy", "timestamp": _utc_now().isoformat()}


@api_router.get("/stock", response_model=List[StockItem])
async def get_stock(status: str = "active"):
    cursor = stock_col.find({"status": status}).sort("added_date", -1)
    docs = await cursor.to_list(length=1000)
    return [_serialize_mongo(d) for d in docs]


@api_router.post("/stock", response_model=StockItem)
async def add_stock(item: StockItemCreate):
    doc = item.model_dump()
    doc["added_date"] = _utc_now().isoformat()
    doc["status"] = "active"
    doc["consumed_date"] = None
    doc["thrown_date"] = None

    res = await stock_col.insert_one(doc)
    created = await stock_col.find_one({"_id": res.inserted_id})
    return _serialize_mongo(created)


@api_router.put("/stock/{item_id}", response_model=StockItem)
async def update_stock(item_id: str, item: StockItemUpdate):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    update_data = item.model_dump(exclude_unset=True)
    if not update_data:
        existing = await stock_col.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Item not found")
        return _serialize_mongo(existing)

    res = await stock_col.update_one(
        {"_id": oid, "status": "active"},
        {"$set": update_data},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Active item not found")

    updated = await stock_col.find_one({"_id": oid})
    return _serialize_mongo(updated)


@api_router.post("/stock/{item_id}/consume")
async def consume_item(item_id: str):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    res = await stock_col.update_one(
        {"_id": oid},
        {"$set": {"status": "consumed", "consumed_date": _utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@api_router.post("/stock/{item_id}/throw")
async def throw_item(item_id: str):
    try:
        oid = ObjectId(item_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid item id")

    res = await stock_col.update_one(
        {"_id": oid},
        {"$set": {"status": "thrown", "thrown_date": _utc_now().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@api_router.get("/stock/priority", response_model=List[StockItem])
async def get_priority_items():
    # priority: expired or expiring in <= 3 days
    cursor = stock_col.find({"status": "active"}).sort("added_date", -1)
    docs = await cursor.to_list(length=2000)

    out: List[Dict[str, Any]] = []
    for d in docs:
        days = _days_until(d.get("expiry_date"))
        if days is None:
            continue
        if days <= 3:
            out.append(_serialize_mongo(d))

    # sort by soonest
    out.sort(key=lambda x: (_days_until(x.get("expiry_date")) or 10**9))
    return out


@api_router.get("/stats", response_model=StatsResponse)
async def get_stats():
    # active
    total_items = await stock_col.count_documents({"status": "active"})

    # expiring soon / expired among active
    cursor = stock_col.find({"status": "active"})
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
        {"status": "consumed", "consumed_date": {"$gte": week_ago}}
    )
    thrown_this_week = await stock_col.count_documents(
        {"status": "thrown", "thrown_date": {"$gte": week_ago}}
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
    return ProductLookupResponse(found=product is not None, product=product, shelf_life=shelf_life)


@api_router.post("/ocr/date", response_model=OCRDateResult)
async def ocr_extract_date(request: OCRRequest):
    if Image is None or easyocr is None:
        raise HTTPException(
            status_code=501,
            detail="OCR is not available on this server (missing easyocr/pillow).",
        )

    image_data = request.image_base64.strip()
    # Remove data URL prefix if present
    if "," in image_data and image_data.lower().startswith("data:"):
        image_data = image_data.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(image_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    try:
        image = Image.open(io.BytesIO(img_bytes))
        if image.mode != "RGB":
            image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image")

    reader = _get_ocr_reader()

    # EasyOCR expects numpy array or file path; pillow image works via conversion to bytes
    # simplest: convert to bytes -> reopen is ok; better: convert to numpy.
    try:
        import numpy as np  # type: ignore

        np_img = np.array(image)
        results = reader.readtext(np_img)
    except Exception as e:
        logger.warning("OCR failed: %s", e)
        raise HTTPException(status_code=500, detail="OCR processing failed")

    best_date = None
    best_conf = 0.0
    best_raw = None

    for bbox, text, conf in results:
        if not text:
            continue
        candidate = _extract_date_from_text(text)
        if candidate and conf >= best_conf:
            best_date = candidate
            best_conf = float(conf)
            best_raw = text

    return OCRDateResult(date=best_date, confidence=best_conf, raw=best_raw)


# -----------------------------------------------------------------------------
# Wire routes
# -----------------------------------------------------------------------------
app.include_router(api_router)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
