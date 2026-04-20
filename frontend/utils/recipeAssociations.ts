import { dedupeRecipesById } from './recipesScoping';
import {
  buildStockItemRecipeSections,
  type RecipeCandidate,
} from './stockItemRecipes';
import type { DashboardStockItem } from '../data/mockDashboardData';

export type StockMutationRefreshSource =
  | 'stock.add.manual'
  | 'stock.add.barcode'
  | 'stock.add.receipt_ocr'
  | 'stock.add.import'
  | 'stock.update'
  | 'stock.delete'
  | 'stock.consume'
  | 'stock.throw'
  | 'stock.restore'
  | 'stock.fetch';

export const STOCK_ASSOCIATION_REFRESH_SOURCES: StockMutationRefreshSource[] = [
  'stock.add.manual',
  'stock.add.barcode',
  'stock.add.receipt_ocr',
  'stock.add.import',
  'stock.update',
  'stock.delete',
  'stock.consume',
  'stock.throw',
  'stock.restore',
  'stock.fetch',
];

export interface RecipeAssociationsSnapshot {
  recipes: RecipeCandidate[];
  associationsByStockItemId: Record<string, RecipeCandidate[]>;
}

export function buildRecipeAssociationsSnapshot(
  stockItems: DashboardStockItem[],
  recipes: RecipeCandidate[],
): RecipeAssociationsSnapshot {
  const uniqueRecipes = dedupeRecipesById(recipes) as RecipeCandidate[];
  const associationsByStockItemId: Record<string, RecipeCandidate[]> = {};

  stockItems.forEach((item) => {
    const sections = buildStockItemRecipeSections(item, stockItems, uniqueRecipes);
    associationsByStockItemId[item.id] = sections.directRecipes;
  });

  return { recipes: uniqueRecipes, associationsByStockItemId };
}

