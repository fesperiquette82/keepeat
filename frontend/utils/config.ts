import { APP_CONFIG } from './appConfig';
import { logger } from './logger';

const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'production').trim().toLowerCase();

type AppEnv = 'development' | 'staging' | 'production';

const ENV_ALIASES: Record<string, AppEnv> = {
  dev: 'development',
  development: 'development',
  stage: 'staging',
  staging: 'staging',
  prod: 'production',
  production: 'production',
};

const ENV_API_URLS: Record<AppEnv, string> = {
  development: 'http://localhost:8000',
  staging: 'https://keepeat-staging-backend.onrender.com',
  production: 'https://keepeat-backend.onrender.com',
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function resolveAppEnv(): AppEnv {
  if (APP_CONFIG.appVariant === 'debug') return 'development';
  return ENV_ALIASES[APP_ENV] ?? 'production';
}

function parseAllowedProdUrls(defaultUrl: string): string[] {
  const raw = process.env.EXPO_PUBLIC_ALLOWED_PROD_API_URLS?.trim();
  if (!raw) return [normalizeBaseUrl(defaultUrl)];
  const urls = raw
    .split(',')
    .map((item: string) => item.trim())
    .filter(Boolean)
    .map(normalizeBaseUrl);
  return urls.length > 0 ? urls : [normalizeBaseUrl(defaultUrl)];
}

function resolveApiUrl(): {
  apiUrl: string;
  guardrailStatus: 'ok' | 'blocked';
  guardrailReason: string;
  allowedProdUrls: string[];
} {
  const appEnv = resolveAppEnv();
  const defaultUrl = ENV_API_URLS[appEnv];
  const explicitUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  const perEnvUrl = process.env[`EXPO_PUBLIC_BACKEND_URL_${appEnv.toUpperCase()}`]?.trim();

  if (appEnv === 'production') {
    const allowedProdUrls = parseAllowedProdUrls(defaultUrl);
    const candidate = normalizeBaseUrl(perEnvUrl || explicitUrl || defaultUrl);

    if (allowedProdUrls.includes(candidate)) {
      return {
        apiUrl: candidate,
        guardrailStatus: 'ok',
        guardrailReason: 'production_target_allowed',
        allowedProdUrls,
      };
    }

    logger.error('[ENV_GUARDRAIL] blocked non-allowed production backend target', {
      candidate,
      allowedProdUrls,
    });

    return {
      apiUrl: normalizeBaseUrl(defaultUrl),
      guardrailStatus: 'blocked',
      guardrailReason: `blocked_non_allowed_prod_target:${candidate}`,
      allowedProdUrls,
    };
  }

  const resolved = normalizeBaseUrl(explicitUrl || perEnvUrl || defaultUrl);
  return {
    apiUrl: resolved,
    guardrailStatus: 'ok',
    guardrailReason: `non_production_${appEnv}`,
    allowedProdUrls: [normalizeBaseUrl(defaultUrl)],
  };
}

const API_RESOLUTION = resolveApiUrl();

export const API_ENV = resolveAppEnv();
export const API_URL = API_RESOLUTION.apiUrl;
export const API_URL_GUARDRAIL_STATUS = API_RESOLUTION.guardrailStatus;
export const API_URL_GUARDRAIL_REASON = API_RESOLUTION.guardrailReason;
export const ALLOWED_PROD_API_URLS = API_RESOLUTION.allowedProdUrls;

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}
