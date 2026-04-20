const DEFAULT_FALLBACK_HREF = '/(tabs)/recipes';

export type BackNavigationAction =
  | { type: 'back' }
  | { type: 'replace'; href: string };

export function resolveBackNavigationAction(options: { canGoBack: boolean; fallbackHref?: string }): BackNavigationAction {
  if (options.canGoBack) {
    return { type: 'back' };
  }
  return { type: 'replace', href: options.fallbackHref ?? DEFAULT_FALLBACK_HREF };
}
