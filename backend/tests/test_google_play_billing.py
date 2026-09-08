"""Non-régression BUG-062/063 — décisions de facturation Google Play.

Ces tests portent sur `backend/google_play_billing.py` (logique pure) : ils
verrouillent les règles qui ont causé les deux bugs bloquants —
« vérification échouée ⇒ Premium offert » et « résiliation ⇒ droits coupés
immédiatement ».
"""

import unittest

from backend.google_play_billing import (
    NOTIFICATION_CANCELED,
    NOTIFICATION_DEFERRED,
    NOTIFICATION_EXPIRED,
    NOTIFICATION_IN_GRACE_PERIOD,
    NOTIFICATION_ON_HOLD,
    NOTIFICATION_PAUSED,
    NOTIFICATION_PAUSE_SCHEDULE_CHANGED,
    NOTIFICATION_PRICE_CHANGE_CONFIRMED,
    NOTIFICATION_PURCHASED,
    NOTIFICATION_RECOVERED,
    NOTIFICATION_RENEWED,
    NOTIFICATION_RESTARTED,
    NOTIFICATION_REVOKED,
    SubscriptionAction,
    VerificationOutcome,
    action_for_notification,
    classify_verification_status,
    is_payment_received,
    may_grant_without_verification,
)


class ClassifyVerificationStatusTests(unittest.TestCase):
    def test_http_200_is_verified(self):
        self.assertIs(classify_verification_status(200), VerificationOutcome.VERIFIED)

    def test_http_400_is_invalid_not_unavailable(self):
        """[REGRESSION] BUG-062 — un HTTP 400 accordait 30 jours de Premium."""
        self.assertIs(classify_verification_status(400), VerificationOutcome.INVALID)

    def test_http_404_and_410_are_invalid(self):
        self.assertIs(classify_verification_status(404), VerificationOutcome.INVALID)
        self.assertIs(classify_verification_status(410), VerificationOutcome.INVALID)

    def test_auth_and_quota_errors_are_unavailable(self):
        """401/403/429 viennent de NOTRE configuration, pas de l'achat : on ne
        refuse pas définitivement un achat peut-être valide."""
        for status in (401, 403, 429):
            with self.subTest(status=status):
                self.assertIs(
                    classify_verification_status(status), VerificationOutcome.UNAVAILABLE
                )

    def test_server_errors_are_unavailable(self):
        for status in (500, 502, 503, 504):
            with self.subTest(status=status):
                self.assertIs(
                    classify_verification_status(status), VerificationOutcome.UNAVAILABLE
                )

    def test_no_status_grants_premium_except_200(self):
        """Aucun statut hors 200 ne doit produire VERIFIED."""
        for status in (201, 204, 301, 400, 401, 404, 410, 418, 500, 503):
            with self.subTest(status=status):
                self.assertIsNot(
                    classify_verification_status(status), VerificationOutcome.VERIFIED
                )


class MayGrantWithoutVerificationTests(unittest.TestCase):
    def test_production_never_grants_without_proof(self):
        """[REGRESSION] BUG-062 — cœur du bug : en production, l'absence de
        preuve ne doit jamais donner de droits."""
        self.assertFalse(
            may_grant_without_verification(is_test_environment=False, allow_unverified=False)
        )

    def test_test_environment_may_grant(self):
        self.assertTrue(
            may_grant_without_verification(is_test_environment=True, allow_unverified=False)
        )

    def test_explicit_dev_flag_may_grant(self):
        self.assertTrue(
            may_grant_without_verification(is_test_environment=False, allow_unverified=True)
        )


class ActionForNotificationTests(unittest.TestCase):
    def test_cancel_keeps_paid_period(self):
        """[REGRESSION] BUG-063 — une résiliation coupait immédiatement les
        droits d'une période déjà payée."""
        self.assertIs(
            action_for_notification(NOTIFICATION_CANCELED),
            SubscriptionAction.KEEP_UNTIL_EXPIRY,
        )

    def test_grace_period_keeps_access(self):
        """[REGRESSION] BUG-063 — la période de grâce (paiement en cours de
        nouvelle tentative) coupait l'accès d'un abonné."""
        self.assertIs(
            action_for_notification(NOTIFICATION_IN_GRACE_PERIOD), SubscriptionAction.ACTIVATE
        )

    def test_active_states(self):
        for notif in (
            NOTIFICATION_RECOVERED,
            NOTIFICATION_RENEWED,
            NOTIFICATION_PURCHASED,
            NOTIFICATION_RESTARTED,
            NOTIFICATION_DEFERRED,
        ):
            with self.subTest(notification_type=notif):
                self.assertIs(action_for_notification(notif), SubscriptionAction.ACTIVATE)

    def test_on_hold_and_paused_now_handled(self):
        """[REGRESSION] BUG-063 — 5 (ON_HOLD) et 10 (PAUSED) n'étaient pas
        traités du tout : l'utilisateur gardait Premium sans payer."""
        self.assertIs(action_for_notification(NOTIFICATION_ON_HOLD), SubscriptionAction.DEACTIVATE)
        self.assertIs(action_for_notification(NOTIFICATION_PAUSED), SubscriptionAction.DEACTIVATE)

    def test_revoked_and_expired_deactivate(self):
        self.assertIs(action_for_notification(NOTIFICATION_REVOKED), SubscriptionAction.DEACTIVATE)
        self.assertIs(action_for_notification(NOTIFICATION_EXPIRED), SubscriptionAction.DEACTIVATE)

    def test_informational_notifications_ignored(self):
        for notif in (NOTIFICATION_PRICE_CHANGE_CONFIRMED, NOTIFICATION_PAUSE_SCHEDULE_CHANGED):
            with self.subTest(notification_type=notif):
                self.assertIs(action_for_notification(notif), SubscriptionAction.IGNORE)

    def test_unknown_type_is_ignored_not_deactivating(self):
        """Un futur numéro inconnu ne doit pas couper l'accès d'un abonné."""
        for value in (99, None, "", "abc", {}):
            with self.subTest(value=value):
                self.assertIs(action_for_notification(value), SubscriptionAction.IGNORE)


class IsPaymentReceivedTests(unittest.TestCase):
    def test_received_and_free_trial_accepted(self):
        self.assertTrue(is_payment_received(1))
        self.assertTrue(is_payment_received(2))

    def test_pending_and_missing_refused(self):
        for value in (0, 3, None, "1"):
            with self.subTest(value=value):
                self.assertFalse(is_payment_received(value))


if __name__ == "__main__":
    unittest.main()
