const FAB_HIDDEN_ROUTES = new Set(['/scan', '/add-product', '/settings']);

const FAB_VISIBLE_LEAVES = new Set(['(tabs)', 'index', 'stock']);

export function shouldShowScanFab(pathname: string, segments: readonly string[]): boolean {
  if (FAB_HIDDEN_ROUTES.has(pathname)) {
    return false;
  }

  const activeLeaf = segments[segments.length - 1];
  return typeof activeLeaf === 'string' && FAB_VISIBLE_LEAVES.has(activeLeaf);
}
