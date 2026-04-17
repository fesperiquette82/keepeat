import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAntiWastePlanByScope,
  buildRecipeSuggestionsByScope,
  daysUntil,
  getActiveItemsByScope,
  resolveStockItems,
  type DashboardStockItem,
} from './mockDashboardData';
import { buildTargetIngredientNames, filterRecipesByTargetIngredients } from '../utils/recipesScoping';

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

test('le scope stock ne propose que des recettes avec au moins un ingrédient disponible et un plan anti-gaspi global unique', () => {
  const items: DashboardStockItem[] = [
    buildItem('a', 'Courgettes', '2026-04-20T00:00:00.000Z'),
    buildItem('b', 'Poulet émincé', '2026-04-08T00:00:00.000Z'),
  ];

  const suggestions = buildRecipeSuggestionsByScope(items, 'stock');
  assert.equal(suggestions.length > 0, true);
  assert.equal(suggestions.every((recipe) => recipe.matchedCount >= 1), true);

  const plan = buildAntiWastePlanByScope(items, 'stock');
  assert.equal(plan.recipes.length, 1);
  assert.equal(plan.coveredCount >= 1, true);
});

test('daysUntil gère les dates ISO sans dérive timezone (10 avril -> 25/30 avril)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });

  assert.equal(daysUntil('2026-04-25'), 15);
  assert.equal(daysUntil('2026-04-30'), 20);
  assert.equal(daysUntil('2026-04-25T00:00:00.000Z'), 15);
  assert.equal(daysUntil('30/04/2026'), null);
});

test('filtre recettes: expiryMonth inclut 25/30 avril, expiryWeek reste vide au 10 avril', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });

  const items: DashboardStockItem[] = [
    buildItem('m25', 'Lait', '2026-04-25'),
    buildItem('m30', 'Yaourt', '2026-04-30'),
  ];

  const monthItems = getActiveItemsByScope(items, 'expiryMonth');
  const weekItems = getActiveItemsByScope(items, 'expiryWeek');

  assert.equal(monthItems.length > 0, true);
  assert.equal(weekItems.length, 0);
});

test('monotonie recettes: jour ⊂ semaine ⊂ mois ⊂ toutes', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-10T12:00:00.000Z') });

  const items: DashboardStockItem[] = [
    buildItem('d0', 'Œufs', '2026-04-10'),
    buildItem('w3', 'Lait', '2026-04-13'),
    buildItem('m20', 'Riz', '2026-04-30'),
    buildItem('s90', 'Farine', '2026-07-09'),
  ];

  const allRecipes = [
    { id: 'r_day', available_ingredients: ['Œufs'] },
    { id: 'r_week', available_ingredients: ['Lait'] },
    { id: 'r_month', available_ingredients: ['Riz'] },
    { id: 'r_stock', available_ingredients: ['Farine'] },
  ];

  const dayItems = getActiveItemsByScope(items, 'expiryDay');
  const weekItems = getActiveItemsByScope(items, 'expiryWeek');
  const monthItems = getActiveItemsByScope(items, 'expiryMonth');
  const stockItems = getActiveItemsByScope(items, 'stock');

  const dayRecipes = filterRecipesByTargetIngredients(allRecipes, buildTargetIngredientNames(dayItems));
  const weekRecipes = filterRecipesByTargetIngredients(allRecipes, buildTargetIngredientNames(weekItems));
  const monthRecipes = filterRecipesByTargetIngredients(allRecipes, buildTargetIngredientNames(monthItems));
  const stockRecipes = filterRecipesByTargetIngredients(allRecipes, buildTargetIngredientNames(stockItems));

  const weekIds = new Set(weekRecipes.map((recipe) => recipe.id));
  const monthIds = new Set(monthRecipes.map((recipe) => recipe.id));
  const stockIds = new Set(stockRecipes.map((recipe) => recipe.id));

  assert.equal(dayRecipes.some((recipe) => recipe.id === 'r_day'), true);
  assert.equal(weekIds.has('r_day'), true);
  assert.equal(monthIds.has('r_week'), true);
  assert.equal(stockIds.has('r_month'), true);
});

test('filtrage recettes: aucun ingrédient cible normalisable => aucune recette', () => {
  const recipes = [{ id: 'r1', available_ingredients: ['oeufs'] }];
  const filtered = filterRecipesByTargetIngredients(recipes, new Set());
  assert.equal(filtered.length, 0);
});

test('filtrage recettes: exclut les recettes fallback génériques même si les ingrédients matchent', () => {
  const recipes = [
    { id: 'generic-fallback', available_ingredients: ['oeufs'], is_fallback: true },
    { id: 'generic-fallback-debug', available_ingredients: ['oeufs'], debug: { is_fallback: true } },
    { id: 'scoped', available_ingredients: ['oeufs'] },
  ];

  const filtered = filterRecipesByTargetIngredients(recipes, new Set(['oeuf']));
  assert.deepEqual(filtered.map((recipe) => recipe.id), ['scoped']);
});

test("resolveStockItems expose l'image quand la payload stock fournit image_url", () => {
  const result = resolveStockItems([
    {
      ...buildItem('img-snake', 'Œufs plein air', '2026-04-20'),
      image_url: 'https://cdn/img/oeufs.jpg',
    },
  ]);
  assert.equal(result.items[0]?.image_url, 'https://cdn/img/oeufs.jpg');
});

test("resolveStockItems expose l'image quand la payload stock fournit imageUrl", () => {
  const result = resolveStockItems([
    {
      ...buildItem('img-camel', 'Crema de pistacho', '2026-04-20'),
      imageUrl: 'https://cdn/img/pistache.jpg',
    } as DashboardStockItem,
  ]);
  assert.equal(result.items[0]?.image_url, 'https://cdn/img/pistache.jpg');
});

test("resolveStockItems expose l'image quand la payload stock contient product.image_url", () => {
  const result = resolveStockItems([
    {
      ...buildItem('img-nested', 'Mix énergie', '2026-04-20'),
      product: {
        image_url: 'https://cdn/img/mix.jpg',
      },
    } as DashboardStockItem,
  ]);
  assert.equal(result.items[0]?.image_url, 'https://cdn/img/mix.jpg');
});

test("resolveStockItems garde le placeholder UI quand aucune image valide n'existe", () => {
  const result = resolveStockItems([
    {
      ...buildItem('img-none', 'Produit sans image', '2026-04-20'),
      image_url: '   ',
      imageUrl: '',
    } as DashboardStockItem,
  ]);
  assert.equal(result.items[0]?.image_url, undefined);
});
