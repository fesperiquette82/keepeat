import type { RecipesFilter } from '../store/recipesStore';
import type { RecipeScopeDiagnostics } from './recipesScoping';

interface BuildRecipesEmptyMessageArgs {
  activeFilter: RecipesFilter;
  activeStockCount: number;
  hasTargetItems: boolean;
  isLoading: boolean;
  diagnostics: RecipeScopeDiagnostics;
  translate: (key: string) => string;
}

const FILTER_LABEL_KEYS: Record<RecipesFilter, string> = {
  expiryDay: 'recipesFilterExpiryDay',
  expiryWeek: 'recipesFilterExpiryWeek',
  expiryMonth: 'recipesFilterExpiryMonth',
  stock: 'recipesFilterAll',
};

const EMPTY_FILTER_LABEL_KEYS: Record<RecipesFilter, string> = {
  stock: 'recipesEmptyAll',
  expiryDay: 'recipesEmptyExpiryDay',
  expiryWeek: 'recipesEmptyExpiryWeek',
  expiryMonth: 'recipesEmptyExpiryMonth',
};

export function buildRecipesEmptyMessage({
  activeFilter,
  activeStockCount,
  hasTargetItems,
  isLoading,
  diagnostics,
  translate,
}: BuildRecipesEmptyMessageArgs): string {
  if (isLoading) return 'Chargement des suggestions...';
  if (activeStockCount === 0) return 'Aucune recette disponible : ajoutez d’abord des ingrédients au stock.';
  if (!hasTargetItems) return translate(EMPTY_FILTER_LABEL_KEYS[activeFilter]);
  if (diagnostics.rawRecipesCount === 0) {
    return 'Je n’ai trouvé aucune recette dans la base commune pour votre stock actuel.';
  }
  if (diagnostics.rawRecipesCount === diagnostics.fallbackRecipesCount) {
    return 'Je n’ai trouvé que des suggestions génériques (fallback), aucune recette personnalisée exploitable pour ce filtre.';
  }
  if (diagnostics.recipesWithAvailableIngredientsCount === 0) {
    return 'Je reçois des recettes, mais sans ingrédients disponibles exploitables. Vérifiez le mapping backend des ingrédients.';
  }
  if (diagnostics.compatibleRecipesCount === 0) {
    return 'Aucune recette de la base commune n’utilise les produits ciblés pour ce filtre. Essayez “Toutes” ou élargissez le stock.';
  }
  if (activeFilter === 'stock') {
    return 'J’ai détecté des articles dans votre stock, mais je n’arrive pas à vous proposer de recette pour le moment.';
  }

  return `J’ai détecté des articles avec des dates de péremption cohérentes pour le filtre “${translate(FILTER_LABEL_KEYS[activeFilter])}”, mais je n’arrive pas à vous proposer de recette pour le moment.`;
}
