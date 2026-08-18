export interface DurationApplyResult {
  valid: boolean;
  days: number | null;
}

/** Parse une saisie de durée (en jours) pour l'ajout rapide de DLC.
 *
 * Valide la chaîne entière (pas seulement son préfixe numérique) : "1.5" ou "7j"
 * doivent être rejetés plutôt que silencieusement tronqués à 1 ou 7 par parseInt.
 */
export function resolveDurationApply(input: string): DurationApplyResult {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, days: null };
  }
  const days = parseInt(trimmed, 10);
  if (days > 0) {
    return { valid: true, days };
  }
  return { valid: false, days: null };
}
