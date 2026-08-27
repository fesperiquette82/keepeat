import assert from 'node:assert/strict';
import test from 'node:test';

import { persistProductEdit, toApiExpiryDate } from './productEditFlow';

test("persistProductEdit met à jour le produit puis rafraîchit le stock", async () => {
  const callOrder: string[] = [];
  const ok = await persistProductEdit({
    itemId: 'item-1',
    updates: { name: 'Lait demi-écrémé' },
    updateItem: async () => {
      callOrder.push('updateItem');
      return { id: 'item-1' };
    },
    fetchStock: async () => {
      callOrder.push('fetchStock');
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(callOrder, ['updateItem', 'fetchStock']);
});

test("persistProductEdit n'actualise pas le stock si la sauvegarde échoue", async () => {
  const callOrder: string[] = [];
  const ok = await persistProductEdit({
    itemId: 'item-2',
    updates: { name: 'Yaourt nature' },
    updateItem: async () => {
      callOrder.push('updateItem');
      return null;
    },
    fetchStock: async () => {
      callOrder.push('fetchStock');
    },
  });

  assert.equal(ok, false);
  assert.deepEqual(callOrder, ['updateItem']);
});

test('toApiExpiryDate normalise les dates au format API', () => {
  const value = toApiExpiryDate(new Date('2026-04-20T09:30:00.000Z'));
  assert.equal(value, '2026-04-20');
  assert.equal(toApiExpiryDate(null), undefined);
});

test("(régression edit-product) persistProductEdit transmet storageZone sans le modifier", async () => {
  let receivedUpdates: unknown;
  await persistProductEdit({
    itemId: 'item-3',
    updates: { name: 'Chips pomme de terre truffe', storageZone: 'placard' },
    updateItem: async (_itemId, updates) => {
      receivedUpdates = updates;
      return { id: 'item-3' };
    },
    fetchStock: async () => {},
  });

  assert.deepEqual(receivedUpdates, { name: 'Chips pomme de terre truffe', storageZone: 'placard' });
});
