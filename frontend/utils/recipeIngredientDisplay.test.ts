import assert from 'node:assert/strict';
import test from 'node:test';

import type { StockItem } from '../store/stockStore';
import { buildRecipeIngredientDisplayRows } from './recipeIngredientDisplay';

const ACTIVE = 'active' as const;

function stockItem(input: Partial<StockItem> & Pick<StockItem, 'id' | 'name'>): StockItem {
  return {
    id: input.id,
    name: input.name,
    status: ACTIVE,
    added_date: input.added_date ?? '2026-04-01T00:00:00.000Z',
    expiry_date: input.expiry_date ?? '2026-04-20T00:00:00.000Z',
    quantity: input.quantity ?? '1',
    image_url: input.image_url,
  };
}

test('un ingrédient lié à un article stock avec image expose la vignette', () => {
  const rows = buildRecipeIngredientDisplayRows(
    [stockItem({ id: 's1', name: 'Tomates concassées', image_url: 'https://cdn/img/tomate.jpg' })],
    [{ name: 'tomato puree', quantity: 1, unit: 'portion' }],
  );

  assert.equal(rows[0]?.isAvailable, true);
  assert.equal(rows[0]?.imageUrl, 'https://cdn/img/tomate.jpg');
  assert.equal(rows[0]?.usesPlaceholder, false);
});

test('un ingrédient disponible sans image utilise le placeholder', () => {
  const rows = buildRecipeIngredientDisplayRows(
    [stockItem({ id: 's1', name: 'Œufs' })],
    [{ name: 'oeuf', quantity: 2, unit: 'pièces' }],
  );

  assert.equal(rows[0]?.isAvailable, true);
  assert.equal(rows[0]?.imageUrl, null);
  assert.equal(rows[0]?.usesPlaceholder, true);
});

test('un ingrédient manquant ne casse pas le rendu', () => {
  const rows = buildRecipeIngredientDisplayRows(
    [stockItem({ id: 's1', name: 'Riz basmati' })],
    [{ name: 'ail', quantity: 1, unit: 'gousse' }],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.isAvailable, false);
  assert.equal(rows[0]?.imageUrl, null);
  assert.equal(rows[0]?.usesPlaceholder, true);
});

test('la logique de mapping existante retrouve la meilleure image produit', () => {
  const rows = buildRecipeIngredientDisplayRows(
    [
      stockItem({ id: 'late', name: 'Tomates concassées marque B', expiry_date: '2026-04-22T00:00:00.000Z', image_url: 'https://cdn/img/late.jpg' }),
      stockItem({ id: 'best', name: 'Tomates concassées marque A', expiry_date: '2026-04-10T00:00:00.000Z', image_url: 'https://cdn/img/best.jpg' }),
    ],
    [{ name: 'tomates concassées', quantity: 1, unit: 'boîte' }],
  );

  assert.equal(rows[0]?.matchedStockItemId, 'best');
  assert.equal(rows[0]?.imageUrl, 'https://cdn/img/best.jpg');
});
