import { normalizeIngredientName } from './ingredientMatching';

export function getRecipeAvailableIngredients(recipe: any): string[] {
  if (Array.isArray(recipe?.available_ingredients)) return recipe.available_ingredients;
  if (Array.isArray(recipe?.availableIngredients)) return recipe.availableIngredients;
  if (Array.isArray(recipe?.usedIngredients)) return recipe.usedIngredients;
  if (Array.isArray(recipe?.used_ingredients)) return recipe.used_ingredients;
  return [];
}

export function buildTargetIngredientNames(targetItems: Array<{ name?: string | null }>): Set<string> {
  return new Set(targetItems.map((item) => normalizeIngredientName(item.name ?? '')).filter(Boolean));
}

export function filterRecipesByTargetIngredients(
  backendRecipes: any[],
  targetIngredientNames: Set<string>,
): any[] {
  if (targetIngredientNames.size === 0) return [];
  return backendRecipes.filter((recipe) => {
    const isGenericFallback = isFallbackRecipe(recipe);
    if (isGenericFallback) return false;

    const recipeAvailableIngredients = getRecipeAvailableIngredients(recipe);
    return recipeAvailableIngredients.some((ingredient) =>
      targetIngredientNames.has(normalizeIngredientName(String(ingredient ?? ''))),
    );
  });
}

export function isFallbackRecipe(recipe: any): boolean {
  return Boolean(
    recipe?.is_fallback || (recipe?.debug && typeof recipe.debug === 'object' && (recipe.debug as any).is_fallback),
  );
}

export interface RecipeScopeDiagnostics {
  rawRecipesCount: number;
  fallbackRecipesCount: number;
  recipesWithAvailableIngredientsCount: number;
  compatibleRecipesCount: number;
}

export function buildRecipeScopeDiagnostics(
  backendRecipes: any[],
  targetIngredientNames: Set<string>,
): RecipeScopeDiagnostics {
  const rawRecipesCount = backendRecipes.length;
  const fallbackRecipesCount = backendRecipes.filter((recipe) => isFallbackRecipe(recipe)).length;
  const recipesWithAvailableIngredientsCount = backendRecipes.filter((recipe) => getRecipeAvailableIngredients(recipe).length > 0).length;
  const compatibleRecipesCount = filterRecipesByTargetIngredients(backendRecipes, targetIngredientNames).length;
  return {
    rawRecipesCount,
    fallbackRecipesCount,
    recipesWithAvailableIngredientsCount,
    compatibleRecipesCount,
  };
}
