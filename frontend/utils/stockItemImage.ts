export function resolveStockItemImageUrl(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;

  const candidate = item as Record<string, unknown>;
  const nestedProduct = candidate.product && typeof candidate.product === 'object'
    ? candidate.product as Record<string, unknown>
    : null;

  const directCandidates = [
    candidate.image_url,
    candidate.imageUrl,
    candidate.imageUri,
    candidate.image,
  ];
  const nestedCandidates = nestedProduct
    ? [nestedProduct.image_url, nestedProduct.imageUrl, nestedProduct.imageUri, nestedProduct.image]
    : [];

  const rawValue = [...directCandidates, ...nestedCandidates].find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );

  return typeof rawValue === 'string' ? rawValue.trim() : undefined;
}
