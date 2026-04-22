import type { StockItem } from '../store/stockStore';

/**
 * Noyau testable de undoRemovedStockItems.
 * Accepte restoreItemFn en injection de dépendance pour permettre le test unitaire
 * sans dépendances React Native (zustand, AsyncStorage, etc.).
 *
 * Régression visée : undoRemovedStockItems doit transmettre l'item complet (pas
 * seulement son id) à restoreItem, afin que l'insertion directe soit possible et
 * que fetchStock() ne soit plus appelé (suppression de la race condition).
 */
export async function undoRemovalCore(
  items: StockItem[],
  restoreItemFn: (id: string, item: StockItem) => Promise<boolean>,
): Promise<{ restoredCount: number; failedCount: number }> {
  let restoredCount = 0;
  let failedCount = 0;

  for (const item of items) {
    const restored = await restoreItemFn(item.id, item);
    if (restored) {
      restoredCount += 1;
    } else {
      failedCount += 1;
    }
  }

  return { restoredCount, failedCount };
}
