import { create } from 'zustand';
import { useAuthStore } from './authStore';
import {
  type Household,
  createHousehold,
  fetchHousehold,
  inviteToHousehold,
  joinHousehold,
  leaveHousehold,
} from '../utils/householdApi';
import { logger } from '../utils/logger';

interface HouseholdStoreState {
  household: Household | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<boolean>;
  invite: () => Promise<{ token: string; expires_at: string } | null>;
  join: (inviteToken: string) => Promise<boolean>;
  leave: () => Promise<boolean>;
}

function authToken(): string | null {
  return useAuthStore.getState().token;
}

export const useHouseholdStore = create<HouseholdStoreState>((set, get) => ({
  household: null,
  isLoading: false,
  error: null,

  refresh: async () => {
    const token = authToken();
    if (!token) return;
    set({ isLoading: true, error: null });
    try {
      const household = await fetchHousehold(token);
      set({ household });
    } catch (error: any) {
      logger.warn('[HOUSEHOLD] refresh failed', { message: error?.message });
      set({ error: error?.message ?? 'household_refresh_failed' });
    } finally {
      set({ isLoading: false });
    }
  },

  create: async (name: string) => {
    const token = authToken();
    if (!token) return false;
    set({ isLoading: true, error: null });
    try {
      const household = await createHousehold(token, name);
      set({ household });
      return true;
    } catch (error: any) {
      set({ error: error?.message ?? 'household_create_failed' });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  invite: async () => {
    const token = authToken();
    if (!token) return null;
    try {
      return await inviteToHousehold(token);
    } catch (error: any) {
      set({ error: error?.message ?? 'household_invite_failed' });
      return null;
    }
  },

  join: async (inviteToken: string) => {
    const token = authToken();
    if (!token) return false;
    set({ isLoading: true, error: null });
    try {
      const household = await joinHousehold(token, inviteToken);
      set({ household });
      return true;
    } catch (error: any) {
      set({ error: error?.message ?? 'household_join_failed' });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  leave: async () => {
    const token = authToken();
    if (!token) return false;
    set({ isLoading: true, error: null });
    try {
      await leaveHousehold(token);
      set({ household: null });
      return true;
    } catch (error: any) {
      set({ error: error?.message ?? 'household_leave_failed' });
      return false;
    } finally {
      set({ isLoading: false });
    }
  },
}));
