import axios from 'axios';
import { buildApiUrl } from './config';
import { useAuthStore } from '../store/authStore';
import { mapRecipesFilterToApi, RecipesApiFilter } from './recipesFilter';

const authHeaders = () => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface BackendRecipeSuggestion {
  id: string;
  title: string;
  description?: string;
  duration_min?: number;
  dish_type?: string;
  available_count: number;
  missing_count: number;
  available_ingredients: string[];
  missing_ingredients: string[];
  steps?: string[];
  score?: number;
}

export interface BackendRecipesSuggestionsResponse {
  recipes: BackendRecipeSuggestion[];
  meta?: {
    total_candidates?: number;
    returned?: number;
    gap_logged?: boolean;
    suggest_later?: boolean;
  };
}

export async function fetchRecipesSuggestions(filter: RecipesApiFilter): Promise<BackendRecipesSuggestionsResponse> {
  const response = await axios.get(
    buildApiUrl(`/api/recipes/suggestions?include_meta=true&filter=${mapRecipesFilterToApi(filter)}`),
    { headers: authHeaders() },
  );
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { recipes: payload };
  }
  return payload;
}

export async function fetchRecipeById(recipeId: string): Promise<any> {
  const response = await axios.get(buildApiUrl(`/api/recipes/${encodeURIComponent(recipeId)}`), {
    headers: authHeaders(),
  });
  return response.data;
}
