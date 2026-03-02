import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useAuthStore } from './authStore';
import {
  scheduleExpiryNotification,
  cancelExpiryNotification,
  rescheduleAllNotifications,
} from '../utils/notificationService';

const DEFAULT_API_URL = 'https://keepeat-backend.onrender.com';
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || DEFAULT_API_URL;

const authHeaders = () => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface StockItem {
  id: string;
  barcode?: string;
  name: string;
  brand?: string;
  image_url?: string;
  category?: string;
  quantity?: string;
  expiry_date?: string;
  added_date: string;
  status: string;
  notes?: string;
  _pending?: boolean; // item créé offline, pas encore syncé
}

export interface Stats {
  total_items: number;
  expiring_soon: number;
  expired: number;
  consumed_this_week: number;
  thrown_this_week: number;
}

type MutationType = 'ADD' | 'CONSUME' | 'THROW' | 'UPDATE';

interface PendingMutation {
  id: string;       // UUID de la mutation
  type: MutationType;
  payload: any;
  tempId?: string;  // ID local temporaire pour ADD offline
  timestamp: number;
}

// Générateur d'UUID simple (ne dépend pas d'une lib externe)
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface StockStore {
  items: StockItem[];
  priorityItems: StockItem[];
  stats: Stats;
  isLoading: boolean;
  loadingCount: number;
  error: string | null;
  pendingMutations: PendingMutation[];
  isOnline: boolean;
  isSyncing: boolean;

  fetchStock: () => Promise<void>;
  fetchPriorityItems: () => Promise<void>;
  fetchStats: () => Promise<void>;
  markConsumed: (itemId: string) => Promise<void>;
  markThrown: (itemId: string) => Promise<void>;
  lookupProduct: (barcode: string) => Promise<any>;
  addItem: (item: Partial<StockItem>) => Promise<StockItem | null>;
  updateItem: (itemId: string, updates: Partial<StockItem>) => Promise<StockItem | null>;
  setOnline: (online: boolean) => void;
  flushPendingMutations: () => Promise<void>;
}

function isNetworkError(err: any): boolean {
  return (
    !err.response ||
    err.code === 'ECONNABORTED' ||
    err.code === 'ERR_NETWORK' ||
    err.message === 'Network Error'
  );
}

export const useStockStore = create<StockStore>()(
  persist(
    (set, get) => ({
      items: [],
      priorityItems: [],
      stats: {
        total_items: 0,
        expiring_soon: 0,
        expired: 0,
        consumed_this_week: 0,
        thrown_this_week: 0,
      },
      isLoading: false,
      loadingCount: 0,
      error: null,
      pendingMutations: [],
      isOnline: true,
      isSyncing: false,

      setOnline: (online: boolean) => {
        const { isOnline, pendingMutations, flushPendingMutations, fetchStock } = get();
        const wasOffline = !isOnline;
        set({ isOnline: online });

        if (online && wasOffline) {
          if (pendingMutations.length > 0) {
            flushPendingMutations();
          } else {
            fetchStock();
          }
        }
      },

      flushPendingMutations: async () => {
        const { pendingMutations, isSyncing } = get();
        if (isSyncing || pendingMutations.length === 0) return;

        set({ isSyncing: true });
        const remaining = [...pendingMutations];

        for (const mutation of [...pendingMutations]) {
          try {
            if (mutation.type === 'ADD') {
              const res = await axios.post(`${API_URL}/api/stock`, mutation.payload, { headers: authHeaders() });
              const realItem: StockItem = res.data;
              // Remplacer le tempId par le vrai ID dans le state local
              set(state => ({
                items: state.items.map(i =>
                  i.id === mutation.tempId ? { ...realItem } : i
                ),
              }));
              scheduleExpiryNotification(realItem);
            } else if (mutation.type === 'CONSUME') {
              await axios.post(`${API_URL}/api/stock/${mutation.payload.itemId}/consume`, {}, { headers: authHeaders() });
            } else if (mutation.type === 'THROW') {
              await axios.post(`${API_URL}/api/stock/${mutation.payload.itemId}/throw`, {}, { headers: authHeaders() });
            } else if (mutation.type === 'UPDATE') {
              await axios.put(`${API_URL}/api/stock/${mutation.payload.itemId}`, mutation.payload.updates, { headers: authHeaders() });
            }
            // Mutation réussie : la retirer de la queue
            remaining.splice(remaining.findIndex(m => m.id === mutation.id), 1);
            set({ pendingMutations: [...remaining] });
          } catch (err: any) {
            if (isNetworkError(err)) {
              // Réseau encore indisponible : arrêter et garder le reste
              break;
            }
            // Erreur API (4xx) : mutation invalide, la supprimer
            remaining.splice(remaining.findIndex(m => m.id === mutation.id), 1);
            set({ pendingMutations: [...remaining] });
          }
        }

        set({ isSyncing: false });

        // Resynchroniser le state avec le serveur après flush
        const s = get();
        await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
      },

      fetchStock: async () => {
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true, error: null }));
        try {
          const res = await axios.get(`${API_URL}/api/stock?status=active`, { headers: authHeaders() });
          const items: StockItem[] = res.data;
          set({ items });
          rescheduleAllNotifications(items);
        } catch (err: any) {
          if (!isNetworkError(err)) {
            set({ error: err.message });
          }
          // Si erreur réseau : on garde le cache local (ne pas écraser)
        } finally {
          set(state => {
            const next = Math.max(0, state.loadingCount - 1);
            return { loadingCount: next, isLoading: next > 0 };
          });
        }
      },

      fetchPriorityItems: async () => {
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true }));
        try {
          const res = await axios.get(`${API_URL}/api/stock/priority`, { headers: authHeaders() });
          set({ priorityItems: res.data });
        } catch {
          // Garder le cache en cas d'erreur réseau
        } finally {
          set(state => {
            const next = Math.max(0, state.loadingCount - 1);
            return { loadingCount: next, isLoading: next > 0 };
          });
        }
      },

      fetchStats: async () => {
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true }));
        try {
          const res = await axios.get(`${API_URL}/api/stats`, { headers: authHeaders() });
          set({ stats: res.data });
        } catch {
          // Garder les stats cachées en cas d'erreur réseau
        } finally {
          set(state => {
            const next = Math.max(0, state.loadingCount - 1);
            return { loadingCount: next, isLoading: next > 0 };
          });
        }
      },

      markConsumed: async (itemId: string) => {
        const { isOnline } = get();

        // Optimistic update
        set(state => ({
          items: state.items.filter(i => i.id !== itemId),
          priorityItems: state.priorityItems.filter(i => i.id !== itemId),
          stats: {
            ...state.stats,
            total_items: Math.max(0, state.stats.total_items - 1),
            consumed_this_week: state.stats.consumed_this_week + 1,
          },
        }));
        cancelExpiryNotification(itemId);

        if (!isOnline) {
          set(state => ({
            pendingMutations: [
              ...state.pendingMutations,
              { id: uuid(), type: 'CONSUME', payload: { itemId }, timestamp: Date.now() },
            ],
          }));
          return;
        }

        const { items, priorityItems, stats } = useStockStore.getState();
        try {
          await axios.post(`${API_URL}/api/stock/${itemId}/consume`, {}, { headers: authHeaders() });
          const s = get();
          await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
        } catch (err: any) {
          if (isNetworkError(err)) {
            set(state => ({
              pendingMutations: [
                ...state.pendingMutations,
                { id: uuid(), type: 'CONSUME', payload: { itemId }, timestamp: Date.now() },
              ],
            }));
          } else {
            // Rollback sur erreur API
            set({ items, priorityItems, stats, error: err.message });
            scheduleExpiryNotification(items.find(i => i.id === itemId)!);
          }
        }
      },

      markThrown: async (itemId: string) => {
        const { isOnline } = get();

        // Optimistic update
        set(state => ({
          items: state.items.filter(i => i.id !== itemId),
          priorityItems: state.priorityItems.filter(i => i.id !== itemId),
          stats: {
            ...state.stats,
            total_items: Math.max(0, state.stats.total_items - 1),
            thrown_this_week: state.stats.thrown_this_week + 1,
          },
        }));
        cancelExpiryNotification(itemId);

        if (!isOnline) {
          set(state => ({
            pendingMutations: [
              ...state.pendingMutations,
              { id: uuid(), type: 'THROW', payload: { itemId }, timestamp: Date.now() },
            ],
          }));
          return;
        }

        const { items, priorityItems, stats } = useStockStore.getState();
        try {
          await axios.post(`${API_URL}/api/stock/${itemId}/throw`, {}, { headers: authHeaders() });
          const s = get();
          await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
        } catch (err: any) {
          if (isNetworkError(err)) {
            set(state => ({
              pendingMutations: [
                ...state.pendingMutations,
                { id: uuid(), type: 'THROW', payload: { itemId }, timestamp: Date.now() },
              ],
            }));
          } else {
            set({ items, priorityItems, stats, error: err.message });
            scheduleExpiryNotification(items.find(i => i.id === itemId)!);
          }
        }
      },

      lookupProduct: async (barcode: string) => {
        try {
          const res = await axios.get(`${API_URL}/api/product/${barcode}`);
          return res.data;
        } catch {
          return null;
        }
      },

      addItem: async (item) => {
        const { isOnline } = get();

        if (!isOnline) {
          const tempId = `temp_${uuid()}`;
          const tempItem: StockItem = {
            id: tempId,
            name: item.name || '',
            barcode: item.barcode,
            brand: item.brand,
            image_url: item.image_url,
            category: item.category,
            quantity: item.quantity,
            expiry_date: item.expiry_date,
            added_date: new Date().toISOString(),
            status: 'active',
            notes: item.notes,
            _pending: true,
          };
          set(state => ({
            items: [tempItem, ...state.items],
            pendingMutations: [
              ...state.pendingMutations,
              { id: uuid(), type: 'ADD', payload: item, tempId, timestamp: Date.now() },
            ],
          }));
          scheduleExpiryNotification(tempItem);
          return tempItem;
        }

        try {
          const res = await axios.post(`${API_URL}/api/stock`, item, { headers: authHeaders() });
          const newItem: StockItem = res.data;
          const s = get();
          await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
          return newItem;
        } catch (err: any) {
          if (isNetworkError(err)) {
            // Fallback offline si le réseau coupe juste après le check
            set({ isOnline: false });
            return get().addItem(item);
          }
          console.error("Erreur lors de l'ajout :", err);
          return null;
        }
      },

      updateItem: async (itemId, updates) => {
        const { isOnline } = get();

        if (!isOnline) {
          set(state => ({
            items: state.items.map(i => i.id === itemId ? { ...i, ...updates } : i),
            pendingMutations: [
              ...state.pendingMutations,
              { id: uuid(), type: 'UPDATE', payload: { itemId, updates }, timestamp: Date.now() },
            ],
          }));
          const updated = get().items.find(i => i.id === itemId);
          if (updated) {
            cancelExpiryNotification(itemId);
            scheduleExpiryNotification(updated);
          }
          return updated || null;
        }

        try {
          const res = await axios.put(`${API_URL}/api/stock/${itemId}`, updates, { headers: authHeaders() });
          const updatedItem: StockItem = res.data;
          cancelExpiryNotification(itemId);
          scheduleExpiryNotification(updatedItem);
          const s = get();
          await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
          return updatedItem;
        } catch (err: any) {
          set({ error: err.message });
          return null;
        }
      },
    }),
    {
      name: 'keepeat_stock',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items: state.items,
        priorityItems: state.priorityItems,
        stats: state.stats,
        pendingMutations: state.pendingMutations,
      }),
    }
  )
);
