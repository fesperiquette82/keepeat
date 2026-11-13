/**
 * Connexion biométrique — logique pure (sans Expo), testable sous Node.
 *
 * BUG-082 : ce qui dort derrière l'empreinte est un **jeton de session**, jamais
 * le mot de passe. L'ancienne version sérialisait `{ email, password }` dans
 * SecureStore : chiffré et protégé par l'empreinte, certes, mais c'était le
 * vrai mot de passe de l'utilisateur (souvent réutilisé ailleurs), impossible
 * à révoquer à distance. Un jeton expire (30 jours) et `session_version`
 * (BUG-068) permet de l'invalider depuis le serveur.
 */

/** Charge utile protégée par l'authentification de l'appareil. */
export const BIOMETRIC_CREDENTIALS_KEY = 'keepeat_biometric_credentials';

/**
 * Marqueur NON protégé, lu au démarrage pour savoir si une session biométrique
 * existe sans déclencher d'invite d'authentification. Sa valeur n'a aucune
 * sensibilité ; il n'est écrit qu'après une sauvegarde réussie de la charge
 * utile par la version courante — son absence signale donc aussi une charge
 * utile héritée (mot de passe) à purger.
 */
export const BIOMETRIC_SESSION_MARKER_KEY = 'keepeat_biometric_session_marker';
export const BIOMETRIC_SESSION_MARKER_VALUE = '1';

export interface BiometricSession {
  email: string;
  token: string;
}

export function serializeBiometricSession(email: string, token: string): string {
  return JSON.stringify({ email: email.trim().toLowerCase(), token });
}

/**
 * Vrai pour une charge utile de l'ancienne version (`{ email, password }`).
 * Elle ne doit jamais être réutilisée : on l'efface.
 */
export function isLegacyBiometricPayload(payload: string | null): boolean {
  if (!payload) return false;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return !!parsed && typeof parsed === 'object' && 'password' in parsed;
  } catch {
    return false;
  }
}

export function parseBiometricSession(payload: string | null): BiometricSession | null {
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<BiometricSession> & { password?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    // Un mot de passe stocké n'est jamais une session valide, même accompagné d'un jeton.
    if ('password' in parsed) return null;
    if (typeof parsed.email !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }

    const email = parsed.email.trim().toLowerCase();
    const token = parsed.token.trim();

    if (!email || !token) {
      return null;
    }

    return { email, token };
  } catch {
    return null;
  }
}

/** Suite à donner à la vérification du jeton biométrique auprès du serveur. */
export type BiometricSessionOutcome =
  | 'ok' // le serveur reconnaît le jeton : la session est ouverte
  | 'expired' // 401 : jeton expiré ou révoqué, la session stockée doit être effacée
  | 'unavailable'; // réseau ou serveur indisponible : la session stockée reste en place

export function decideBiometricSessionOutcome(params: { status?: number | null; ok?: boolean }): BiometricSessionOutcome {
  if (params.status === 401) return 'expired';
  if (params.ok === true) return 'ok';
  return 'unavailable';
}

export function shouldDisplayBiometricLoginButton(
  hasStoredCredentials: boolean,
  isBiometricSupported: boolean,
  platformOs: string,
): boolean {
  return hasStoredCredentials && isBiometricSupported && platformOs !== 'web';
}

export function isBiometricAuthenticationCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { message?: unknown };
  if (typeof maybeError.message !== 'string') {
    return false;
  }

  const normalizedMessage = maybeError.message.toLowerCase();

  return (
    normalizedMessage.includes('could not authenticate the user') ||
    normalizedMessage.includes("opération d'empreinte digitale annulée") ||
    normalizedMessage.includes('authentication canceled') ||
    normalizedMessage.includes('user canceled authentication')
  );
}
