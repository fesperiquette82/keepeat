"""Tests de non-régression — BUG-051/054 (import automatique des tickets par
email).

Boîte mail unique, partagée par tous les utilisateurs premium — l'utilisateur
transfère lui-même ses tickets reçus par email vers cette adresse. L'app relève
la boîte par sondage IMAP périodique (cron) plutôt que par un webhook, et
retrouve l'utilisateur via l'adresse d'expéditeur du mail transféré. Pas
d'OAuth, pas de scope Google sensible, pas de domaine dédié à posséder — c'est
notre propre boîte, pas celle d'un utilisateur tiers.
"""
import importlib
import sys
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Unité — backend/email_import_service.py (pas de dépendance réseau/IMAP)
# ---------------------------------------------------------------------------

class TestEmailImportServiceUnit:
    def test_is_configured_false_when_missing(self, monkeypatch):
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_ADDRESS", raising=False)
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", raising=False)
        from backend import email_import_service as svc
        assert svc.is_configured() is False
        assert svc.get_import_address() == ""

    def test_is_configured_requires_both_address_and_password(self, monkeypatch):
        monkeypatch.setenv("EMAIL_IMPORT_INBOX_ADDRESS", "tickets@example.com")
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", raising=False)
        from backend import email_import_service as svc
        assert svc.is_configured() is False

    def test_is_configured_true_and_returns_address(self, monkeypatch):
        monkeypatch.setenv("EMAIL_IMPORT_INBOX_ADDRESS", "tickets@example.com")
        monkeypatch.setenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", "app-password")
        from backend import email_import_service as svc
        assert svc.is_configured() is True
        assert svc.get_import_address() == "tickets@example.com"

    def test_extract_sender_email_plain(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        msg["From"] = "Jean Dupont <Jean.Dupont@Example.com>"
        assert svc.extract_sender_email(msg) == "jean.dupont@example.com"

    def test_extract_sender_email_missing(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        assert svc.extract_sender_email(msg) == ""

    def test_extract_subject(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        msg["Subject"] = "  Votre ticket Carrefour  "
        assert svc.extract_subject(msg) == "Votre ticket Carrefour"

    def test_extract_email_text_plain(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        msg.set_content("Lait 1L\nOeufs x6")
        assert svc.extract_email_text(msg).strip() == "Lait 1L\nOeufs x6"

    def test_extract_email_text_falls_back_to_html_stripped(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        msg.set_content("<html><body><p>Lait 1L</p><br><p>Oeufs x6</p></body></html>", subtype="html")
        text = svc.extract_email_text(msg)
        assert "Lait 1L" in text
        assert "Oeufs x6" in text
        assert "<p>" not in text

    def test_extract_email_text_prefers_plain_over_html_in_multipart(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        msg.set_content("Lait 1L")
        msg.add_alternative("<p>Lait 1L (html)</p>", subtype="html")
        assert svc.extract_email_text(msg).strip() == "Lait 1L"

    def test_extract_email_text_empty_when_no_body(self):
        from backend import email_import_service as svc
        msg = EmailMessage()
        assert svc.extract_email_text(msg) == ""

    def test_fetch_unseen_emails_returns_empty_when_not_configured(self, monkeypatch):
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_ADDRESS", raising=False)
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", raising=False)
        from backend import email_import_service as svc
        assert svc.fetch_unseen_emails() == []

    def test_mark_seen_noop_when_not_configured(self, monkeypatch):
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_ADDRESS", raising=False)
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", raising=False)
        from backend import email_import_service as svc
        svc.mark_seen(b"1")  # ne doit pas lever, même sans connexion IMAP


# ---------------------------------------------------------------------------
# Endpoint — GET /integrations/email-import/address et POST /internal/email-import/poll
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
    def __init__(self):
        self.inserted: list[dict] = []

    async def insert_one(self, doc):
        self.inserted.append(dict(doc))
        return None


class FakeServiceUsageLogsCol:
    async def insert_one(self, _doc):
        return None


PREMIUM_USER_ID = "507f1f77bcf86cd799439011"
PREMIUM_USER_EMAIL = "premium@example.com"
FREE_USER_ID = "507f1f77bcf86cd799439012"
FREE_USER_EMAIL = "free@example.com"


def _load_server(monkeypatch, *, inbox_configured=True):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017/keepeat-test")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    monkeypatch.delenv("APP_ENV", raising=False)
    if inbox_configured:
        monkeypatch.setenv("EMAIL_IMPORT_INBOX_ADDRESS", "tickets@keepeat.app")
        monkeypatch.setenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", "app-password")
    else:
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_ADDRESS", raising=False)
        monkeypatch.delenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", raising=False)
    for mod in ("server", "models", "email_import_service"):
        sys.modules.pop(mod, None)
    return importlib.import_module("server")


class TestGetEmailImportAddress:
    def test_free_plan_gets_403(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": FREE_USER_ID, "is_premium": False}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        monkeypatch.setattr(server, "users_col", FakeUsersCollection([
            {"_id": ObjectId(FREE_USER_ID), "email": FREE_USER_EMAIL, "is_premium": False},
        ]))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/email-import/address")

        assert resp.status_code == 403
        server.app.dependency_overrides.clear()

    def test_premium_but_not_configured_returns_configured_false(self, monkeypatch):
        server = _load_server(monkeypatch, inbox_configured=False)
        current_user = {"id": PREMIUM_USER_ID, "is_premium": True}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        monkeypatch.setattr(server, "users_col", FakeUsersCollection([
            {"_id": ObjectId(PREMIUM_USER_ID), "email": PREMIUM_USER_EMAIL, "is_premium": True},
        ]))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/email-import/address")

        assert resp.status_code == 200
        assert resp.json() == {"configured": False, "address": None}
        server.app.dependency_overrides.clear()

    def test_premium_configured_returns_the_shared_address(self, monkeypatch):
        server = _load_server(monkeypatch)
        current_user = {"id": PREMIUM_USER_ID, "is_premium": True}
        server.app.dependency_overrides[server._get_current_user] = lambda: current_user
        monkeypatch.setattr(server, "users_col", FakeUsersCollection([
            {"_id": ObjectId(PREMIUM_USER_ID), "email": PREMIUM_USER_EMAIL, "is_premium": True},
        ]))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.get("/api/integrations/email-import/address")

        assert resp.status_code == 200
        assert resp.json() == {"configured": True, "address": "tickets@keepeat.app"}
        server.app.dependency_overrides.clear()

    def test_the_shared_address_is_identical_across_different_users(self, monkeypatch):
        """Contrairement à BUG-051 initial (adresse par utilisateur), tout le
        monde reçoit la même adresse — c'est l'expéditeur qui identifie qui est
        qui, pas l'adresse de destination."""
        server = _load_server(monkeypatch)
        users_col = FakeUsersCollection([
            {"_id": ObjectId(PREMIUM_USER_ID), "email": PREMIUM_USER_EMAIL, "is_premium": True},
            {"_id": ObjectId(FREE_USER_ID), "email": "other-premium@example.com", "is_premium": True},
        ])
        monkeypatch.setattr(server, "users_col", users_col)

        from fastapi.testclient import TestClient
        client = TestClient(server.app)

        server.app.dependency_overrides[server._get_current_user] = lambda: {"id": PREMIUM_USER_ID, "is_premium": True}
        addr_a = client.get("/api/integrations/email-import/address").json()["address"]
        server.app.dependency_overrides[server._get_current_user] = lambda: {"id": FREE_USER_ID, "is_premium": True}
        addr_b = client.get("/api/integrations/email-import/address").json()["address"]

        assert addr_a == addr_b == "tickets@keepeat.app"
        server.app.dependency_overrides.clear()


class TestEmailImportPollEndpoint:
    def _setup(self, monkeypatch, server, *, premium=True, used=0):
        uid = PREMIUM_USER_ID if premium else FREE_USER_ID
        email = PREMIUM_USER_EMAIL if premium else FREE_USER_EMAIL
        users_col = FakeUsersCollection([
            {"_id": ObjectId(uid), "email": email, "is_premium": premium, "push_tokens": ["ExponentPushToken[abc]"]},
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
        return email, users_col, stock_col, app_state

    def _headers(self, token="cron-secret"):
        return {"Authorization": f"Bearer {token}"}

    def test_missing_cron_token_returns_503(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.delenv("EMAIL_IMPORT_CRON_TOKEN", raising=False)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())
        assert resp.status_code == 503

    def test_wrong_cron_token_returns_401(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers("wrong"))
        assert resp.status_code == 401

    def test_inbox_not_configured_returns_zero_processed_without_fetching(self, monkeypatch):
        server = _load_server(monkeypatch, inbox_configured=False)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        def _should_not_be_called():
            raise AssertionError("fetch_unseen_emails ne doit pas être appelé quand la boîte n'est pas configurée")
        monkeypatch.setattr(server.email_import_service, "fetch_unseen_emails", _should_not_be_called)
        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "processed": 0}

    def test_successful_import_inserts_stock_items_and_notifies(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, users_col, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server.email_import_service, "fetch_unseen_emails",
            lambda: [{"uid": b"1", "sender": email, "subject": "Votre ticket Carrefour", "text": "Lait demi-écrémé x1"}],
        )
        marked_seen = []
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: marked_seen.append(uid))
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
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "processed": 1}
        assert marked_seen == [b"1"]
        assert len(stock_col.inserted) == 1
        assert stock_col.inserted[0]["name"] == "Lait demi-écrémé"
        assert stock_col.inserted[0]["source"] == "email_import"
        assert stock_col.inserted[0]["user_id"] == PREMIUM_USER_ID
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 1
        server.send_expo_push.assert_awaited_once()
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_succeeded"
        assert tracked[0]["user_id"] == PREMIUM_USER_ID

    def test_unknown_sender_is_ignored_but_still_marked_seen(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server.email_import_service, "fetch_unseen_emails",
            lambda: [{"uid": b"1", "sender": "inconnu@example.com", "subject": "?", "text": "..."}],
        )
        marked_seen = []
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: marked_seen.append(uid))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "processed": 1}
        assert marked_seen == [b"1"]
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_sender_unrecognized"
        assert tracked[0]["user_id"] is None

    def test_missing_sender_is_ignored_but_still_marked_seen(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server.email_import_service, "fetch_unseen_emails",
            lambda: [{"uid": b"1", "sender": "", "subject": "?", "text": "..."}],
        )
        marked_seen = []
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: marked_seen.append(uid))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "processed": 1}
        assert marked_seen == [b"1"]
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_sender_missing"
        assert tracked[0]["user_id"] is None

    def test_free_plan_sender_is_ignored_no_stock_inserted(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, _ = self._setup(monkeypatch, server, premium=False)
        monkeypatch.setattr(server.email_import_service, "fetch_unseen_emails", lambda: [{"uid": b"1", "sender": email, "subject": "?", "text": "Lait x1"}])
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: None)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert stock_col.inserted == []
        server.parse_email_receipt_text.assert_not_awaited()
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_non_premium"
        assert tracked[0]["user_id"] == FREE_USER_ID

    def test_empty_body_is_ignored_but_still_marked_seen(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, _ = self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server.email_import_service, "fetch_unseen_emails",
            lambda: [{"uid": b"1", "sender": email, "subject": "?", "text": ""}],
        )
        marked_seen = []
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: marked_seen.append(uid))
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert marked_seen == [b"1"]
        assert stock_col.inserted == []
        server.parse_email_receipt_text.assert_not_awaited()
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_empty_body"
        assert tracked[0]["user_id"] == PREMIUM_USER_ID

    def test_quota_exhausted_skips_without_error(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, app_state = self._setup(monkeypatch, server, used=200)
        monkeypatch.setattr(server.email_import_service, "fetch_unseen_emails", lambda: [{"uid": b"1", "sender": email, "subject": "?", "text": "Lait x1"}])
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: None)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock())

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert stock_col.inserted == []
        server.parse_email_receipt_text.assert_not_awaited()
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_quota_exhausted"
        assert tracked[0]["user_id"] == PREMIUM_USER_ID

    def test_empty_parse_result_refunds_quota_and_inserts_nothing(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(server.email_import_service, "fetch_unseen_emails", lambda: [{"uid": b"1", "sender": email, "subject": "?", "text": "newsletter, pas un ticket"}])
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: None)
        monkeypatch.setattr(
            server, "parse_email_receipt_text",
            AsyncMock(return_value={"purchase_date": None, "merchant": None, "currency": "EUR", "items": [], "ignored_items": []}),
        )

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert stock_col.inserted == []
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 0  # réservé (1) puis remboursé (0)
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_no_items"
        assert tracked[0]["user_id"] == PREMIUM_USER_ID

    def test_gemini_failure_refunds_quota_and_does_not_crash(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, app_state = self._setup(monkeypatch, server)
        monkeypatch.setattr(server.email_import_service, "fetch_unseen_emails", lambda: [{"uid": b"1", "sender": email, "subject": "?", "text": "Lait x1"}])
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: None)
        monkeypatch.setattr(server, "parse_email_receipt_text", AsyncMock(side_effect=RuntimeError("gemini down")))

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert stock_col.inserted == []
        counter_id = f"usage:{PREMIUM_USER_ID}:ocr_receipt:{server._current_period_key()}"
        assert app_state.docs[counter_id]["used"] == 0
        tracked = server.business_events_col.inserted
        assert len(tracked) == 1
        assert tracked[0]["event_name"] == "email_import_parse_failed"
        assert tracked[0]["user_id"] == PREMIUM_USER_ID

    def test_multiple_messages_all_marked_seen_even_if_one_fails(self, monkeypatch):
        server = _load_server(monkeypatch)
        monkeypatch.setenv("EMAIL_IMPORT_CRON_TOKEN", "cron-secret")
        email, _, stock_col, _ = self._setup(monkeypatch, server)
        monkeypatch.setattr(
            server.email_import_service, "fetch_unseen_emails",
            lambda: [
                {"uid": b"1", "sender": "inconnu@example.com", "subject": "?", "text": "..."},
                {"uid": b"2", "sender": email, "subject": "?", "text": "Lait x1"},
            ],
        )
        marked_seen = []
        monkeypatch.setattr(server.email_import_service, "mark_seen", lambda uid: marked_seen.append(uid))
        monkeypatch.setattr(
            server, "parse_email_receipt_text",
            AsyncMock(return_value={
                "purchase_date": None, "merchant": None, "currency": "EUR",
                "items": [{"normalized_title": "Lait", "category": "frais", "food_category": "frais", "quantity": 1}],
                "ignored_items": [],
            }),
        )

        from fastapi.testclient import TestClient
        client = TestClient(server.app)
        resp = client.post("/api/internal/email-import/poll", headers=self._headers())

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "processed": 2}
        assert marked_seen == [b"1", b"2"]
        assert len(stock_col.inserted) == 1
