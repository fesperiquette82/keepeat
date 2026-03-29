export type AppVariant = 'prod' | 'debug';

export interface AppConfig {
  appVariant: AppVariant;
  enableDebugTools: boolean;
  enableVerboseLogs: boolean;
  enableDiagnosticScreen: boolean;
  enableNetworkTracing: boolean;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveAppVariant(): AppVariant {
  const raw = (process.env.EXPO_PUBLIC_APP_VARIANT ?? '').trim().toLowerCase();
  if (raw === 'debug') return 'debug';
  if (raw === 'prod' || raw === 'production') return 'prod';
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'prod';
}

const appVariant = resolveAppVariant();
const debugByDefault = appVariant === 'debug';

export const APP_CONFIG: AppConfig = {
  appVariant,
  enableDebugTools: appVariant === 'debug'
    ? parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_DEBUG_TOOLS, debugByDefault)
    : false,
  enableVerboseLogs: parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_VERBOSE_LOGS, debugByDefault),
  enableDiagnosticScreen: appVariant === 'debug'
    ? parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_DIAGNOSTIC_SCREEN, debugByDefault)
    : false,
  enableNetworkTracing: parseBooleanFlag(process.env.EXPO_PUBLIC_ENABLE_NETWORK_TRACING, debugByDefault),
};
