import type { StockRemovalResult } from './stockRemoval';

export type SwipeDirection = 'left' | 'right';
export type StockRemovalAction = 'used' | 'thrown';

export interface StockRemovalBannerState {
  message: string;
  canUndo: boolean;
  variant: 'success' | 'error';
}

export function resolveSwipeAction(direction: SwipeDirection): StockRemovalAction {
  return direction === 'right' ? 'used' : 'thrown';
}

export function resolveStockRemovalBanner(action: StockRemovalAction, result: StockRemovalResult): StockRemovalBannerState {
  if (result.removedItems.length > 0) {
    return {
      message: action === 'used' ? 'Article retiré du stock (utilisé).' : 'Article retiré du stock (jeté).',
      canUndo: true,
      variant: 'success',
    };
  }

  return {
    message: "Impossible de retirer l'article pour le moment.",
    canUndo: false,
    variant: 'error',
  };
}
