"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useStockStore = void 0;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
const async_storage_1 = __importDefault(require("@react-native-async-storage/async-storage"));
const axios_1 = __importDefault(require("axios"));
const authStore_1 = require("./authStore");
const notificationService_1 = require("../utils/notificationService");
const config_1 = require("../utils/config");
const logger_1 = require("../utils/logger");
const premiumErrors_1 = require("../utils/premiumErrors");
const premiumUiStore_1 = require("./premiumUiStore");
const authHeaders = () => {
    const token = authStore_1.useAuthStore.getState().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
};
const authRequestConfig = (requiresAuthLogout = true) => ({
    headers: authHeaders(),
    requiresAuthLogout,
});
// Intercepteur Axios global : déconnexion automatique sur token expiré (401)
axios_1.default.interceptors.response.use((response) => response, (error) => {
    const status = error.response?.status;
    const config = (error.config ?? null);
    const requiresAuthLogout = config?.requiresAuthLogout === true;
    if (status === 401 && requiresAuthLogout) {
        // Import dynamique pour éviter la dépendance circulaire au niveau module
        const { logout } = authStore_1.useAuthStore.getState();
        logout();
    }
    return Promise.reject(error);
});
// Cache barcode → résultat produit (session en mémoire, non persisté)
const _barcodeCache = {};
// Générateur d'UUID simple (ne dépend pas d'une lib externe)
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
function isNetworkError(err) {
    return (!err.response ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ERR_NETWORK' ||
        err.message === 'Network Error');
}
function handlePremiumOrQuotaError(err) {
    const premiumError = (0, premiumErrors_1.extractPremiumErrorDetail)(err);
    if (!premiumError)
        return false;
    premiumUiStore_1.usePremiumUiStore.getState().openPaywall(premiumError);
    return true;
}
exports.useStockStore = (0, zustand_1.create)()((0, middleware_1.persist)((set, get) => ({
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
    setOnline: (online) => {
        const { isOnline, pendingMutations, flushPendingMutations, fetchStock } = get();
        const wasOffline = !isOnline;
        set({ isOnline: online });
        if (online && wasOffline) {
            if (pendingMutations.length > 0) {
                flushPendingMutations();
            }
            else {
                fetchStock();
            }
        }
    },
    flushPendingMutations: async () => {
        const { pendingMutations, isSyncing } = get();
        if (isSyncing || pendingMutations.length === 0)
            return;
        set({ isSyncing: true });
        const remaining = [...pendingMutations];
        for (const mutation of [...pendingMutations]) {
            try {
                if (mutation.type === 'ADD') {
                    const res = await axios_1.default.post((0, config_1.buildApiUrl)('/api/stock'), mutation.payload, authRequestConfig());
                    const realItem = res.data;
                    // Remplacer le tempId par le vrai ID dans le state local
                    set(state => ({
                        items: state.items.map(i => i.id === mutation.tempId ? { ...realItem } : i),
                    }));
                    (0, notificationService_1.scheduleExpiryNotification)(realItem);
                }
                else if (mutation.type === 'CONSUME') {
                    await axios_1.default.post((0, config_1.buildApiUrl)(`/api/stock/${mutation.payload.itemId}/consume`), {}, authRequestConfig());
                }
                else if (mutation.type === 'THROW') {
                    await axios_1.default.post((0, config_1.buildApiUrl)(`/api/stock/${mutation.payload.itemId}/throw`), {}, authRequestConfig());
                }
                else if (mutation.type === 'UPDATE') {
                    await axios_1.default.put((0, config_1.buildApiUrl)(`/api/stock/${mutation.payload.itemId}`), mutation.payload.updates, authRequestConfig());
                }
                // Mutation réussie : la retirer de la queue
                remaining.splice(remaining.findIndex(m => m.id === mutation.id), 1);
                set({ pendingMutations: [...remaining] });
            }
            catch (err) {
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
            const res = await axios_1.default.get((0, config_1.buildApiUrl)('/api/stock?status=active'), authRequestConfig());
            const items = res.data;
            set({ items });
            (0, notificationService_1.rescheduleAllNotifications)(items);
        }
        catch (err) {
            if (handlePremiumOrQuotaError(err)) {
                throw err;
            }
            if (!isNetworkError(err)) {
                set({ error: err.message });
            }
            // Si erreur réseau : on garde le cache local (ne pas écraser)
        }
        finally {
            set(state => {
                const next = Math.max(0, state.loadingCount - 1);
                return { loadingCount: next, isLoading: next > 0 };
            });
        }
    },
    fetchPriorityItems: async () => {
        set(state => ({ loadingCount: state.loadingCount + 1, isLoading: true }));
        try {
            const res = await axios_1.default.get((0, config_1.buildApiUrl)('/api/stock/priority'), authRequestConfig());
            set({ priorityItems: res.data, error: null });
        }
        catch {
            // Garder le cache en cas d'erreur réseau
        }
        finally {
            set(state => {
                const next = Math.max(0, state.loadingCount - 1);
                return { loadingCount: next, isLoading: next > 0 };
            });
        }
    },
    refreshPriorityItems: async (leadDays, remindersEnabled) => {
        if (get().isRefreshingPriorityItems) {
            logger_1.logger.info('[STOCK] priority refresh skipped (already in progress)');
            return null;
        }
        set(state => ({
            loadingCount: state.loadingCount + 1,
            isLoading: true,
            isRefreshingPriorityItems: true,
        }));
        try {
            const url = (0, config_1.buildApiUrl)('/api/stock/priority/refresh');
            logger_1.logger.info('[STOCK] priority refresh request', {
                method: 'POST',
                url,
                body: { lead_days: leadDays, reminders_enabled: remindersEnabled },
            });
            const res = await axios_1.default.post(url, { lead_days: leadDays, reminders_enabled: remindersEnabled }, authRequestConfig());
            set({ priorityItems: res.data.items, error: null });
            logger_1.logger.info('[STOCK] priority refresh success', {
                status: res.status,
                count: res.data.count,
                last_refresh_at: res.data.last_refresh_at,
            });
            return res.data;
        }
        catch (err) {
            if (handlePremiumOrQuotaError(err)) {
                throw err;
            }
            logger_1.logger.warn('[STOCK] priority refresh failed', {
                status: err?.response?.status ?? null,
                responseBody: err?.response?.data ?? null,
                errorMessage: err?.message ?? String(err),
            });
            if (!isNetworkError(err)) {
                set({ error: err.message });
            }
            throw err;
        }
        finally {
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
            const res = await axios_1.default.get((0, config_1.buildApiUrl)('/api/stats'), authRequestConfig());
            set({ stats: res.data });
        }
        catch {
            // Garder les stats cachées en cas d'erreur réseau
        }
        finally {
            set(state => {
                const next = Math.max(0, state.loadingCount - 1);
                return { loadingCount: next, isLoading: next > 0 };
            });
        }
    },
    fetchHistory: async () => {
        try {
            const res = await axios_1.default.get((0, config_1.buildApiUrl)('/api/stock/history?limit=15'), authRequestConfig());
            set({ historyItems: res.data });
        }
        catch {
            // Garder le cache en cas d'erreur réseau
        }
    },
    markConsumed: async (itemId) => {
        const { isOnline } = get();
        // Capturer le snapshot AVANT la mise à jour optimiste pour pouvoir rollback
        const { items, priorityItems, stats } = exports.useStockStore.getState();
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
        (0, notificationService_1.cancelExpiryNotification)(itemId);
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
            await axios_1.default.post((0, config_1.buildApiUrl)(`/api/stock/${itemId}/consume`), {}, authRequestConfig());
            const s = get();
            await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
        }
        catch (err) {
            if (isNetworkError(err)) {
                set(state => ({
                    pendingMutations: [
                        ...state.pendingMutations,
                        { id: uuid(), type: 'CONSUME', payload: { itemId }, timestamp: Date.now() },
                    ],
                }));
            }
            else {
                // Rollback sur erreur API
                set({ items, priorityItems, stats, error: err.message });
                (0, notificationService_1.scheduleExpiryNotification)(items.find(i => i.id === itemId));
            }
        }
    },
    markThrown: async (itemId) => {
        const { isOnline } = get();
        // Capturer le snapshot AVANT la mise à jour optimiste pour pouvoir rollback
        const { items, priorityItems, stats } = exports.useStockStore.getState();
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
        (0, notificationService_1.cancelExpiryNotification)(itemId);
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
            await axios_1.default.post((0, config_1.buildApiUrl)(`/api/stock/${itemId}/throw`), {}, authRequestConfig());
            const s = get();
            await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
        }
        catch (err) {
            if (isNetworkError(err)) {
                set(state => ({
                    pendingMutations: [
                        ...state.pendingMutations,
                        { id: uuid(), type: 'THROW', payload: { itemId }, timestamp: Date.now() },
                    ],
                }));
            }
            else {
                set({ items, priorityItems, stats, error: err.message });
                (0, notificationService_1.scheduleExpiryNotification)(items.find(i => i.id === itemId));
            }
        }
    },
    restoreItem: async (itemId) => {
        try {
            await axios_1.default.post((0, config_1.buildApiUrl)(`/api/stock/${itemId}/restore`), {}, authRequestConfig());
            const s = get();
            await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats(), s.fetchHistory()]);
            return true;
        }
        catch (err) {
            if (!isNetworkError(err)) {
                set({ error: err.message });
            }
            return false;
        }
    },
    lookupProduct: async (barcode) => {
        if (_barcodeCache[barcode])
            return _barcodeCache[barcode];
        try {
            const res = await axios_1.default.get((0, config_1.buildApiUrl)(`/api/product/${barcode}`), authRequestConfig(false));
            _barcodeCache[barcode] = res.data;
            return res.data;
        }
        catch {
            return null;
        }
    },
    addItem: async (item) => {
        const { isOnline } = get();
        if (!isOnline) {
            const tempId = `temp_${uuid()}`;
            const tempItem = {
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
            (0, notificationService_1.scheduleExpiryNotification)(tempItem);
            return tempItem;
        }
        try {
            const res = await axios_1.default.post((0, config_1.buildApiUrl)('/api/stock'), item, authRequestConfig());
            const newItem = res.data;
            const s = get();
            await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
            return newItem;
        }
        catch (err) {
            if (isNetworkError(err)) {
                // Fallback offline si le réseau coupe juste après le check (sans récursion)
                set({ isOnline: false });
                const tempId = `temp_${uuid()}`;
                const tempItem = {
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
                (0, notificationService_1.scheduleExpiryNotification)(tempItem);
                return tempItem;
            }
            logger_1.logger.error("[Stock] addItem failed", { message: err instanceof Error ? err.message : String(err) });
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
                (0, notificationService_1.cancelExpiryNotification)(itemId);
                (0, notificationService_1.scheduleExpiryNotification)(updated);
            }
            return updated || null;
        }
        try {
            const res = await axios_1.default.put((0, config_1.buildApiUrl)(`/api/stock/${itemId}`), updates, authRequestConfig());
            const updatedItem = res.data;
            (0, notificationService_1.cancelExpiryNotification)(itemId);
            (0, notificationService_1.scheduleExpiryNotification)(updatedItem);
            const s = get();
            await Promise.all([s.fetchStock(), s.fetchPriorityItems(), s.fetchStats()]);
            return updatedItem;
        }
        catch (err) {
            set({ error: err.message });
            return null;
        }
    },
}), {
    name: 'keepeat_stock',
    storage: (0, middleware_1.createJSONStorage)(() => async_storage_1.default),
    partialize: (state) => ({
        items: state.items,
        priorityItems: state.priorityItems,
        historyItems: state.historyItems,
        stats: state.stats,
        pendingMutations: state.pendingMutations,
    }),
}));
