import { logger } from './logger';

export type ReceiptStorageZone = 'fridge' | 'pantry' | 'freezer';

export interface ReceiptExpiryProduct {
  name: string;
  purchase_date?: string | null;
  category?: string;
  estimated_expiration_date?: string | null;
  estimated_shelf_life_days?: number | null;
  shelf_life_fridge?: number | null;
  shelf_life_pantry?: number | null;
  shelf_life_freezer?: number | null;
}

export function defaultReceiptZone(product: ReceiptExpiryProduct): ReceiptStorageZone {
  if (product.shelf_life_fridge) return 'fridge';
  if (product.shelf_life_pantry) return 'pantry';
  if (product.shelf_life_freezer) return 'freezer';
  return 'pantry';
}

function parseBaseDate(rawDate?: string | null): Date {
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function daysForZone(product: ReceiptExpiryProduct, zone: ReceiptStorageZone): number | null | undefined {
  if (zone === 'fridge') return product.shelf_life_fridge;
  if (zone === 'pantry') return product.shelf_life_pantry;
  return product.shelf_life_freezer;
}

export function computeReceiptItemExpiry(product: ReceiptExpiryProduct, zone: ReceiptStorageZone): string | undefined {
  const explicitEstimate = typeof product.estimated_expiration_date === 'string'
    ? product.estimated_expiration_date.slice(0, 10)
    : undefined;
  if (explicitEstimate) return explicitEstimate;

  const preferredZone = defaultReceiptZone(product);
  const candidateDays = [
    daysForZone(product, zone),
    daysForZone(product, preferredZone),
    product.shelf_life_fridge,
    product.shelf_life_pantry,
    product.shelf_life_freezer,
    product.estimated_shelf_life_days,
  ];

  const chosenDays = candidateDays.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (!chosenDays) {
    logger.warn('[OCR] no shelf-life estimate available for receipt item', {
      name: product.name,
      category: product.category,
      selected_zone: zone,
      preferred_zone: preferredZone,
    });
    return undefined;
  }

  const baseDate = parseBaseDate(product.purchase_date);
  baseDate.setDate(baseDate.getDate() + chosenDays);
  return baseDate.toISOString().split('T')[0];
}
