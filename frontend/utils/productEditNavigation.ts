export const PRODUCT_EDIT_ROUTE = '/edit-product' as const;
export const STOCK_DETAIL_EDIT_LABEL = 'Modifier';
export const STOCK_DETAIL_EDIT_ICON = 'create-outline' as const;

export function buildProductEditRoute(itemId: string) {
  return {
    pathname: PRODUCT_EDIT_ROUTE,
    params: { id: itemId },
  };
}
