export function expiryText(days: number | null): string {
  if (days === null) return 'Date non renseignée';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return "Expire aujourd'hui";
  if (days === 1) return 'Expire demain';
  return `Expire dans ${days} j`;
}

export function expiryColor(days: number | null): string {
  if (days === null) return '#6B7280';
  if (days <= 0) return '#EF4444';
  if (days <= 3) return '#F97316';
  if (days <= 7) return '#EAB308';
  return '#166534';
}
