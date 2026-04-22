export interface RecipeListSplit<T> {
  header: T[];
  list: T[];
}

/**
 * Partitionne un tableau de recettes en deux parties sans duplication :
 * - `header` : les N premières recettes affichées dans la carte "plan" (ListHeaderComponent)
 * - `list`   : le reste affiché dans le FlatList
 *
 * Invariant : header.concat(list) === suggestions (pas de doublons, pas de manquants)
 */
export function splitRecipeDisplay<T>(suggestions: T[], headerCount = 2): RecipeListSplit<T> {
  return {
    header: suggestions.slice(0, headerCount),
    list: suggestions.slice(headerCount),
  };
}
