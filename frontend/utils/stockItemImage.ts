function normalizeImageCandidate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  return trimmed;
}

function getImageCandidates(item: unknown): unknown[] {
  if (!item || typeof item !== 'object') return [];

  const candidate = item as Record<string, unknown>;
  const nestedProduct = candidate.product && typeof candidate.product === 'object'
    ? candidate.product as Record<string, unknown>
    : null;
  const nestedProductData = candidate.product_data && typeof candidate.product_data === 'object'
    ? candidate.product_data as Record<string, unknown>
    : null;
  const nestedProductDataCamel = candidate.productData && typeof candidate.productData === 'object'
    ? candidate.productData as Record<string, unknown>
    : null;

  const directCandidates = [candidate.image_url, candidate.imageUrl, candidate.imageUri, candidate.image];
  const nestedCandidates = [
    nestedProduct,
    nestedProductData,
    nestedProductDataCamel,
  ].flatMap((entry) => (
    entry ? [entry.image_url, entry.imageUrl, entry.imageUri, entry.image] : []
  ));

  return [...directCandidates, ...nestedCandidates];
}

export function resolveStockItemImageUrl(item: unknown): string | undefined {
  return getImageCandidates(item)
    .map((value) => normalizeImageCandidate(value))
    .find((value): value is string => typeof value === 'string');
}

export function resolveStockItemImageUrlWithFallback(item: unknown, fallbackItem: unknown): string | undefined {
  return resolveStockItemImageUrl(item) ?? resolveStockItemImageUrl(fallbackItem);
}
