"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecipesSuggestionsWithStockFallback = fetchRecipesSuggestionsWithStockFallback;
exports.resolveDisplayedRecipesWithScope = resolveDisplayedRecipesWithScope;
const recipesScoping_1 = require("./recipesScoping");
async function fetchRecipesSuggestionsWithStockFallback(filter, fetcher) {
    const primary = await fetcher(filter);
    const primaryRecipes = Array.isArray(primary?.recipes) ? primary.recipes : [];
    if (filter === 'stock' || primaryRecipes.length > 0) {
        return { payload: primary, usedFallback: false };
    }
    const fallback = await fetcher('stock');
    return { payload: fallback, usedFallback: true };
}
function resolveDisplayedRecipesWithScope(backendRecipes, options) {
    const effectiveTargets = options.usedFallback ? options.stockIngredientNames : options.targetIngredientNames;
    return (0, recipesScoping_1.filterRecipesByTargetIngredients)(backendRecipes, effectiveTargets);
}
