"""Non-régression BUG-068 — invalidation des sessions au changement de mot de passe.

Les JWT durent 30 jours et ne portaient que `sub` et `exp` : changer son mot de
passe ne rendait inutilisable aucun jeton déjà émis. Un jeton volé restait donc
valable jusqu'à un mois **après** que la victime ait réagi — précisément le
scénario pour lequel on réinitialise un mot de passe.
"""

import os
import unittest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

from jose import jwt

from backend.auth_utils import (
    JWT_ALGORITHM,
    SESSION_VERSION_CLAIM,
    create_token,
    get_jwt_secret_key,
    token_session_version_is_current,
)


def _decode(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret_key(), algorithms=[JWT_ALGORITHM])


class SessionVersionTests(unittest.TestCase):
    def test_token_carries_session_version(self):
        payload = _decode(create_token("user-1", 3))
        self.assertEqual(payload[SESSION_VERSION_CLAIM], 3)

    def test_token_is_valid_while_version_matches(self):
        payload = _decode(create_token("user-1", 2))
        self.assertTrue(token_session_version_is_current(payload, {"session_version": 2}))

    def test_old_token_rejected_after_password_reset(self):
        """[REGRESSION] BUG-068 — cœur du bug : le jeton émis AVANT la
        réinitialisation ne doit plus ouvrir de session."""
        stolen = _decode(create_token("user-1", 2))
        # `reset_password` fait `$inc: {session_version: 1}`.
        self.assertFalse(token_session_version_is_current(stolen, {"session_version": 3}))

    def test_new_token_after_reset_is_accepted(self):
        fresh = _decode(create_token("user-1", 3))
        self.assertTrue(token_session_version_is_current(fresh, {"session_version": 3}))

    def test_legacy_token_without_claim_stays_valid_until_first_reset(self):
        """La mise en production ne doit déconnecter personne : les jetons émis
        avant ce correctif (sans claim `sv`) valent version 0."""
        legacy = {"sub": "user-1"}
        self.assertTrue(token_session_version_is_current(legacy, {}))
        self.assertTrue(token_session_version_is_current(legacy, {"session_version": 0}))
        # …mais le premier changement de mot de passe les invalide bien.
        self.assertFalse(token_session_version_is_current(legacy, {"session_version": 1}))

    def test_corrupted_claim_is_refused(self):
        self.assertFalse(
            token_session_version_is_current({SESSION_VERSION_CLAIM: "abc"}, {"session_version": 0})
        )

    def test_corrupted_stored_version_is_treated_as_zero(self):
        """Une valeur illisible en base ne doit pas déconnecter tout le monde."""
        payload = _decode(create_token("user-1", 0))
        self.assertTrue(token_session_version_is_current(payload, {"session_version": None}))


if __name__ == "__main__":
    unittest.main()
