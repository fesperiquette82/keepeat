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
  return ENV_ALIASES[APP_ENV] ?? 'production';
}

function resolveApiUrl(): string {
  const appEnv = resolveAppEnv();
  const defaultUrl = ENV_API_URLS[appEnv];
  const explicitUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  const perEnvUrl = process.env[`EXPO_PUBLIC_BACKEND_URL_${appEnv.toUpperCase()}`]?.trim();

  // En production, on verrouille la cible backend pour éviter un build mobile
  // qui pointerait vers une ancienne API (source des recettes exotiques observées).
  if (appEnv === 'production') {
    if (perEnvUrl) {
      return normalizeBaseUrl(perEnvUrl);
    }
    if (explicitUrl && normalizeBaseUrl(explicitUrl) !== normalizeBaseUrl(defaultUrl)) {
      console.info('[ENV_DEBUG] ignoring EXPO_PUBLIC_BACKEND_URL in production', {
        explicitUrl,
        enforcedUrl: defaultUrl,
      });
      return normalizeBaseUrl(defaultUrl);
    }
    return normalizeBaseUrl(explicitUrl || defaultUrl);
  }

  return normalizeBaseUrl(explicitUrl || perEnvUrl || defaultUrl);
}

export const API_ENV = resolveAppEnv();
export const API_URL = resolveApiUrl();

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}
