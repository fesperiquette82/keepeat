"""Décisions de facturation Google Play — logique pure, sans I/O.

Séparé de `server.py` pour être testable sans réseau ni Mongo : les appels HTTP
restent côté serveur, seules les **décisions** (accorder / refuser / réessayer)
vivent ici.

Principe directeur (BUG-062) : un droit Premium ne s'accorde que sur **preuve
positive**. Une vérification qui n'aboutit pas — panne réseau, credentials
cassés, Google indisponible — n'est PAS un achat valide : elle laisse
l'utilisateur en attente, jamais en Premium. L'ancienne implémentation
confondait ces trois cas dans un unique `None` et accordait 30 jours de Premium
à chacun, y compris sur un HTTP 400 en production.
"""

from __future__ import annotations

from enum import Enum


class VerificationOutcome(str, Enum):
    """Résultat d'une vérification d'achat auprès de Google Play."""

    VERIFIED = "verified"
    """Google a répondu : la réponse fait foi (reste à valider `paymentState`)."""

    INVALID = "invalid"
    """Google a tranché négativement (jeton inconnu, révoqué, mal formé).
    Aucun droit, et inutile de réessayer : la réponse ne changera pas."""

    UNAVAILABLE = "unavailable"
    """Indisponibilité temporaire (réseau, 5xx, quota, credentials illisibles).
    Aucun droit accordé, mais l'achat peut être revérifié plus tard."""

    NOT_CONFIGURED = "not_configured"
    """`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` absent — environnement de
    développement. Traité comme UNAVAILABLE en production (cf.
    `may_grant_without_verification`)."""


def classify_verification_status(status_code: int) -> VerificationOutcome:
    """Classe une réponse HTTP de l'API Android Publisher.

    - 200 : réponse exploitable.
    - 400/404/410 : Google a tranché — jeton invalide, inconnu ou déjà consommé.
      Réessayer ne changera rien, donc refus définitif.
    - tout le reste (401/403 credentials, 429 quota, 5xx, timeouts) : notre
      côté ou celui de Google est en cause, l'achat de l'utilisateur peut être
      parfaitement valide — on ne le pénalise pas, on réessaiera.
    """
    if status_code == 200:
        return VerificationOutcome.VERIFIED
    if status_code in (400, 404, 410):
        return VerificationOutcome.INVALID
    return VerificationOutcome.UNAVAILABLE


def may_grant_without_verification(*, is_test_environment: bool, allow_unverified: bool) -> bool:
    """Accorder Premium sans preuve n'est acceptable qu'en test/dev explicite.

    `allow_unverified` correspond à `ALLOW_UNVERIFIED_PURCHASES=true` : un
    interrupteur volontaire, absent par défaut, pour développer sans compte de
    service Google. En production les deux valent False, donc l'absence de
    configuration bloque l'attribution au lieu de l'offrir."""
    return bool(is_test_environment or allow_unverified)


# ---------------------------------------------------------------------------
# Real-Time Developer Notifications (RTDN)
# ---------------------------------------------------------------------------
# Numéros officiels de `subscriptionNotification.notificationType`
# (https://developer.android.com/google/play/billing/rtdn-reference).
# Les commentaires précédents dans server.py étaient faux : ils annonçaient
# « 1=PURCHASED, 4=PURCHASED_WITH_DEFERRED, 12=EXPIRED, 13=ON_HOLD » alors que
# 1=RECOVERED, 4=PURCHASED, 12=REVOKED, 13=EXPIRED et 5=ON_HOLD.

NOTIFICATION_RECOVERED = 1
NOTIFICATION_RENEWED = 2
NOTIFICATION_CANCELED = 3
NOTIFICATION_PURCHASED = 4
NOTIFICATION_ON_HOLD = 5
NOTIFICATION_IN_GRACE_PERIOD = 6
NOTIFICATION_RESTARTED = 7
NOTIFICATION_PRICE_CHANGE_CONFIRMED = 8
NOTIFICATION_DEFERRED = 9
NOTIFICATION_PAUSED = 10
NOTIFICATION_PAUSE_SCHEDULE_CHANGED = 11
NOTIFICATION_REVOKED = 12
NOTIFICATION_EXPIRED = 13


class SubscriptionAction(str, Enum):
    """Effet d'une notification sur les droits de l'utilisateur."""

    ACTIVATE = "activate"
    """Abonnement en cours : (re)vérifier auprès de Google et poser l'échéance."""

    KEEP_UNTIL_EXPIRY = "keep_until_expiry"
    """Résiliation demandée : le renouvellement automatique est coupé, mais la
    période **déjà payée** reste due. Couper immédiatement priverait
    l'utilisateur de jours qu'il a payés."""

    DEACTIVATE = "deactivate"
    """Plus d'accès : expiration, remboursement, mise en attente ou pause."""

    IGNORE = "ignore"
    """Notification informative, sans effet sur les droits."""


_ACTION_BY_NOTIFICATION: dict[int, SubscriptionAction] = {
    # Accès actif — l'utilisateur paie (ou est en période d'essai).
    NOTIFICATION_RECOVERED: SubscriptionAction.ACTIVATE,
    NOTIFICATION_RENEWED: SubscriptionAction.ACTIVATE,
    NOTIFICATION_PURCHASED: SubscriptionAction.ACTIVATE,
    NOTIFICATION_RESTARTED: SubscriptionAction.ACTIVATE,
    NOTIFICATION_DEFERRED: SubscriptionAction.ACTIVATE,
    # Le paiement a échoué mais Google réessaie : l'utilisateur GARDE l'accès
    # pendant la période de grâce. L'ancienne implémentation le coupait ici.
    NOTIFICATION_IN_GRACE_PERIOD: SubscriptionAction.ACTIVATE,
    # Résiliation : droits conservés jusqu'à l'échéance déjà payée.
    NOTIFICATION_CANCELED: SubscriptionAction.KEEP_UNTIL_EXPIRY,
    # Perte d'accès immédiate.
    NOTIFICATION_ON_HOLD: SubscriptionAction.DEACTIVATE,
    NOTIFICATION_PAUSED: SubscriptionAction.DEACTIVATE,
    NOTIFICATION_REVOKED: SubscriptionAction.DEACTIVATE,
    NOTIFICATION_EXPIRED: SubscriptionAction.DEACTIVATE,
    # Sans effet sur les droits.
    NOTIFICATION_PRICE_CHANGE_CONFIRMED: SubscriptionAction.IGNORE,
    NOTIFICATION_PAUSE_SCHEDULE_CHANGED: SubscriptionAction.IGNORE,
}


def action_for_notification(notification_type: object) -> SubscriptionAction:
    """Traduit un `notificationType` RTDN en effet sur les droits.

    Un type inconnu (nouveau numéro introduit par Google, valeur absente ou non
    numérique) est ignoré plutôt que traité comme une désactivation : mieux vaut
    laisser les droits en l'état et le voir dans les logs que couper l'accès
    d'un abonné sur un message qu'on ne sait pas lire."""
    try:
        key = int(notification_type)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return SubscriptionAction.IGNORE
    return _ACTION_BY_NOTIFICATION.get(key, SubscriptionAction.IGNORE)


def is_payment_received(payment_state: object) -> bool:
    """`paymentState` : 0=en attente, 1=reçu, 2=essai gratuit, absent=différé.

    Seuls 1 et 2 donnent droit à l'accès."""
    return payment_state in (1, 2)
