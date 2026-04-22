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
import { buildApiUrl } from '../utils/config';
import { logger } from '../utils/logger';
import { extractPremiumErrorDetail } from '../utils/premiumErrors';
import { resolveStockItemImageUrlWithFallback } from '../utils/stockItemImage';
import { usePremiumUiStore } from './premiumUiStore';
import { useRecipesStore } from './recipesStore';
import type { DashboardStockItem } from '../data/mockDashboardData';
import type { AxiosError, AxiosRequestConfig } from 'axios';
import { shouldSkipStockFetch } from '../utils/stockFetchPolicy';
import { buildRestoredItemsList } from '../utils/stockRestoreInsert';

const authHeaders = () => {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type AuthAxiosConfig = AxiosRequestConfig & {
  requiresAuthLogout?: boolean;
};

const authRequestConfig = (requiresAuthLogout = true): AuthAxiosConfig => ({
  headers: authHeaders(),
  requiresAuthLogout,
});

export interface HistoryItem {
  name: string;
  brand: string;
  image_url: string;
  category: string;
  food_category: string;
  barcode: string;
  shelf_life_fridge: number | null;
  shelf_life_pantry: number | null;
  shelf_life_freezer: number | null;
  shelf_life_category: string;
  shelf_life_tips: string;
}

export interface StockItem {
  id: string;
  barcode?: string;
  name: string;
  brand?: string;
  image_url?: string;
  category?: string;
  food_category?: string; // frais/proteines/legumes/feculents/desserts/boissons/epicerie/autres
  quantity?: string;
  expiry_date?: string;
  added_date: string;
  status: string;
  consumed_date?: string;
  thrown_date?: string;
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

export interface PriorityRefreshResult {
  items: StockItem[];
  last_refresh_at: string;
  count: number;
  lead_days_used: 1 | 2 | 3;
  reminders_enabled: boolean;
}

type MutationType = 'ADD' | 'CONSUME' | 'THROW' | 'UPDATE';

interface PendingMutation {
  id: string;       // UUID de la mutation
  type: MutationType;
  payload: any;
  tempId?: string;  // ID local temporaire pour ADD offline
  timestamp: number;
}

function normalizeStockItemImage(item: StockItem, fallbackItem?: Partial<StockItem>): StockItem {
  const image_url = resolveStockItemImageUrlWithFallback(item, fallbackItem);
  if (!image_url) return { ...item, image_url: undefined };
  return { ...item, image_url };
}

// Intercepteur Axios global : déconnexion automatique sur token expiré (401)
axios.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const config = (error.config ?? null) as AuthAxiosConfig | null;
    const requiresAuthLogout = config?.requiresAuthLogout === true;
    if (status === 401 && requiresAuthLogout) {
      // Import dynamique pour éviter la dépendance circulaire au niveau module
      const { logout } = useAuthStore.getState();
      logout();
    }
    return Promise.reject(error);
  }
);

// Cache barcode → résultat produit (session en mémoire, non persisté)
const _barcodeCache: Record<string, any> = {};

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
  historyItems: HistoryItem[];
  stats: Stats;
  isLoading: boolean;
  loadingCount: number;
  error: string | null;
  pendingMutations: PendingMutation[];
  isOnline: boolean;
  isSyncing: boolean;
  isRefreshingPriorityItems: boolean;
  lastStockFetchAt: number | null;

  fetchStock: (options?: { force?: boolean; reason?: string }) => Promise<void>;
  fetchPriorityItems: () => Promise<void>;
  refreshPriorityItems: (leadDays: 1 | 2 | 3, remindersEnabled: boolean) => Promise<PriorityRefreshResult | null>;
  fetchStats: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  markConsumed: (itemId: string) => Promise<void>;
  markThrown: (itemId: string) => Promise<void>;
  restoreItem: (itemId: string, restoredItem?: StockItem) => Promise<boolean>;
  lookupProduct: (barcode: string) => Promise<any>;
  addItem: (
    item: Partial<StockItem>,
    options?: { source?: 'manual' | 'barcode' | 'receipt_ocr' | 'import' },
  ) => Promise<StockItem | null>;
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

function handlePremiumOrQuotaError(err: any): boolean {
  const premiumError = extractPremiumErrorDetail(err);
  if (!premiumError) return false;
  usePremiumUiStore.getState().openPaywall(premiumError);
  return true;
}

export const useStockStore = create<StockStore>()(
  persist(
    (set, get) => ({
      items: [],
      priorityItems: [],
      historyItems: [],
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
      isRefreshingPriorityItems: false,
      lastStockFetchAt: null,

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
              const res = await axios.post(buildApiUrl('/api/stock'), mutation.payload, authRequestConfig());
              const realItem: StockItem = normalizeStockItemImage(res.data as StockItem);
              // Remplacer le tempId par le vrai ID dans le state local
              set(state => ({
                items: state.items.map(i =>
                  i.id === mutation.tempId ? { ...realItem } : i
                ),
              }));
              scheduleExpiryNotification(realItem);
            } else if (mutation.type === 'CONSUME') {
              await axios.post(buildApiUrl(`/api/stock/${mutation.payload.itemId}/consume`), {}, authRequestConfig());
            } else if (mutation.type === 'THROW') {
              await axios.post(buildApiUrl(`/api/stock/${mutation.payload.itemId}/throw`), {}, authRequestConfig());
            } else if (mutation.type === 'UPDATE') {
              await axios.put(buildApiUrl(`/api/stock/${mutation.payload.itemId}`), mutation.payload.updates, authRequestConfig());
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

      fetchStock: async (options) => {
        const state = get();
        if (
          shouldSkipStockFetch({
            hasItemsInStore: state.items.length > 0,
            lastFetchAt: state.lastStockFetchAt,
            force: options?.force,
          })
        ) {
          logger.debug('[STOCK] fetch skipped (fresh cache)', {
            reason: options?.reason ?? 'unspecified',
            itemsCount: state.items.length,
            lastStockFetchAt: state.lastStockFetchAt,
          });
          useRecipesStore.getState().recomputeRecipeAssociationsFromCache(state.items as DashboardStockItem[]);
          return;
        }

        logger.debug('[STOCK] fetch request', {
          reason: options?.reason ?? 'unspecified',
          force: options?.force === true,
          hasItemsInStore: state.items.length > 0,
        });
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true, error: null }));
        try {
          const res = await axios.get(buildApiUrl('/api/stock?status=active'), authRequestConfig());
          const items: StockItem[] = Array.isArray(res.data)
            ? res.data.map((item) => normalizeStockItemImage(item as StockItem))
            : [];
          set({ items, lastStockFetchAt: Date.now() });
          useRecipesStore.getState().recomputeRecipeAssociationsFromCache(items as DashboardStockItem[]);
          rescheduleAllNotifications(items);
        } catch (err: any) {
          if (handlePremiumOrQuotaError(err)) {
            throw err;
          }
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
          const res = await axios.get(buildApiUrl('/api/stock/priority'), authRequestConfig());
          const priorityItems: StockItem[] = Array.isArray(res.data)
            ? res.data.map((item) => normalizeStockItemImage(item as StockItem))
            : [];
          set({ priorityItems, error: null });
        } catch {
          // Garder le cache en cas d'erreur réseau
        } finally {
          set(state => {
            const next = Math.max(0, state.loadingCount - 1);
            return { loadingCount: next, isLoading: next > 0 };
          });
        }
      },

      refreshPriorityItems: async (leadDays, remindersEnabled) => {
        if (get().isRefreshingPriorityItems) {
          logger.info('[STOCK] priority refresh skipped (already in progress)');
          return null;
        }
        set(state => ({
          loadingCount: state.loadingCount + 1,
          isLoading: true,
          isRefreshingPriorityItems: true,
        }));
        try {
          const url = buildApiUrl('/api/stock/priority/refresh');
          logger.info('[STOCK] priority refresh request', {
            method: 'POST',
            url,
            body: { lead_days: leadDays, reminders_enabled: remindersEnabled },
          });
          const res = await axios.post<PriorityRefreshResult>(
            url,
            { lead_days: leadDays, reminders_enabled: remindersEnabled },
            authRequestConfig(),
          );
          set({ priorityItems: res.data.items, error: null });
          logger.info('[STOCK] priority refresh success', {
            status: res.status,
            count: res.data.count,
            last_refresh_at: res.data.last_refresh_at,
          });
          return res.data;
        } catch (err: any) {
          if (handlePremiumOrQuotaError(err)) {
            throw err;
          }
          logger.warn('[STOCK] priority refresh failed', {
            status: err?.response?.status ?? null,
            responseBody: err?.response?.data ?? null,
            errorMessage: err?.message ?? String(err),
          });
          if (!isNetworkError(err)) {
            set({ error: err.message });
          }
          throw err;
        } finally {
          set(state => {
            const next = Math.max(0, state.loadingCount - 1);
            return {
              loadingCount: next,
              isLoading: next > 0,
              isRefreshingPriorityItems: false,
            };
          });
        }
      },

      fetchStats: async () => {
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true }));
        try {
          const res = await axios.get(buildApiUrl('/api/stats'), authRequestConfig());
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

      fetchHistory: async () => {
        try {
          const res = await axios.get(buildApiUrl('/api/stock/history?limit=15'), authRequestConfig());
          set({ historyItems: res.data });
        } catch {
          // Garder le cache en cas d'erreur réseau
        }
      },

      markConsumed: async (itemId: string) => {
        const { isOnline } = get();

        // Capturer le snapshot AVANT la mise à jour optimiste pour pouvoir rollback
        const { items, priorityItems, stats } = useStockStore.getState();

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
        await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
          source: 'stock.consume',
          stockItems: get().items as DashboardStockItem[],
        });
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

        try {
          await axios.post(buildApiUrl(`/api/stock/${itemId}/consume`), {}, authRequestConfig());
          // Ne PAS appeler fetchStock() ici : cela créerait une race condition.
          // Si l'utilisateur swipe deux items rapidement, le GET de fetchStock() peut
          // arriver APRÈS l'update optimiste du 2ème item mais AVANT son POST — le serveur
          // renvoie alors le 2ème item comme encore actif, écrase l'update optimiste, et
          // rend stillActive=true → failedCount++, pas de bouton Annuler.
          // L'update optimiste (set ci-dessus) est suffisant : l'item est déjà retiré du store.
          const s = get();
          await Promise.all([s.fetchPriorityItems(), s.fetchStats()]);
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
            await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
              source: 'stock.consume',
              stockItems: items as DashboardStockItem[],
            });
            scheduleExpiryNotification(items.find(i => i.id === itemId)!);
          }
        }
      },

      markThrown: async (itemId: string) => {
        const { isOnline } = get();

        // Capturer le snapshot AVANT la mise à jour optimiste pour pouvoir rollback
        const { items, priorityItems, stats } = useStockStore.getState();

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
        await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
          source: 'stock.throw',
          stockItems: get().items as DashboardStockItem[],
        });
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

        try {
          await axios.post(buildApiUrl(`/api/stock/${itemId}/throw`), {}, authRequestConfig());
          // Même raison que markConsumed : ne pas appeler fetchStock() pour éviter la race
          // condition qui restaure l'update optimiste d'un autre item supprimé en parallèle.
          const s = get();
          await Promise.all([s.fetchPriorityItems(), s.fetchStats()]);
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
            await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
              source: 'stock.throw',
              stockItems: items as DashboardStockItem[],
            });
            scheduleExpiryNotification(items.find(i => i.id === itemId)!);
          }
        }
      },

      restoreItem: async (itemId: string, restoredItem?: StockItem) => {
        try {
          await axios.post(buildApiUrl(`/api/stock/${itemId}/restore`), {}, authRequestConfig());
          // Ne PAS appeler fetchStock() ici : race condition avec un markConsumed/markThrown
          // concurrent (le GET peut arriver après l'update optimiste du prochain item).
          // On réinsère directement l'item si on le connaît, puis on rafraîchit les listes
          // légères (priorités, stats, historique).
          if (restoredItem) {
            set(state => ({ items: buildRestoredItemsList(state.items, restoredItem) }));
          }
          const s = get();
          await Promise.all([s.fetchPriorityItems(), s.fetchStats(), s.fetchHistory()]);
          return true;
        } catch (err: any) {
          if (!isNetworkError(err)) {
            set({ error: err.message });
          }
          return false;
        }
      },

      lookupProduct: async (barcode: string) => {
        if (_barcodeCache[barcode]) return _barcodeCache[barcode];
        try {
          const res = await axios.get(buildApiUrl(`/api/product/${barcode}`), authRequestConfig(false));
          _barcodeCache[barcode] = res.data;
          return res.data;
        } catch {
          return null;
        }
      },

      addItem: async (item, options) => {
        const { isOnline } = get();
        const source = options?.source ?? 'manual';
        const refreshSource = source === 'barcode'
          ? 'stock.add.barcode'
          : source === 'receipt_ocr'
            ? 'stock.add.receipt_ocr'
            : source === 'import'
              ? 'stock.add.import'
              : 'stock.add.manual';

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
          await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
            source: refreshSource,
            stockItems: get().items as DashboardStockItem[],
          });
          scheduleExpiryNotification(tempItem);
          return tempItem;
        }

        try {
          const res = await axios.post(buildApiUrl('/api/stock'), item, authRequestConfig());
          const newItem: StockItem = normalizeStockItemImage(res.data as StockItem, item);
          // Insertion directe : évite la race condition lors d'ajouts OCR parallèles.
          // Plusieurs addItem() concurrents + fetchStock() concurrents → le GET peut
          // répondre avant que les autres POST soient confirmés → store incomplet →
          // removeStockItems() ne trouve pas l'item → suppression silencieusement ratée.
          set(state => ({ items: [newItem, ...state.items] }));
          await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
            source: refreshSource,
            stockItems: get().items as DashboardStockItem[],
          });
          scheduleExpiryNotification(newItem);
          const s = get();
          await Promise.all([s.fetchPriorityItems(), s.fetchStats()]);
          return newItem;
        } catch (err: any) {
          if (isNetworkError(err)) {
            // Fallback offline si le réseau coupe juste après le check (sans récursion)
            set({ isOnline: false });
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
            await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
              source: refreshSource,
              stockItems: get().items as DashboardStockItem[],
            });
            scheduleExpiryNotification(tempItem);
            return tempItem;
          }
          logger.error("[Stock] addItem failed", { message: err instanceof Error ? err.message : String(err) });
          return null;
        }
      },

      updateItem: async (itemId, updates) => {
        const { isOnline } = get();
        const existingItem = get().items.find((entry) => entry.id === itemId);

        if (!isOnline) {
          set(state => ({
            items: state.items.map(i => i.id === itemId ? { ...i, ...updates } : i),
            pendingMutations: [
              ...state.pendingMutations,
              { id: uuid(), type: 'UPDATE', payload: { itemId, updates }, timestamp: Date.now() },
            ],
          }));
          await useRecipesStore.getState().refreshRecipeAssociationsForStockMutation({
            source: 'stock.update',
            stockItems: get().items as DashboardStockItem[],
          });
          const updated = get().items.find(i => i.id === itemId);
          if (updated) {
            cancelExpiryNotification(itemId);
            scheduleExpiryNotification(updated);
          }
          return updated || null;
        }

        try {
          const res = await axios.put(buildApiUrl(`/api/stock/${itemId}`), updates, authRequestConfig());
          const updatedItem: StockItem = normalizeStockItemImage(res.data as StockItem, existingItem);
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
        historyItems: state.historyItems,
        stats: state.stats,
        pendingMutations: state.pendingMutations,
      }),
    }
  )
);
