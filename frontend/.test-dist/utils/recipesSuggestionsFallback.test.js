"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const recipesSuggestionsFallback_1 = require("./recipesSuggestionsFallback");
(0, node_test_1.default)('fetchRecipesSuggestionsWithStockFallback garde la réponse principale quand elle contient des recettes', async () => {
    const calls = [];
    const result = await (0, recipesSuggestionsFallback_1.fetchRecipesSuggestionsWithStockFallback)('expiryDay', async (filter) => {
        calls.push(filter);
        return { recipes: [{ id: 'r1' }] };
    });
    strict_1.default.equal(result.usedFallback, false);
    strict_1.default.equal(result.payload.recipes.length, 1);
    strict_1.default.deepEqual(calls, ['expiryDay']);
});
(0, node_test_1.default)('fetchRecipesSuggestionsWithStockFallback bascule sur stock quand le filtre temporel est vide', async () => {
    const calls = [];
    const result = await (0, recipesSuggestionsFallback_1.fetchRecipesSuggestionsWithStockFallback)('expiryWeek', async (filter) => {
        calls.push(filter);
        if (filter === 'expiryWeek')
            return { recipes: [] };
        return { recipes: [{ id: 'stock-1' }] };
    });
    strict_1.default.equal(result.usedFallback, true);
    strict_1.default.equal(result.payload.recipes.length, 1);
    strict_1.default.deepEqual(calls, ['expiryWeek', 'stock']);
});
(0, node_test_1.default)('resolveDisplayedRecipesWithScope utilise le scope temporel quand il n y a pas fallback', () => {
    const recipes = [
        { id: 'day', available_ingredients: ['lait'] },
        { id: 'stock', available_ingredients: ['oeuf'] },
    ];
    const displayed = (0, recipesSuggestionsFallback_1.resolveDisplayedRecipesWithScope)(recipes, {
        usedFallback: false,
        targetIngredientNames: new Set(['lait']),
        stockIngredientNames: new Set(['oeuf']),
    });
    strict_1.default.deepEqual(displayed.map((recipe) => recipe.id), ['day']);
});
(0, node_test_1.default)('resolveDisplayedRecipesWithScope utilise le scope stock quand fallback activé', () => {
    const recipes = [
        { id: 'day', available_ingredients: ['lait'] },
        { id: 'stock', available_ingredients: ['oeuf'] },
    ];
    const displayed = (0, recipesSuggestionsFallback_1.resolveDisplayedRecipesWithScope)(recipes, {
        usedFallback: true,
        targetIngredientNames: new Set(['lait']),
        stockIngredientNames: new Set(['oeuf']),
    });
    strict_1.default.deepEqual(displayed.map((recipe) => recipe.id), ['stock']);
});
(0, node_test_1.default)('fetchRecipesSuggestionsWithStockFallback préserve suggest_later=true quand recipes vides', async () => {
    const result = await (0, recipesSuggestionsFallback_1.fetchRecipesSuggestionsWithStockFallback)('stock', async () => ({
        recipes: [],
        meta: { suggest_later: true },
    }));
    strict_1.default.equal(result.payload.meta?.suggest_later, true);
    strict_1.default.equal(result.payload.recipes.length, 0);
});
(0, node_test_1.default)('fetchRecipesSuggestionsWithStockFallback préserve suggest_later=false quand recipes présentes', async () => {
    const result = await (0, recipesSuggestionsFallback_1.fetchRecipesSuggestionsWithStockFallback)('stock', async () => ({
        recipes: [{ id: 'r1' }],
        meta: { suggest_later: false },
    }));
    strict_1.default.equal(result.payload.meta?.suggest_later, false);
    strict_1.default.equal(result.usedFallback, false);
});
(0, node_test_1.default)('fetchRecipesSuggestionsWithStockFallback utilise le meta du fallback quand bascule sur stock', async () => {
    const result = await (0, recipesSuggestionsFallback_1.fetchRecipesSuggestionsWithStockFallback)('expiryMonth', async (filter) => {
        if (filter === 'expiryMonth')
            return { recipes: [], meta: { suggest_later: false } };
        return { recipes: [], meta: { suggest_later: true } };
    });
    strict_1.default.equal(result.usedFallback, true);
    strict_1.default.equal(result.payload.meta?.suggest_later, true);
});
