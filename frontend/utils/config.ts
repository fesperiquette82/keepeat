const DEFAULT_API_URL = 'https://keepeat-backend.onrender.com';

export const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || DEFAULT_API_URL;

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}
