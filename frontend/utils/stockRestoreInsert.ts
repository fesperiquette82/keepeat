/**
 * Construit la nouvelle liste d'items après une restauration.
 *
 * Régression visée : race condition lors de la suppression de 2 items consécutifs.
 * Avant le correctif, restoreItem() appelait fetchStock() → un GET concurrent
 * pouvait ramener un item déjà consommé dans le store → failedCount++ → pas de
 * bouton "Annuler".
 * Correctif : insertion directe de l'item restauré, sans appel réseau.
 *
 * Garanties :
 *  - L'item restauré est toujours en tête de liste
 *  - Aucun doublon (dédupliqué par id si l'item existait déjà)
 *  - Les autres items conservent leur ordre
 */
export function buildRestoredItemsList<T extends { id: string }>(items: T[], restoredItem: T): T[] {
  return [restoredItem, ...items.filter(i => i.id !== restoredItem.id)];
}
