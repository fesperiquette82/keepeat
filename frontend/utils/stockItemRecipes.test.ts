import assert from 'node:assert/strict';
import test from 'node:test';

import type { DashboardStockItem } from '../data/mockDashboardData';
import { buildStockItemRecipeSections, buildRecipeDetailRoute, normalizeStockItemNameForRecipeMatching } from './stockItemRecipes';

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

test('normalise un nom produit avec packaging/marque', () => {
  assert.equal(normalizeStockItemNameForRecipeMatching('Oeufs Plein air Bleu Blanc Coeur - Boite de 10'), 'oeuf');
  assert.equal(normalizeStockItemNameForRecipeMatching('Crème entière UHT 30%MG, 3x20cl'), 'creme');
});

test('retourne des recettes directes quand l’article est référencé', () => {
  const item = stockItem({ id: 'egg', name: 'Oeufs Plein air Bleu Blanc Coeur - Boite de 10', expiry_date: '2026-04-18' });
  const stock = [item, stockItem({ id: 'milk', name: 'Lait', expiry_date: '2026-04-19' })];
  const recipes = [
    { id: 'r1', title: 'Omelette', available_ingredients: ['oeuf', 'lait'], duration_min: 10 },
    { id: 'r2', title: 'Soupe', available_ingredients: ['courgette'], duration_min: 15 },
  ];

  const sections = buildStockItemRecipeSections(item, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), ['r1']);
});

test("retourne des suggestions anti-gaspi liées uniquement pour les recettes qui utilisent vraiment l'ingrédient", () => {
  const selected = stockItem({ id: 'cream', name: 'Crème entière UHT 30%MG, 3x20cl', expiry_date: '2026-04-18' });
  const urgentOther = stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' });
  const stock = [selected, urgentOther, stockItem({ id: 'rice', name: 'Riz basmati', expiry_date: '2026-05-30' })];
  const recipes = [
    { id: 'direct', title: 'Pâtes crème', available_ingredients: ['creme', 'oeuf'], duration_min: 15 },
    { id: 'urgent-other', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
    { id: 'off-topic', title: 'Dessert exotique', available_ingredients: ['ananas'], duration_min: 35 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.antiWasteRecipes.map((recipe) => recipe.id), ['direct']);
  assert.deepEqual(sections.globalSuggestions.map((recipe) => recipe.id), ['urgent-other']);
});

test('article sans recette liée retourne des sections vides', () => {
  const selected = stockItem({ id: 'jam', name: 'Confiture de fraise', expiry_date: '2026-05-20' });
  const stock = [selected, stockItem({ id: 'rice', name: 'Riz basmati', expiry_date: '2026-07-01' })];
  const recipes = [{ id: 'r1', title: 'Soupe', available_ingredients: ['poireau'], duration_min: 20 }];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.equal(sections.directRecipes.length, 0);
  assert.equal(sections.antiWasteRecipes.length, 0);
  assert.equal(sections.globalSuggestions.length, 0);
});



test('sépare les suggestions globales des recettes réellement liées pour éviter un écran contradictoire', () => {
  const selected = stockItem({ id: 'jam', name: 'Confiture de fraise', expiry_date: '2026-05-20' });
  const urgentEgg = stockItem({ id: 'egg', name: 'Oeufs', expiry_date: '2026-04-18' });
  const stock = [selected, urgentEgg];
  const recipes = [
    { id: 'r-omelette', title: 'Omelette', available_ingredients: ['oeuf'], duration_min: 8 },
  ];

  const sections = buildStockItemRecipeSections(selected, stock, recipes);
  assert.deepEqual(sections.directRecipes.map((recipe) => recipe.id), []);
  assert.deepEqual(sections.antiWasteRecipes.map((recipe) => recipe.id), []);
  assert.deepEqual(sections.globalSuggestions.map((recipe) => recipe.id), ['r-omelette']);
});

test('construit la route de navigation vers le détail recette existant', () => {
  assert.deepEqual(buildRecipeDetailRoute('recipe-42'), {
    pathname: '/recipes/[id]',
    params: { id: 'recipe-42' },
  });
});
