import test from 'node:test';
import assert from 'node:assert/strict';
import type { StockItem } from '../store/stockStore';
import { resolveStockRemovalBanner, resolveSwipeAction } from './stockSwipe';

const removedItem: StockItem = {
  id: '1',
  name: 'Test',
  quantity: '1',
  expiry_date: new Date().toISOString(),
  added_date: new Date().toISOString(),
  status: 'active',
};

test('resolveSwipeAction mappe correctement le swipe gauche vers thrown', () => {
  assert.equal(resolveSwipeAction('left'), 'thrown');
});

test('resolveSwipeAction mappe correctement le swipe droit vers used', () => {
  assert.equal(resolveSwipeAction('right'), 'used');
});

test('resolveStockRemovalBanner garde l\'annulation quand la suppression a réussi', () => {
  const banner = resolveStockRemovalBanner('used', {
    removedItems: [removedItem],
    notFoundCount: 0,
    failedCount: 0,
  });

  assert.deepEqual(banner, {
    message: 'Article retiré du stock (utilisé).',
    canUndo: true,
    variant: 'success',
  });
});

test('resolveStockRemovalBanner désactive l\'annulation quand la suppression a échoué', () => {
  const banner = resolveStockRemovalBanner('thrown', {
    removedItems: [],
    notFoundCount: 1,
    failedCount: 0,
  });

  assert.deepEqual(banner, {
    message: "Impossible de retirer l'article pour le moment.",
    canUndo: false,
    variant: 'error',
  });
});
