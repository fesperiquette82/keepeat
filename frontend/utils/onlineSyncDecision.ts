export type OnlineSyncAction = 'flush' | 'fetch' | 'none';

/**
 * Décide quelle action de synchronisation déclencher quand l'état de connectivité
 * du store change (setOnline).
 *
 * Fonction pure : testable sans zustand, axios ni NetInfo.
 *
 * C4 — Correction de la perte silencieuse des mutations offline au redémarrage.
 * Avant, le flush n'était déclenché QUE sur une transition offline→online
 * (`wasOffline === true`). Au démarrage de l'app, `isOnline` vaut déjà `true`
 * donc `wasOffline` est `false` → les mutations persistées (ajouts/consommations
 * faites hors-ligne) n'étaient jamais rejouées tant que le réseau ne retombait
 * pas puis ne remontait pas.
 *
 * Règle corrigée : dès qu'on est en ligne ET qu'il reste des mutations en attente,
 * on flushe — y compris au démarrage, sans transition. Le `fetch` de rafraîchissement
 * reste réservé à une vraie transition offline→online sans mutation en attente, pour
 * éviter de spammer le serveur sur les multiples events émis par NetInfo.
 */
export function resolveOnlineSyncAction(params: {
  online: boolean;
  wasOffline: boolean;
  pendingMutationCount: number;
}): OnlineSyncAction {
  const { online, wasOffline, pendingMutationCount } = params;
  if (!online) return 'none';
  if (pendingMutationCount > 0) return 'flush';
  if (wasOffline) return 'fetch';
  return 'none';
}
