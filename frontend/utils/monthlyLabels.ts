const FRENCH_SHORT_MONTHS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN', 'JUL', 'AOÛ', 'SEP', 'OCT', 'NOV', 'DÉC'] as const;

export interface MonthlyLabel {
  month: string;
  label: string;
}

/**
 * Génère exactement les 6 derniers mois (inclusif),
 * ordonnés du plus ancien au plus récent,
 * au format de label français court en majuscules (ex: MAR 26).
 */
export function generateLastSixMonthLabels(referenceDate: Date): MonthlyLabel[] {
  const baseYear = referenceDate.getUTCFullYear();
  const baseMonth = referenceDate.getUTCMonth();
  const labels: MonthlyLabel[] = [];
  const seenMonths = new Set<string>();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const current = new Date(Date.UTC(baseYear, baseMonth - offset, 1));
    const year = current.getUTCFullYear();
    const monthIndex = current.getUTCMonth();
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    if (seenMonths.has(monthKey)) {
      continue;
    }

    seenMonths.add(monthKey);
    labels.push({
      month: monthKey,
      label: `${FRENCH_SHORT_MONTHS[monthIndex]} ${String(year).slice(-2)}`,
    });
  }

  return labels;
}
