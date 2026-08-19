import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { unregisterPushToken } from '../utils/notificationService';
import { buildApiUrl } from '../utils/config';
import { fetchWithTimeout as fetch } from '../utils/fetchWithTimeout';
import {
  BIOMETRIC_CREDENTIALS_KEY,
  isBiometricAuthenticationCancellationError,
  parseBiometricCredentials,
  serializeBiometricCredentials,
} from '../utils/biometricAuth';

const TOKEN_KEY = 'keepeat_token';
const USER_KEY = 'keepeat_user';

export interface AuthUser {
  id: string;
  email: string;
  is_premium: boolean;
  is_verified?: boolean;
}

export interface BillingFeatureAccess {
  allowed: boolean;
  monthly_limit: number | null;
}

export interface BillingEntitlements {
  plan: 'free' | 'premium';
  is_premium: boolean;
  subscription_status: string;
  subscription_expires_at: string | null;
  features: Record<string, BillingFeatureAccess>;
  server_time: string;
}

export interface BillingFeatureUsage {
  used: number;
  limit: number | null;
  remaining: number;
}

export interface BillingUsage {
  period: string;
  usage: Record<string, BillingFeatureUsage>;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  isLoaded: boolean;
  error: string | null;
  plan: 'free' | 'premium';
  entitlements: BillingEntitlements | null;
  usage: BillingUsage | null;
  hasBiometricCredentials: boolean;
  isBiometricSupported: boolean;

  loadAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithBiometrics: () => Promise<void>;
  register: (email: string, password: string) => Promise<{ email: string }>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshEntitlements: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  /** DEV ONLY — bypass auth sans compte (token null, non persisté). Lance une erreur en production. */
  bypassAuth: () => void;
}

async function apiPost(endpoint: string, body: object): Promise<any> {
  const url = buildApiUrl(`/api/auth/${endpoint}`);
  console.log('[AUTH_API] POST request to:', url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log('[AUTH_API] response status:', response.status, 'ok:', response.ok);
    const data = await response.json();
    console.log('[AUTH_API] response data received');

    if (!response.ok) {
      console.error('[AUTH_API] response not ok, detail:', data.detail);
      throw new Error(data.detail || `Error ${response.status}`);
    }

    return data;
  } catch (err: any) {
    console.error('[AUTH_API] fetch failed:', err);
    throw err;
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isLoaded: false,
  error: null,
  plan: 'free',
  entitlements: null,
  usage: null,
  hasBiometricCredentials: false,
  isBiometricSupported: false,

  loadAuth: async () => {
    try {
      const isBiometricSupported = SecureStore.canUseBiometricAuthentication();
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await SecureStore.getItemAsync(USER_KEY);
      const biometricPayload = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);
      const hasBiometricCredentials = isBiometricSupported && parseBiometricCredentials(biometricPayload) !== null;
      if (token && userJson) {
        // Vérifier l'expiry du JWT sans appel réseau (décodage de la payload Base64)
        try {
          const payloadB64 = token.split('.')[1];
          if (payloadB64) {
            const payload = JSON.parse(atob(payloadB64));
            if (payload.exp && payload.exp * 1000 < Date.now()) {
              await SecureStore.deleteItemAsync(TOKEN_KEY);
              await SecureStore.deleteItemAsync(USER_KEY);
              set({ isLoaded: true });
              return;
            }
          }
        } catch {
          // Décodage JWT échoué : continuer, le premier appel API retournera 401
        }
        const user: AuthUser = JSON.parse(userJson);
        set({
          token,
          user,
          isLoaded: true,
          plan: user.is_premium ? 'premium' : 'free',
          hasBiometricCredentials,
          isBiometricSupported,
        });
      } else {
        set({ isLoaded: true, hasBiometricCredentials, isBiometricSupported });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  login: async (email, password) => {
    console.log('[AUTH_STORE] login called with email:', email);
    set({ error: null });
    try {
      console.log('[AUTH_STORE] calling apiPost to /api/auth/login');
      const data = await apiPost('login', { email, password });
      console.log('[AUTH_STORE] apiPost succeeded, received response:', { has_token: !!data.access_token, has_user: !!data.user });
      const { access_token, user } = data as { access_token: string; user: AuthUser };
      console.log('[AUTH_STORE] saving token and user to SecureStore');
      await SecureStore.setItemAsync(TOKEN_KEY, access_token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      const isBiometricSupported = SecureStore.canUseBiometricAuthentication();
      let hasBiometricCredentials = false;
      if (isBiometricSupported) {
        try {
          await SecureStore.setItemAsync(
            BIOMETRIC_CREDENTIALS_KEY,
            serializeBiometricCredentials(email, password),
            { requireAuthentication: true }
          );
          hasBiometricCredentials = true;
        } catch (biometricError) {
          if (!isBiometricAuthenticationCancellationError(biometricError)) {
            console.warn('[AUTH_STORE] biometric save failed (non-cancellation), continuing without biometric', biometricError);
            hasBiometricCredentials = false;
          }
        }
      }
      console.log('[AUTH_STORE] updating Zustand state with token and user');
      set({
        token: access_token,
        user,
        plan: user.is_premium ? 'premium' : 'free',
        hasBiometricCredentials,
        isBiometricSupported,
      });
      console.log('[AUTH_STORE] refreshing entitlements and usage');
      await useAuthStore.getState().refreshEntitlements();
      await useAuthStore.getState().refreshUsage();
      console.log('[AUTH_STORE] login complete');
    } catch (err: any) {
      console.error('[AUTH_STORE] login failed:', err);
      set({ error: err.message || 'Erreur de connexion' });
      throw err;
    }
  },

  loginWithBiometrics: async () => {
    set({ error: null });
    try {
      if (!SecureStore.canUseBiometricAuthentication()) {
        throw new Error('BIOMETRIC_NOT_SUPPORTED');
      }
      const payload = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY, {
        requireAuthentication: true,
        authenticationPrompt: 'Authentifiez-vous pour vous connecter à KeepEat',
      });
      const credentials = parseBiometricCredentials(payload);
      if (!credentials) {
        throw new Error('BIOMETRIC_CREDENTIALS_NOT_FOUND');
      }
      await useAuthStore.getState().login(credentials.email, credentials.password);
    } catch (err: any) {
      if (err?.message === 'BIOMETRIC_NOT_SUPPORTED') {
        set({ error: 'Biométrie non disponible sur cet appareil', isBiometricSupported: false });
        throw err;
      }
      if (err?.message === 'BIOMETRIC_CREDENTIALS_NOT_FOUND') {
        set({ error: 'Connexion biométrique indisponible' });
        throw err;
      }
      set({ error: err?.message || 'Échec de la connexion biométrique' });
      throw err;
    }
  },

  register: async (email, password) => {
    set({ error: null });
    try {
      const data = await apiPost('register', { email, password });
      return { email: data.email as string };
    } catch (err: any) {
      set({ error: err.message || "Erreur d'inscription" });
      throw err;
    }
  },

  verifyEmail: async (token) => {
    set({ error: null });
    try {
      const data = await apiPost('verify-email', { token });
      const { access_token, user } = data as { access_token: string; user: AuthUser };
      await SecureStore.setItemAsync(TOKEN_KEY, access_token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      set({ token: access_token, user, plan: user.is_premium ? 'premium' : 'free' });
      await useAuthStore.getState().refreshEntitlements();
      await useAuthStore.getState().refreshUsage();
    } catch (err: any) {
      set({ error: err.message || 'Erreur de vérification' });
      throw err;
    }
  },

  resendVerification: async (email) => {
    set({ error: null });
    try {
      await apiPost('resend-verification', { email });
    } catch (err: any) {
      set({ error: err.message || "Erreur d'envoi" });
      throw err;
    }
  },

  forgotPassword: async (email) => {
    set({ error: null });
    try {
      await apiPost('forgot-password', { email });
    } catch (err: any) {
      set({ error: err.message || "Erreur d'envoi" });
      throw err;
    }
  },

  resetPassword: async (token, newPassword) => {
    set({ error: null });
    try {
      await apiPost('reset-password', { token, new_password: newPassword });
    } catch (err: any) {
      set({ error: err.message || 'Erreur de réinitialisation' });
      throw err;
    }
  },

  logout: async () => {
    const { token } = useAuthStore.getState();
    if (token) {
      try {
        await unregisterPushToken(token);
      } catch {
        // Erreur réseau : on continue le logout même si la désinscription échoue
      }
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null, error: null, plan: 'free', entitlements: null, usage: null });
  },

  clearError: () => set({ error: null }),

  refreshEntitlements: async () => {
    const token = useAuthStore.getState().token;
    if (!token) {
      console.log('[AUTH_STORE] refreshEntitlements skipped: no token');
      return;
    }
    try {
      const response = await fetch(buildApiUrl('/api/billing/entitlements'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        console.warn('[AUTH_STORE] refreshEntitlements: 401 Unauthorized, logging out');
        await useAuthStore.getState().logout();
        return;
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || `Error ${response.status}`);
      }
      const entitlements = data as BillingEntitlements;
      console.log('[AUTH_STORE] refreshEntitlements succeeded', { plan: entitlements.plan });
      set((state) => ({
        entitlements,
        plan: entitlements.plan,
        user: state.user
          ? { ...state.user, is_premium: entitlements.is_premium }
          : state.user,
      }));
      const nextUser = useAuthStore.getState().user;
      if (nextUser) {
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
      }
    } catch (err: any) {
      console.error('[AUTH_STORE] refreshEntitlements failed', { message: err.message });
      set({ error: err.message || 'Erreur de synchronisation premium' });
    }
  },

  refreshUsage: async () => {
    const token = useAuthStore.getState().token;
    if (!token) {
      console.log('[AUTH_STORE] refreshUsage skipped: no token');
      return;
    }
    try {
      const response = await fetch(buildApiUrl('/api/billing/usage'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        console.warn('[AUTH_STORE] refreshUsage: 401 Unauthorized, logging out');
        await useAuthStore.getState().logout();
        return;
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || `Error ${response.status}`);
      }
      console.log('[AUTH_STORE] refreshUsage succeeded');
      set({ usage: data as BillingUsage });
    } catch (err: any) {
      console.error('[AUTH_STORE] refreshUsage failed', { message: err.message });
      set({ error: err.message || 'Erreur de synchronisation quota' });
    }
  },

  bypassAuth: () => {
    if (!__DEV__) {
      throw new Error('bypassAuth is only available in development builds.');
    }
    set({ user: { id: 'guest', email: 'Invité', is_premium: false }, token: null, plan: 'free' });
  },
}));
