from __future__ import annotations

import os
from copy import deepcopy
from datetime import timedelta
from typing import Any

from app_core import utc_now

_TRUE_VALUES = {"1", "true", "yes", "on"}


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in _TRUE_VALUES


def is_test_env() -> bool:
    return os.getenv("APP_ENV", "").strip().lower() == "test"


def external_services_disabled() -> bool:
    return _env_flag("DISABLE_EXTERNAL_SERVICES", default=False)


def mock_ai_enabled() -> bool:
    return _env_flag("MOCK_AI", default=is_test_env())


def mock_ocr_enabled() -> bool:
    return _env_flag("MOCK_OCR", default=is_test_env())


def mock_openfoodfacts_enabled() -> bool:
    return _env_flag("MOCK_OPEN_FOOD_FACTS", default=is_test_env())


def mock_billing_enabled() -> bool:
    return _env_flag("MOCK_BILLING", default=is_test_env())


def mock_emails_enabled() -> bool:
    return _env_flag("MOCK_EMAILS", default=is_test_env())


def mock_push_enabled() -> bool:
    return _env_flag("MOCK_PUSH", default=is_test_env())


def ensure_external_allowed(service_name: str) -> None:
    if is_test_env() and external_services_disabled():
        raise RuntimeError(f"External service call blocked in APP_ENV=test: {service_name}")


FIXTURES: dict[str, Any] = {
    "users": {
        "free": {
            "email": "e2e.free@keepeat.test",
            "password": "TestPassword123!",
            "is_premium": False,
            "subscription_status": "inactive",
        },
        "premium": {
            "email": "premium-user@keepeat.test",
            "password": "Password123!",
            "is_premium": True,
            "subscription_status": "active",
        },
    },
    "products": {
        "known": {
            "barcode": "3017620422003",
            "name": "Nutella",
            "brand": "Ferrero",
            "image_url": "https://example.test/nutella.png",
            "category": "epicerie",
            "quantity": "400g",
        },
        "unknown": {
            "barcode": "0000000000000",
            "name": "Produit inconnu",
            "brand": "",
            "image_url": "",
            "category": "autres",
            "quantity": "",
        },
    },
    "ocr": {
        "receipt_date": "2026-04-24",
        "items": [
            {"name": "Lait demi-écrémé", "quantity": "1L", "category": "frais"},
            {"name": "Tomates", "quantity": "500g", "category": "legumes"},
        ],
    },
    "ai_recipe": {
        "title": "Poêlée anti-gaspi",
        "description": "Recette mock stable en mode test",
        "ingredients": ["tomates", "lait", "oignon"],
        "steps": ["Découper", "Cuire", "Servir"],
        "duration_min": 20,
        "dish_type": "rapide",
    },
}


def build_seed_stock(user_id: str) -> list[dict[str, Any]]:
    today = utc_now().date()
    return [
        {
            "user_id": user_id,
            "name": "Yaourt nature",
            "status": "active",
            "storageZone": "frigo",
            "food_category": "frais",
            "expiry_date": today.isoformat(),
            "added_date": utc_now().isoformat(),
            "quantity": "2",
            "source": "test_seed",
        },
        {
            "user_id": user_id,
            "name": "Carottes",
            "status": "active",
            "storageZone": "placard",
            "food_category": "legumes",
            "expiry_date": (today + timedelta(days=5)).isoformat(),
            "added_date": utc_now().isoformat(),
            "quantity": "1kg",
            "source": "test_seed",
        },
        {
            "user_id": user_id,
            "name": "Pâtes",
            "status": "active",
            "storageZone": "placard",
            "food_category": "feculents",
            "expiry_date": (today + timedelta(days=25)).isoformat(),
            "added_date": utc_now().isoformat(),
            "quantity": "500g",
            "source": "test_seed",
        },
    ]


def clone_fixtures() -> dict[str, Any]:
    return deepcopy(FIXTURES)
