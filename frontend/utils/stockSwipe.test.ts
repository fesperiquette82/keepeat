import test from 'node:test';
import assert from 'node:assert/strict';
import type { StockItem } from '../store/stockStore';
import { resolveStockRemovalBanner, resolveSwipeAction, resolveSwipeActionFromOpenSide } from './stockSwipe';

const removedItem: StockItem = {
  id: '1',
  name: 'Test',
  quantity: '1',
  expiry_date: new Date().toISOString(),
  added_date: new Date().toISOString(),
  status: 'active',
};

test('resolveSwipeAction mappe correctement la direction de swipe gauche vers used', () => {
  assert.equal(resolveSwipeAction('left'), 'used');
});

test('resolveSwipeAction mappe correctement la direction de swipe droite vers thrown', () => {
  assert.equal(resolveSwipeAction('right'), 'thrown');
});

test('resolveSwipeActionFromOpenSide mappe correctement l\'ouverture gauche vers used', () => {
  assert.equal(resolveSwipeActionFromOpenSide('left'), 'used');
});

test('resolveSwipeActionFromOpenSide mappe correctement l\'ouverture droite vers thrown', () => {
  assert.equal(resolveSwipeActionFromOpenSide('right'), 'thrown');
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

// Régression : race condition fetchStock dans markConsumed/markThrown.
// Avant le correctif, fetchStock() appelé après chaque consume/throw pouvait
// recevoir une réponse serveur AVANT que le POST d'un autre item concurrent soit
// terminé — le store était alors réécrit avec cet item encore actif (stillActive=true),
// ce qui donnait failedCount>0 et supprimait le bouton "Annuler".
// Le correctif : fetchStock() n'est plus appelé dans markConsumed/markThrown.
test('resolveStockRemovalBanner désactive l\'annulation quand failedCount > 0 (race condition)', () => {
  const banner = resolveStockRemovalBanner('used', {
    removedItems: [],
    notFoundCount: 0,
    failedCount: 1,
  });

  assert.deepEqual(banner, {
    message: "Impossible de retirer l'article pour le moment.",
    canUndo: false,
    variant: 'error',
  });
});
