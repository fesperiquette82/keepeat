import { create } from 'zustand';
import axios from 'axios';
import { buildApiUrl } from '../utils/config';
import { useAuthStore } from './authStore';
import { logger } from '../utils/logger';
import { formatFrenchRecipeText } from '../utils/recipeFrenchTypography';
import {
  buildRecipeAssociationsSnapshot,
  type StockMutationRefreshSource,
} from '../utils/recipeAssociations';
import { shouldBootstrapRecipeAssociationsCache } from '../utils/recipeCacheBootstrap';
import { resolveRecipeDetailLoadPolicy } from '../utils/recipeDetailLoadPolicy';
import type { DashboardStockItem } from '../data/mockDashboardData';
import type { RecipeCandidate } from '../utils/stockItemRecipes';

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
  associationsByStockItemId: Record<string, RecipeCandidate[]>;
  recipesById: Record<string, BackendRecipeSuggestion>;
  isLoading: boolean;
  error: string | null;
  fetchSuggestions: (filter: RecipesFilter) => Promise<BackendRecipeSuggestion[]>;
  refreshRecipeAssociationsForStockMutation: (input: {
    source: StockMutationRefreshSource;
    stockItems: DashboardStockItem[];
  }) => Promise<Record<string, RecipeCandidate[]>>;
  ensureRecipeAssociationsFromCache: (stockItems: DashboardStockItem[]) => Promise<Record<string, RecipeCandidate[]>>;
  recomputeRecipeAssociationsFromCache: (stockItems: DashboardStockItem[]) => Record<string, RecipeCandidate[]>;
  fetchRecipeById: (id: string) => Promise<BackendRecipeSuggestion | null>;
  getRecipeById: (id: string) => BackendRecipeSuggestion | null;
  getRecipesForStockItem: (stockItemId: string) => RecipeCandidate[];
}

const FILTER_TO_API: Record<RecipesFilter, string> = {
  expiryDay: 'expiryDay',
  expiryWeek: 'expiryWeek',
  expiryMonth: 'expiryMonth',
  stock: 'stock',
};

const inFlightRecipeDetailRequests: Record<string, Promise<BackendRecipeSuggestion | null>> = {};

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
  associationsByStockItemId: {},
  recipesById: {},
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
      const sanitized: BackendRecipeSuggestion[] = payload.map((item: unknown, index: number) => sanitizeRecipe(item, index));
      const recipesByIdFromBatch: Record<string, BackendRecipeSuggestion> = sanitized.reduce((acc, recipe) => {
        acc[recipe.id] = recipe;
        return acc;
      }, {} as Record<string, BackendRecipeSuggestion>);
      set((state) => ({
        suggestionsByFilter: { ...state.suggestionsByFilter, [filter]: sanitized },
        suggestLaterByFilter: { ...state.suggestLaterByFilter, [filter]: suggestLater },
        recipesById: { ...state.recipesById, ...recipesByIdFromBatch },
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
  refreshRecipeAssociationsForStockMutation: async ({ source, stockItems }) => {
    const filters: RecipesFilter[] = ['stock', 'expiryDay', 'expiryWeek', 'expiryMonth'];
    const recipeBatches = await Promise.all(filters.map((filter) => get().fetchSuggestions(filter)));
    const snapshot = buildRecipeAssociationsSnapshot(
      stockItems,
      recipeBatches.flat() as BackendRecipeSuggestion[],
    );
    set({ associationsByStockItemId: snapshot.associationsByStockItemId });
    logger.info('[RECIPES_MATCH] recipe associations refreshed', {
      source,
      stockItemsCount: stockItems.length,
      recipesCount: snapshot.recipes.length,
      associatedStockItemsCount: Object.keys(snapshot.associationsByStockItemId).length,
    });
    return snapshot.associationsByStockItemId;
  },
  ensureRecipeAssociationsFromCache: async (stockItems) => {
    const suggestionsByFilter = get().suggestionsByFilter;
    if (shouldBootstrapRecipeAssociationsCache(suggestionsByFilter)) {
      logger.debug('[RECIPES_MATCH] associations cache empty on cold start, bootstrapping stock suggestions');
      await get().fetchSuggestions('stock');
    }
    return get().recomputeRecipeAssociationsFromCache(stockItems);
  },
  recomputeRecipeAssociationsFromCache: (stockItems) => {
    const cachedRecipes = Object.values(get().suggestionsByFilter).flat() as BackendRecipeSuggestion[];
    const snapshot = buildRecipeAssociationsSnapshot(stockItems, cachedRecipes);
    set({ associationsByStockItemId: snapshot.associationsByStockItemId });
    logger.debug('[RECIPES_MATCH] recipe associations recomputed from cache', {
      stockItemsCount: stockItems.length,
      cachedRecipesCount: cachedRecipes.length,
      associatedStockItemsCount: Object.keys(snapshot.associationsByStockItemId).length,
    });
    return snapshot.associationsByStockItemId;
  },
  fetchRecipeById: async (id) => {
    const cached = get().getRecipeById(id);
    const decision = resolveRecipeDetailLoadPolicy({
      hasRecipeInCache: !!cached,
      hasInFlightRequest: !!inFlightRecipeDetailRequests[id],
    });

    if (decision.useCacheFirst && cached) {
      logger.debug('[RECIPES_DETAIL_PERF] recipe resolved from local cache', { recipeId: id });
      return cached;
    }

    if (decision.shouldAwaitInFlight) {
      logger.debug('[RECIPES_DETAIL_PERF] awaiting in-flight recipe detail request', { recipeId: id });
      return inFlightRecipeDetailRequests[id];
    }

    logger.debug('[RECIPES_DETAIL_PERF] recipe missing in cache, requesting backend by id', { recipeId: id });
    inFlightRecipeDetailRequests[id] = (async () => {
      try {
        const response = await axios.get(buildApiUrl(`/api/recipes/${encodeURIComponent(id)}`), {
          headers: authHeaders(),
        });
        const recipe = sanitizeRecipe(response.data, 0);
        set((state) => ({
          recipesById: { ...state.recipesById, [recipe.id]: recipe },
          suggestionsByFilter: {
            ...state.suggestionsByFilter,
            stock: [recipe, ...state.suggestionsByFilter.stock.filter((item) => item.id !== recipe.id)],
          },
        }));
        logger.debug('[RECIPES_DETAIL_PERF] recipe fetched by id and cached', { recipeId: recipe.id });
        return recipe;
      } catch (error: any) {
        logger.warn('[RECIPES_DETAIL_PERF] recipe by id request failed', {
          recipeId: id,
          message: error?.message ?? String(error),
        });
        return null;
      } finally {
        delete inFlightRecipeDetailRequests[id];
      }
    })();

    const fetched = await inFlightRecipeDetailRequests[id];
    if (fetched) return fetched;

    const fallbackCached = get().recipesById[id] ?? null;
    if (fallbackCached) return fallbackCached;
    return null;
  },
  getRecipeById: (id) => {
    const byId = get().recipesById[id];
    if (byId) return byId;
    for (const recipeList of Object.values(get().suggestionsByFilter)) {
      const found = recipeList.find((recipe) => recipe.id === id);
      if (found) return found;
    }
    return null;
  },
  getRecipesForStockItem: (stockItemId) => {
    return get().associationsByStockItemId[stockItemId] ?? [];
  },
}));
