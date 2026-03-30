import type { StockItem } from '../store/stockStore';

export type StorageZone = 'frigo' | 'placard';

export interface DashboardStockItem extends StockItem {
  storageZone: StorageZone;
}

export interface MockRecipe {
  id: string;
  title: string;
  timeMinutes: number;
  missingCount: number;
  matchRate: number;
  ingredients: string[];
}

const TODAY = new Date('2026-03-30T12:00:00Z');

function isoInDays(days: number): string {
  const value = new Date(TODAY);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

export const MOCK_STOCK_ITEMS: DashboardStockItem[] = [
  { id: 'm1', name: 'Yaourt nature', brand: 'Danone', food_category: 'frais', storageZone: 'frigo', quantity: '4 pots', expiry_date: isoInDays(2), added_date: isoInDays(-3), status: 'active' },
  { id: 'm2', name: 'Lait demi-écrémé', brand: 'Lactel', food_category: 'boissons', storageZone: 'frigo', quantity: '1 bouteille', expiry_date: isoInDays(5), added_date: isoInDays(-6), status: 'active' },
  { id: 'm3', name: 'Courgettes', brand: 'Primeur', food_category: 'legumes', storageZone: 'frigo', quantity: '3 pièces', expiry_date: isoInDays(1), added_date: isoInDays(-2), status: 'active' },
  { id: 'm4', name: 'Poulet émincé', brand: 'Fermier', food_category: 'proteines', storageZone: 'frigo', quantity: '450g', expiry_date: isoInDays(0), added_date: isoInDays(-1), status: 'active' },
  { id: 'm5', name: 'Tomates concassées', brand: 'Mutti', food_category: 'epicerie', storageZone: 'placard', quantity: '2 boîtes', expiry_date: isoInDays(45), added_date: isoInDays(-20), status: 'active' },
  { id: 'm6', name: 'Pâtes complètes', brand: 'Barilla', food_category: 'feculents', storageZone: 'placard', quantity: '500g', expiry_date: isoInDays(180), added_date: isoInDays(-15), status: 'active' },
  { id: 'm7', name: 'Riz basmati', brand: 'Taureau Ailé', food_category: 'feculents', storageZone: 'placard', quantity: '1 kg', expiry_date: isoInDays(260), added_date: isoInDays(-45), status: 'active' },
  { id: 'm8', name: 'Pois chiches', brand: 'Bonduelle', food_category: 'epicerie', storageZone: 'placard', quantity: '1 bocal', expiry_date: isoInDays(90), added_date: isoInDays(-12), status: 'active' },
  { id: 'm9', name: 'Œufs', brand: 'Plein Air', food_category: 'proteines', storageZone: 'frigo', quantity: '6', expiry_date: isoInDays(4), added_date: isoInDays(-4), status: 'active' },
  { id: 'm10', name: 'Huile d’olive', brand: 'Puget', food_category: 'epicerie', storageZone: 'placard', quantity: '1 bouteille', expiry_date: isoInDays(320), added_date: isoInDays(-90), status: 'active' },
];

export const MOCK_RECIPES: Omit<MockRecipe, 'missingCount' | 'matchRate'>[] = [
  { id: 'r1', title: 'Poêlée courgettes & poulet', timeMinutes: 20, ingredients: ['Courgettes', 'Poulet émincé', 'Huile d’olive'] },
  { id: 'r2', title: 'Shakshuka express', timeMinutes: 25, ingredients: ['Tomates concassées', 'Œufs', 'Huile d’olive'] },
  { id: 'r3', title: 'Salade pois chiches & yaourt', timeMinutes: 15, ingredients: ['Pois chiches', 'Yaourt nature', 'Tomates concassées'] },
  { id: 'r4', title: 'Pâtes crémeuses au lait', timeMinutes: 18, ingredients: ['Pâtes complètes', 'Lait demi-écrémé', 'Courgettes'] },
];

export function daysUntil(expiryDate?: string): number | null {
  if (!expiryDate) return null;
  const today = new Date(TODAY);
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setUTCHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86400000);
}

export function resolveStockItems(
  items: StockItem[],
  options?: { useMockFallback?: boolean },
): { items: DashboardStockItem[]; isMock: boolean } {
  if (items.length > 0) {
    return {
      isMock: false,
      items: items.map((item) => ({
        ...item,
        storageZone: item.food_category && ['frais', 'proteines', 'legumes', 'boissons'].includes(item.food_category)
          ? 'frigo'
          : 'placard',
      })),
    };
  }

  if (options?.useMockFallback === false) {
    return { items: [], isMock: false };
  }

  return { items: MOCK_STOCK_ITEMS, isMock: true };
}

export function findExpiringSoon(items: DashboardStockItem[], limit = 3): DashboardStockItem[] {
  return [...items]
    .filter((item) => item.expiry_date)
    .sort((a, b) => (daysUntil(a.expiry_date) ?? 999) - (daysUntil(b.expiry_date) ?? 999))
    .slice(0, limit);
}

export function buildRecipeSuggestions(items: DashboardStockItem[]): MockRecipe[] {
  const names = new Set(items.map((item) => item.name.toLowerCase()));

  return MOCK_RECIPES.map((recipe) => {
    const matched = recipe.ingredients.filter((ingredient) => names.has(ingredient.toLowerCase())).length;
    const missingCount = Math.max(recipe.ingredients.length - matched, 0);
    const matchRate = Math.round((matched / recipe.ingredients.length) * 100);
    return { ...recipe, missingCount, matchRate };
  }).sort((a, b) => b.matchRate - a.matchRate || a.missingCount - b.missingCount);
}
