import { resolveBackNavigationAction } from './navigationBack';

export function resolveRecipeDetailBackAction(canGoBack: boolean) {
  return resolveBackNavigationAction({
    canGoBack,
    fallbackHref: '/(tabs)/recipes',
  });
}
