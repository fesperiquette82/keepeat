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

function resolveAppEnv(): AppEnv {
  return ENV_ALIASES[APP_ENV] ?? 'production';
}

function resolveApiUrl(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const appEnv = resolveAppEnv();
  const perEnvUrl = process.env[`EXPO_PUBLIC_BACKEND_URL_${appEnv.toUpperCase()}`]?.trim();
  return perEnvUrl || ENV_API_URLS[appEnv];
}

export const API_ENV = resolveAppEnv();
export const API_URL = resolveApiUrl();

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}
