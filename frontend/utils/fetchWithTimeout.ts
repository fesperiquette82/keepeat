const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Remplacement du `fetch` global avec un timeout par défaut (15 s).
 *
 * Aucun appel réseau de l'app (axios ou fetch) n'avait de timeout : un backend
 * lent ou indisponible pouvait laisser un écran de chargement indéfiniment,
 * sans qu'aucune erreur ne remonte jamais à l'utilisateur — voir l'écran de
 * détail recette (frontend/app/recipes/[id].tsx) où ce symptôme a été signalé.
 *
 * Si l'appelant fournit déjà un `AbortSignal` (ex: un timeout volontairement
 * plus long comme le warm-up backend au démarrage), il est respecté tel quel
 * plutôt que d'en imposer un second qui le raccourcirait.
 *
 * S'utilise en remplaçant l'import du `fetch` global dans le fichier appelant :
 * `import { fetchWithTimeout as fetch } from '.../fetchWithTimeout';` — tous
 * les appels `fetch(...)` du fichier héritent alors du timeout sans autre
 * changement.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (init?.signal) {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
