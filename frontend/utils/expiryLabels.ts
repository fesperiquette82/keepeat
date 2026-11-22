import type { ThemeMode } from './theme';

export function expiryText(days: number | null): string {
  if (days === null) return 'Date non renseignée';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return "Expire aujourd'hui";
  if (days === 1) return 'Expire demain';
  return `Expire dans ${days} j`;
}

/** Couleur d'une échéance. Rouge, orange et jaune se lisent sur fond clair
 *  comme sur fond sombre ; le gris et le vert foncé non : en thème sombre ils
 *  sont éclaircis (BUG-100). Sans thème précisé, les couleurs d'origine. */
export function expiryColor(days: number | null, mode: ThemeMode = 'light'): string {
  const isDark = mode === 'dark';
  if (days === null) return isDark ? '#9CA3AF' : '#6B7280';
  if (days <= 0) return '#EF4444';
  if (days <= 3) return '#F97316';
  if (days <= 7) return '#EAB308';
  return isDark ? '#86EFAC' : '#166534';
}
