export const AUTH_PUBLIC_SCREENS = [
  'login',
  'register',
  'email-sent',
  'verify-email',
  'forgot-password',
  'reset-password',
] as const;

export type AuthRedirectResult = '/login' | '/' | null;

export function resolveAuthRedirect(options: {
  isLoaded: boolean;
  hasUser: boolean;
  firstSegment?: string;
  publicScreens?: readonly string[];
}): AuthRedirectResult {
  const { isLoaded, hasUser, firstSegment, publicScreens = AUTH_PUBLIC_SCREENS } = options;

  if (!isLoaded) {
    return null;
  }

  const inPublicScreen = publicScreens.includes(firstSegment ?? '');

  if (!hasUser && !inPublicScreen) {
    return '/login';
  }

  if (hasUser && (firstSegment === 'login' || firstSegment === 'register')) {
    return '/';
  }

  return null;
}
