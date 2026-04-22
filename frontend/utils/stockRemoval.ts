import { useStockStore, type StockItem } from '../store/stockStore';
import { undoRemovalCore } from './undoRemovalCore';

type StockRemovalAction = 'used' | 'thrown';

export interface StockRemovalResult {
  removedItems: StockItem[];
  notFoundCount: number;
  failedCount: number;
}

export async function removeStockItems(itemIds: string[], action: StockRemovalAction): Promise<StockRemovalResult> {
  const uniqueIds = [...new Set(itemIds)];
  let notFoundCount = 0;
  let failedCount = 0;
  const removedItems: StockItem[] = [];

  for (const itemId of uniqueIds) {
    const item = useStockStore.getState().items.find((entry) => entry.id === itemId);
    if (!item) {
      notFoundCount += 1;
      continue;
    }

    if (action === 'used') {
      await useStockStore.getState().markConsumed(itemId);
    } else {
      await useStockStore.getState().markThrown(itemId);
    }

    const stillActive = useStockStore.getState().items.some((entry) => entry.id === itemId);
    if (stillActive) {
      failedCount += 1;
      continue;
    }

    removedItems.push(item);
  }

  return { removedItems, notFoundCount, failedCount };
}

export async function undoRemovedStockItems(items: StockItem[]): Promise<{ restoredCount: number; failedCount: number }> {
  return undoRemovalCore(items, (id, item) => useStockStore.getState().restoreItem(id, item));
}
