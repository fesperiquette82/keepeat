export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  card: string;
  primary: string;
  primaryLight: string;
  primaryMid: string;
  /** Texte vert sur une surface du thème (liens, mentions) : lisible dans les deux modes. */
  primaryText: string;
  text: string;
  textMid: string;
  textLight: string;
  border: string;
  red: string;
  redLight: string;
  orange: string;
  orangeLight: string;
  yellow: string;
  yellowLight: string;
  blue: string;
  blueLight: string;
  offline: string;
  cardBorder: string;
  surfaceMuted: string;
}

export const LIGHT_COLORS: ThemeColors = {
  bg: '#F7F8FA',
  card: '#FFFFFF',
  primary: '#22c55e',
  primaryLight: '#F0FDF4',
  primaryMid: '#DCFCE7',
  primaryText: '#166534',
  text: '#111827',
  textMid: '#6B7280',
  textLight: '#9CA3AF',
  border: '#E5E7EB',
  red: '#EF4444',
  redLight: '#FEF2F2',
  orange: '#F97316',
  orangeLight: '#FFF7ED',
  yellow: '#EAB308',
  yellowLight: '#FEFCE8',
  blue: '#3B82F6',
  blueLight: '#EFF6FF',
  offline: '#92400E',
  cardBorder: '#EBEBEB',
  surfaceMuted: '#F3F4F6',
};

export const DARK_COLORS: ThemeColors = {
  bg: '#0B1220',
  card: '#111827',
  primary: '#22c55e',
  primaryLight: '#14532D',
  primaryMid: '#166534',
  primaryText: '#86EFAC',
  text: '#F9FAFB',
  textMid: '#D1D5DB',
  textLight: '#9CA3AF',
  border: '#1F2937',
  red: '#F87171',
  redLight: '#3F1D1D',
  orange: '#FB923C',
  orangeLight: '#3A2815',
  yellow: '#FACC15',
  yellowLight: '#3A3618',
  blue: '#60A5FA',
  blueLight: '#1E3A5F',
  offline: '#FBBF24',
  cardBorder: '#1F2937',
  surfaceMuted: '#1F2937',
};

export function getThemeColors(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

/** Fond d'un écran posé sur l'image d'arrière-plan, qui est claire dans les
 *  deux thèmes. En clair, l'écran est transparent et l'image reste visible.
 *  En sombre, le texte du thème est clair : l'écran recouvre l'image de la
 *  couleur de fond du thème, sinon titres et sous-titres sont illisibles
 *  (BUG-100). */
export function screenBackdropColor(mode: ThemeMode): string {
  return mode === 'dark' ? DARK_COLORS.bg : 'transparent';
}

export function resolveThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

export function getThemeText(colors: ThemeColors) {
  return {
    secondary: {
      color: colors.textMid,
      fontSize: 13,
      fontWeight: '500' as const,
    },
    secondarySmall: {
      color: colors.textMid,
      fontSize: 12,
      fontWeight: '500' as const,
    },
    tertiary: {
      color: colors.textLight,
      fontSize: 12,
      fontWeight: '500' as const,
    },
  };
}

export const C = LIGHT_COLORS;
export const T = getThemeText(LIGHT_COLORS);

export const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 8,
  elevation: 3,
};

export const shadowSm = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 4,
  elevation: 2,
};
