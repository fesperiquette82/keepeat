import type { StockItem } from '../store/stockStore';
import { resolveStockItemImageUrl } from './stockItemImage';

// Code métier du stock tel que les écrans l'affichent. Il vivait dans
// data/mockDashboardData.ts, à côté d'un jeu de faux produits que l'accueil
// affichait dès que le stock était vide (BUG-098). Ici, aucune donnée
// d'exemple : un stock vide reste vide.

export type StorageZone = 'frigo' | 'placard';

export interface DashboardStockItem extends StockItem {
  storageZone: StorageZone;
}

export type RecipeSuggestionScope = 'stock' | 'expiryDay' | 'expiryWeek' | 'expiryMonth';

const FRIDGE_FOOD_CATEGORIES = ['frais', 'proteines', 'legumes', 'boissons'];

export function daysUntil(expiryDate?: string): number | null {
  if (!expiryDate) return null;
  const value = String(expiryDate).trim();
  if (!value) return null;

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let expiryUtcMs: number;
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    expiryUtcMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    expiryUtcMs = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }

  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiryUtcMs - todayUtcMs) / 86400000);
}

/** Produits du stock prêts à l'affichage (image résolue, zone de rangement).
 *  Ne renvoie que les produits reçus : jamais de données d'exemple. */
export function resolveStockItems(items: StockItem[]): DashboardStockItem[] {
  return items.map((item) => ({
    ...item,
    image_url: resolveStockItemImageUrl(item),
    storageZone: item.food_category && FRIDGE_FOOD_CATEGORIES.includes(item.food_category)
      ? 'frigo'
      : 'placard',
  }));
}

export function findExpiringSoon(items: DashboardStockItem[], limit = 3): DashboardStockItem[] {
  return [...items]
    .filter((item) => item.expiry_date)
    .sort((a, b) => (daysUntil(a.expiry_date) ?? 999) - (daysUntil(b.expiry_date) ?? 999))
    .slice(0, limit);
}

export function getActiveItemsByScope(items: DashboardStockItem[], scope: RecipeSuggestionScope): DashboardStockItem[] {
  const activeItems = items.filter((item) => item.status === 'active');
  if (scope === 'stock') return activeItems;

  const maxDaysByScope: Record<Exclude<RecipeSuggestionScope, 'stock'>, number> = {
    expiryDay: 0,
    expiryWeek: 7,
    expiryMonth: 31,
  };

  return activeItems.filter((item) => {
    const days = daysUntil(item.expiry_date);
    if (days === null) return false;
    return days >= 0 && days <= maxDaysByScope[scope];
  });
}

export type HomeStockOverviewState = 'list' | 'no-urgent' | 'loading' | 'empty';

/** Ce que l'accueil affiche dans « Aperçu du stock ». Un stock vide donne un
 *  état vide (ou un chargement en cours), jamais une liste de substitution. */
export function resolveHomeStockOverviewState(input: {
  itemCount: number;
  expiringSoonCount: number;
  isLoading: boolean;
}): HomeStockOverviewState {
  if (input.expiringSoonCount > 0) return 'list';
  if (input.itemCount > 0) return 'no-urgent';
  return input.isLoading ? 'loading' : 'empty';
}
