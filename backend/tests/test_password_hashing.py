"""BUG-081 : passlib remplacé par bcrypt direct — compatibilité des hachés existants.

passlib est abandonné et incompatible avec bcrypt >= 4.1 (lecture de version
cassée), ce qui bloquait toute mise à jour de bcrypt. Les utilisateurs existants
ont des hachés `$2b$12$…` produits par passlib : ils doivent se vérifier à
l'identique après la migration, y compris pour les mots de passe de plus de
72 octets que passlib tronquait en silence.
"""
from __future__ import annotations

import os
import unittest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

import jwt  # noqa: E402

from backend.auth_utils import (  # noqa: E402
    JWT_ALGORITHM,
    SESSION_VERSION_CLAIM,
    create_token,
    get_jwt_secret_key,
    hash_password,
    verify_password,
)

# Hachés générés avec passlib 1.7.4 (CryptContext bcrypt, 12 tours) AVANT la
# migration, pour les mots de passe ci-dessous. Ils tiennent lieu de données
# de production : s'ils cessent de se vérifier, des utilisateurs réels ne
# pourront plus se connecter.
LEGACY_PASSWORD = "Str0ng!Passw0rd"
LEGACY_HASH = "$2b$12$GvqY7/Dvf8GBEbCl3JG6vuNLtpcNtAhN11xPwYdtqlgINMQdTWpNW"

LONG_PASSWORD = "A1!" + "x" * 90  # 93 octets : passlib ne hachait que les 72 premiers
LONG_PASSWORD_LEGACY_HASH = "$2b$12$7LiS23nTskldroyVmiW6eO6yHidShKyLO9O06Pzejk4Nv0CYqJNlS"


class LegacyHashCompatibilityTests(unittest.TestCase):
    def test_passlib_hash_still_verifies(self):
        self.assertTrue(verify_password(LEGACY_PASSWORD, LEGACY_HASH))

    def test_passlib_hash_rejects_wrong_password(self):
        self.assertFalse(verify_password("Str0ng!Passw0rd2", LEGACY_HASH))

    def test_long_password_hashed_by_passlib_still_verifies(self):
        # passlib tronquait à 72 octets ; bcrypt >= 4.1 refuserait le secret
        # complet. La troncature explicite préserve la compatibilité.
        self.assertTrue(verify_password(LONG_PASSWORD, LONG_PASSWORD_LEGACY_HASH))

    def test_long_password_differs_only_beyond_72_bytes_is_equivalent(self):
        # Conséquence assumée de bcrypt (identique sous passlib) : deux secrets
        # égaux sur 72 octets sont indiscernables. Figé pour que le comportement
        # ne change pas par surprise.
        self.assertTrue(verify_password(LONG_PASSWORD[:72] + "DIFFERENT", LONG_PASSWORD_LEGACY_HASH))


class NewHashTests(unittest.TestCase):
    def test_roundtrip(self):
        hashed = hash_password("Nouveau!Mdp2026")
        self.assertTrue(hashed.startswith("$2b$12$"))
        self.assertTrue(verify_password("Nouveau!Mdp2026", hashed))
        self.assertFalse(verify_password("nouveau!Mdp2026", hashed))

    def test_salted(self):
        self.assertNotEqual(hash_password("Même!Mdp2026"), hash_password("Même!Mdp2026"))

    def test_unicode_password(self):
        hashed = hash_password("Mötley Crüe ❤️ 2026!")
        self.assertTrue(verify_password("Mötley Crüe ❤️ 2026!", hashed))

    def test_long_password_hashes_without_error(self):
        hashed = hash_password(LONG_PASSWORD)
        self.assertTrue(verify_password(LONG_PASSWORD, hashed))

    def test_unreadable_hash_is_refused_not_crashing(self):
        self.assertFalse(verify_password("Str0ng!Passw0rd", "pas-un-hache"))
        self.assertFalse(verify_password("Str0ng!Passw0rd", ""))


class PyJwtTokenTests(unittest.TestCase):
    """python-jose (abandonné) remplacé par PyJWT : même format de jeton."""

    def test_token_decodes_with_pyjwt_and_carries_session_version(self):
        token = create_token("507f1f77bcf86cd799439011", session_version=3)
        payload = jwt.decode(token, get_jwt_secret_key(), algorithms=[JWT_ALGORITHM])
        self.assertEqual(payload["sub"], "507f1f77bcf86cd799439011")
        self.assertEqual(payload[SESSION_VERSION_CLAIM], 3)
        self.assertIn("exp", payload)

    def test_tampered_token_is_rejected(self):
        token = create_token("507f1f77bcf86cd799439011")
        with self.assertRaises(jwt.PyJWTError):
            jwt.decode(token + "x", get_jwt_secret_key(), algorithms=[JWT_ALGORITHM])

    def test_wrong_secret_is_rejected(self):
        token = create_token("507f1f77bcf86cd799439011")
        with self.assertRaises(jwt.PyJWTError):
            jwt.decode(token, "autre-secret", algorithms=[JWT_ALGORITHM])
