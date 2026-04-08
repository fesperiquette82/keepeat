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
    const isGenericFallback = Boolean(
      recipe?.is_fallback || (recipe?.debug && typeof recipe.debug === 'object' && (recipe.debug as any).is_fallback),
    );
    if (isGenericFallback) return false;

    const recipeAvailableIngredients = getRecipeAvailableIngredients(recipe);
    return recipeAvailableIngredients.some((ingredient) =>
      targetIngredientNames.has(normalizeIngredientName(String(ingredient ?? ''))),
    );
  });
}

export function dedupeRecipesById(recipes: any[]): any[] {
  const seen = new Set<string>();
  return recipes.filter((recipe) => {
    const id = String(recipe?.id ?? '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function scopeAndDedupeRecipes(
  backendRecipes: any[],
  targetIngredientNames: Set<string>,
): any[] {
  return dedupeRecipesById(filterRecipesByTargetIngredients(backendRecipes, targetIngredientNames));
}
