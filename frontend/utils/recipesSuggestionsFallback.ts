import { BackendRecipesSuggestionsResponse } from './recipesApi';
import { RecipesApiFilter } from './recipesFilter';
import { filterRecipesByTargetIngredients } from './recipesScoping';

type FetchRecipesSuggestions = (filter: RecipesApiFilter) => Promise<BackendRecipesSuggestionsResponse>;

export interface FetchRecipesWithFallbackResult {
  payload: BackendRecipesSuggestionsResponse;
  usedFallback: boolean;
}

export async function fetchRecipesSuggestionsWithStockFallback(
  filter: RecipesApiFilter,
  fetcher: FetchRecipesSuggestions,
): Promise<FetchRecipesWithFallbackResult> {
  const primary = await fetcher(filter);
  const primaryRecipes = Array.isArray(primary?.recipes) ? primary.recipes : [];
  if (filter === 'stock' || primaryRecipes.length > 0) {
    return { payload: primary, usedFallback: false };
  }

  const fallback = await fetcher('stock');
  return { payload: fallback, usedFallback: true };
}

export function resolveDisplayedRecipesWithScope(
  backendRecipes: any[],
  options: {
    usedFallback: boolean;
    targetIngredientNames: Set<string>;
    stockIngredientNames: Set<string>;
  },
): any[] {
  const effectiveTargets = options.usedFallback ? options.stockIngredientNames : options.targetIngredientNames;
  return filterRecipesByTargetIngredients(backendRecipes, effectiveTargets);
}
