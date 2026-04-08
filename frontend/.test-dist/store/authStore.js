"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAuthStore = void 0;
const zustand_1 = require("zustand");
const SecureStore = __importStar(require("expo-secure-store"));
const notificationService_1 = require("../utils/notificationService");
const config_1 = require("../utils/config");
const TOKEN_KEY = 'keepeat_token';
const USER_KEY = 'keepeat_user';
async function apiPost(endpoint, body) {
    const response = await fetch((0, config_1.buildApiUrl)(`/api/auth/${endpoint}`), {
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
exports.useAuthStore = (0, zustand_1.create)((set) => ({
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
            const userJson = await SecureStore.getItemAsync(USER_KEY);
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
                }
                catch {
                    // Décodage JWT échoué : continuer, le premier appel API retournera 401
                }
                const user = JSON.parse(userJson);
                set({ token, user, isLoaded: true, plan: user.is_premium ? 'premium' : 'free' });
            }
            else {
                set({ isLoaded: true });
            }
        }
        catch {
            set({ isLoaded: true });
        }
    },
    login: async (email, password) => {
        set({ error: null });
        try {
            const data = await apiPost('login', { email, password });
            const { access_token, user } = data;
            await SecureStore.setItemAsync(TOKEN_KEY, access_token);
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
            set({ token: access_token, user, plan: user.is_premium ? 'premium' : 'free' });
            await exports.useAuthStore.getState().refreshEntitlements();
            await exports.useAuthStore.getState().refreshUsage();
        }
        catch (err) {
            set({ error: err.message || 'Erreur de connexion' });
            throw err;
        }
    },
    register: async (email, password) => {
        set({ error: null });
        try {
            const data = await apiPost('register', { email, password });
            return { email: data.email };
        }
        catch (err) {
            set({ error: err.message || "Erreur d'inscription" });
            throw err;
        }
    },
    verifyEmail: async (token) => {
        set({ error: null });
        try {
            const data = await apiPost('verify-email', { token });
            const { access_token, user } = data;
            await SecureStore.setItemAsync(TOKEN_KEY, access_token);
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
            set({ token: access_token, user, plan: user.is_premium ? 'premium' : 'free' });
            await exports.useAuthStore.getState().refreshEntitlements();
            await exports.useAuthStore.getState().refreshUsage();
        }
        catch (err) {
            set({ error: err.message || 'Erreur de vérification' });
            throw err;
        }
    },
    resendVerification: async (email) => {
        set({ error: null });
        try {
            await apiPost('resend-verification', { email });
        }
        catch (err) {
            set({ error: err.message || "Erreur d'envoi" });
            throw err;
        }
    },
    forgotPassword: async (email) => {
        set({ error: null });
        try {
            await apiPost('forgot-password', { email });
        }
        catch (err) {
            set({ error: err.message || "Erreur d'envoi" });
            throw err;
        }
    },
    resetPassword: async (token, newPassword) => {
        set({ error: null });
        try {
            await apiPost('reset-password', { token, new_password: newPassword });
        }
        catch (err) {
            set({ error: err.message || 'Erreur de réinitialisation' });
            throw err;
        }
    },
    logout: async () => {
        const { token } = exports.useAuthStore.getState();
        if (token) {
            await (0, notificationService_1.unregisterPushToken)(token);
        }
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
        set({ token: null, user: null, error: null, plan: 'free', entitlements: null, usage: null });
    },
    clearError: () => set({ error: null }),
    refreshEntitlements: async () => {
        const token = exports.useAuthStore.getState().token;
        if (!token)
            return;
        try {
            const response = await fetch((0, config_1.buildApiUrl)('/api/billing/entitlements'), {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.status === 401) {
                await exports.useAuthStore.getState().logout();
                return;
            }
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || `Error ${response.status}`);
            }
            const entitlements = data;
            set((state) => ({
                entitlements,
                plan: entitlements.plan,
                user: state.user
                    ? { ...state.user, is_premium: entitlements.is_premium }
                    : state.user,
            }));
            const nextUser = exports.useAuthStore.getState().user;
            if (nextUser) {
                await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
            }
        }
        catch (err) {
            set({ error: err.message || 'Erreur de synchronisation premium' });
        }
    },
    refreshUsage: async () => {
        const token = exports.useAuthStore.getState().token;
        if (!token)
            return;
        try {
            const response = await fetch((0, config_1.buildApiUrl)('/api/billing/usage'), {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.status === 401) {
                await exports.useAuthStore.getState().logout();
                return;
            }
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || `Error ${response.status}`);
            }
            set({ usage: data });
        }
        catch (err) {
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
