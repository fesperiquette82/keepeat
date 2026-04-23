/**
 * Tests de non-régression — BUG-023 : mutation updateItem perdue sur erreur réseau.
 *
 * Vérifie que buildUpdateItemOfflineState produit le bon état (mise à jour optimiste
 * + mutation en queue) que ce soit en mode hors-ligne ou en catch réseau.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { StockItem } from '../store/stockStore';
import { buildUpdateItemOfflineState } from './stockUpdateOffline';

const item1: StockItem = {
  id: 'item-1',
  name: 'Lait',
  quantity: '1L',
  expiry_date: '2026-05-01',
  added_date: '2026-04-01',
  status: 'active',
};

const item2: StockItem = {
  id: 'item-2',
  name: 'Beurre',
  quantity: '250g',
  expiry_date: '2026-06-01',
  added_date: '2026-04-01',
  status: 'active',
};

test('BUG-023 : mise à jour optimiste appliquée sur le bon item', () => {
  const result = buildUpdateItemOfflineState(
    [item1, item2],
    [],
    'item-1',
    { quantity: '2L' },
    'mut-1',
    1000,
  );
  const updated = result.items.find(i => i.id === 'item-1');
  assert.equal(updated?.quantity, '2L');
});

test('BUG-023 : les autres items ne sont pas modifiés', () => {
  const result = buildUpdateItemOfflineState(
    [item1, item2],
    [],
    'item-1',
    { quantity: '2L' },
    'mut-1',
    1000,
  );
  const untouched = result.items.find(i => i.id === 'item-2');
  assert.equal(untouched?.quantity, '250g');
});

test('BUG-023 : la mutation UPDATE est ajoutée à pendingMutations', () => {
  const result = buildUpdateItemOfflineState(
    [item1],
    [],
    'item-1',
    { notes: 'bio' },
    'mut-abc',
    9999,
  );
  assert.equal(result.pendingMutations.length, 1);
  const mut = result.pendingMutations[0];
  assert.equal(mut.type, 'UPDATE');
  assert.equal(mut.id, 'mut-abc');
  assert.equal(mut.timestamp, 9999);
  assert.deepEqual(mut.payload, { itemId: 'item-1', updates: { notes: 'bio' } });
});

test('BUG-023 : les mutations existantes sont préservées', () => {
  const existing = [{ id: 'prev', type: 'UPDATE' as const, payload: { itemId: 'x', updates: {} }, timestamp: 1 }];
  const result = buildUpdateItemOfflineState(
    [item1],
    existing,
    'item-1',
    { quantity: '500ml' },
    'new-mut',
    2000,
  );
  assert.equal(result.pendingMutations.length, 2);
  assert.equal(result.pendingMutations[0].id, 'prev');
  assert.equal(result.pendingMutations[1].id, 'new-mut');
});

test('BUG-023 : item inconnu laisse la liste inchangée', () => {
  const result = buildUpdateItemOfflineState(
    [item1],
    [],
    'item-inexistant',
    { quantity: '2L' },
    'mut-x',
    1000,
  );
  assert.equal(result.items[0].quantity, item1.quantity);
});
