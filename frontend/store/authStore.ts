import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { unregisterPushToken } from '../utils/notificationService';
import { buildApiUrl } from '../utils/config';

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

  loadAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
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
  const response = await fetch(buildApiUrl(`/api/auth/${endpoint}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || `Error ${response.status}`);
  }

  return data;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isLoaded: false,
  error: null,
  plan: 'free',
  entitlements: null,
  usage: null,

  loadAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await AsyncStorage.getItem(USER_KEY);
      if (token && userJson) {
        const user: AuthUser = JSON.parse(userJson);
        set({ token, user, isLoaded: true, plan: user.is_premium ? 'premium' : 'free' });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const data = await apiPost('login', { email, password });
      const { access_token, user } = data as { access_token: string; user: AuthUser };
      await SecureStore.setItemAsync(TOKEN_KEY, access_token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ token: access_token, user, plan: user.is_premium ? 'premium' : 'free' });
      await useAuthStore.getState().refreshEntitlements();
      await useAuthStore.getState().refreshUsage();
    } catch (err: any) {
      set({ error: err.message || 'Erreur de connexion' });
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
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
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
      await unregisterPushToken(token);
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    set({ token: null, user: null, error: null, plan: 'free', entitlements: null, usage: null });
  },

  clearError: () => set({ error: null }),

  refreshEntitlements: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const response = await fetch(buildApiUrl('/api/billing/entitlements'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || `Error ${response.status}`);
      }
      const entitlements = data as BillingEntitlements;
      set((state) => ({
        entitlements,
        plan: entitlements.plan,
        user: state.user
          ? { ...state.user, is_premium: entitlements.is_premium }
          : state.user,
      }));
      const nextUser = useAuthStore.getState().user;
      if (nextUser) {
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      }
    } catch (err: any) {
      set({ error: err.message || 'Erreur de synchronisation premium' });
    }
  },

  refreshUsage: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const response = await fetch(buildApiUrl('/api/billing/usage'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || `Error ${response.status}`);
      }
      set({ usage: data as BillingUsage });
    } catch (err: any) {
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
