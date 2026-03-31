import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { create } from 'zustand';
import { logger } from '../utils/logger';
import { APP_CONFIG } from '../utils/appConfig';
import { buildApiUrl, getApiUrlDiagnostics } from '../utils/config';
import { type Language, useLanguageStore } from './languageStore';
import { useAuthStore } from './authStore';

const APP_SETTINGS_KEY = 'keepeat_app_settings_v1';

export type ReminderLeadDays = 1 | 2 | 3;

interface PersistedSettings {
  householdSize: number;
  productRemindersEnabled: boolean;
  reminderDaysBefore: ReminderLeadDays;
  lastReminderRefreshAt: string | null;
}

interface AppSettingsStore extends PersistedSettings {
  language: Language;
  isLoaded: boolean;
  reminderRefreshLoading: boolean;
  reminderRefreshError: string | null;
  reminderRefreshSuccessAt: string | null;
  loadSettings: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setHouseholdSize: (size: number) => Promise<void>;
  setProductRemindersEnabled: (enabled: boolean) => Promise<void>;
  setReminderDaysBefore: (days: ReminderLeadDays) => Promise<void>;
  markRemindersUpdated: (iso?: string) => Promise<void>;
  forceRefreshReminderProducts: () => Promise<boolean>;
}

const DEFAULT_SETTINGS: PersistedSettings = {
  householdSize: APP_CONFIG.defaultRecipeServings,
  productRemindersEnabled: true,
  reminderDaysBefore: 2,
  lastReminderRefreshAt: null,
};

function clampHouseholdSize(value: number): number {
  return Math.max(1, Math.min(12, value));
}

async function persistSettings(settings: PersistedSettings): Promise<void> {
  await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

function readPersistedSettings(state: AppSettingsStore): PersistedSettings {
  return {
    householdSize: state.householdSize,
    productRemindersEnabled: state.productRemindersEnabled,
    reminderDaysBefore: state.reminderDaysBefore,
    lastReminderRefreshAt: state.lastReminderRefreshAt,
  };
}

function buildReminderRefreshError(language: Language): string {
  return language === 'en'
    ? 'Unable to refresh reminder products. Please try again.'
    : 'Impossible de mettre à jour les produits rappelés. Réessayez.';
}

interface RecallsRefreshResponse {
  success: boolean;
  message: string;
  refreshedCount: number;
  lastSuccessfulRefreshAt: string | null;
  attemptedAt: string;
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseRefreshErrorMessage(language: Language, error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object' && typeof detail.message === 'string' && detail.message.trim()) {
      return detail.message;
    }
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return buildReminderRefreshError(language);
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  language: 'fr',
  isLoaded: false,
  reminderRefreshLoading: false,
  reminderRefreshError: null,
  reminderRefreshSuccessAt: null,

  loadSettings: async () => {
    try {
      await useLanguageStore.getState().loadLanguage();
      const language = useLanguageStore.getState().language;
      const raw = await AsyncStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) {
        set({ language, isLoaded: true });
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedSettings> & { lastRemindersUpdate?: string | null };
      set({
        language,
        householdSize: clampHouseholdSize(Number(parsed.householdSize ?? DEFAULT_SETTINGS.householdSize)),
        productRemindersEnabled: typeof parsed.productRemindersEnabled === 'boolean' ? parsed.productRemindersEnabled : DEFAULT_SETTINGS.productRemindersEnabled,
        reminderDaysBefore: parsed.reminderDaysBefore === 1 || parsed.reminderDaysBefore === 2 || parsed.reminderDaysBefore === 3
          ? parsed.reminderDaysBefore
          : DEFAULT_SETTINGS.reminderDaysBefore,
        lastReminderRefreshAt: typeof parsed.lastReminderRefreshAt === 'string'
          ? parsed.lastReminderRefreshAt
          : typeof parsed.lastRemindersUpdate === 'string'
            ? parsed.lastRemindersUpdate
            : null,
        isLoaded: true,
      });
    } catch (error) {
      logger.warn('[SettingsStore] load failed', { message: error instanceof Error ? error.message : String(error) });
      set({ isLoaded: true, language: useLanguageStore.getState().language });
    }
  },

  setLanguage: async (language: Language) => {
    await useLanguageStore.getState().setLanguage(language);
    set({ language: useLanguageStore.getState().language });
  },

  setHouseholdSize: async (size: number) => {
    const householdSize = clampHouseholdSize(size);
    set({ householdSize });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist household size failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  setProductRemindersEnabled: async (enabled: boolean) => {
    set({ productRemindersEnabled: enabled });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminders enabled failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  setReminderDaysBefore: async (days: ReminderLeadDays) => {
    set({ reminderDaysBefore: days });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminder days failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  markRemindersUpdated: async (iso?: string) => {
    set({ lastReminderRefreshAt: iso ?? new Date().toISOString() });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminder update date failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  forceRefreshReminderProducts: async () => {
    logger.info('[RECALLS] function entered');

    if (get().reminderRefreshLoading) {
      logger.info('[RECALLS] refresh already in progress, skipping duplicate click');
      return false;
    }

    set({ reminderRefreshError: null, reminderRefreshSuccessAt: null, reminderRefreshLoading: true });

    try {
      const endpoint = '/api/recalls/refresh';
      const url = buildApiUrl(endpoint);
      const apiDiag = getApiUrlDiagnostics();
      const token = useAuthStore.getState().token;
      logger.info('[RECALLS] backend url = ...', { url });
      logger.info('[RECALLS] token exists = ...', { hasToken: Boolean(token) });

      if (apiDiag.likelyInvalidOnAndroidDevice) {
        logger.warn('[SettingsStore] backend URL may be invalid on Android physical device', {
          apiUrl: apiDiag.apiUrl,
          hint: 'Set EXPO_PUBLIC_BACKEND_URL to LAN IP or public URL (not localhost/127.0.0.1)',
        });
      }

      logger.info('[RECALLS] about to POST /api/recalls/refresh', { method: 'POST', url });
      const response = await axios.post<RecallsRefreshResponse>(url, {}, { headers: authHeaders() });
      const data = response.data;

      logger.info('[RECALLS] status HTTP', { status: response.status });
      logger.info('[RECALLS] body réponse', { body: data });
      logger.info('[SettingsStore] manual recalls refresh response', {
        method: 'POST',
        url,
        status: response.status,
        body: data,
      });

      if (!data || data.success !== true || typeof data.lastSuccessfulRefreshAt !== 'string') {
        const fallbackMessage = (typeof data?.message === 'string' && data.message.trim())
          ? data.message
          : buildReminderRefreshError(get().language);
        set({ reminderRefreshError: fallbackMessage });
        logger.warn('[RECALLS] message d’erreur final affiché', { userMessage: fallbackMessage });
        logger.warn('[SettingsStore] manual recalls refresh returned unexpected payload', {
          method: 'POST',
          url,
          status: response.status,
          body: data,
        });
        return false;
      }

      set({
        lastReminderRefreshAt: data.lastSuccessfulRefreshAt,
        reminderRefreshSuccessAt: data.lastSuccessfulRefreshAt,
        reminderRefreshError: null,
      });
      await persistSettings(readPersistedSettings(get()));
      return true;
    } catch (error) {
      const endpoint = '/api/recalls/refresh';
      const url = buildApiUrl(endpoint);
      const status = axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
      const responseBody = axios.isAxiosError(error) ? (error.response?.data ?? null) : null;
      const message = parseRefreshErrorMessage(get().language, error);
      logger.warn('[SettingsStore] force refresh recalls failed', {
        method: 'POST',
        url,
        status,
        responseBody,
        errorMessage: error instanceof Error ? error.message : String(error),
        userMessage: message,
      });
      logger.warn('[RECALLS] message d’erreur final affiché', { userMessage: message });
      set({ reminderRefreshError: message });
      return false;
    } finally {
      set({ reminderRefreshLoading: false });
    }
  },
}));
