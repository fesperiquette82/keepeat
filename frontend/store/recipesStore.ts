import { create } from 'zustand';
import axios from 'axios';
import { buildApiUrl } from '../utils/config';
import { useAuthStore } from './authStore';
import { logger } from '../utils/logger';

export type RecipesFilter = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth';

export interface BackendRecipeSuggestion {
  id: string;
  title: string;
  image?: string;
  usedIngredients?: string[];
  missedIngredients?: string[];
  instructions_summary?: string;
  prep_time_min?: number | null;
  cook_time_min?: number | null;
  score?: number;
  debug?: Record<string, unknown>;
}

interface RecipesStoreState {
  suggestionsByFilter: Record<RecipesFilter, BackendRecipeSuggestion[]>;
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
  stock: 'all',
};

function authHeaders() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sanitizeRecipe(raw: any, fallbackIndex: number): BackendRecipeSuggestion {
  const prep = typeof raw?.prep_time_min === 'number' ? raw.prep_time_min : null;
  const cook = typeof raw?.cook_time_min === 'number' ? raw.cook_time_min : null;
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : `recipe-${fallbackIndex}`,
    title: typeof raw?.title === 'string' ? raw.title : `Recette ${fallbackIndex + 1}`,
    image: typeof raw?.image === 'string' ? raw.image : '',
    usedIngredients: Array.isArray(raw?.usedIngredients) ? raw.usedIngredients.filter((item: unknown) => typeof item === 'string') : [],
    missedIngredients: Array.isArray(raw?.missedIngredients) ? raw.missedIngredients.filter((item: unknown) => typeof item === 'string') : [],
    instructions_summary: typeof raw?.instructions_summary === 'string' ? raw.instructions_summary : '',
    prep_time_min: prep,
    cook_time_min: cook,
    score: typeof raw?.score === 'number' ? raw.score : 0,
    debug: typeof raw?.debug === 'object' && raw?.debug ? raw.debug : {},
  };
}

export const useRecipesStore = create<RecipesStoreState>((set, get) => ({
  suggestionsByFilter: {
    stock: [],
    expiryDay: [],
    expiryWeek: [],
    expiryMonth: [],
  },
  isLoading: false,
  error: null,
  fetchSuggestions: async (filter) => {
    set({ isLoading: true, error: null });
    try {
      const apiFilter = FILTER_TO_API[filter];
      const response = await axios.get(buildApiUrl(`/api/recipes/suggestions?filter=${encodeURIComponent(apiFilter)}`), {
        headers: authHeaders(),
      });
      const payload = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.recipes)
          ? response.data.recipes
          : [];
      const sanitized = payload.map((item: unknown, index: number) => sanitizeRecipe(item, index));
      set((state) => ({
        suggestionsByFilter: { ...state.suggestionsByFilter, [filter]: sanitized },
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
