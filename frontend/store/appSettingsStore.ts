import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { logger } from '../utils/logger';
import { APP_CONFIG } from '../utils/appConfig';
import { type Language, useLanguageStore } from './languageStore';
import { useStockStore } from './stockStore';

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

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  language: 'fr',
  isLoaded: false,
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
    if (useStockStore.getState().isRefreshingPriorityItems) {
      return false;
    }

    set({ reminderRefreshError: null, reminderRefreshSuccessAt: null });

    try {
      const { reminderDaysBefore, productRemindersEnabled } = get();
      const refreshResult = await useStockStore
        .getState()
        .refreshPriorityItems(reminderDaysBefore, productRemindersEnabled);
      if (!refreshResult) {
        return false;
      }
      set({
        lastReminderRefreshAt: refreshResult.last_refresh_at,
        reminderRefreshSuccessAt: refreshResult.last_refresh_at,
      });
      await persistSettings(readPersistedSettings(get()));
      return true;
    } catch (error) {
      logger.warn('[SettingsStore] force refresh reminders failed', { message: error instanceof Error ? error.message : String(error) });
      set({ reminderRefreshError: buildReminderRefreshError(get().language) });
      return false;
    }
  },
}));
