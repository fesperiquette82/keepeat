from __future__ import annotations

import os
from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import HTTPException
from jose import JWTError, jwt

from backend.app_core import serialize_mongo, utc_now
from backend.auth_utils import get_jwt_secret_key
from backend.entitlements import PREMIUM_PLAN, resolve_plan

JWT_ALGORITHM = "HS256"
INVITE_EXPIRE_DAYS = 7
INVITE_TOKEN_TYPE = "household_invite"

MAX_HOUSEHOLD_MEMBERS = 6


def generate_invite_token(household_id: str) -> dict[str, str]:
    expire = utc_now() + timedelta(days=INVITE_EXPIRE_DAYS)
    token = jwt.encode(
        {"household_id": household_id, "type": INVITE_TOKEN_TYPE, "exp": expire},
        get_jwt_secret_key(),
        algorithm=JWT_ALGORITHM,
    )
    return {"token": token, "expires_at": expire.isoformat()}


def decode_invite_token(token: str) -> str:
    """Retourne le household_id encodé dans le token, ou lève HTTPException(400)."""
    try:
        payload = jwt.decode(token, get_jwt_secret_key(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INVITE_TOKEN"})
    if payload.get("type") != INVITE_TOKEN_TYPE:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INVITE_TOKEN"})
    household_id = payload.get("household_id")
    if not household_id:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INVITE_TOKEN"})
    return household_id


def household_response(household_doc: dict[str, Any], *, members_docs: list[dict[str, Any]]) -> dict[str, Any]:
    out = serialize_mongo(household_doc)
    members_by_id = {str(m.get("_id")): m for m in members_docs}
    owner_id = out.get("owner_id")
    out["members"] = [
        {
            "user_id": member_id,
            "email": members_by_id.get(member_id, {}).get("email", ""),
            "role": "owner" if member_id == owner_id else "member",
        }
        for member_id in out.get("member_ids", [])
    ]
    return out


async def resolve_billing_user_doc(
    user_doc: dict[str, Any] | None,
    *,
    users_col,
    households_col,
) -> dict[str, Any] | None:
    """Retourne le document utilisateur à utiliser pour toute résolution
    d'abonnement (plan, quotas, historique). Un utilisateur premium sur son
    propre compte reste résolu sur son propre document, sans requête
    supplémentaire. Un utilisateur membre d'un foyer (household_id) sans
    abonnement actif en propre est résolu sur le document du propriétaire du
    foyer — l'abonnement premium couvre tout le foyer, un seul paiement.

    Best-effort : toute erreur (foyer introuvable, Mongo indisponible) retombe
    silencieusement sur le document d'origine plutôt que de faire échouer la
    requête — un foyer cassé ne doit jamais bloquer l'utilisateur.
    """
    if not user_doc:
        return user_doc
    if resolve_plan(user_doc) == PREMIUM_PLAN:
        return user_doc
    household_id = user_doc.get("household_id")
    if not household_id:
        return user_doc

    own_id = str(user_doc.get("id") or user_doc.get("_id") or "")
    try:
        household = await households_col.find_one({"_id": ObjectId(household_id)})
    except Exception:
        return user_doc
    if not household:
        return user_doc

    owner_id = household.get("owner_id")
    if not owner_id or owner_id == own_id:
        return user_doc

    try:
        owner_doc = await users_col.find_one({"_id": ObjectId(owner_id)})
    except Exception:
        return user_doc
    return owner_doc or user_doc
