import { APP_CONFIG } from './appConfig';
import type { AuthUser } from '../store/authStore';

function parseAdminEmails(): string[] {
  const raw = process.env.EXPO_PUBLIC_ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((item: string) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user: AuthUser | null): boolean {
  if (!user?.email) return false;
  const admins = parseAdminEmails();
  if (admins.length === 0) {
    return APP_CONFIG.appVariant === 'debug';
  }
  return admins.includes(user.email.toLowerCase());
}
