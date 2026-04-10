export const BIOMETRIC_CREDENTIALS_KEY = 'keepeat_biometric_credentials';

export interface BiometricCredentials {
  email: string;
  password: string;
}

export function serializeBiometricCredentials(email: string, password: string): string {
  return JSON.stringify({ email: email.trim().toLowerCase(), password });
}

export function parseBiometricCredentials(payload: string | null): BiometricCredentials | null {
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<BiometricCredentials>;
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null;
    }

    const email = parsed.email.trim().toLowerCase();
    const password = parsed.password;

    if (!email || !password) {
      return null;
    }

    return { email, password };
  } catch {
    return null;
  }
}

export function shouldDisplayBiometricLoginButton(
  hasStoredCredentials: boolean,
  isBiometricSupported: boolean,
  platformOs: string,
): boolean {
  return hasStoredCredentials && isBiometricSupported && platformOs !== 'web';
}
