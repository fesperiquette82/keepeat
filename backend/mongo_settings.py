"""Réglages du client MongoDB lus depuis l'environnement.

BUG-075 : sans MongoDB joignable (suite de tests locale, CI sans service
`mongo`), chaque opération attendait le délai de sélection de serveur par
défaut du pilote — 30 secondes — avant que l'appelant n'avale l'erreur. La
suite backend complète passait ainsi de 2 à 58 minutes en CI sans qu'aucun
test n'échoue. Le délai devient réglable pour que les environnements de test
échouent vite ; la production garde le défaut du pilote.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

SERVER_SELECTION_TIMEOUT_ENV = "MONGO_SERVER_SELECTION_TIMEOUT_MS"

# Bornes de sécurité : en dessous de 100 ms un cluster sain peut être déclaré
# injoignable ; au-delà de deux minutes le réglage n'a plus de sens.
MIN_SERVER_SELECTION_TIMEOUT_MS = 100
MAX_SERVER_SELECTION_TIMEOUT_MS = 120_000


def server_selection_timeout_ms(raw: str | None) -> int | None:
    """Convertit la valeur brute de l'environnement en délai exploitable.

    Retourne ``None`` (= défaut du pilote, 30 s) quand la variable est absente,
    vide ou illisible : un réglage cassé ne doit jamais empêcher le serveur de
    démarrer. Une valeur lisible est bornée dans [100 ms ; 120 s].
    """
    if raw is None:
        return None
    candidate = raw.strip()
    if not candidate:
        return None
    try:
        value = int(candidate)
    except ValueError:
        return None
    return max(MIN_SERVER_SELECTION_TIMEOUT_MS, min(MAX_SERVER_SELECTION_TIMEOUT_MS, value))


def mongo_client_kwargs(environ: Mapping[str, str]) -> dict[str, Any]:
    """Arguments nommés à passer au client Motor, dérivés de l'environnement.

    Ne contient que les réglages explicitement fournis : passer ``None`` au
    pilote ne vaut pas « défaut » pour tous les paramètres, on préfère donc
    omettre la clé.
    """
    kwargs: dict[str, Any] = {}
    timeout = server_selection_timeout_ms(environ.get(SERVER_SELECTION_TIMEOUT_ENV))
    if timeout is not None:
        kwargs["serverSelectionTimeoutMS"] = timeout
    return kwargs
