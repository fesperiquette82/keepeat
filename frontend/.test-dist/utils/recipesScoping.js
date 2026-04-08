"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecipeAvailableIngredients = getRecipeAvailableIngredients;
exports.buildTargetIngredientNames = buildTargetIngredientNames;
exports.filterRecipesByTargetIngredients = filterRecipesByTargetIngredients;
const ingredientMatching_1 = require("./ingredientMatching");
function getRecipeAvailableIngredients(recipe) {
    if (Array.isArray(recipe?.available_ingredients))
        return recipe.available_ingredients;
    if (Array.isArray(recipe?.availableIngredients))
        return recipe.availableIngredients;
    if (Array.isArray(recipe?.usedIngredients))
        return recipe.usedIngredients;
    if (Array.isArray(recipe?.used_ingredients))
        return recipe.used_ingredients;
    return [];
}
function buildTargetIngredientNames(targetItems) {
    return new Set(targetItems.map((item) => (0, ingredientMatching_1.normalizeIngredientName)(item.name ?? '')).filter(Boolean));
}
function filterRecipesByTargetIngredients(backendRecipes, targetIngredientNames) {
    if (targetIngredientNames.size === 0)
        return [];
    return backendRecipes.filter((recipe) => {
        const isGenericFallback = Boolean(recipe?.is_fallback || (recipe?.debug && typeof recipe.debug === 'object' && recipe.debug.is_fallback));
        if (isGenericFallback)
            return false;
        const recipeAvailableIngredients = getRecipeAvailableIngredients(recipe);
        return recipeAvailableIngredients.some((ingredient) => targetIngredientNames.has((0, ingredientMatching_1.normalizeIngredientName)(String(ingredient ?? ''))));
    });
}
