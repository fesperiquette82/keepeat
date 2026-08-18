export interface DurationApplyResult {
  valid: boolean;
  days: number | null;
}

/** Parse une saisie de durée (en jours) pour l'ajout rapide de DLC. */
export function resolveDurationApply(input: string): DurationApplyResult {
  const days = parseInt(input, 10);
  if (Number.isFinite(days) && days > 0) {
    return { valid: true, days };
  }
  return { valid: false, days: null };
}
