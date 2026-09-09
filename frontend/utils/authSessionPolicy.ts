/**
 * Décisions de session côté client — logique pure (BUG-070).
 *
 * `authStore.ts` importe SecureStore et d'autres modules Expo : il n'est pas
 * chargeable dans les tests Node de ce dépôt. Ses quatre « tests » existants
 * se réduisaient donc à `assert.ok(true)` — ils ne démontraient rien, tout en
 * donnant l'apparence d'une couverture. Les décisions qu'ils prétendaient
 * couvrir vivent désormais ici, où elles sont réellement vérifiables.
 */

/** Suite à donner à une tentative de rafraîchissement (droits ou quotas). */
export type RefreshDecision =
  | 'skip-no-token' // pas de session : ne rien demander au serveur
  | 'logout' // le serveur a répondu 401 : la session n'est plus valable
  | 'apply' // réponse exploitable
  | 'report-error'; // échec transitoire : journaliser, sans déconnecter

export function decideRefreshOutcome(params: {
  hasToken: boolean;
  status?: number | null;
  ok?: boolean;
}): RefreshDecision {
  if (!params.hasToken) return 'skip-no-token';
  if (params.status === 401) return 'logout';
  if (params.ok === true) return 'apply';
  return 'report-error';
}

/**
 * Un échec d'enregistrement biométrique doit-il faire échouer la connexion ?
 *
 * Non : à ce stade le jeton est déjà obtenu et stocké. Refuser la connexion
 * parce que l'utilisateur a annulé (ou que le capteur a échoué) le priverait
 * d'un accès auquel il a droit. Seul l'état « biométrie disponible » change.
 */
export function shouldAbortLoginOnBiometricFailure(_error: unknown): boolean {
  return false;
}

/**
 * Après un échec d'enregistrement biométrique, l'app doit-elle considérer que
 * des identifiants biométriques sont disponibles ?
 *
 * Une annulation volontaire laisse l'état inchangé (l'utilisateur pourra
 * réessayer plus tard) ; une vraie erreur d'écriture signifie qu'aucun
 * identifiant n'a été enregistré.
 */
export function biometricCredentialsAfterFailure(params: {
  wasCancellation: boolean;
  hadCredentialsBefore: boolean;
}): boolean {
  return params.wasCancellation ? params.hadCredentialsBefore : false;
}
