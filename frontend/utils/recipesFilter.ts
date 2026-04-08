export type RecipesApiFilter = 'expiryDay' | 'expiryWeek' | 'expiryMonth' | 'stock';

const FILTER_MAP: Record<RecipesApiFilter, string> = {
  expiryDay: 'expiryDay',
  expiryWeek: 'expiryWeek',
  expiryMonth: 'expiryMonth',
  stock: 'stock',
};

export function mapRecipesFilterToApi(filter: RecipesApiFilter): string {
  return FILTER_MAP[filter];
}
