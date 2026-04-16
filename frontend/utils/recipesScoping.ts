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
  const seenIds = new Set<string>();
  const seenSemanticSignatures = new Set<string>();
  const seenTitleSignatures = new Set<string>();

  return recipes.filter((recipe) => {
    const id = String(recipe?.id ?? '').trim();
    const title = String(recipe?.title ?? '').trim().toLowerCase();
    const duration = String(recipe?.duration_min ?? recipe?.timeMinutes ?? '').trim();
    const dishType = String(recipe?.dish_type ?? recipe?.type ?? '').trim().toLowerCase();
    const availableIngredients = getRecipeAvailableIngredients(recipe)
      .map((ingredient) => normalizeIngredientName(String(ingredient ?? '')))
      .filter(Boolean)
      .sort()
      .join('|');
    const semanticKey = [title, duration, dishType, availableIngredients].join('#');
    const titleKey = [title, duration, dishType].join('#');

    if (id) {
      if (seenIds.has(id)) return false;
      seenIds.add(id);
    }

    if (title && (duration || dishType)) {
      if (seenTitleSignatures.has(titleKey)) return false;
      seenTitleSignatures.add(titleKey);
    }

    if (!id) {
      if (!semanticKey || seenSemanticSignatures.has(semanticKey)) return false;
      seenSemanticSignatures.add(semanticKey);
    }

    return true;
  });
}

export function scopeAndDedupeRecipes(
  backendRecipes: any[],
  targetIngredientNames: Set<string>,
): any[] {
  return dedupeRecipesById(filterRecipesByTargetIngredients(backendRecipes, targetIngredientNames));
}

export interface RecipesScopeDiagnostics {
  rawRecipesCount: number;
  scopedRecipesCount: number;
  dedupedRecipesCount: number;
  targetIngredientNamesCount: number;
}

export function buildScopedRecipesWithDiagnostics(
  backendRecipes: any[],
  targetIngredientNames: Set<string>,
): { recipes: any[]; diagnostics: RecipesScopeDiagnostics } {
  const rawRecipesCount = backendRecipes.length;
  const scopedRecipes = filterRecipesByTargetIngredients(backendRecipes, targetIngredientNames);
  const dedupedRecipes = dedupeRecipesById(scopedRecipes);
  return {
    recipes: dedupedRecipes,
    diagnostics: {
      rawRecipesCount,
      scopedRecipesCount: scopedRecipes.length,
      dedupedRecipesCount: dedupedRecipes.length,
      targetIngredientNamesCount: targetIngredientNames.size,
    },
  };
}
