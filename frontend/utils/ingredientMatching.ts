import type { StockItem } from '../store/stockStore';
import { logger } from './logger';

function normalizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') || token.endsWith('x')) return token.slice(0, -1);
  return token;
}

export function normalizeIngredientName(value: string): string {
  return value
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken)
    .join(' ')
    .trim();
}

export function isClearIngredientMatch(stockName: string, ingredientName: string): boolean {
  const stock = normalizeIngredientName(stockName);
  const ingredient = normalizeIngredientName(ingredientName);
  if (!stock || !ingredient) return false;
  if (stock === ingredient) return true;

  const stockTokens = new Set(stock.split(' ').filter((token) => token.length >= 3));
  const ingredientTokens = ingredient.split(' ').filter((token) => token.length >= 3);
  if (ingredientTokens.length === 0) return false;
  return ingredientTokens.every((token) => stockTokens.has(token));
}

function itemRank(item: StockItem): [number, number, string] {
  const expiry = item.expiry_date ? new Date(item.expiry_date).getTime() : Number.POSITIVE_INFINITY;
  const added = item.added_date ? new Date(item.added_date).getTime() : Number.POSITIVE_INFINITY;
  return [expiry, added, item.id];
}

export function matchRecipeIngredientsToStock(
  stockItems: StockItem[],
  ingredientNames: string[],
): { matchedIds: string[]; unmatchedIngredients: string[] } {
  const remaining = [...stockItems];
  const matchedIds: string[] = [];
  const unmatchedIngredients: string[] = [];

  for (const ingredientName of ingredientNames) {
    const candidates = remaining
      .filter((item) => item.status === 'active' && isClearIngredientMatch(item.name, ingredientName))
      .sort((a, b) => {
        const rankA = itemRank(a);
        const rankB = itemRank(b);
        if (rankA[0] !== rankB[0]) return rankA[0] - rankB[0];
        if (rankA[1] !== rankB[1]) return rankA[1] - rankB[1];
        return rankA[2].localeCompare(rankB[2]);
      });

    const picked = candidates[0];
    if (!picked) {
      unmatchedIngredients.push(ingredientName);
      continue;
    }

    matchedIds.push(picked.id);
    const idx = remaining.findIndex((item) => item.id === picked.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  return { matchedIds, unmatchedIngredients };
}

export interface RecipeIngredientAvailabilityInput {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface RecipeIngredientAvailability {
  availableIngredients: string[];
  missingIngredients: string[];
}

export function computeRecipeIngredientAvailability(
  stockItems: StockItem[],
  ingredients: RecipeIngredientAvailabilityInput[],
): RecipeIngredientAvailability {
  const activeStock = stockItems.filter((item) => item.status === 'active');
  const normalizedStock = activeStock.map((item) => ({
    id: item.id,
    name: item.name,
    normalizedName: normalizeIngredientName(item.name),
    quantity: item.quantity ?? null,
  }));

  const availableIngredients: string[] = [];
  const missingIngredients: string[] = [];

  for (const ingredient of ingredients) {
    const normalizedIngredient = normalizeIngredientName(ingredient.name);
    const matched = normalizedStock.find((candidate) =>
      isClearIngredientMatch(candidate.name, ingredient.name),
    );

    logger.debug('[RECIPES_MATCH] ingredient evaluation', {
      ingredientName: ingredient.name,
      ingredientNormalized: normalizedIngredient,
      requestedQuantity: ingredient.quantity ?? null,
      requestedUnit: ingredient.unit ?? null,
      comparedStockProducts: normalizedStock.map((item) => ({
        id: item.id,
        name: item.name,
        normalizedName: item.normalizedName,
        quantity: item.quantity,
      })),
      matchedStockProduct: matched
        ? {
            id: matched.id,
            name: matched.name,
            normalizedName: matched.normalizedName,
            quantity: matched.quantity,
          }
        : null,
      reason: matched ? 'normalized_token_match' : 'no_normalized_match',
    });

    if (matched) {
      availableIngredients.push(ingredient.name);
    } else {
      missingIngredients.push(ingredient.name);
    }
  }

  return { availableIngredients, missingIngredients };
}
