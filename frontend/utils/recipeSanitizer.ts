import { formatFrenchRecipeText } from './recipeFrenchTypography';
import { resolveRecipeDurationMinutes } from './recipeDisplay';

// Nettoyage d'une recette reçue du serveur. Il vivait dans store/recipesStore.ts,
// hors de portée des tests, et ne gardait qu'une liste fixe de champs : la
// durée (`duration_min`), les compteurs d'ingrédients et le type de plat que
// sert l'API étaient perdus, alors que les écrans les lisent (BUG-101).

export interface BackendRecipeSuggestion {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  usedIngredients?: string[];
  missedIngredients?: string[];
  ingredients?: {
    name: string;
    quantity: number | null;
    unit: string | null;
    display_unit?: string | null;
    display_label?: string | null;
    optional?: boolean;
    available?: boolean;
    matched_stock_item_ids?: string[];
    missing_quantity?: number | null;
    is_estimated?: boolean;
  }[];
  instructions_summary?: string;
  prep_time_min?: number | null;
  cook_time_min?: number | null;
  /** Durée totale en minutes, telle que l'API la sert ; absente si inconnue. */
  duration_min?: number;
  /** Ingrédients de la recette présents dans le stock, selon le serveur. */
  available_count?: number;
  /** Ingrédients de la recette absents du stock, selon le serveur. */
  missing_count?: number;
  dish_type?: string;
  score?: number;
  debug?: Record<string, unknown>;
  servings?: number;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function sanitizeRecipe(raw: any, fallbackIndex: number): BackendRecipeSuggestion {
  const prep = typeof raw?.prep_time_min === 'number' ? raw.prep_time_min : null;
  const cook = typeof raw?.cook_time_min === 'number' ? raw.cook_time_min : null;

  const usedIngredients = Array.isArray(raw?.usedIngredients)
    ? raw.usedIngredients.filter((item: unknown) => typeof item === 'string').map((item: string) => formatFrenchRecipeText(item))
    : Array.isArray(raw?.available_ingredients)
      ? raw.available_ingredients.filter((item: unknown) => typeof item === 'string').map((item: string) => formatFrenchRecipeText(item))
      : [];

  const missedIngredients = Array.isArray(raw?.missedIngredients)
    ? raw.missedIngredients.filter((item: unknown) => typeof item === 'string').map((item: string) => formatFrenchRecipeText(item))
    : Array.isArray(raw?.missing_ingredients)
      ? raw.missing_ingredients.filter((item: unknown) => typeof item === 'string').map((item: string) => formatFrenchRecipeText(item))
      : [];

  const existingDebug = typeof raw?.debug === 'object' && raw?.debug ? raw.debug : {};
  const topLevelSteps = Array.isArray(raw?.steps) ? raw.steps.filter((s: unknown) => typeof s === 'string') : [];
  const debugStepsRaw = Array.isArray(existingDebug.steps) ? existingDebug.steps : topLevelSteps;
  const debugSteps = debugStepsRaw
    .filter((step: unknown): step is string => typeof step === 'string')
    .map((step: string) => formatFrenchRecipeText(step));
  const debug = { ...existingDebug, steps: debugSteps };

  const ingredients = Array.isArray(raw?.ingredients)
    ? raw.ingredients
      .filter((item: unknown) => typeof item === 'object' && item !== null)
      .map((item: any) => ({
        name: formatFrenchRecipeText(typeof item.name === 'string' ? item.name : ''),
        quantity: typeof item.quantity === 'number' ? item.quantity : null,
        unit: typeof item.unit === 'string' ? item.unit : null,
        display_unit: typeof item.display_unit === 'string' ? item.display_unit : null,
        display_label: typeof item.display_label === 'string' ? item.display_label : null,
        optional: item.optional === true,
        available: item.available === true,
        matched_stock_item_ids: Array.isArray(item.matched_stock_item_ids)
          ? item.matched_stock_item_ids.filter((id: unknown) => typeof id === 'string')
          : [],
        missing_quantity: typeof item.missing_quantity === 'number' ? item.missing_quantity : null,
        is_estimated: item.is_estimated === true,
      }))
      .filter((item: { name: string }) => item.name.length > 0)
    : [];

  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : `recipe-${fallbackIndex}`,
    title: formatFrenchRecipeText(typeof raw?.title === 'string' ? raw.title : `Recette ${fallbackIndex + 1}`),
    image: typeof raw?.image === 'string' ? raw.image : '',
    summary: formatFrenchRecipeText(typeof raw?.summary === 'string' ? raw.summary : ''),
    usedIngredients,
    missedIngredients,
    ingredients,
    instructions_summary: formatFrenchRecipeText(typeof raw?.instructions_summary === 'string' ? raw.instructions_summary : ''),
    prep_time_min: prep,
    cook_time_min: cook,
    duration_min: resolveRecipeDurationMinutes({ duration_min: raw?.duration_min, prep_time_min: prep, cook_time_min: cook }) ?? undefined,
    available_count: nonNegativeInteger(raw?.available_count) ?? usedIngredients.length,
    missing_count: nonNegativeInteger(raw?.missing_count) ?? missedIngredients.length,
    dish_type: typeof raw?.dish_type === 'string' && raw.dish_type.trim() ? raw.dish_type.trim() : undefined,
    score: typeof raw?.score === 'number' ? raw.score : 0,
    debug,
    servings: typeof raw?.servings === 'number' && raw.servings > 0 ? raw.servings : 2,
  };
}
