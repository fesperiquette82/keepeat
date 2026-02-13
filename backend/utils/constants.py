# backend/utils/constants.py

# ====== FOODKEEPER_DATA (Base de durées USDA FoodKeeper) ======
FOODKEEPER_DATA = {
    # Dairy Products
    "en:milks": {"category": "Milk", "category_fr": "Lait", "refrigerator_days": 7, "freezer_days": 90, "tips": "Keep refrigerated", "tips_fr": "Garder au réfrigérateur"},
    "en:cheeses": {"category": "Cheese", "category_fr": "Fromage", "refrigerator_days": 21, "freezer_days": 180, "tips": "Wrap tightly", "tips_fr": "Emballer hermétiquement"},
    "en:yogurts": {"category": "Yogurt", "category_fr": "Yaourt", "refrigerator_days": 14, "tips": "Check use-by date", "tips_fr": "Vérifier la DLC"},
    "en:butters": {"category": "Butter", "category_fr": "Beurre", "refrigerator_days": 30, "freezer_days": 270, "tips": "Keep covered", "tips_fr": "Garder couvert"},
    "en:creams": {"category": "Cream", "category_fr": "Crème", "refrigerator_days": 10, "after_opening_days": 5, "tips_fr": "Consommer rapidement après ouverture"},
    # ... (le reste inchangé, copier-coller depuis server.py)
}

# ====== EXPIRY_KEYWORDS ======
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

# ====== MONTH_NAMES ======
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
