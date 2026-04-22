import test from 'node:test';
import assert from 'node:assert/strict';
import type { StockItem } from '../store/stockStore';

import { undoRemovalCore } from './undoRemovalCore';

// Régression : undoRemovedStockItems (via undoRemovalCore) doit transmettre l'item
// COMPLET à restoreItem — pas seulement son id.
//
// Avant le correctif :
//   restoreItem(item.id)           ← restoredItem absent
//   → fetchStock() appelé côté store
//   → race condition avec markConsumed du prochain swipe
//   → bouton "Annuler" absent après la 2e suppression.
//
// Après le correctif :
//   restoreItem(item.id, item)     ← item complet transmis
//   → insertion directe dans le store (buildRestoredItemsList)
//   → plus de fetchStock(), plus de race condition.

const makeStockItem = (id: string): StockItem => ({
  id,
  name: `Produit ${id}`,
  added_date: '2026-01-01T00:00:00.000Z',
  status: 'active',
});

test('régression: undoRemovalCore transmet l\'item complet à restoreItemFn (pas seulement l\'id)', async () => {
  const item = makeStockItem('xyz');
  const calls: Array<{ id: string; restoredItem: StockItem }> = [];

  await undoRemovalCore([item], async (id, restoredItem) => {
    calls.push({ id, restoredItem });
    return true;
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'xyz');
  assert.deepEqual(calls[0].restoredItem, item);
});

test('undoRemovalCore incrémente restoredCount quand restoreItemFn réussit', async () => {
  const items = [makeStockItem('a'), makeStockItem('b')];
  const result = await undoRemovalCore(items, async () => true);

  assert.equal(result.restoredCount, 2);
  assert.equal(result.failedCount, 0);
});

test('undoRemovalCore incrémente failedCount quand restoreItemFn échoue', async () => {
  const items = [makeStockItem('a'), makeStockItem('b')];
  const result = await undoRemovalCore(items, async () => false);

  assert.equal(result.restoredCount, 0);
  assert.equal(result.failedCount, 2);
});

test('undoRemovalCore comptabilise correctement les succès et échecs mixtes', async () => {
  const items = [makeStockItem('a'), makeStockItem('b'), makeStockItem('c')];
  let callIndex = 0;

  const result = await undoRemovalCore(items, async () => {
    callIndex++;
    return callIndex !== 2; // b échoue
  });

  assert.equal(result.restoredCount, 2);
  assert.equal(result.failedCount, 1);
});

test('undoRemovalCore: tableau vide → restoredCount=0, failedCount=0', async () => {
  const result = await undoRemovalCore([], async () => true);

  assert.equal(result.restoredCount, 0);
  assert.equal(result.failedCount, 0);
});
