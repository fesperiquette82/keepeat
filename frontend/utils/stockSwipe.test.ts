import test from 'node:test';
import assert from 'node:assert/strict';
import type { StockItem } from '../store/stockStore';
import { createSwipeActionQueue, resolveStockRemovalBanner, resolveSwipeAction, resolveSwipeActionFromOpenSide } from './stockSwipe';

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

test('régression: deux ouvertures Swipeable consécutives à gauche restent mappées vers used', () => {
  const sequence = ['left', 'left'] as const;
  const actions = sequence.map((direction) => resolveSwipeAction(direction));

  assert.deepEqual(actions, ['used', 'used']);
});

test('régression: suppressions consécutives gauche puis droite restent correctement mappées', () => {
  const openSides = ['left', 'right'] as const;
  const actions = openSides.map((side) => resolveSwipeActionFromOpenSide(side));

  assert.deepEqual(actions, ['used', 'thrown']);
});

test('createSwipeActionQueue exécute les suppressions en série même si elles arrivent en rafale', async () => {
  const queue = createSwipeActionQueue();
  const executionOrder: string[] = [];

  const first = queue.enqueue(async () => {
    executionOrder.push('start-1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    executionOrder.push('end-1');
    return 'first';
  });

  const second = queue.enqueue(async () => {
    executionOrder.push('start-2');
    executionOrder.push('end-2');
    return 'second';
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult, 'first');
  assert.equal(secondResult, 'second');
  assert.deepEqual(executionOrder, ['start-1', 'end-1', 'start-2', 'end-2']);
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
