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
