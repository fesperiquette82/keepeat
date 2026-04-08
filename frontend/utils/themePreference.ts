import { resolveThemeMode, type ThemeMode } from './theme';

export function getDefaultThemeMode(): ThemeMode {
  return 'light';
}

export function readThemeModeFromSettings(raw: string | null): ThemeMode {
  if (!raw) return getDefaultThemeMode();
  try {
    const parsed = JSON.parse(raw) as { themeMode?: unknown };
    return resolveThemeMode(parsed.themeMode);
  } catch {
    return getDefaultThemeMode();
  }
}

export function persistThemeModeIntoSettings(raw: string | null, themeMode: ThemeMode): string {
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  return JSON.stringify({ ...parsed, themeMode });
}

export function applyThemeSelection(_: ThemeMode, next: ThemeMode): ThemeMode {
  return next;
}
