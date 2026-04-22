type RecipeBuckets = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth';
type SuggestionsByFilter = Record<RecipeBuckets, unknown[]>;

export function countCachedRecipes(suggestionsByFilter: SuggestionsByFilter): number {
  return Object.values(suggestionsByFilter).reduce((count, recipes) => count + recipes.length, 0);
}

export function shouldBootstrapRecipeAssociationsCache(suggestionsByFilter: SuggestionsByFilter): boolean {
  return countCachedRecipes(suggestionsByFilter) === 0;
}
