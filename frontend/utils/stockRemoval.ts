import { useStockStore, type StockItem } from '../store/stockStore';
import { undoRemovalCore } from './undoRemovalCore';
import { debugSwipeLogger } from './debugSwipeLogger';

type StockRemovalAction = 'used' | 'thrown';

export interface StockRemovalResult {
  removedItems: StockItem[];
  notFoundCount: number;
  failedCount: number;
}

export async function removeStockItems(itemIds: string[], action: StockRemovalAction): Promise<StockRemovalResult> {
  const uniqueIds = [...new Set(itemIds)];
  debugSwipeLogger.info('removeStockItems', `Starting removal`, {
    itemIds,
    uniqueIds,
    action,
    currentStoreItemsCount: useStockStore.getState().items.length,
  });

  let notFoundCount = 0;
  let failedCount = 0;
  const removedItems: StockItem[] = [];

  for (const itemId of uniqueIds) {
    const storeState = useStockStore.getState();
    const item = storeState.items.find((entry) => entry.id === itemId);

    debugSwipeLogger.info('removeStockItems', `Processing item`, {
      itemId,
      itemFound: !!item,
      itemName: item?.name,
      storeItemsCount: storeState.items.length,
    });

    if (!item) {
      notFoundCount += 1;
      debugSwipeLogger.warn('removeStockItems', `Item not found in store`, { itemId, notFoundCount });
      continue;
    }

    if (action === 'used') {
      debugSwipeLogger.info('removeStockItems', `Calling markConsumed`, { itemId });
      await useStockStore.getState().markConsumed(itemId);
    } else {
      debugSwipeLogger.info('removeStockItems', `Calling markThrown`, { itemId });
      await useStockStore.getState().markThrown(itemId);
    }

    const stillActive = useStockStore.getState().items.some((entry) => entry.id === itemId);
    debugSwipeLogger.info('removeStockItems', `After mark operation`, {
      itemId,
      stillActive,
      storeItemsCount: useStockStore.getState().items.length,
    });

    if (stillActive) {
      failedCount += 1;
      debugSwipeLogger.error('removeStockItems', `Item still active after mark operation`, {
        itemId,
        failedCount,
      });
      continue;
    }

    removedItems.push(item);
    debugSwipeLogger.info('removeStockItems', `Item successfully marked for removal`, {
      itemId,
      removedItemsCount: removedItems.length,
    });
  }

  debugSwipeLogger.info('removeStockItems', `Removal complete`, {
    itemIds,
    removedItemsCount: removedItems.length,
    notFoundCount,
    failedCount,
  });

  return { removedItems, notFoundCount, failedCount };
}

export async function undoRemovedStockItems(items: StockItem[]): Promise<{ restoredCount: number; failedCount: number }> {
  return undoRemovalCore(items, (id, item) => useStockStore.getState().restoreItem(id, item));
}
