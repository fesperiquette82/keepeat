export function pluralizeFr(count: number, singular: string, plural?: string): string {
  if (count === 1) {
    return singular;
  }
  return plural ?? `${singular}s`;
}

export function countLabelFr(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralizeFr(count, singular, plural)}`;
}

export function formatEuroFr(amount: number, maximumFractionDigits = 1): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(amount);

  return `${formatted} €`;
}
