export const STOCK_FETCH_TTL_MS = 30_000;

export interface StockFetchPolicyInput {
  hasItemsInStore: boolean;
  lastFetchAt: number | null;
  now?: number;
  ttlMs?: number;
  force?: boolean;
}

export function shouldSkipStockFetch(input: StockFetchPolicyInput): boolean {
  if (input.force) return false;
  if (!input.hasItemsInStore) return false;
  if (!input.lastFetchAt) return false;

  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? STOCK_FETCH_TTL_MS;
  return now - input.lastFetchAt < ttlMs;
}

