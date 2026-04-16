import type { BackendRecipeSuggestion } from '../store/recipesStore';
import { buildRecipeIngredients, type IngredientUnit, type RecipeIngredient } from './recipeIngredients';

function asIngredientUnit(unit: unknown): IngredientUnit | null {
  if (typeof unit !== 'string') return null;
  const allowed: IngredientUnit[] = ['piece', 'g', 'kg', 'ml', 'cl', 'l', 'tsp', 'tbsp', 'pinch', 'pot', 'jar', 'can', 'slice', 'box'];
  return allowed.includes(unit as IngredientUnit) ? (unit as IngredientUnit) : null;
}

export function resolveRecipeIngredients(recipe: BackendRecipeSuggestion | null, baseServings: number): RecipeIngredient[] {
  if (!recipe) return [];

  const structured = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
      .filter((ingredient) => typeof ingredient?.name === 'string' && ingredient.name.trim().length > 0)
      .map((ingredient) => ({
        name: ingredient.name.trim(),
        quantity: typeof ingredient.quantity === 'number' ? ingredient.quantity : null,
        unit: asIngredientUnit(ingredient.unit),
      }))
    : [];

  if (structured.length > 0) return structured;

  const used = Array.isArray(recipe.usedIngredients) ? recipe.usedIngredients : [];
  const missed = Array.isArray(recipe.missedIngredients) ? recipe.missedIngredients : [];
  const names = Array.from(new Set([...used, ...missed].map((item) => item.trim()).filter(Boolean)));
  return buildRecipeIngredients(names, baseServings);
}
