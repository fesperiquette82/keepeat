from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any

from backend.auth_utils import get_jwt_secret_key

IMPORT_CODE_LENGTH = 10


def _import_secret() -> bytes:
    # Réutilise JWT_SECRET_KEY (déjà un secret fort existant, pas un nouveau à
    # provisionner) plutôt qu'une clé dédiée — ce code n'est pas un jeton de
    # sécurité à haute valeur (il ne donne accès qu'à l'ajout d'articles dans le
    # stock d'un utilisateur, jamais à la lecture de données), un HMAC dérivé
    # d'un secret déjà déployé est proportionné.
    return get_jwt_secret_key().encode("utf-8")


def generate_import_code(user_id: str) -> str:
    """Code court, non énumérable, dérivé de façon déterministe du user_id —
    utilisé comme suffixe d'adresse email (tickets+<code>@domaine). Déterministe
    pour ne pas avoir besoin d'une table de correspondance séparée : au moment de
    la résolution, on ne peut pas retrouver le user_id à partir du code (HMAC non
    réversible), donc le code est stocké une fois sur le document utilisateur et
    indexé pour la résolution inverse (cf. resolve_user_id_by_import_code)."""
    digest = hmac.new(_import_secret(), user_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:IMPORT_CODE_LENGTH]


def build_import_address(code: str) -> str:
    domain = os.getenv("EMAIL_IMPORT_DOMAIN", "").strip()
    if not domain:
        return ""
    local_part = os.getenv("EMAIL_IMPORT_LOCAL_PART", "tickets").strip() or "tickets"
    return f"{local_part}+{code}@{domain}"


def is_configured() -> bool:
    return bool(os.getenv("EMAIL_IMPORT_DOMAIN", "").strip())


def extract_code_from_address(address: str) -> str | None:
    """Extrait le suffixe `+code` d'une adresse `local+code@domaine`. Tolère les
    variations de casse (adresses email insensibles à la casse pour la partie
    domaine, et beaucoup de providers normalisent aussi le local-part)."""
    if not address or "@" not in address or "+" not in address:
        return None
    local_part = address.split("@", 1)[0]
    if "+" not in local_part:
        return None
    code = local_part.split("+", 1)[1].strip().lower()
    return code or None


# ---------------------------------------------------------------------------
# Extraction défensive du payload webhook Brevo (Inbound Parsing)
# ---------------------------------------------------------------------------
# ⚠️ Basé sur la documentation publique de Brevo au moment de l'écriture, PAS
# vérifié contre un paiement réel — aucun compte Brevo Inbound Parsing n'est
# disponible dans cet environnement. Le format documenté est un objet avec une
# clé "items" (liste, un message peut être livré en lot), chaque item portant
# From/To/Subject/RawTextBody/RawHtmlBody. Cette fonction tolère plusieurs
# variantes de casse/nommage pour limiter la casse si le format réel diffère
# légèrement — mais DOIT être validée contre un vrai payload de test avant mise
# en production (cf. AUDIT_BUGS.md, risques restants BUG-051).

def _first_present(d: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in d and d[key]:
            return d[key]
    return None


def extract_inbound_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Retourne la liste des items email à traiter, quelle que soit la forme du
    payload (objet avec "items"/"Items", ou payload unique traité comme un seul
    item)."""
    if not isinstance(payload, dict):
        return []
    items = _first_present(payload, "items", "Items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return [payload]


def extract_to_addresses(item: dict[str, Any]) -> list[str]:
    raw = _first_present(item, "To", "to", "Recipients", "recipients")
    if raw is None:
        return []
    candidates = raw if isinstance(raw, list) else [raw]
    addresses: list[str] = []
    for candidate in candidates:
        if isinstance(candidate, str):
            addresses.append(candidate.strip().lower())
        elif isinstance(candidate, dict):
            address = _first_present(candidate, "Address", "address", "email", "Email")
            if isinstance(address, str) and address.strip():
                addresses.append(address.strip().lower())
    return addresses


def extract_email_text(item: dict[str, Any]) -> str:
    """Corps texte de l'email — priorité au texte brut, repli sur un dépouillement
    minimal du HTML si seul le HTML est fourni (pas de parseur HTML dédié : les
    balises restantes ne gênent pas Gemini, qui les ignore en pratique)."""
    text = _first_present(item, "RawTextBody", "text", "Text", "TextBody", "text-plain")
    if isinstance(text, str) and text.strip():
        return text.strip()
    html = _first_present(item, "RawHtmlBody", "html", "Html", "HtmlBody", "text-html")
    if isinstance(html, str) and html.strip():
        return _strip_html_tags(html)
    return ""


def extract_subject(item: dict[str, Any]) -> str:
    subject = _first_present(item, "Subject", "subject")
    return subject.strip() if isinstance(subject, str) else ""


def extract_from_address(item: dict[str, Any]) -> str:
    raw = _first_present(item, "From", "from", "Sender", "sender")
    if isinstance(raw, str):
        return raw.strip().lower()
    if isinstance(raw, dict):
        address = _first_present(raw, "Address", "address", "email", "Email")
        return address.strip().lower() if isinstance(address, str) else ""
    return ""


def _strip_html_tags(html: str) -> str:
    import re

    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()
