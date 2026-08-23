from __future__ import annotations

import imaplib
import os
import re
from email import message_from_bytes
from email.header import decode_header
from email.message import Message
from email.utils import parseaddr
from typing import Any


def is_configured() -> bool:
    return bool(
        os.getenv("EMAIL_IMPORT_INBOX_ADDRESS", "").strip()
        and os.getenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", "").strip()
    )


def get_import_address() -> str:
    """Adresse unique partagée par tous les utilisateurs premium — pas d'adresse
    par utilisateur : l'identification se fait par l'expéditeur du mail transféré,
    pas par l'adresse de destination (cf. _process_inbound_email_message)."""
    return os.getenv("EMAIL_IMPORT_INBOX_ADDRESS", "").strip()


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    decoded = ""
    for text, encoding in decode_header(value):
        if isinstance(text, bytes):
            decoded += text.decode(encoding or "utf-8", errors="replace")
        else:
            decoded += text
    return decoded.strip()


def extract_sender_email(msg: Message) -> str:
    """Adresse de l'expéditeur — c'est elle qui sert à retrouver le compte
    KeepEat à créditer (cf. commentaire au-dessus de get_import_address)."""
    _, address = parseaddr(msg.get("From", ""))
    return address.strip().lower()


def extract_subject(msg: Message) -> str:
    return _decode_header_value(msg.get("Subject", ""))


def _decode_part(part: Message) -> str:
    try:
        payload = part.get_payload(decode=True)
    except Exception:
        return ""
    if not payload:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, ValueError):
        return payload.decode("utf-8", errors="replace")


def extract_email_text(msg: Message) -> str:
    """Corps texte de l'email — priorité au texte brut, repli sur un dépouillement
    minimal du HTML si seul le HTML est fourni (pas de parseur HTML dédié : les
    balises restantes ne gênent pas Gemini, qui les ignore en pratique)."""
    text_plain: str | None = None
    text_html: str | None = None

    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_disposition() == "attachment":
                continue
            content_type = part.get_content_type()
            if content_type == "text/plain" and text_plain is None:
                text_plain = _decode_part(part)
            elif content_type == "text/html" and text_html is None:
                text_html = _decode_part(part)
    else:
        content_type = msg.get_content_type()
        if content_type == "text/plain":
            text_plain = _decode_part(msg)
        elif content_type == "text/html":
            text_html = _decode_part(msg)

    if text_plain and text_plain.strip():
        return text_plain.strip()
    if text_html and text_html.strip():
        return _strip_html_tags(text_html)
    return ""


def _strip_html_tags(html: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Boîte mail partagée — IMAP (polling, pas de webhook)
# ---------------------------------------------------------------------------
# Un seul compte email, possédé par l'application (ex: un Gmail dédié avec un
# mot de passe d'application) — pas d'OAuth par utilisateur, pas de scope
# Google sensible à faire vérifier par Google : c'est notre propre boîte, pas
# celle d'un utilisateur tiers. cf. AUDIT_BUGS.md pour la comparaison avec les
# approches précédentes (Gmail OAuth par utilisateur, adresse dédiée par
# utilisateur via un domaine).

def _imap_config() -> dict[str, Any]:
    return {
        "host": os.getenv("EMAIL_IMPORT_IMAP_HOST", "imap.gmail.com").strip() or "imap.gmail.com",
        "port": int(os.getenv("EMAIL_IMPORT_IMAP_PORT", "993") or "993"),
        "address": os.getenv("EMAIL_IMPORT_INBOX_ADDRESS", "").strip(),
        "password": os.getenv("EMAIL_IMPORT_INBOX_APP_PASSWORD", "").strip(),
    }


def fetch_unseen_emails(*, limit: int = 20) -> list[dict[str, Any]]:
    """Se connecte à la boîte partagée et retourne les emails non lus (jusqu'à
    `limit`), sous forme de dicts {"uid": bytes, "sender": str, "subject": str,
    "text": str}. Ne marque rien comme lu — c'est à l'appelant de le faire via
    mark_seen() une fois chaque email traité (un par un, pour ne jamais perdre
    un ticket si le process s'interrompt en cours de lot)."""
    config = _imap_config()
    if not config["address"] or not config["password"]:
        return []

    results: list[dict[str, Any]] = []
    conn = imaplib.IMAP4_SSL(config["host"], config["port"])
    try:
        conn.login(config["address"], config["password"])
        conn.select("INBOX")
        status, data = conn.uid("search", None, "UNSEEN")
        if status != "OK" or not data or not data[0]:
            return []
        uids = data[0].split()[:limit]
        for uid in uids:
            status, msg_data = conn.uid("fetch", uid, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = message_from_bytes(raw)
            results.append({
                "uid": uid,
                "sender": extract_sender_email(msg),
                "subject": extract_subject(msg),
                "text": extract_email_text(msg),
            })
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return results


def mark_seen(uid: bytes) -> None:
    config = _imap_config()
    if not config["address"] or not config["password"]:
        return
    conn = imaplib.IMAP4_SSL(config["host"], config["port"])
    try:
        conn.login(config["address"], config["password"])
        conn.select("INBOX")
        conn.uid("store", uid, "+FLAGS", "(\\Seen)")
    finally:
        try:
            conn.logout()
        except Exception:
            pass
