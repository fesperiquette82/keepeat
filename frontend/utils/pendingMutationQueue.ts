/**
 * File des mutations hors ligne — logique pure (BUG-065).
 *
 * Extraite de `stockStore.ts` pour être testable sans réseau ni AsyncStorage.
 * Elle corrige quatre défauts reproduits par la revue externe du 08/09/2026 :
 *
 * 1. **Une erreur temporaire supprimait l'action.** `isNetworkError` n'était vrai
 *    que sans réponse HTTP : un 503, un 500 ou un 401 (session pas encore
 *    chargée) tombaient donc dans la branche « mutation invalide, la
 *    supprimer ». L'ajout de l'utilisateur disparaissait sans un mot.
 * 2. **Les actions ajoutées pendant une synchronisation étaient perdues.** Le
 *    flush figeait un instantané de la file au départ puis réécrivait la file
 *    entière avec, écrasant tout ce qui était arrivé entre-temps.
 * 3. **Les identifiants temporaires n'étaient jamais remplacés.** Un ADD hors
 *    ligne suivi d'un UPDATE partait vers `/api/stock/temp_xxx` → 404 → action
 *    supprimée : la modification était perdue alors que l'ajout avait réussi.
 * 4. **Un refus définitif disparaissait silencieusement.** L'utilisateur n'avait
 *    aucun moyen de savoir qu'une action n'était pas passée.
 */

export type MutationType = 'ADD' | 'CONSUME' | 'THROW' | 'UPDATE';

export interface PendingMutation {
  id: string;
  type: MutationType;
  payload: any;
  /** ID local temporaire attribué à un ADD hors ligne. */
  tempId?: string;
  timestamp: number;
  /**
   * Compte KeepEat qui a créé l'action. Une action préparée par A ne doit
   * jamais être envoyée avec le jeton de B (BUG-064).
   */
  ownerId?: string | null;
  /** Nombre de tentatives déjà effectuées, pour diagnostic. */
  attempts?: number;
}

export interface FailedMutation extends PendingMutation {
  failedAt: number;
  reason: string;
  status: number | null;
}

/** Suite à donner à un échec d'envoi. */
export type FailureHandling =
  | 'retry-later' // réseau ou serveur indisponible : on garde et on réessaiera
  | 'wait-for-auth' // session absente/expirée : on garde, surtout pas de perte
  | 'give-up'; // le serveur a définitivement refusé : on sort de la file d'attente

type HttpErrorLike = {
  response?: { status?: number };
  code?: string;
  message?: string;
};

export function httpStatusOf(error: unknown): number | null {
  const status = (error as HttpErrorLike)?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * Décide du sort d'une mutation dont l'envoi a échoué.
 *
 * Règle : on n'abandonne QUE sur un refus que le serveur redonnera à
 * l'identique (400 requête malformée, 404 ressource disparue, 409 conflit,
 * 410, 422). Tout le reste — absence de réponse, 401/403, 408, 429, 5xx — est
 * réessayable et ne doit jamais faire disparaître le travail de l'utilisateur.
 */
export function classifyMutationFailure(error: unknown): FailureHandling {
  const status = httpStatusOf(error);
  if (status === null) return 'retry-later'; // pas de réponse : réseau
  if (status === 401 || status === 403) return 'wait-for-auth';
  if (status >= 500 || status === 408 || status === 429) return 'retry-later';
  if (status === 400 || status === 404 || status === 409 || status === 410 || status === 422) {
    return 'give-up';
  }
  // Statut inattendu : on préfère garder l'action que la perdre.
  return 'retry-later';
}

export function describeFailure(error: unknown): string {
  const status = httpStatusOf(error);
  if (status === null) return 'Réseau indisponible';
  if (status === 401 || status === 403) return 'Session expirée';
  if (status >= 500) return `Serveur indisponible (${status})`;
  return `Refusé par le serveur (${status})`;
}

/**
 * Remplace un identifiant temporaire par l'identifiant réel dans toutes les
 * mutations encore en file. Sans cela, un UPDATE/CONSUME/THROW enregistré hors
 * ligne juste après un ADD ciblait un `temp_…` inexistant côté serveur.
 */
export function remapTempId(
  queue: PendingMutation[],
  tempId: string,
  realId: string,
): PendingMutation[] {
  if (!tempId || !realId || tempId === realId) return queue;
  return queue.map((mutation) => {
    const payload = mutation.payload;
    if (!payload || typeof payload !== 'object') return mutation;
    if (payload.itemId !== tempId) return mutation;
    return { ...mutation, payload: { ...payload, itemId: realId } };
  });
}

/** Retire une mutation de la file en travaillant sur la file COURANTE. */
export function removeMutation(queue: PendingMutation[], mutationId: string): PendingMutation[] {
  return queue.filter((mutation) => mutation.id !== mutationId);
}

/** Incrémente le compteur de tentatives d'une mutation conservée. */
export function markAttempted(queue: PendingMutation[], mutationId: string): PendingMutation[] {
  return queue.map((mutation) =>
    mutation.id === mutationId
      ? { ...mutation, attempts: (mutation.attempts ?? 0) + 1 }
      : mutation,
  );
}

export function toFailedMutation(
  mutation: PendingMutation,
  error: unknown,
  now: number,
): FailedMutation {
  return {
    ...mutation,
    failedAt: now,
    reason: describeFailure(error),
    status: httpStatusOf(error),
  };
}

/**
 * Mutations envoyables maintenant : celles du compte connecté. Les autres
 * restent en file jusqu'à ce que leur propriétaire se reconnecte, au lieu de
 * partir avec le jeton de quelqu'un d'autre (BUG-064).
 */
export function mutationsSendableBy(
  queue: PendingMutation[],
  currentUserId: string | null,
): PendingMutation[] {
  if (!currentUserId) return [];
  return queue.filter(
    (mutation) => mutation.ownerId == null || mutation.ownerId === currentUserId,
  );
}

/** État de synchronisation affichable pour un article. */
export type ItemSyncState = 'synced' | 'pending' | 'failed';

export function syncStateForItem(
  itemId: string,
  queue: PendingMutation[],
  failed: FailedMutation[],
): ItemSyncState {
  const matches = (mutation: PendingMutation) =>
    mutation.tempId === itemId || mutation.payload?.itemId === itemId;
  if (failed.some(matches)) return 'failed';
  if (queue.some(matches)) return 'pending';
  return 'synced';
}
