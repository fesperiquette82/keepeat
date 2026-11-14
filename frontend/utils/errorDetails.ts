/**
 * Lecture typée d'une erreur interceptée.
 *
 * En TypeScript strict, la valeur d'un `catch` est `unknown` : elle peut être
 * une `Error`, une erreur axios (`response.status`, `response.data.detail`), une
 * chaîne, ou n'importe quoi d'autre. L'ancienne pratique `catch (e: any)` puis
 * `e.message` désactivait toute vérification — un `throw 'texte'` ou un
 * `throw null` produisait `undefined` sans que rien ne le signale. Ces helpers
 * centralisent la lecture et ne lèvent jamais.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Message lisible de l'erreur, ou `undefined` si elle n'en porte pas. */
export function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return record && typeof record.message === 'string' ? record.message : undefined;
}

function getResponse(error: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(error)?.response);
}

/** Statut HTTP d'une erreur de requête (axios), ou `null`. */
export function getHttpStatus(error: unknown): number | null {
  const status = getResponse(error)?.status;
  return typeof status === 'number' ? status : null;
}

/** Champ `detail` texte renvoyé par l'API (FastAPI), ou `undefined`. */
export function getApiErrorDetail(error: unknown): string | undefined {
  const detail = asRecord(getResponse(error)?.data)?.detail;
  return typeof detail === 'string' ? detail : undefined;
}

/** Corps brut de la réponse d'erreur (à journaliser tel quel), ou `null`. */
export function getHttpResponseData(error: unknown): unknown {
  return getResponse(error)?.data ?? null;
}
