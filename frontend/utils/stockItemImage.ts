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
  const candidates = getImageCandidates(item);
  const normalized = candidates.map((value) => normalizeImageCandidate(value));
  const result = normalized.find((value): value is string => typeof value === 'string');

  // Debug log for image resolution issues
  if (typeof item === 'object' && item !== null) {
    const itemRecord = item as Record<string, unknown>;
    if (!result && (itemRecord.image_url || itemRecord.imageUrl)) {
      console.warn('[stockItemImage] No valid image URL resolved despite candidates present', {
        itemName: itemRecord.name,
        directImageUrl: itemRecord.image_url,
        directImageUrlType: typeof itemRecord.image_url,
        candidates: candidates.slice(0, 3), // Only log first 3 to avoid spam
        normalizedResults: normalized.slice(0, 3),
      });
    }
  }

  return result;
}

export function resolveStockItemImageUrlWithFallback(item: unknown, fallbackItem: unknown): string | undefined {
  return resolveStockItemImageUrl(item) ?? resolveStockItemImageUrl(fallbackItem);
}
