import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { logger } from '../utils/logger';
import { APP_CONFIG } from '../utils/appConfig';
import { type Language, useLanguageStore } from './languageStore';

const APP_SETTINGS_KEY = 'keepeat_app_settings_v1';

export type ReminderLeadDays = 1 | 2 | 3;

interface PersistedSettings {
  householdSize: number;
  productRemindersEnabled: boolean;
  reminderDaysBefore: ReminderLeadDays;
  lastRemindersUpdate: string | null;
}

interface AppSettingsStore extends PersistedSettings {
  language: Language;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setHouseholdSize: (size: number) => Promise<void>;
  setProductRemindersEnabled: (enabled: boolean) => Promise<void>;
  setReminderDaysBefore: (days: ReminderLeadDays) => Promise<void>;
  markRemindersUpdated: (iso?: string) => Promise<void>;
}

const DEFAULT_SETTINGS: PersistedSettings = {
  householdSize: APP_CONFIG.defaultRecipeServings,
  productRemindersEnabled: true,
  reminderDaysBefore: 2,
  lastRemindersUpdate: null,
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
    lastRemindersUpdate: state.lastRemindersUpdate,
  };
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  language: 'fr',
  isLoaded: false,

  loadSettings: async () => {
    try {
      await useLanguageStore.getState().loadLanguage();
      const language = useLanguageStore.getState().language;
      const raw = await AsyncStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) {
        set({ language, isLoaded: true });
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      set({
        language,
        householdSize: clampHouseholdSize(Number(parsed.householdSize ?? DEFAULT_SETTINGS.householdSize)),
        productRemindersEnabled: typeof parsed.productRemindersEnabled === 'boolean' ? parsed.productRemindersEnabled : DEFAULT_SETTINGS.productRemindersEnabled,
        reminderDaysBefore: parsed.reminderDaysBefore === 1 || parsed.reminderDaysBefore === 2 || parsed.reminderDaysBefore === 3
          ? parsed.reminderDaysBefore
          : DEFAULT_SETTINGS.reminderDaysBefore,
        lastRemindersUpdate: typeof parsed.lastRemindersUpdate === 'string' ? parsed.lastRemindersUpdate : null,
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
    const updatedAt = new Date().toISOString();
    set({ productRemindersEnabled: enabled, lastRemindersUpdate: updatedAt });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminders enabled failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  setReminderDaysBefore: async (days: ReminderLeadDays) => {
    const updatedAt = new Date().toISOString();
    set({ reminderDaysBefore: days, lastRemindersUpdate: updatedAt });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminder days failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },

  markRemindersUpdated: async (iso?: string) => {
    set({ lastRemindersUpdate: iso ?? new Date().toISOString() });
    try {
      await persistSettings(readPersistedSettings(get()));
    } catch (error) {
      logger.warn('[SettingsStore] persist reminder update date failed', { message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
