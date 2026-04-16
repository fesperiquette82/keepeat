import { create } from 'zustand';
import axios from 'axios';
import { buildApiUrl } from '../utils/config';
import { useAuthStore } from './authStore';
import { logger } from '../utils/logger';
import { formatFrenchRecipeText } from '../utils/recipeFrenchTypography';

export type RecipesFilter = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth';

export interface BackendRecipeSuggestion {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  usedIngredients?: string[];
  missedIngredients?: string[];
  ingredients?: Array<{
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
  }>;
  instructions_summary?: string;
  prep_time_min?: number | null;
  cook_time_min?: number | null;
  score?: number;
  debug?: Record<string, unknown>;
  servings?: number;
}

interface RecipesStoreState {
  suggestionsByFilter: Record<RecipesFilter, BackendRecipeSuggestion[]>;
  suggestLaterByFilter: Record<RecipesFilter, boolean>;
  isLoading: boolean;
  error: string | null;
  fetchSuggestions: (filter: RecipesFilter) => Promise<BackendRecipeSuggestion[]>;
  fetchRecipeById: (id: string) => Promise<BackendRecipeSuggestion | null>;
  getRecipeById: (id: string) => BackendRecipeSuggestion | null;
}

const FILTER_TO_API: Record<RecipesFilter, string> = {
  expiryDay: 'expiryDay',
  expiryWeek: 'expiryWeek',
  expiryMonth: 'expiryMonth',
  stock: 'stock',
};

function authHeaders() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
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
    score: typeof raw?.score === 'number' ? raw.score : 0,
    debug,
    servings: typeof raw?.servings === 'number' && raw.servings > 0 ? raw.servings : 2,
  };
}

export const useRecipesStore = create<RecipesStoreState>((set, get) => ({
  suggestionsByFilter: {
    stock: [],
    expiryDay: [],
    expiryWeek: [],
    expiryMonth: [],
  },
  suggestLaterByFilter: {
    stock: false,
    expiryDay: false,
    expiryWeek: false,
    expiryMonth: false,
  },
  isLoading: false,
  error: null,
  fetchSuggestions: async (filter) => {
    set({ isLoading: true, error: null });
    try {
      const apiFilter = FILTER_TO_API[filter];
      const response = await axios.get(buildApiUrl(`/api/recipes/suggestions?include_meta=true&filter=${encodeURIComponent(apiFilter)}`), {
        headers: authHeaders(),
      });
      const payload = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.recipes)
          ? response.data.recipes
          : [];
      const suggestLater = response.data?.meta?.suggest_later === true;
      const sanitized = payload.map((item: unknown, index: number) => sanitizeRecipe(item, index));
      set((state) => ({
        suggestionsByFilter: { ...state.suggestionsByFilter, [filter]: sanitized },
        suggestLaterByFilter: { ...state.suggestLaterByFilter, [filter]: suggestLater },
      }));
      return sanitized;
    } catch (error: any) {
      const message = error?.message ?? 'Impossible de récupérer les recettes.';
      logger.warn('[RECIPES] backend suggestions failed, fallback local only', { filter, message });
      set({ error: message });
      return [];
    } finally {
      set({ isLoading: false });
    }
  },
  fetchRecipeById: async (id) => {
    const cached = get().getRecipeById(id);
    if (cached) return cached;

    const filtersToScan: RecipesFilter[] = ['expiryDay', 'expiryWeek', 'expiryMonth', 'stock'];
    for (const filter of filtersToScan) {
      const recipes = await get().fetchSuggestions(filter);
      const found = recipes.find((recipe) => recipe.id === id);
      if (found) return found;
    }
    return null;
  },
  getRecipeById: (id) => {
    for (const recipeList of Object.values(get().suggestionsByFilter)) {
      const found = recipeList.find((recipe) => recipe.id === id);
      if (found) return found;
    }
    return null;
  },
}));
