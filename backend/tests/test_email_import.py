"""Tests de non-régression — BUG-051 (import automatique des tickets, boîte
mail dédiée).

Alternative retenue à la connexion Gmail (BUG-050, phase 1 livrée mais phase 2
mise en pause après revue RGPD) : l'utilisateur transfère lui-même ses tickets
reçus par email vers une adresse dédiée à son compte
(tickets+<code>@EMAIL_IMPORT_DOMAIN). Pas d'OAuth, pas de scope Google
sensible — geste actif par email transféré.
"""
import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Unité — backend/email_import_service.py (pas de dépendance Mongo/réseau)
# ---------------------------------------------------------------------------

class TestEmailImportServiceUnit:
    def test_generate_import_code_is_deterministic_and_short(self, monkeypatch):
        monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
        from backend import email_import_service as svc
        code_a = svc.generate_import_code("507f1f77bcf86cd799439011")
        code_b = svc.generate_import_code("507f1f77bcf86cd799439011")
        code_c = svc.generate_import_code("507f1f77bcf86cd799439099")
        assert code_a == code_b
        assert code_a != code_c
        assert len(code_a) == svc.IMPORT_CODE_LENGTH

    def test_build_import_address_empty_when_not_configured(self, monkeypatch):
        monkeypatch.delenv("EMAIL_IMPORT_DOMAIN", raising=False)
        from backend import email_import_service as svc
        assert svc.build_import_address("abc123") == ""
        assert svc.is_configured() is False

    def test_build_import_address_when_configured(self, monkeypatch):
        monkeypatch.setenv("EMAIL_IMPORT_DOMAIN", "import.keepeat.app")
        from backend import email_import_service as svc
        assert svc.is_configured() is True
        assert svc.build_import_address("abc123") == "tickets+abc123@import.keepeat.app"

    def test_build_import_address_custom_local_part(self, monkeypatch):
        monkeypatch.setenv("EMAIL_IMPORT_DOMAIN", "keepeat.app")
        monkeypatch.setenv("EMAIL_IMPORT_LOCAL_PART", "recettes")
        from backend import email_import_service as svc
        assert svc.build_import_address("xyz") == "recettes+xyz@keepeat.app"

    def test_extract_code_from_address(self):
        from backend import email_import_service as svc
        assert svc.extract_code_from_address("tickets+abc123@import.keepeat.app") == "abc123"
        assert svc.extract_code_from_address("TICKETS+ABC123@IMPORT.KEEPEAT.APP") == "abc123"
        assert svc.extract_code_from_address("tickets@import.keepeat.app") is None
        assert svc.extract_code_from_address("") is None
        assert svc.extract_code_from_address("not-an-email") is None

    def test_extract_inbound_items_batched_format(self):
        from backend import email_import_service as svc
        payload = {"items": [{"Subject": "A"}, {"Subject": "B"}]}
        items = svc.extract_inbound_items(payload)
        assert [i["Subject"] for i in items] == ["A", "B"]

    def test_extract_inbound_items_falls_back_to_single_payload(self):
        from backend import email_import_service as svc
        payload = {"Subject": "Ticket Carrefour"}
        items = svc.extract_inbound_items(payload)
        assert items == [payload]

    def test_extract_to_addresses_dict_form(self):
        from backend import email_import_service as svc
        item = {"To": [{"Address": "Tickets+ABC@Import.KeepEat.app", "Name": "Moi"}]}
        assert svc.extract_to_addresses(item) == ["tickets+abc@import.keepeat.app"]

    def test_extract_to_addresses_string_form(self):
        from backend import email_import_service as svc
        item = {"to": "tickets+abc@import.keepeat.app"}
        assert svc.extract_to_addresses(item) == ["tickets+abc@import.keepeat.app"]

    def test_extract_email_text_prefers_plain_text(self):
        from backend import email_import_service as svc
        item = {"RawTextBody": "Lait 1L\nOeufs x6", "RawHtmlBody": "<p>ignore</p>"}
        assert svc.extract_email_text(item) == "Lait 1L\nOeufs x6"

    def test_extract_email_text_falls_back_to_html_stripped(self):
        from backend import email_import_service as svc
        item = {"RawHtmlBody": "<html><body><p>Lait 1L</p><br><p>Oeufs x6</p></body></html>"}
        text = svc.extract_email_text(item)
        assert "Lait 1L" in text
        assert "Oeufs x6" in text
        assert "<p>" not in text

    def test_extract_email_text_empty_when_no_body(self):
        from backend import email_import_service as svc
        assert svc.extract_email_text({}) == ""

    def test_extract_subject(self):
        from backend import email_import_service as svc
        assert svc.extract_subject({"Subject": "  Votre ticket Carrefour  "}) == "Votre ticket Carrefour"
        assert svc.extract_subject({}) == ""


# ---------------------------------------------------------------------------
# Endpoint — GET /integrations/email-import/address et POST /webhooks/email-import
# ---------------------------------------------------------------------------

def _matches(doc: dict, flt: dict) -> bool:
    for key, cond in flt.items():
        value = doc.get(key)
        if isinstance(cond, dict) and "$in" in cond:
            if value not in cond["$in"]:
                return False
        elif value != cond:
            return False
    return True


class FakeUsersCollection:
    def __init__(self, docs=None):
        self.docs: dict[str, dict] = {}
        for doc in docs or []:
            self.docs[str(doc["_id"])] = dict(doc)

    async def find_one(self, flt, projection=None):
        for doc in self.docs.values():
            if _matches(doc, flt):
                return dict(doc)
        return None

    async def update_one(self, flt, update):
        for _id, doc in self.docs.items():
            if _matches(doc, flt):
                for key, val in update.get("$set", {}).items():
                    doc[key] = val
                return type("Result", (), {"matched_count": 1})()
        return type("Result", (), {"matched_count": 0})()

    async def create_index(self, *args, **kwargs):
        return None


class FakeStockCollection:
    def __init__(self):
        self.inserted: list[dict] = []

    async def insert_one(self, doc):
        self.inserted.append(dict(doc))
        return type("Result", (), {"inserted_id": ObjectId()})()


class FakeAppState:
    def __init__(self, docs=None):
        self.docs = dict(docs or {})

    async def find_one_and_update(self, flt, update, upsert=False, return_document=None):
        _id = flt.get("_id")
        doc = self.docs.get(_id)
        inserted = False
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": _id}
            self.docs[_id] = doc
            inserted = True
        if not inserted:
            for key, cond in flt.items():
                if key == "_id":
                    continue
                if isinstance(cond, dict) and "$gt" in cond:
                    if not (doc.get(key, 0) > cond["$gt"]):
                        return None
                elif doc.get(key) != cond:
                    return None
        for key, val in update.get("$setOnInsert", {}).items():
            doc.setdefault(key, val)
        for key, val in update.get("$inc", {}).items():
            doc[key] = doc.get(key, 0) + val
        for key, val in update.get("$set", {}).items():
            doc[key] = val
        return dict(doc)

    async def find_one(self, flt, projection=None):
        doc = self.docs.get(flt.get("_id"))
        return dict(doc) if doc else None


class FakeBusinessEventsCol:
    async def insert_one(self, _doc):
        return None


class FakeServiceUsageLogsCol:
    async def insert_one(self, _doc):
        return None


PREMIUM_USER_ID = "507f1f77bcf86cd799439011"
FREE_USER_ID = "507f1f77bcf86cd799439012"


def _load_server(monkeypatch, *, domain_configured=True):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    if domain_configured:
        monkeypatch.setenv("EMAIL_IMPORT_DOMAIN", "import.keepeat.app")
    else:
        monkeypatch.delenv("EMAIL_IMPORT_DOMAIN", raising=False)
    for mod in ("server", "models", "email_import_service"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class TestGetEmailImportAddress:
    def test_free_plan_gets_403(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": FREE_USER_ID, "is_premium": False}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        monkeypatch.setattr(server, "users_col", FakeUsersCollection([
            {"_id": ObjectId(FREE_USER_ID), "is_premium": False},
        ]))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/email-import/address")

        assert resp.status_code == 403
        server.app.dependency_overrides.clear()

    def test_premium_but_not_configured_returns_configured_false(self, monkeypatch):
        server = _load_server(monkeypatch, domain_configured=False)
        current_user = {"id": PREMIUM_USER_ID, "is_premium": True}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        monkeypatch.setattr(server, "users_col", FakeUsersCollection([
            {"_id": ObjectId(PREMIUM_USER_ID), "is_premium": True},
        ]))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/email-import/address")

        assert resp.status_code == 200
        assert resp.json() == {"configured": False, "address": None}
        server.app.dependency_overrides.clear()

    def test_premium_configured_generates_and_persists_code(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": PREMIUM_USER_ID, "is_premium": True}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        users_col = FakeUsersCollection([{"_id": ObjectId(PREMIUM_USER_ID), "is_premium": True}])
        monkeypatch.setattr(server, "users_col", users_col)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp1 = client.get("/api/integrations/email-import/address")
        assert resp1.status_code == 200
        body1 = resp1.json()
        assert body1["configured"] is True
        assert body1["address"].startswith("tickets+")
        assert body1["address"].endswith("@import.keepeat.app")

        stored_code = users_col.docs[PREMIUM_USER_ID]["email_import_code"]
        assert stored_code and stored_code in body1["address"]

        # Deuxième appel : même code, pas de régénération.
        resp2 = client.get("/api/integrations/email-import/address")
        assert resp2.json()["address"] == body1["address"]
        server.app.dependency_overrides.clear()


class TestEmailImportWebhook:
    def _setup(self, monkeypatch, server, *, premium=True, used=0):
        code = server.email_import_service.generate_import_code(PREMIUM_USER_ID if premium else FREE_USER_ID)
        uid = PREMIUM_USER_ID if premium else FREE_USER_ID
        users_col = FakeUsersCollection([
            {"_id": ObjectId(uid), "is_premium": premium, "email_import_code": code, "push_tokens": ["ExponentPushToken[abc]"]},
        ])
        monkeypatch.setattr(server, "users_col", users_col)
        stock_col = FakeStockCollection()
        monkeypatch.setattr(server, "stock_col", stock_col)
        counter_id = f"usage:{uid}:ocr_receipt:{server._current_period_key()}"
        app_state = FakeAppState({counter_id: {"_id": counter_id, "used": used}} if used else {})
        monkeypatch.setattr(server, "app_state_col", app_state)
        monkeypatch.setattr(server, "business_events_col", FakeBusinessEventsCol())
        monkeypatch.setattr(server, "service_usage_logs_col", FakeServiceUsageLogsCol())
        monkeypatch.setattr(server, "send_expo_push", AsyncMock())
        return code, users_col, stock_col, app_state

    def test_wrong_token_returns_401(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_WEBHOOK_SECRET", "correct-secret")

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/webhooks/email-import?token=wrong", json={})
        assert resp.status_code == 401

    def test_successful_import_inserts_stock_items_and_notifies(self, monkeypatch):
        server = _load_server(monkeypatch)
        code, users_col, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server, "parse_email_receipt_text",
            AsyncMock(return_value={
                "purchase_date": "2026-08-01", "merchant": "Carrefour", "currency": "EUR",
                "items": [{"normalized_title": "Lait demi-écrémé", "category": "frais", "food_category": "frais", "quantity": 1}],
                "ignored_items": [],
            }),
        )

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{
            "To": [{"Address": f"tickets+{code}@import.keepeat.app"}],
            "Subject": "Votre ticket Carrefour",
            "RawTextBody": "Lait demi-écrémé x1",
        }]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert len(stock_col.inserted) == 1
        assert stock_col.inserted[0]["name"] == "Lait demi-écrémé"
        assert stock_col.inserted[0]["source"] == "email_import"
        assert stock_col.inserted[0]["user_id"] == PREMIUM_USER_ID
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 1
        server.send_expo_push.assert_awaited_once()

    def test_unknown_code_is_ignored_without_error(self, monkeypatch):
        server = _load_server(monkeypatch)
        self._setup(monkeypatch, server)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{"To": [{"Address": "tickets+doesnotexist@import.keepeat.app"}], "RawTextBody": "..."}]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_free_plan_user_is_ignored_no_stock_inserted(self, monkeypatch):
        server = _load_server(monkeypatch)
        code, _, stock_col, _ = self._setup(monkeypatch, server, premium=False)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{"To": [{"Address": f"tickets+{code}@import.keepeat.app"}], "RawTextBody": "Lait x1"}]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert stock_col.inserted == []
        server.parse_email_receipt_text.assert_not_awaited()

    def test_quota_exhausted_skips_without_error(self, monkeypatch):
        server = _load_server(monkeypatch)
        code, _, stock_col, app_state = self._setup(monkeypatch, server, used=200)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{"To": [{"Address": f"tickets+{code}@import.keepeat.app"}], "RawTextBody": "Lait x1"}]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert stock_col.inserted == []
        server.parse_email_receipt_text.assert_not_awaited()

    def test_empty_parse_result_refunds_quota_and_inserts_nothing(self, monkeypatch):
        server = _load_server(monkeypatch)
        code, _, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server, "parse_email_receipt_text",
            AsyncMock(return_value={"purchase_date": None, "merchant": None, "currency": "EUR", "items": [], "ignored_items": []}),
        )

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{"To": [{"Address": f"tickets+{code}@import.keepeat.app"}], "RawTextBody": "newsletter, pas un ticket"}]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert stock_col.inserted == []
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 0  # réservé (1) puis remboursé (0)

    def test_gemini_failure_refunds_quota_and_does_not_crash(self, monkeypatch):
        server = _load_server(monkeypatch)
        code, _, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock(side_effect=RuntimeError("gemini down")))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        payload = {"items": [{"To": [{"Address": f"tickets+{code}@import.keepeat.app"}], "RawTextBody": "Lait x1"}]}
        resp = client.post("/api/webhooks/email-import", json=payload)

        assert resp.status_code == 200
        assert stock_col.inserted == []
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 0
