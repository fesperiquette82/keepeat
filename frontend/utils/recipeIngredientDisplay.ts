import type { StockItem } from '../store/stockStore';
import { mapRecipeIngredientsToStock } from './ingredientMatching';

export interface RecipeIngredientDisplayInput {
  name: string;
  quantity: number;
  unit: string;
}

export interface RecipeIngredientDisplayRow {
  ingredient: RecipeIngredientDisplayInput;
  isAvailable: boolean;
  imageUrl: string | null;
  usesPlaceholder: boolean;
  matchedStockItemId: string | null;
}

export function buildRecipeIngredientDisplayRows(
  stockItems: StockItem[],
  ingredients: RecipeIngredientDisplayInput[],
): RecipeIngredientDisplayRow[] {
  const { matches } = mapRecipeIngredientsToStock(stockItems, ingredients.map((ingredient) => ingredient.name));

  return ingredients.map((ingredient, index) => {
    const matchedStockItem = matches[index]?.stockItem ?? null;
    const imageUrl = typeof matchedStockItem?.image_url === 'string' && matchedStockItem.image_url.trim().length > 0
      ? matchedStockItem.image_url
      : null;

    return {
      ingredient,
      isAvailable: !!matchedStockItem,
      imageUrl,
      usesPlaceholder: !imageUrl,
      matchedStockItemId: matchedStockItem?.id ?? null,
    };
  });
}
