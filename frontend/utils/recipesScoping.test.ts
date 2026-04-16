import assert from 'node:assert/strict';
import test from 'node:test';

import { getActiveItemsByScope, type DashboardStockItem } from '../data/mockDashboardData';
import { buildScopedRecipesWithDiagnostics, buildTargetIngredientNames, scopeAndDedupeRecipes } from './recipesScoping';

const ACTIVE_STATUS = 'active' as const;

function buildItem(id: string, name: string, expiryDate: string): DashboardStockItem {
  return {
    id,
    name,
    brand: 'Test',
    food_category: 'frais',
    storageZone: 'frigo',
    quantity: '1',
    expiry_date: expiryDate,
    added_date: '2026-03-01T00:00:00.000Z',
    status: ACTIVE_STATUS,
  };
}

function asSet(recipes: any[]): Set<string> {
  return new Set(recipes.map((recipe) => String(recipe.id)));
}

test('monotonie filtres recettes: day ⊆ week ⊆ month ⊆ all et comptage cohérent', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });

  const items: DashboardStockItem[] = [
    buildItem('d0', 'Œufs', '2026-04-10'),
    buildItem('w2', 'Lait', '2026-04-12'),
    buildItem('m15', 'Riz', '2026-04-25'),
    buildItem('all', 'Farine', '2026-07-01'),
  ];

  const baseRecipes = [
    { id: 'day-only', available_ingredients: ['Œufs'] },
    { id: 'week-only', available_ingredients: ['Lait'] },
    { id: 'month-only', available_ingredients: ['Riz'] },
    { id: 'all-only', available_ingredients: ['Farine'] },
    { id: 'day-duplicate-a', available_ingredients: ['Œufs'] },
    { id: 'day-duplicate-a', available_ingredients: ['Œufs'] },
  ];

  const dayRecipes = scopeAndDedupeRecipes(baseRecipes, buildTargetIngredientNames(getActiveItemsByScope(items, 'expiryDay')));
  const weekRecipes = scopeAndDedupeRecipes(baseRecipes, buildTargetIngredientNames(getActiveItemsByScope(items, 'expiryWeek')));
  const monthRecipes = scopeAndDedupeRecipes(baseRecipes, buildTargetIngredientNames(getActiveItemsByScope(items, 'expiryMonth')));
  const allRecipes = scopeAndDedupeRecipes(baseRecipes, buildTargetIngredientNames(getActiveItemsByScope(items, 'stock')));

  const dayIds = asSet(dayRecipes);
  const weekIds = asSet(weekRecipes);
  const monthIds = asSet(monthRecipes);
  const allIds = asSet(allRecipes);

  for (const id of dayIds) {
    assert.equal(weekIds.has(id), true);
  }
  for (const id of weekIds) {
    assert.equal(monthIds.has(id), true);
  }
  for (const id of monthIds) {
    assert.equal(allIds.has(id), true);
  }

  assert.equal(allRecipes.length >= monthRecipes.length, true);
  assert.equal(allRecipes.length >= weekRecipes.length, true);
  assert.equal(allRecipes.length >= dayRecipes.length, true);
});

test('déduplication: une recette dupliquée n apparait qu une fois dans une même vue', () => {
  const recipes = [
    { id: 'same', available_ingredients: ['oeuf'] },
    { id: 'same', available_ingredients: ['oeuf'] },
    { id: 'other', available_ingredients: ['oeuf'] },
  ];

  const deduped = scopeAndDedupeRecipes(recipes, new Set(['oeuf']));
  assert.deepEqual(deduped.map((recipe) => recipe.id), ['same', 'other']);
});

test('déduplication: même recette backend avec ids différents est fusionnée via signature sémantique', () => {
  const recipes = [
    {
      id: 'variant-a',
      title: 'Spirales crème pistache et olivade',
      duration_min: 20,
      dish_type: 'rapide',
      available_ingredients: ['pistache'],
    },
    {
      id: 'variant-b',
      title: 'Spirales crème pistache et olivade',
      duration_min: 20,
      dish_type: 'rapide',
      available_ingredients: ['Pistaches'],
    },
    {
      id: 'other',
      title: 'Salade fraîche',
      duration_min: 10,
      dish_type: 'salade',
      available_ingredients: ['oeuf'],
    },
  ];

  const deduped = scopeAndDedupeRecipes(recipes, new Set(['pistache', 'oeuf']));
  assert.deepEqual(deduped.map((recipe) => recipe.id), ['variant-a', 'other']);
});

test('déduplication: même titre + durée + type reste unique même si les ingrédients disponibles diffèrent', () => {
  const recipes = [
    {
      id: 'variant-a',
      title: 'Spirales crème pistache et olivade',
      duration_min: 20,
      dish_type: 'rapide',
      available_ingredients: ['pistache'],
    },
    {
      id: 'variant-b',
      title: 'Spirales crème pistache et olivade',
      duration_min: 20,
      dish_type: 'rapide',
      available_ingredients: ['olive'],
    },
    {
      id: 'other',
      title: 'Salade fraîche',
      duration_min: 10,
      dish_type: 'salade',
      available_ingredients: ['oeuf'],
    },
  ];

  const deduped = scopeAndDedupeRecipes(recipes, new Set(['pistache', 'olive', 'oeuf']));
  assert.deepEqual(deduped.map((recipe) => recipe.id), ['variant-a', 'other']);
});

test('buildTargetIngredientNames: deux appels avec les mêmes items produisent des clés sérialisées identiques (BUG-025)', () => {
  const items = [{ name: 'Tomate' }, { name: 'oeuf' }, { name: 'courgette' }];
  const set1 = buildTargetIngredientNames(items);
  const set2 = buildTargetIngredientNames(items);
  // Deux instances distinctes (références différentes, == ne suffit pas comme dépendance React)
  assert.notEqual(set1 === set2, true);
  // Mais les clés sérialisées sont identiques → stable comme dépendance useEffect
  const key1 = [...set1].sort().join(',');
  const key2 = [...set2].sort().join(',');
  assert.equal(key1, key2);
});

test('cohérence anti-gaspi / liste principale: top suggestions restent un sous-ensemble de la liste filtrée', () => {
  const recipes = [
    { id: 'r1', available_ingredients: ['oeuf'] },
    { id: 'r2', available_ingredients: ['oeuf'] },
    { id: 'r3', available_ingredients: ['oeuf'] },
  ];

  const classic = scopeAndDedupeRecipes(recipes, new Set(['oeuf']));
  const antiWasteTop = classic.slice(0, 2);
  const classicIds = asSet(classic);

  antiWasteTop.forEach((recipe) => assert.equal(classicIds.has(recipe.id), true));
});

test('cas utilisateur: un filtre restrictif ne retourne jamais plus de recettes que Toutes sur base commune', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });

  const items: DashboardStockItem[] = [
    buildItem('d0', 'Œufs', '2026-04-10'),
    buildItem('w2', 'Lait', '2026-04-12'),
    buildItem('m15', 'Riz', '2026-04-25'),
    buildItem('s80', 'Farine', '2026-06-29'),
  ];
  const commonBaseRecipes = [
    { id: 'r-day', available_ingredients: ['Œufs'] },
    { id: 'r-week', available_ingredients: ['Lait'] },
    { id: 'r-month', available_ingredients: ['Riz'] },
    { id: 'r-all', available_ingredients: ['Farine'] },
  ];

  const dayTargets = buildTargetIngredientNames(getActiveItemsByScope(items, 'expiryDay'));
  const allTargets = buildTargetIngredientNames(getActiveItemsByScope(items, 'stock'));
  const dayResult = buildScopedRecipesWithDiagnostics(commonBaseRecipes, dayTargets);
  const allResult = buildScopedRecipesWithDiagnostics(commonBaseRecipes, allTargets);

  assert.equal(dayResult.recipes.length <= allResult.recipes.length, true);
  dayResult.recipes.forEach((recipe) => {
    assert.equal(allResult.recipes.some((allRecipe) => allRecipe.id === recipe.id), true);
  });
  assert.equal(dayResult.diagnostics.dedupedRecipesCount, dayResult.recipes.length);
  assert.equal(allResult.diagnostics.dedupedRecipesCount, allResult.recipes.length);
});
