import { create } from 'zustand';
import axios from 'axios';
import { buildApiUrl } from '../utils/config';
import { useAuthStore } from './authStore';
import { usePremiumUiStore } from './premiumUiStore';
import { extractPremiumErrorDetail } from '../utils/premiumErrors';
import { logger } from '../utils/logger';
import { sanitizeRecipe, type BackendRecipeSuggestion } from '../utils/recipeSanitizer';
import {
  buildRecipeAssociationsSnapshot,
  type StockMutationRefreshSource,
} from '../utils/recipeAssociations';
import { shouldBootstrapRecipeAssociationsCache } from '../utils/recipeCacheBootstrap';
import { resolveRecipeDetailLoadPolicy } from '../utils/recipeDetailLoadPolicy';
import type { DashboardStockItem } from '../utils/stockDashboard';
import type { RecipeCandidate } from '../utils/stockItemRecipes';
import { getErrorMessage } from '../utils/errorDetails';

export type RecipesFilter = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth';

export { sanitizeRecipe };
export type { BackendRecipeSuggestion };

interface RecipesStoreState {
  suggestionsByFilter: Record<RecipesFilter, BackendRecipeSuggestion[]>;
  suggestLaterByFilter: Record<RecipesFilter, boolean>;
  associationsByStockItemId: Record<string, RecipeCandidate[]>;
  recipesById: Record<string, BackendRecipeSuggestion>;
  isLoading: boolean;
  error: string | null;
  fetchSuggestions: (filter: RecipesFilter, countUsage?: boolean) => Promise<BackendRecipeSuggestion[]>;
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
  fetchSuggestions: async (filter, countUsage = true) => {
    set({ isLoading: true, error: null });
    try {
      const apiFilter = FILTER_TO_API[filter];
      const countUsageParam = countUsage ? '' : '&count_usage=false';
      const response = await axios.get(buildApiUrl(`/api/recipes/suggestions?include_meta=true&filter=${encodeURIComponent(apiFilter)}${countUsageParam}`), {
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
    } catch (error: unknown) {
      const premiumError = extractPremiumErrorDetail(error);
      if (premiumError) {
        usePremiumUiStore.getState().openPaywall(premiumError);
      }
      const message = getErrorMessage(error) ?? 'Impossible de récupérer les recettes.';
      logger.warn('[RECIPES] backend suggestions failed, fallback local only', { filter, message });
      set({ error: message });
      return [];
    } finally {
      set({ isLoading: false });
    }
  },
  refreshRecipeAssociationsForStockMutation: async ({ source, stockItems }) => {
    const filters: RecipesFilter[] = ['stock', 'expiryDay', 'expiryWeek', 'expiryMonth'];
    const recipeBatches = await Promise.all(filters.map((filter) => get().fetchSuggestions(filter, false)));
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
      await get().fetchSuggestions('stock', false);
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
      } catch (error: unknown) {
        logger.warn('[RECIPES_DETAIL_PERF] recipe by id request failed', {
          recipeId: id,
          message: getErrorMessage(error) ?? String(error),
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
