/**
 * Point de rendez-vous entre l'authentification et les stores de données
 * (BUG-064).
 *
 * `authStore` doit prévenir les autres stores qu'on a changé de compte (login,
 * logout, restauration de session), mais `stockStore` importe déjà `authStore` :
 * un import direct dans l'autre sens créerait un cycle. Chaque store s'abonne
 * donc ici, et `authStore` se contente de notifier.
 *
 * Sans ce mécanisme, la déconnexion laissait le stock et les actions en attente
 * du compte précédent en mémoire et dans AsyncStorage : le compte suivant
 * voyait les articles de son prédécesseur, et ses actions non synchronisées
 * partaient avec le mauvais jeton.
 */

export type AccountChangeListener = (userId: string | null) => void;

const listeners = new Set<AccountChangeListener>();

export function onAccountChanged(listener: AccountChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAccountChanged(userId: string | null): void {
  listeners.forEach((listener) => {
    try {
      listener(userId);
    } catch {
      // Un abonné défaillant ne doit jamais empêcher la déconnexion.
    }
  });
}

/** Utilitaire de test : repartir d'un registre vide. */
export function resetAccountChangeListeners(): void {
  listeners.clear();
}
