import { buildRestoredItemsList } from './stockRestoreInsert';

export type MarkAction = 'consume' | 'throw';

export interface RollbackStats {
  total_items: number;
  consumed_this_week: number;
  thrown_this_week: number;
}

/**
 * Calcule l'état après rollback CIBLÉ d'un markConsumed / markThrown ayant échoué
 * côté API (E4).
 *
 * Le bug d'origine : le rollback faisait `set({ items, priorityItems, stats })` avec
 * les snapshots capturés au DÉBUT de l'opération. Si un swipe concurrent avait retiré
 * un autre item entre-temps, ce `set` réécrivait la liste entière avec une version
 * périmée → l'item supprimé par l'autre opération réapparaissait (régression de la
 * classe BUG-034).
 *
 * Correctif : on ne réinsère QUE l'item concerné dans l'état COURANT (jamais le
 * snapshot complet), et on inverse précisément les deltas de stats appliqués par
 * l'update optimiste. Fonction pure : testable sans zustand ni axios.
 */
export function buildMarkActionRollback<T extends { id: string }, S extends RollbackStats>(params: {
  currentItems: T[];
  currentPriorityItems: T[];
  currentStats: S;
  rolledBackItem: T | undefined;
  wasPriority: boolean;
  action: MarkAction;
}): { items: T[]; priorityItems: T[]; stats: S } {
  const { currentItems, currentPriorityItems, currentStats, rolledBackItem, wasPriority, action } = params;

  // Item introuvable dans le snapshot (déjà retiré par une opération concurrente) :
  // ne rien ressusciter, laisser l'état courant intact.
  if (!rolledBackItem) {
    return { items: currentItems, priorityItems: currentPriorityItems, stats: currentStats };
  }

  const items = currentItems.some(i => i.id === rolledBackItem.id)
    ? currentItems
    : buildRestoredItemsList(currentItems, rolledBackItem);

  const priorityItems = wasPriority && !currentPriorityItems.some(i => i.id === rolledBackItem.id)
    ? buildRestoredItemsList(currentPriorityItems, rolledBackItem)
    : currentPriorityItems;

  const stats: S = {
    ...currentStats,
    total_items: currentStats.total_items + 1,
    ...(action === 'consume'
      ? { consumed_this_week: Math.max(0, currentStats.consumed_this_week - 1) }
      : { thrown_this_week: Math.max(0, currentStats.thrown_this_week - 1) }),
  };

  return { items, priorityItems, stats };
}
