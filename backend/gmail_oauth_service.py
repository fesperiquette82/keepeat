from __future__ import annotations

import os
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from backend.app_core import utc_now
from backend.auth_utils import get_jwt_secret_key

JWT_ALGORITHM = "HS256"
STATE_EXPIRE_MINUTES = 15
STATE_TOKEN_TYPE = "gmail_oauth_state"

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"


class GmailOAuthNotConfigured(Exception):
    """Levée quand GOOGLE_OAUTH_CLIENT_ID/SECRET ne sont pas configurés."""


def _client_credentials() -> tuple[str, str]:
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise GmailOAuthNotConfigured(
            "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET non configurés "
            "(à créer dans Google Cloud Console — cf. AUDIT_BUGS.md)."
        )
    return client_id, client_secret


def _redirect_uri() -> str:
    # Schéma custom de l'app (deep link), configurable sans redeploy si le
    # schéma change — même convention que les autres secrets/URLs externes
    # (cf. GEMINI_RECIPES_MODEL, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON).
    return os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "keepeat://oauth/gmail/callback").strip()


def is_configured() -> bool:
    return bool(os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip() and os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip())


def _get_fernet() -> Fernet:
    key = os.getenv("GMAIL_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        raise GmailOAuthNotConfigured(
            "GMAIL_TOKEN_ENCRYPTION_KEY non configuré — générer avec "
            "Fernet.generate_key() et le stocker en variable d'environnement Render, "
            "jamais dans le code."
        )
    return Fernet(key.encode("utf-8"))


def encrypt_refresh_token(refresh_token: str) -> str:
    return _get_fernet().encrypt(refresh_token.encode("utf-8")).decode("utf-8")


def decrypt_refresh_token(encrypted: str) -> str | None:
    """Best-effort : une clé de chiffrement changée ou un token corrompu ne doit
    jamais faire planter l'appelant, juste rendre la connexion Gmail invalide
    (l'utilisateur devra reconnecter son compte)."""
    try:
        return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except (InvalidToken, GmailOAuthNotConfigured, ValueError):
        return None


def generate_state_token(user_id: str) -> str:
    expire = utc_now() + timedelta(minutes=STATE_EXPIRE_MINUTES)
    return jwt.encode(
        {"user_id": user_id, "type": STATE_TOKEN_TYPE, "exp": expire},
        get_jwt_secret_key(),
        algorithm=JWT_ALGORITHM,
    )


def decode_state_token(state: str) -> str:
    """Retourne le user_id encodé dans le state, ou lève ValueError."""
    try:
        payload = jwt.decode(state, get_jwt_secret_key(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise ValueError("invalid_state")
    if payload.get("type") != STATE_TOKEN_TYPE:
        raise ValueError("invalid_state")
    user_id = payload.get("user_id")
    if not user_id:
        raise ValueError("invalid_state")
    return user_id


def build_authorization_url(*, user_id: str) -> dict[str, str]:
    client_id, _ = _client_credentials()
    state = generate_state_token(user_id)
    params = {
        "client_id": client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": GMAIL_READONLY_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return {"authorization_url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}", "state": state}


async def exchange_code_for_tokens(*, code: str) -> dict[str, Any]:
    """Échange le code d'autorisation contre un refresh_token + access_token.
    Lève httpx.HTTPStatusError si Google rejette l'échange (code invalide/expiré)."""
    client_id, client_secret = _client_credentials()
    async with httpx.AsyncClient(timeout=15) as http:
        resp = await http.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def revoke_token(*, token: str) -> bool:
    """Révoque un refresh_token auprès de Google. Best-effort : retourne False
    (sans lever) si Google est injoignable — le token local est supprimé côté
    KeepEat dans tous les cas par l'appelant, la révocation distante est une
    précaution supplémentaire, pas une condition bloquante."""
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.post(GOOGLE_REVOKE_URL, data={"token": token})
            return resp.status_code == 200
    except Exception:
        return False
