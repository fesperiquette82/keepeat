import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';

const TOKEN_KEY = 'keepeat_token';
const USER_KEY = 'keepeat_user';

export interface AuthUser {
  id: string;
  email: string;
  is_premium: boolean;
  is_verified?: boolean;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  isLoaded: boolean;
  error: string | null;

  loadAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ email: string }>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** DEV ONLY — bypass auth sans compte (token null, non persisté) */
  bypassAuth: () => void;
}

async function apiPost(endpoint: string, body: object): Promise<any> {
  const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
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

  loadAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await AsyncStorage.getItem(USER_KEY);
      if (token && userJson) {
        const user: AuthUser = JSON.parse(userJson);
        set({ token, user, isLoaded: true });
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
      set({ token: access_token, user });
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
      set({ token: access_token, user });
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
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    set({ token: null, user: null, error: null });
  },

  clearError: () => set({ error: null }),

  bypassAuth: () => {
    set({ user: { id: 'guest', email: 'Invité', is_premium: false }, token: null });
  },
}));
