import type { StockItem } from '../store/stockStore';

interface PendingUpdateMutation {
  id: string;
  type: 'UPDATE';
  payload: { itemId: string; updates: Partial<StockItem> };
  timestamp: number;
  ownerId?: string | null;
}

interface OfflineUpdateState {
  items: StockItem[];
  pendingMutations: PendingUpdateMutation[];
}

/**
 * Calcule le nouvel état du store quand updateItem ne peut pas joindre le serveur
 * (mode hors-ligne ou erreur réseau dans le catch).
 * Fonction pure : testable sans dépendance à axios ou zustand.
 */
export function buildUpdateItemOfflineState(
  items: StockItem[],
  pendingMutations: PendingUpdateMutation[],
  itemId: string,
  updates: Partial<StockItem>,
  mutationId: string,
  timestamp: number,
  /**
   * Compte propriétaire de l'action (BUG-064) — une modification préparée hors
   * ligne par A ne doit jamais partir avec le jeton de B.
   */
  ownerId: string | null = null,
): OfflineUpdateState {
  return {
    items: items.map(i => (i.id === itemId ? { ...i, ...updates } : i)),
    pendingMutations: [
      ...pendingMutations,
      { id: mutationId, type: 'UPDATE', payload: { itemId, updates }, timestamp, ownerId },
    ],
  };
}
