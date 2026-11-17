export type PostLoginDestination = '/onboarding' | '/(tabs)';

/**
 * BUG-043 (audit commercial, point 10) — décide où atterrit un utilisateur
 * authentifié : l'onboarding ne doit se déclencher que pour un utilisateur
 * qui ne l'a jamais vu ET dont le stock est vide. Un utilisateur qui a déjà
 * des produits (import, autre appareil, session précédente) n'a rien à
 * apprendre de cet écran — l'y envoyer serait juste un obstacle de plus.
 */
export function resolvePostLoginDestination(options: {
  hasSeenOnboarding: boolean;
  hasStockItems: boolean;
}): PostLoginDestination {
  if (!options.hasSeenOnboarding && !options.hasStockItems) {
    return '/onboarding';
  }
  return '/(tabs)';
}

export const REMOTE_STOCK_CHECK_TIMEOUT_MS = 4000;

/**
 * BUG-095 — décision complète après connexion. `resolvePostLoginDestination`
 * ne voit que le stock LOCAL : sur un nouvel appareil (ou après réinstallation)
 * il est vide au moment de décider, et un utilisateur qui a déjà des produits
 * sur le serveur était envoyé vers l'onboarding, contrairement à l'intention de
 * BUG-043. Quand l'onboarding n'a pas été vu et que le stock local est vide, on
 * charge le stock distant (borné dans le temps, sans jamais lever) avant de
 * trancher ; en cas d'échec ou de lenteur, on retombe sur la décision locale.
 */
export async function decidePostLoginDestination(options: {
  hasSeenOnboarding: boolean;
  localStockCount: () => number;
  loadRemoteStock: () => Promise<void>;
  timeoutMs?: number;
}): Promise<PostLoginDestination> {
  const { hasSeenOnboarding, localStockCount, loadRemoteStock } = options;
  if (hasSeenOnboarding || localStockCount() > 0) {
    return resolvePostLoginDestination({ hasSeenOnboarding, hasStockItems: localStockCount() > 0 });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      loadRemoteStock(),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, options.timeoutMs ?? REMOTE_STOCK_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Réseau indisponible : la décision locale s'applique.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return resolvePostLoginDestination({ hasSeenOnboarding, hasStockItems: localStockCount() > 0 });
}
