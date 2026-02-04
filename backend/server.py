from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import base64
import io
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'keepeat_db')]

# Create the main app
app = FastAPI(title="KeepEat API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ===== EASYOCR INITIALIZATION =====
# Initialize EasyOCR reader (lazy loading for performance)
ocr_reader = None

def get_ocr_reader():
    global ocr_reader
    if ocr_reader is None:
        import easyocr
        # Support multiple languages: French, English, German, Spanish, Italian, Portuguese, Dutch
        ocr_reader = easyocr.Reader(['fr', 'en', 'de', 'es', 'it', 'pt', 'nl'], gpu=False)
    return ocr_reader

# ===== MODELS =====

class ProductBase(BaseModel):
    barcode: Optional[str] = None
    name: str
    brand: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    quantity: Optional[str] = None

class StockItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    barcode: Optional[str] = None
    name: str
    brand: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    quantity: Optional[str] = None
    expiry_date: Optional[str] = None  # ISO date string
    added_date: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "active"  # active, consumed, thrown
    notes: Optional[str] = None

class StockItemCreate(BaseModel):
    barcode: Optional[str] = None
    name: str
    brand: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    quantity: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None

class StockItemUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    expiry_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    quantity: Optional[str] = None

# OCR Request/Response models
class OCRRequest(BaseModel):
    image_base64: str  # Base64 encoded image

class OCRDateResult(BaseModel):
    raw_text: str
    detected_date: Optional[str] = None
    confidence: str
    format_detected: str
    all_text_lines: List[str]

# Community shelf life contribution
class CommunityShelfLifeCreate(BaseModel):
    product_name: str
    barcode: Optional[str] = None
    category: Optional[str] = None
    shelf_life_days: int
    storage_type: str  # refrigerator, freezer, pantry
    source: str = "user"  # user, ocr

class CommunityShelfLife(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    product_name: str
    barcode: Optional[str] = None
    category: Optional[str] = None
    shelf_life_days: int
    storage_type: str
    source: str = "user"
    votes: int = 1
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

class ProductLookupResponse(BaseModel):
    found: bool
    product: Optional[ProductBase] = None
    message: str
    shelf_life: Optional[dict] = None  # Suggested shelf life from FoodKeeper

class StatsResponse(BaseModel):
    total_items: int
    expiring_soon: int  # Within 2 days
    expired: int
    consumed_this_week: int
    thrown_this_week: int

class ShelfLifeInfo(BaseModel):
    category: str
    category_fr: str
    refrigerator_days: Optional[int] = None
    freezer_days: Optional[int] = None
    pantry_days: Optional[int] = None
    after_opening_days: Optional[int] = None
    tips: Optional[str] = None
    tips_fr: Optional[str] = None

# ===== FOODKEEPER DATABASE (Based on USDA FoodKeeper) =====
# Shelf life data in days - source: USDA FoodKeeper
FOODKEEPER_DATA = {
    # Dairy Products
    "en:milks": {"category": "Milk", "category_fr": "Lait", "refrigerator_days": 7, "freezer_days": 90, "tips": "Keep refrigerated", "tips_fr": "Garder au réfrigérateur"},
    "en:cheeses": {"category": "Cheese", "category_fr": "Fromage", "refrigerator_days": 21, "freezer_days": 180, "tips": "Wrap tightly", "tips_fr": "Emballer hermétiquement"},
    "en:yogurts": {"category": "Yogurt", "category_fr": "Yaourt", "refrigerator_days": 14, "tips": "Check use-by date", "tips_fr": "Vérifier la DLC"},
    "en:butters": {"category": "Butter", "category_fr": "Beurre", "refrigerator_days": 30, "freezer_days": 270, "tips": "Keep covered", "tips_fr": "Garder couvert"},
    "en:creams": {"category": "Cream", "category_fr": "Crème", "refrigerator_days": 10, "after_opening_days": 5, "tips_fr": "Consommer rapidement après ouverture"},
    
    # Eggs
    "en:eggs": {"category": "Eggs", "category_fr": "Oeufs", "refrigerator_days": 35, "tips": "Keep in original carton", "tips_fr": "Garder dans la boîte d'origine"},
    
    # Meat & Poultry
    "en:meats": {"category": "Meat", "category_fr": "Viande", "refrigerator_days": 3, "freezer_days": 120, "tips": "Cook or freeze promptly", "tips_fr": "Cuisiner ou congeler rapidement"},
    "en:beef": {"category": "Beef", "category_fr": "Boeuf", "refrigerator_days": 3, "freezer_days": 180, "tips_fr": "Conserver au frais"},
    "en:pork": {"category": "Pork", "category_fr": "Porc", "refrigerator_days": 3, "freezer_days": 180, "tips_fr": "Conserver au frais"},
    "en:poultry": {"category": "Poultry", "category_fr": "Volaille", "refrigerator_days": 2, "freezer_days": 270, "tips": "Use within 2 days", "tips_fr": "Utiliser sous 2 jours"},
    "en:chicken": {"category": "Chicken", "category_fr": "Poulet", "refrigerator_days": 2, "freezer_days": 270, "tips_fr": "Consommer rapidement"},
    "en:deli-meats": {"category": "Deli Meat", "category_fr": "Charcuterie", "refrigerator_days": 5, "freezer_days": 60, "after_opening_days": 3, "tips_fr": "Refermer après usage"},
    
    # Seafood
    "en:seafood": {"category": "Seafood", "category_fr": "Fruits de mer", "refrigerator_days": 2, "freezer_days": 90, "tips": "Use quickly", "tips_fr": "Utiliser rapidement"},
    "en:fishes": {"category": "Fish", "category_fr": "Poisson", "refrigerator_days": 2, "freezer_days": 180, "tips_fr": "Garder très frais"},
    "en:smoked-fishes": {"category": "Smoked Fish", "category_fr": "Poisson fumé", "refrigerator_days": 14, "freezer_days": 60, "tips_fr": "Garder emballé"},
    
    # Fruits & Vegetables
    "en:fruits": {"category": "Fruits", "category_fr": "Fruits", "refrigerator_days": 7, "pantry_days": 3, "tips": "Check daily for ripeness", "tips_fr": "Vérifier la maturité"},
    "en:vegetables": {"category": "Vegetables", "category_fr": "Légumes", "refrigerator_days": 7, "tips": "Store in crisper", "tips_fr": "Conserver dans le bac à légumes"},
    "en:salads": {"category": "Salad", "category_fr": "Salade", "refrigerator_days": 5, "tips": "Keep dry", "tips_fr": "Garder au sec"},
    "en:berries": {"category": "Berries", "category_fr": "Baies", "refrigerator_days": 3, "freezer_days": 365, "tips_fr": "Ne pas laver avant stockage"},
    "en:citrus-fruits": {"category": "Citrus", "category_fr": "Agrumes", "refrigerator_days": 21, "pantry_days": 7, "tips_fr": "Peuvent rester à température ambiante"},
    "en:apples": {"category": "Apples", "category_fr": "Pommes", "refrigerator_days": 28, "pantry_days": 7, "tips_fr": "Conserver au frais pour plus longtemps"},
    "en:bananas": {"category": "Bananas", "category_fr": "Bananes", "pantry_days": 5, "tips": "Do not refrigerate unripe", "tips_fr": "Ne pas réfrigérer si pas mûres"},
    
    # Bread & Bakery
    "en:breads": {"category": "Bread", "category_fr": "Pain", "pantry_days": 5, "freezer_days": 90, "tips": "Freeze for longer storage", "tips_fr": "Congeler pour conserver plus longtemps"},
    "en:pastries": {"category": "Pastries", "category_fr": "Pâtisseries", "refrigerator_days": 3, "pantry_days": 2, "tips_fr": "Consommer rapidement"},
    
    # Beverages
    "en:beverages": {"category": "Beverages", "category_fr": "Boissons", "pantry_days": 365, "after_opening_days": 7, "tips_fr": "Réfrigérer après ouverture"},
    "en:fruit-juices": {"category": "Fruit Juice", "category_fr": "Jus de fruits", "refrigerator_days": 7, "after_opening_days": 7, "tips_fr": "Réfrigérer après ouverture"},
    "en:sodas": {"category": "Soda", "category_fr": "Sodas", "pantry_days": 270, "tips_fr": "Garder au frais pour meilleur goût"},
    
    # Spreads & Condiments
    "en:spreads": {"category": "Spreads", "category_fr": "Pâtes à tartiner", "pantry_days": 90, "after_opening_days": 30, "tips_fr": "Refermer après usage"},
    "en:honeys": {"category": "Honey", "category_fr": "Miel", "pantry_days": 730, "tips": "Never expires if stored properly", "tips_fr": "Se conserve très longtemps"},
    "en:jams": {"category": "Jam", "category_fr": "Confiture", "pantry_days": 365, "refrigerator_days": 30, "after_opening_days": 30, "tips_fr": "Réfrigérer après ouverture"},
    "en:sauces": {"category": "Sauces", "category_fr": "Sauces", "pantry_days": 365, "after_opening_days": 30, "tips_fr": "Réfrigérer après ouverture"},
    "en:mayonnaises": {"category": "Mayonnaise", "category_fr": "Mayonnaise", "pantry_days": 180, "refrigerator_days": 60, "after_opening_days": 60, "tips_fr": "Toujours réfrigérer après ouverture"},
    "en:mustards": {"category": "Mustard", "category_fr": "Moutarde", "pantry_days": 365, "refrigerator_days": 365, "tips_fr": "Se conserve longtemps"},
    "en:ketchup": {"category": "Ketchup", "category_fr": "Ketchup", "pantry_days": 365, "refrigerator_days": 180, "after_opening_days": 30, "tips_fr": "Réfrigérer après ouverture"},
    
    # Canned & Preserved
    "en:canned-foods": {"category": "Canned Food", "category_fr": "Conserves", "pantry_days": 730, "after_opening_days": 4, "tips": "Transfer to container after opening", "tips_fr": "Transférer dans un récipient après ouverture"},
    "en:frozen-foods": {"category": "Frozen Food", "category_fr": "Surgelés", "freezer_days": 180, "tips": "Keep frozen until use", "tips_fr": "Garder congelé jusqu'à utilisation"},
    
    # Snacks & Cereals
    "en:cereals": {"category": "Cereals", "category_fr": "Céréales", "pantry_days": 180, "after_opening_days": 60, "tips": "Keep dry and sealed", "tips_fr": "Garder au sec et fermé"},
    "en:biscuits": {"category": "Biscuits", "category_fr": "Biscuits", "pantry_days": 60, "tips_fr": "Conserver dans une boîte hermétique"},
    "en:chocolates": {"category": "Chocolate", "category_fr": "Chocolat", "pantry_days": 180, "tips": "Store in cool, dark place", "tips_fr": "Conserver au frais et à l'abri de la lumière"},
    "en:chips": {"category": "Chips", "category_fr": "Chips", "pantry_days": 60, "after_opening_days": 14, "tips_fr": "Refermer le paquet"},
    
    # Prepared Foods
    "en:meals": {"category": "Prepared Meals", "category_fr": "Plats préparés", "refrigerator_days": 3, "freezer_days": 90, "tips_fr": "Réchauffer complètement"},
    "en:pizzas": {"category": "Pizza", "category_fr": "Pizza", "refrigerator_days": 3, "freezer_days": 60, "tips_fr": "Congeler si non consommée rapidement"},
    "en:sandwiches": {"category": "Sandwiches", "category_fr": "Sandwichs", "refrigerator_days": 2, "tips_fr": "Consommer le jour même de préférence"},
    
    # Baby Food
    "en:baby-foods": {"category": "Baby Food", "category_fr": "Alimentation bébé", "pantry_days": 365, "after_opening_days": 2, "tips": "Discard if contaminated", "tips_fr": "Jeter si contaminé"},
    
    # Default fallbacks by general type
    "fresh": {"category": "Fresh Product", "category_fr": "Produit frais", "refrigerator_days": 5, "tips_fr": "Vérifier régulièrement"},
    "dry": {"category": "Dry Product", "category_fr": "Produit sec", "pantry_days": 180, "tips_fr": "Garder au sec"},
    "frozen": {"category": "Frozen Product", "category_fr": "Produit surgelé", "freezer_days": 180, "tips_fr": "Ne pas recongeler"},
    "default": {"category": "Food Product", "category_fr": "Produit alimentaire", "refrigerator_days": 7, "tips_fr": "Vérifier la date sur l'emballage"},
}

def get_shelf_life_for_category(category: Optional[str]) -> dict:
    """Get shelf life information based on Open Food Facts category"""
    if not category:
        return FOODKEEPER_DATA["default"]
    
    # Clean category string
    cat_lower = category.lower().strip()
    
    # Direct match
    if cat_lower in FOODKEEPER_DATA:
        return FOODKEEPER_DATA[cat_lower]
    
    # Partial match - check if category contains any key
    for key, data in FOODKEEPER_DATA.items():
        if key in cat_lower or cat_lower in key:
            return data
    
    # Keyword matching for common terms
    keyword_mapping = {
        "lait": "en:milks", "milk": "en:milks",
        "fromage": "en:cheeses", "cheese": "en:cheeses",
        "yaourt": "en:yogurts", "yogurt": "en:yogurts", "yoghurt": "en:yogurts",
        "beurre": "en:butters", "butter": "en:butters",
        "oeuf": "en:eggs", "egg": "en:eggs",
        "viande": "en:meats", "meat": "en:meats",
        "boeuf": "en:beef", "beef": "en:beef",
        "porc": "en:pork", "pork": "en:pork",
        "poulet": "en:chicken", "chicken": "en:chicken",
        "volaille": "en:poultry", "poultry": "en:poultry",
        "poisson": "en:fishes", "fish": "en:fishes",
        "fruit": "en:fruits",
        "légume": "en:vegetables", "vegetable": "en:vegetables",
        "salade": "en:salads", "salad": "en:salads",
        "pain": "en:breads", "bread": "en:breads",
        "jus": "en:fruit-juices", "juice": "en:fruit-juices",
        "boisson": "en:beverages", "beverage": "en:beverages",
        "confiture": "en:jams", "jam": "en:jams",
        "sauce": "en:sauces",
        "conserve": "en:canned-foods", "canned": "en:canned-foods",
        "surgelé": "en:frozen-foods", "frozen": "en:frozen-foods",
        "céréale": "en:cereals", "cereal": "en:cereals",
        "biscuit": "en:biscuits",
        "chocolat": "en:chocolates", "chocolate": "en:chocolates",
        "pizza": "en:pizzas",
        "sandwich": "en:sandwiches",
        "bébé": "en:baby-foods", "baby": "en:baby-foods",
        "crème": "en:creams", "cream": "en:creams",
        "charcuterie": "en:deli-meats", "deli": "en:deli-meats", "ham": "en:deli-meats", "jambon": "en:deli-meats",
        "miel": "en:honeys", "honey": "en:honeys",
        "moutarde": "en:mustards", "mustard": "en:mustards",
        "mayonnaise": "en:mayonnaises",
        "ketchup": "en:ketchup",
        "chips": "en:chips",
        "soda": "en:sodas",
        "pomme": "en:apples", "apple": "en:apples",
        "banane": "en:bananas", "banana": "en:bananas",
        "agrume": "en:citrus-fruits", "citrus": "en:citrus-fruits", "orange": "en:citrus-fruits", "citron": "en:citrus-fruits",
        "baie": "en:berries", "berry": "en:berries", "fraise": "en:berries", "framboise": "en:berries",
        "pâtisserie": "en:pastries", "pastry": "en:pastries", "gâteau": "en:pastries", "cake": "en:pastries",
        "plat": "en:meals", "meal": "en:meals", "ready": "en:meals",
        "tartiner": "en:spreads", "spread": "en:spreads", "nutella": "en:spreads", "pâte": "en:spreads",
    }
    
    for keyword, mapped_key in keyword_mapping.items():
        if keyword in cat_lower:
            return FOODKEEPER_DATA.get(mapped_key, FOODKEEPER_DATA["default"])
    
    return FOODKEEPER_DATA["default"]

# ===== OPEN FOOD FACTS API =====

# ===== DATE PARSING FOR OCR =====

# Multilingual expiry keywords
EXPIRY_KEYWORDS = [
    # French
    'a consommer de preference avant', 'a consommer avant', 'date limite', 'dlc', 'ddm',
    'peremption', 'valable jusqu',
    # English
    'best before', 'best by', 'use by', 'use before', 'sell by', 'expiry date', 'expiry',
    'exp date', 'exp', 'expires', 'bb', 'bbe',
    # German
    'mindestens haltbar bis', 'mhd', 'verbrauchsdatum', 'haltbar bis',
    # Spanish
    'consumir preferentemente antes', 'fecha de caducidad', 'caducidad', 'consumir antes',
    # Italian
    'da consumarsi preferibilmente entro', 'da consumare entro', 'scadenza', 'scad',
    # Portuguese
    'consumir de preferencia antes', 'validade', 'val',
    # Dutch
    'ten minste houdbaar tot', 'tht', 'te gebruiken tot', 'tgt',
]

# Month names in multiple languages
MONTH_NAMES = {
    # French
    'janvier': 1, 'janv': 1, 'jan': 1, 'février': 2, 'fevrier': 2, 'fev': 2, 'mars': 3, 'mar': 3,
    'avril': 4, 'avr': 4, 'mai': 5, 'juin': 6, 'jun': 6, 'juillet': 7, 'juil': 7, 'jul': 7,
    'août': 8, 'aout': 8, 'aou': 8, 'septembre': 9, 'sept': 9, 'sep': 9, 'octobre': 10, 'oct': 10,
    'novembre': 11, 'nov': 11, 'décembre': 12, 'decembre': 12, 'dec': 12,
    # English
    'january': 1, 'february': 2, 'feb': 2, 'march': 3, 'april': 4, 'apr': 4, 'may': 5,
    'june': 6, 'july': 7, 'august': 8, 'aug': 8, 'september': 9, 'october': 10,
    'november': 11, 'december': 12,
    # German
    'januar': 1, 'februar': 2, 'marz': 3, 'märz': 3, 'mai': 5, 'juni': 6, 'juli': 7,
    'august': 8, 'oktober': 10, 'okt': 10, 'dezember': 12, 'dez': 12,
    # Spanish
    'enero': 1, 'ene': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'abr': 4, 'mayo': 5,
    'junio': 6, 'julio': 7, 'agosto': 8, 'ago': 8, 'septiembre': 9, 'octubre': 10,
    'noviembre': 11, 'diciembre': 12, 'dic': 12,
    # Italian
    'gennaio': 1, 'gen': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'mag': 5,
    'giugno': 6, 'giu': 6, 'luglio': 7, 'lug': 7, 'agosto': 8, 'settembre': 9, 'set': 9,
    'ottobre': 10, 'ott': 10, 'dicembre': 12,
    # Portuguese
    'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6,
    'julho': 7, 'setembro': 9, 'outubro': 10, 'out': 10, 'dezembro': 12,
    # Dutch
    'januari': 1, 'februari': 2, 'maart': 3, 'mrt': 3, 'april': 4, 'mei': 5, 'juni': 6,
    'juli': 7, 'augustus': 8, 'september': 9, 'oktober': 10, 'december': 12,
}

def normalize_text(text: str) -> str:
    """Normalize text for comparison"""
    import unicodedata
    text = text.lower()
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return text

def parse_month(text: str) -> Optional[int]:
    """Parse month from text (numeric or name)"""
    text = normalize_text(text.strip())
    
    # Try numeric
    try:
        num = int(text)
        if 1 <= num <= 12:
            return num
    except ValueError:
        pass
    
    # Try month names
    for name, month in MONTH_NAMES.items():
        if text == normalize_text(name) or text.startswith(normalize_text(name)[:3]):
            return month
    
    return None

def expand_year(year: int) -> int:
    """Convert 2-digit year to 4-digit"""
    if year >= 100:
        return year
    return 2000 + year if year < 50 else 1900 + year

def parse_date_from_text(text: str) -> Optional[dict]:
    """Parse date from OCR text with multiple format support"""
    original = text
    normalized = normalize_text(text)
    
    # Remove keywords
    for keyword in EXPIRY_KEYWORDS:
        normalized = normalized.replace(normalize_text(keyword), ' ')
    
    normalized = re.sub(r'[:\-/\.]+', ' ', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
    # Pattern 1: DD MM YYYY or DD MMM YYYY (e.g., "19 NOV 2024", "15 03 2025")
    match = re.search(r'(\d{1,2})\s+([a-z]{3,}|\d{1,2})\s+(\d{2,4})', normalized)
    if match:
        day = int(match.group(1))
        month = parse_month(match.group(2))
        year = expand_year(int(match.group(3)))
        if month and 1 <= day <= 31:
            return {'day': day, 'month': month, 'year': year, 'format': 'DD MMM YYYY'}
    
    # Pattern 2: MM/YYYY or MMM YYYY (e.g., "10/2022", "OCT 2022")
    match = re.search(r'([a-z]{3,}|\d{1,2})\s*[/\s]\s*(\d{4})', normalized)
    if match:
        month = parse_month(match.group(1))
        year = int(match.group(2))
        if month:
            # Use last day of month
            if month == 12:
                day = 31
            elif month in [4, 6, 9, 11]:
                day = 30
            elif month == 2:
                day = 28
            else:
                day = 31
            return {'day': day, 'month': month, 'year': year, 'format': 'MM/YYYY'}
    
    # Pattern 3: DD/MM/YYYY or DD-MM-YYYY
    match = re.search(r'(\d{1,2})\s*[/\-\.]\s*(\d{1,2})\s*[/\-\.]\s*(\d{2,4})', original)
    if match:
        day = int(match.group(1))
        month = int(match.group(2))
        year = expand_year(int(match.group(3)))
        if 1 <= day <= 31 and 1 <= month <= 12:
            return {'day': day, 'month': month, 'year': year, 'format': 'DD/MM/YYYY'}
    
    # Pattern 4: DDMMYY or DDMMYYYY
    digits = re.sub(r'\D', '', normalized)
    if len(digits) == 6:
        day = int(digits[0:2])
        month = int(digits[2:4])
        year = expand_year(int(digits[4:6]))
        if 1 <= day <= 31 and 1 <= month <= 12:
            return {'day': day, 'month': month, 'year': year, 'format': 'DDMMYY'}
    elif len(digits) == 8:
        day = int(digits[0:2])
        month = int(digits[2:4])
        year = int(digits[4:8])
        if 1 <= day <= 31 and 1 <= month <= 12:
            return {'day': day, 'month': month, 'year': year, 'format': 'DDMMYYYY'}
    
    # Pattern 5: Just MM/YY or MMYY
    if len(digits) == 4:
        month = int(digits[0:2])
        year = expand_year(int(digits[2:4]))
        if 1 <= month <= 12:
            day = 28 if month == 2 else (30 if month in [4, 6, 9, 11] else 31)
            return {'day': day, 'month': month, 'year': year, 'format': 'MMYY'}
    
    return None

def find_best_date_in_text_lines(text_lines: List[str]) -> Optional[dict]:
    """Find the best date from OCR text lines, prioritizing lines with keywords"""
    results = []
    
    # First, try each line individually
    for line in text_lines:
        # Check if line contains expiry keyword
        has_keyword = any(normalize_text(kw) in normalize_text(line) for kw in EXPIRY_KEYWORDS)
        
        parsed = parse_date_from_text(line)
        if parsed:
            # Validate year is reasonable (not too past/future)
            year = parsed.get('year', 0)
            if 2020 <= year <= 2035:
                parsed['has_keyword'] = has_keyword
                parsed['source_line'] = line
                results.append(parsed)
    
    # If no results, try combining consecutive lines
    if not results:
        combined_text = ' '.join(text_lines)
        parsed = parse_date_from_text(combined_text)
        if parsed:
            year = parsed.get('year', 0)
            if 2020 <= year <= 2035:
                parsed['has_keyword'] = False
                parsed['source_line'] = combined_text
                results.append(parsed)
    
    # Try sliding window of 2-3 consecutive lines
    if not results:
        for i in range(len(text_lines)):
            for window_size in [2, 3]:
                if i + window_size <= len(text_lines):
                    combined = ' '.join(text_lines[i:i+window_size])
                    parsed = parse_date_from_text(combined)
                    if parsed:
                        year = parsed.get('year', 0)
                        if 2020 <= year <= 2035:
                            has_keyword = any(normalize_text(kw) in normalize_text(combined) for kw in EXPIRY_KEYWORDS)
                            parsed['has_keyword'] = has_keyword
                            parsed['source_line'] = combined
                            results.append(parsed)
    
    # Try to find date patterns like "DD" "MMM" "YYYY" spread across lines
    if not results and len(text_lines) >= 2:
        # Look for year (4 digits starting with 20)
        year_line = None
        year_val = None
        for i, line in enumerate(text_lines):
            match = re.search(r'20[2-3]\d', line)
            if match:
                year_line = i
                year_val = int(match.group())
                break
        
        if year_val:
            # Look for day and month in nearby lines
            day_val = None
            month_val = None
            
            for i, line in enumerate(text_lines):
                if i == year_line:
                    continue
                
                # Try to find day (1-31)
                day_match = re.search(r'\b([1-9]|[12]\d|3[01])\b', line)
                if day_match and not day_val:
                    potential_day = int(day_match.group())
                    if 1 <= potential_day <= 31:
                        day_val = potential_day
                
                # Try to find month (name or 1-12)
                month_test = parse_month(line.strip())
                if month_test and not month_val:
                    month_val = month_test
            
            if year_val and month_val:
                day_val = day_val or (28 if month_val == 2 else (30 if month_val in [4, 6, 9, 11] else 31))
                results.append({
                    'day': day_val,
                    'month': month_val,
                    'year': year_val,
                    'format': 'fragmented',
                    'has_keyword': False,
                    'source_line': ' '.join(text_lines)
                })
    
    if not results:
        return None
    
    # Prefer dates with keywords
    with_keyword = [r for r in results if r.get('has_keyword')]
    if with_keyword:
        return with_keyword[0]
    
    return results[0]

async def lookup_product_openfoodfacts(barcode: str) -> Optional[ProductBase]:
    """Lookup product in Open Food Facts database"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
            response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == 1 and data.get("product"):
                    product = data["product"]
                    return ProductBase(
                        barcode=barcode,
                        name=product.get("product_name", product.get("product_name_fr", "Produit inconnu")),
                        brand=product.get("brands", ""),
                        image_url=product.get("image_front_small_url", product.get("image_url", "")),
                        category=product.get("categories_tags", [""])[0] if product.get("categories_tags") else None,
                        quantity=product.get("quantity", "")
                    )
    except Exception as e:
        logging.error(f"Error looking up product {barcode}: {e}")
    return None

# ===== ROUTES =====

@api_router.get("/")
async def root():
    return {"message": "KeepEat API - Bienvenue!"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ===== OCR ENDPOINT =====

@api_router.post("/ocr/date", response_model=OCRDateResult)
async def ocr_extract_date(request: OCRRequest):
    """
    Extract expiry date from image using EasyOCR.
    Accepts base64 encoded image, returns detected date and raw text.
    """
    try:
        from PIL import Image
        
        # Decode base64 image
        image_data = request.image_base64
        if ',' in image_data:
            # Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
            image_data = image_data.split(',')[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Get OCR reader
        reader = get_ocr_reader()
        
        # Perform OCR
        import numpy as np
        image_np = np.array(image)
        results = reader.readtext(image_np)
        
        # Extract text lines
        text_lines = [text for (bbox, text, confidence) in results if confidence > 0.3]
        raw_text = '\n'.join(text_lines)
        
        logging.info(f"OCR detected text lines: {text_lines}")
        
        # Find best date
        best_date = find_best_date_in_text_lines(text_lines)
        
        if best_date:
            date_str = f"{best_date['year']}-{best_date['month']:02d}-{best_date['day']:02d}"
            return OCRDateResult(
                raw_text=raw_text,
                detected_date=date_str,
                confidence='high' if best_date.get('has_keyword') else 'medium',
                format_detected=best_date.get('format', 'unknown'),
                all_text_lines=text_lines
            )
        else:
            return OCRDateResult(
                raw_text=raw_text,
                detected_date=None,
                confidence='low',
                format_detected='no_date_found',
                all_text_lines=text_lines
            )
            
    except Exception as e:
        logging.error(f"OCR error: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {str(e)}")

# Product lookup
@api_router.get("/product/{barcode}", response_model=ProductLookupResponse)
async def lookup_product(barcode: str):
    """Lookup product by barcode in Open Food Facts with shelf life suggestions"""
    product = await lookup_product_openfoodfacts(barcode)
    if product:
        # Get shelf life based on product category
        shelf_life = get_shelf_life_for_category(product.category)
        return ProductLookupResponse(
            found=True,
            product=product,
            message="Produit trouvé",
            shelf_life=shelf_life
        )
    return ProductLookupResponse(
        found=False,
        product=None,
        message="Produit non trouvé dans la base de données",
        shelf_life=FOODKEEPER_DATA["default"]
    )

# Shelf life lookup by category or keyword
@api_router.get("/shelf-life/{query}")
async def get_shelf_life(query: str):
    """Get shelf life suggestion for a product category or keyword"""
    shelf_life = get_shelf_life_for_category(query)
    return {
        "query": query,
        "shelf_life": shelf_life
    }

# Get all shelf life categories
@api_router.get("/shelf-life-categories")
async def get_shelf_life_categories():
    """Get all available shelf life categories"""
    categories = []
    for key, data in FOODKEEPER_DATA.items():
        if key not in ["fresh", "dry", "frozen", "default"]:
            categories.append({
                "key": key,
                "category": data.get("category"),
                "category_fr": data.get("category_fr"),
                "refrigerator_days": data.get("refrigerator_days"),
                "freezer_days": data.get("freezer_days"),
                "pantry_days": data.get("pantry_days"),
            })
    return {"categories": categories}

# ===== COMMUNITY SHELF LIFE DATABASE =====

@api_router.post("/community-shelf-life", response_model=CommunityShelfLife)
async def add_community_shelf_life(data: CommunityShelfLifeCreate):
    """Add user-contributed shelf life data to community database"""
    # Check if similar entry exists (same barcode or similar name + storage type)
    existing = None
    if data.barcode:
        existing = await db.community_shelf_life.find_one({
            "barcode": data.barcode,
            "storage_type": data.storage_type
        })
    
    if not existing and data.product_name:
        # Check for similar product name
        existing = await db.community_shelf_life.find_one({
            "product_name": {"$regex": data.product_name, "$options": "i"},
            "storage_type": data.storage_type
        })
    
    if existing:
        # Update existing entry with average and increment votes
        new_avg = int((existing["shelf_life_days"] * existing["votes"] + data.shelf_life_days) / (existing["votes"] + 1))
        await db.community_shelf_life.update_one(
            {"id": existing["id"]},
            {"$set": {"shelf_life_days": new_avg}, "$inc": {"votes": 1}}
        )
        existing["shelf_life_days"] = new_avg
        existing["votes"] += 1
        return CommunityShelfLife(**existing)
    else:
        # Create new entry
        entry = CommunityShelfLife(**data.dict())
        await db.community_shelf_life.insert_one(entry.dict())
        return entry

@api_router.get("/community-shelf-life/{query}")
async def get_community_shelf_life(query: str):
    """Get community-contributed shelf life data for a product"""
    results = []
    
    # Search by barcode first
    if query.isdigit():
        entries = await db.community_shelf_life.find({"barcode": query}).to_list(10)
        results.extend(entries)
    
    # Search by product name
    if not results:
        entries = await db.community_shelf_life.find({
            "product_name": {"$regex": query, "$options": "i"}
        }).sort("votes", -1).to_list(10)
        results.extend(entries)
    
    # Search by category
    if not results:
        entries = await db.community_shelf_life.find({
            "category": {"$regex": query, "$options": "i"}
        }).sort("votes", -1).to_list(10)
        results.extend(entries)
    
    return {
        "query": query,
        "results": results,
        "count": len(results)
    }

@api_router.get("/community-shelf-life-stats")
async def get_community_stats():
    """Get statistics about community contributions"""
    total = await db.community_shelf_life.count_documents({})
    by_source = await db.community_shelf_life.aggregate([
        {"$group": {"_id": "$source", "count": {"$sum": 1}}}
    ]).to_list(10)
    top_products = await db.community_shelf_life.find().sort("votes", -1).limit(10).to_list(10)
    
    return {
        "total_contributions": total,
        "by_source": {item["_id"]: item["count"] for item in by_source},
        "top_products": top_products
    }

# Stock Management
@api_router.post("/stock", response_model=StockItem)
async def add_stock_item(item: StockItemCreate):
    """Add a new item to stock"""
    stock_item = StockItem(**item.dict())
    await db.stock.insert_one(stock_item.dict())
    return stock_item

@api_router.get("/stock", response_model=List[StockItem])
async def get_stock(status: str = "active"):
    """Get all stock items, optionally filtered by status"""
    query = {"status": status} if status else {}
    items = await db.stock.find(query).sort("expiry_date", 1).to_list(1000)
    return [StockItem(**item) for item in items]

@api_router.get("/stock/priority", response_model=List[StockItem])
async def get_priority_items():
    """Get items that need to be consumed soon (expiring within 3 days or expired)"""
    today = datetime.utcnow().date()
    three_days_later = (today + timedelta(days=3)).isoformat()
    
    # Get active items with expiry date within 3 days or already expired
    items = await db.stock.find({
        "status": "active",
        "expiry_date": {"$ne": None, "$lte": three_days_later}
    }).sort("expiry_date", 1).to_list(1000)
    
    return [StockItem(**item) for item in items]

@api_router.get("/stock/{item_id}", response_model=StockItem)
async def get_stock_item(item_id: str):
    """Get a specific stock item"""
    item = await db.stock.find_one({"id": item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return StockItem(**item)

@api_router.put("/stock/{item_id}", response_model=StockItem)
async def update_stock_item(item_id: str, update: StockItemUpdate):
    """Update a stock item"""
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await db.stock.update_one(
        {"id": item_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item = await db.stock.find_one({"id": item_id})
    return StockItem(**item)

@api_router.delete("/stock/{item_id}")
async def delete_stock_item(item_id: str):
    """Permanently delete a stock item"""
    result = await db.stock.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted", "id": item_id}

@api_router.post("/stock/{item_id}/consume")
async def mark_consumed(item_id: str):
    """Mark an item as consumed"""
    result = await db.stock.update_one(
        {"id": item_id},
        {"$set": {"status": "consumed", "consumed_date": datetime.utcnow().isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item marked as consumed", "id": item_id}

@api_router.post("/stock/{item_id}/throw")
async def mark_thrown(item_id: str):
    """Mark an item as thrown away"""
    result = await db.stock.update_one(
        {"id": item_id},
        {"$set": {"status": "thrown", "thrown_date": datetime.utcnow().isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item marked as thrown", "id": item_id}

# Statistics
@api_router.get("/stats", response_model=StatsResponse)
async def get_stats():
    """Get stock statistics"""
    today = datetime.utcnow().date()
    two_days_later = (today + timedelta(days=2)).isoformat()
    today_str = today.isoformat()
    week_ago = (today - timedelta(days=7)).isoformat()
    
    total = await db.stock.count_documents({"status": "active"})
    
    # Expiring soon (within 2 days, not yet expired)
    expiring_soon = await db.stock.count_documents({
        "status": "active",
        "expiry_date": {"$ne": None, "$lte": two_days_later, "$gte": today_str}
    })
    
    # Already expired
    expired = await db.stock.count_documents({
        "status": "active",
        "expiry_date": {"$ne": None, "$lt": today_str}
    })
    
    # Consumed this week
    consumed = await db.stock.count_documents({
        "status": "consumed",
        "consumed_date": {"$gte": week_ago}
    })
    
    # Thrown this week
    thrown = await db.stock.count_documents({
        "status": "thrown",
        "thrown_date": {"$gte": week_ago}
    })
    
    return StatsResponse(
        total_items=total,
        expiring_soon=expiring_soon,
        expired=expired,
        consumed_this_week=consumed,
        thrown_this_week=thrown
    )

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
