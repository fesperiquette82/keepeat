#!/usr/bin/env python3
"""Validation automatique des métadonnées de déploiement frontend.

Usage recommandé (depuis frontend/):
  npm run validate:deploy-meta

Variables d'environnement supportées:
- FRONTEND_BUILD_INFO_URL (prioritaire)
- FRONTEND_PUBLIC_URL / FRONTEND_URL (fallback pour /build-info.json)
- BACKEND_URL (optionnel pour valider /api/admin/monitoring/dashboard)
- ADMIN_BEARER_TOKEN (optionnel pour appeler l'endpoint admin)
- VALIDATE_TIMEOUT_SECONDS (défaut: 6)
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error, request

DEFAULT_TIMEOUT_SECONDS = 6.0


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str]
    warnings: list[str]


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_frontend_build_info_url(explicit_url: str = "", frontend_public_url: str = "") -> str:
    explicit = _normalize_text(explicit_url)
    if explicit:
        return explicit
    base = _normalize_text(frontend_public_url)
    if not base:
        return ""
    return f"{base.rstrip('/')}/build-info.json"


def _load_json_url(url: str, timeout_seconds: float, headers: dict[str, str] | None = None) -> dict[str, Any]:
    req = request.Request(url, headers=headers or {"Accept": "application/json", "User-Agent": "KeepEat-Deploy-Validator/1.0"})
    with request.urlopen(req, timeout=timeout_seconds) as response:  # nosec B310
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise ValueError("La réponse JSON doit être un objet.")
    return payload


def validate_build_info_payload(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for field in ("commit", "version", "build_time"):
        value = _normalize_text(payload.get(field)).lower()
        if not value or value == "unknown":
            errors.append(f"Champ build-info invalide: {field}")
    return errors


def validate_dashboard_frontend_payload(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    meta = payload.get("frontend_deployment")
    if not isinstance(meta, dict):
        return ["dashboard.frontend_deployment est absent ou invalide"], warnings

    current = meta.get("current") if isinstance(meta.get("current"), dict) else {}
    expected = meta.get("expected") if isinstance(meta.get("expected"), dict) else {}

    current_commit = _normalize_text(current.get("commit")).lower()
    current_version = _normalize_text(current.get("version")).lower()
    expected_commit = _normalize_text(expected.get("commit")).lower()

    if not current_commit or current_commit == "unknown":
        errors.append("dashboard.current.commit est inconnu")
    if not current_version or current_version == "unknown":
        errors.append("dashboard.current.version est inconnu")
    if not expected_commit or expected_commit == "unknown":
        warnings.append("dashboard.expected.commit est inconnu")

    return errors, warnings


def run_validation() -> ValidationResult:
    timeout_seconds = float(os.getenv("VALIDATE_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))

    explicit_build_info_url = os.getenv("FRONTEND_BUILD_INFO_URL", "")
    frontend_public_url = os.getenv("FRONTEND_PUBLIC_URL") or os.getenv("FRONTEND_URL", "")
    build_info_url = build_frontend_build_info_url(explicit_build_info_url, frontend_public_url)

    errors: list[str] = []
    warnings: list[str] = []

    if not build_info_url:
        errors.append("Impossible de déterminer l'URL build-info (FRONTEND_BUILD_INFO_URL/FRONTEND_PUBLIC_URL manquants)")
    else:
        try:
            build_info = _load_json_url(build_info_url, timeout_seconds)
            errors.extend(validate_build_info_payload(build_info))
        except (error.HTTPError, error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"Lecture build-info impossible: {exc}")

    backend_url = _normalize_text(os.getenv("BACKEND_URL"))
    admin_token = _normalize_text(os.getenv("ADMIN_BEARER_TOKEN"))
    if backend_url and admin_token:
        dashboard_url = f"{backend_url.rstrip('/')}/api/admin/monitoring/dashboard?days=7"
        try:
            dashboard = _load_json_url(
                dashboard_url,
                timeout_seconds,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {admin_token}",
                    "User-Agent": "KeepEat-Deploy-Validator/1.0",
                },
            )
            dash_errors, dash_warnings = validate_dashboard_frontend_payload(dashboard)
            errors.extend(dash_errors)
            warnings.extend(dash_warnings)
        except (error.HTTPError, error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            warnings.append(f"Vérification dashboard ignorée (appel impossible): {exc}")
    else:
        warnings.append("Vérification dashboard ignorée (BACKEND_URL ou ADMIN_BEARER_TOKEN absent)")

    return ValidationResult(ok=not errors, errors=errors, warnings=warnings)


def main() -> None:
    result = run_validation()

    if result.warnings:
        for warning in result.warnings:
            print(f"[WARN] {warning}")

    if result.errors:
        for err in result.errors:
            print(f"[ERROR] {err}")
        raise SystemExit(1)

    print("[OK] Validation métadonnées frontend réussie.")


if __name__ == "__main__":
    main()
