import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRecipesSuggestionsWithStockFallback, resolveDisplayedRecipesWithScope } from './recipesSuggestionsFallback';

test('fetchRecipesSuggestionsWithStockFallback garde la réponse principale quand elle contient des recettes', async () => {
  const calls: string[] = [];
  const result = await fetchRecipesSuggestionsWithStockFallback('expiryDay', async (filter) => {
    calls.push(filter);
    return { recipes: [{ id: 'r1' } as any] };
  });

  assert.equal(result.usedFallback, false);
  assert.equal(result.payload.recipes.length, 1);
  assert.deepEqual(calls, ['expiryDay']);
});

test('fetchRecipesSuggestionsWithStockFallback bascule sur stock quand le filtre temporel est vide', async () => {
  const calls: string[] = [];
  const result = await fetchRecipesSuggestionsWithStockFallback('expiryWeek', async (filter) => {
    calls.push(filter);
    if (filter === 'expiryWeek') return { recipes: [] };
    return { recipes: [{ id: 'stock-1' } as any] };
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.payload.recipes.length, 1);
  assert.deepEqual(calls, ['expiryWeek', 'stock']);
});

test('resolveDisplayedRecipesWithScope utilise le scope temporel quand il n y a pas fallback', () => {
  const recipes = [
    { id: 'day', available_ingredients: ['lait'] },
    { id: 'stock', available_ingredients: ['oeuf'] },
  ];

  const displayed = resolveDisplayedRecipesWithScope(recipes, {
    usedFallback: false,
    targetIngredientNames: new Set(['lait']),
    stockIngredientNames: new Set(['oeuf']),
  });

  assert.deepEqual(displayed.map((recipe) => recipe.id), ['day']);
});

test('resolveDisplayedRecipesWithScope utilise le scope stock quand fallback activé', () => {
  const recipes = [
    { id: 'day', available_ingredients: ['lait'] },
    { id: 'stock', available_ingredients: ['oeuf'] },
  ];

  const displayed = resolveDisplayedRecipesWithScope(recipes, {
    usedFallback: true,
    targetIngredientNames: new Set(['lait']),
    stockIngredientNames: new Set(['oeuf']),
  });

  assert.deepEqual(displayed.map((recipe) => recipe.id), ['stock']);
});

test('fetchRecipesSuggestionsWithStockFallback préserve suggest_later=true quand recipes vides', async () => {
  const result = await fetchRecipesSuggestionsWithStockFallback('stock', async () => ({
    recipes: [],
    meta: { suggest_later: true },
  }));

  assert.equal(result.payload.meta?.suggest_later, true);
  assert.equal(result.payload.recipes.length, 0);
});

test('fetchRecipesSuggestionsWithStockFallback préserve suggest_later=false quand recipes présentes', async () => {
  const result = await fetchRecipesSuggestionsWithStockFallback('stock', async () => ({
    recipes: [{ id: 'r1' } as any],
    meta: { suggest_later: false },
  }));

  assert.equal(result.payload.meta?.suggest_later, false);
  assert.equal(result.usedFallback, false);
});

test('fetchRecipesSuggestionsWithStockFallback utilise le meta du fallback quand bascule sur stock', async () => {
  const result = await fetchRecipesSuggestionsWithStockFallback('expiryMonth', async (filter) => {
    if (filter === 'expiryMonth') return { recipes: [], meta: { suggest_later: false } };
    return { recipes: [], meta: { suggest_later: true } };
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.payload.meta?.suggest_later, true);
});
