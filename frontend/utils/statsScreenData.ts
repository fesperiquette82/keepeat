/**
 * Chargement des données de l'onglet Statistiques (BUG-096).
 *
 * Les statistiques mensuelles et la gamification sont gratuites ; les
 * prédictions sont Premium. L'écran les chargeait ensemble avec `Promise.all` :
 * pour un utilisateur gratuit, le 403 PREMIUM_REQUIRED des prédictions faisait
 * échouer tout le chargement (statistiques invisibles, message « Vérifiez votre
 * connexion ») et ouvrait le paywall sans que l'utilisateur ait rien demandé.
 * Les prédictions sont désormais facultatives : chargées seulement si le droit
 * est ouvert, et leur échec vaut « aucune prédiction ».
 */

export interface FeatureAccessLike {
  allowed: boolean;
}

export function canLoadPredictions(
  plan: 'free' | 'premium',
  entitlements: { features?: Record<string, FeatureAccessLike> } | null | undefined,
): boolean {
  const access = entitlements?.features?.predictions;
  if (access) return access.allowed;
  return plan === 'premium';
}

export async function loadStatsScreenData<Monthly, Gamification>(deps: {
  fetchMonthly: () => Promise<Monthly>;
  fetchGamification: () => Promise<Gamification>;
  fetchPredictions: (() => Promise<unknown>) | null;
}): Promise<{ monthly: Monthly; gamification: Gamification; predictionsCount: number }> {
  const predictionsCount: Promise<number> = deps.fetchPredictions
    ? deps.fetchPredictions().then(
        data => (Array.isArray(data) ? data.length : 0),
        () => 0,
      )
    : Promise.resolve(0);
  const [monthly, gamification, count] = await Promise.all([
    deps.fetchMonthly(),
    deps.fetchGamification(),
    predictionsCount,
  ]);
  return { monthly, gamification, predictionsCount: count };
}
