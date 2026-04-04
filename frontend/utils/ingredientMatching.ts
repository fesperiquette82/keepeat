import type { StockItem } from '../store/stockStore';

function normalizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') || token.endsWith('x')) return token.slice(0, -1);
  return token;
}

export function normalizeIngredientName(value: string): string {
  return value
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
