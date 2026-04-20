import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecipeAssociationsSnapshot,
  STOCK_ASSOCIATION_REFRESH_SOURCES,
} from './recipeAssociations';
import type { DashboardStockItem } from '../data/mockDashboardData';
import type { RecipeCandidate } from './stockItemRecipes';

function stockItem(overrides: Partial<DashboardStockItem>): DashboardStockItem {
  return {
    id: overrides.id ?? 's1',
    name: overrides.name ?? 'Produit',
    status: 'active',
    added_date: '2026-04-01T00:00:00.000Z',
    expiry_date: overrides.expiry_date ?? '2026-04-20',
    storageZone: 'frigo',
    quantity: '1',
    ...overrides,
  };
}

const recipes: RecipeCandidate[] = [
  { id: 'r-omelette', title: 'Omelette', available_ingredients: ['oeuf', 'lait'] },
  { id: 'r-soup', title: 'Soupe', available_ingredients: ['poireau'] },
  { id: 'r-omelette', title: 'Omelette (dup)', available_ingredients: ['oeuf'] },
];

test('la liste des points d’entrée couvre toutes les mutations stock attendues sans doublon', () => {
  const expected = [
    'stock.add.manual',
    'stock.add.barcode',
    'stock.add.receipt_ocr',
    'stock.add.import',
    'stock.update',
    'stock.delete',
    'stock.consume',
    'stock.throw',
    'stock.restore',
    'stock.fetch',
  ];
  assert.deepEqual(STOCK_ASSOCIATION_REFRESH_SOURCES, expected);
  assert.equal(new Set(STOCK_ASSOCIATION_REFRESH_SOURCES).size, STOCK_ASSOCIATION_REFRESH_SOURCES.length);
});

test('recalcule une source de vérité dédupliquée après ajout manuel / barcode / OCR', () => {
  const manualStock = [stockItem({ id: 'egg', name: 'Oeufs fermiers' })];
  const barcodeStock = [...manualStock, stockItem({ id: 'milk', name: 'Lait demi-écrémé' })];
  const receiptStock = [...barcodeStock, stockItem({ id: 'rice', name: 'Riz basmati' })];

  const manualSnapshot = buildRecipeAssociationsSnapshot(manualStock, recipes);
  const barcodeSnapshot = buildRecipeAssociationsSnapshot(barcodeStock, recipes);
  const receiptSnapshot = buildRecipeAssociationsSnapshot(receiptStock, recipes);

  assert.equal(manualSnapshot.recipes.length, 2);
  assert.deepEqual(manualSnapshot.associationsByStockItemId.egg?.map((recipe) => recipe.id), ['r-omelette']);
  assert.deepEqual(barcodeSnapshot.associationsByStockItemId.milk?.map((recipe) => recipe.id), ['r-omelette']);
  assert.deepEqual(receiptSnapshot.associationsByStockItemId.rice ?? [], []);
});

test('recalcule après modification / suppression / consommation / jet', () => {
  const initialStock = [
    stockItem({ id: 'egg', name: 'Oeufs fermiers', quantity: '6' }),
    stockItem({ id: 'milk', name: 'Lait demi-écrémé' }),
  ];
  const updatedStock = initialStock.map((item) => item.id === 'egg' ? { ...item, quantity: '12', expiry_date: '2026-04-25' } : item);
  const deletedStock = updatedStock.filter((item) => item.id !== 'milk');
  const consumedStock = deletedStock.filter((item) => item.id !== 'egg');
  const thrownStock = consumedStock;

  assert.deepEqual(
    buildRecipeAssociationsSnapshot(updatedStock, recipes).associationsByStockItemId.egg?.map((recipe) => recipe.id),
    ['r-omelette'],
  );
  assert.deepEqual(
    buildRecipeAssociationsSnapshot(deletedStock, recipes).associationsByStockItemId.milk ?? [],
    [],
  );
  assert.deepEqual(
    buildRecipeAssociationsSnapshot(consumedStock, recipes).associationsByStockItemId.egg ?? [],
    [],
  );
  assert.deepEqual(
    buildRecipeAssociationsSnapshot(thrownStock, recipes).associationsByStockItemId.egg ?? [],
    [],
  );
});

test('un produit avec vraie recette associée reste visible dans le détail', () => {
  const snapshot = buildRecipeAssociationsSnapshot(
    [stockItem({ id: 'egg', name: 'Oeufs fermiers' }), stockItem({ id: 'jam', name: 'Confiture' })],
    recipes,
  );
  assert.deepEqual(snapshot.associationsByStockItemId.egg?.map((recipe) => recipe.id), ['r-omelette']);
});

test('un produit sans recette associée ne reçoit pas de recette non liée après mutation', () => {
  const snapshot = buildRecipeAssociationsSnapshot(
    [stockItem({ id: 'jam', name: 'Confiture de fraise', quantity: '2' })],
    recipes,
  );
  assert.deepEqual(snapshot.associationsByStockItemId.jam?.map((recipe) => recipe.id) ?? [], []);
});

