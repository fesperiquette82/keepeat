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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestNotificationPermissions = requestNotificationPermissions;
exports.registerPushToken = registerPushToken;
exports.unregisterPushToken = unregisterPushToken;
exports.scheduleExpiryNotification = scheduleExpiryNotification;
exports.cancelExpiryNotification = cancelExpiryNotification;
exports.checkAndNotifyUrgentOnOpen = checkAndNotifyUrgentOnOpen;
exports.rescheduleAllNotifications = rescheduleAllNotifications;
const Notifications = __importStar(require("expo-notifications"));
const async_storage_1 = __importDefault(require("@react-native-async-storage/async-storage"));
const expo_constants_1 = __importDefault(require("expo-constants"));
const react_native_1 = require("react-native");
const date_fns_1 = require("date-fns");
const config_1 = require("./config");
const logger_1 = require("./logger");
const PUSH_TOKEN_KEY = 'keepeat_push_token';
const NOTIF_IDS_KEY = 'keepeat_notification_ids';
// Configure le handler global (doit être appelé avant tout scheduling)
if (react_native_1.Platform.OS !== 'web') {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
        }),
    });
}
async function requestNotificationPermissions() {
    if (react_native_1.Platform.OS === 'web')
        return false;
    if (react_native_1.Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('expiry-alerts', {
            name: 'Alertes péremption',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#f97316',
            sound: 'default',
        });
        await Notifications.setNotificationChannelAsync('recalls', {
            name: 'Rappels produits',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 250, 500],
            lightColor: '#ef4444',
            sound: 'default',
        });
        await Notifications.setNotificationChannelAsync('inactivity', {
            name: "Rappels d'activité",
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: 'default',
        });
        await Notifications.setNotificationChannelAsync('weekly-summary', {
            name: 'Résumé hebdomadaire',
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: 'default',
        });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted')
        return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
}
/**
 * Obtient le push token Expo de l'appareil et l'enregistre sur le backend.
 * À appeler après authentification de l'utilisateur.
 */
async function registerPushToken(authToken) {
    if (react_native_1.Platform.OS === 'web')
        return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted')
        return;
    try {
        const projectId = expo_constants_1.default.expoConfig?.extra?.eas?.projectId ??
            expo_constants_1.default.easConfig?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        const expoPushToken = tokenData.data;
        // Éviter de re-enregistrer le même token à chaque lancement
        const cached = await async_storage_1.default.getItem(PUSH_TOKEN_KEY);
        if (cached === expoPushToken)
            return;
        await fetch((0, config_1.buildApiUrl)('/api/push-token'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ token: expoPushToken }),
        });
        await async_storage_1.default.setItem(PUSH_TOKEN_KEY, expoPushToken);
    }
    catch (err) {
        logger_1.logger.warn('[Push] registerPushToken error', { message: err instanceof Error ? err.message : String(err) });
    }
}
/**
 * Supprime le push token du backend lors de la déconnexion.
 */
async function unregisterPushToken(authToken) {
    if (react_native_1.Platform.OS === 'web')
        return;
    try {
        const cached = await async_storage_1.default.getItem(PUSH_TOKEN_KEY);
        if (!cached)
            return;
        await fetch((0, config_1.buildApiUrl)('/api/push-token'), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ token: cached }),
        });
        await async_storage_1.default.removeItem(PUSH_TOKEN_KEY);
    }
    catch (err) {
        logger_1.logger.warn('[Push] unregisterPushToken error', { message: err instanceof Error ? err.message : String(err) });
    }
}
async function loadNotifIds() {
    try {
        const raw = await async_storage_1.default.getItem(NOTIF_IDS_KEY);
        return raw ? JSON.parse(raw) : {};
    }
    catch {
        return {};
    }
}
async function saveNotifIds(map) {
    await async_storage_1.default.setItem(NOTIF_IDS_KEY, JSON.stringify(map));
}
async function scheduleExpiryNotification(item) {
    if (!item.expiry_date || item.status !== 'active')
        return;
    try {
        const expiryDate = (0, date_fns_1.parseISO)(item.expiry_date);
        const triggerDate = new Date(expiryDate.getTime() - 24 * 60 * 60 * 1000);
        // Ne pas planifier si le trigger est dans le passé
        if (triggerDate <= new Date())
            return;
        const notifId = await Notifications.scheduleNotificationAsync({
            content: {
                title: '⚠️ Produit bientôt périmé',
                body: `${item.name} expire demain. Pensez à le consommer !`,
                data: { itemId: item.id },
                sound: 'default',
            },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: triggerDate,
                channelId: 'expiry-alerts',
            },
        });
        const map = await loadNotifIds();
        map[item.id] = notifId;
        await saveNotifIds(map);
    }
    catch (err) {
        logger_1.logger.warn('[Notifications] scheduleExpiryNotification error', { message: err instanceof Error ? err.message : String(err) });
    }
}
async function cancelExpiryNotification(itemId) {
    try {
        const map = await loadNotifIds();
        const notifId = map[itemId];
        if (notifId) {
            await Notifications.cancelScheduledNotificationAsync(notifId);
            delete map[itemId];
            await saveNotifIds(map);
        }
    }
    catch (err) {
        logger_1.logger.warn('[Notifications] cancelExpiryNotification error', { message: err instanceof Error ? err.message : String(err) });
    }
}
const OPEN_NOTIF_KEY_PREFIX = 'keepeat_open_notif_';
/**
 * Déclenche une notif locale (une fois par jour) si des produits expirent aujourd'hui ou demain.
 * À appeler au démarrage quand l'utilisateur est connecté et que le stock est chargé.
 */
async function checkAndNotifyUrgentOnOpen(items) {
    const today = new Date().toISOString().slice(0, 10);
    const KEY = `${OPEN_NOTIF_KEY_PREFIX}${today}`;
    try {
        const already = await async_storage_1.default.getItem(KEY);
        if (already)
            return;
        const urgent = items.filter(i => {
            if (!i.expiry_date || i.status !== 'active')
                return false;
            const d = (0, date_fns_1.differenceInDays)((0, date_fns_1.parseISO)(i.expiry_date), new Date());
            return d <= 1;
        });
        if (!urgent.length)
            return;
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted')
            return;
        const names = urgent.slice(0, 3).map(i => i.name).join(', ');
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '⏰ Produits à utiliser maintenant',
                body: `${names} expire${urgent.length > 1 ? 'nt' : ''} aujourd\'hui ou demain`,
                sound: 'default',
                data: { type: 'urgent_open' },
            },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: 3,
                channelId: 'expiry-alerts',
            },
        });
        await async_storage_1.default.setItem(KEY, '1');
    }
    catch (err) {
        logger_1.logger.warn('[Notifications] checkAndNotifyUrgentOnOpen error', { message: err instanceof Error ? err.message : String(err) });
    }
}
async function rescheduleAllNotifications(items) {
    try {
        await Notifications.cancelAllScheduledNotificationsAsync();
        await async_storage_1.default.removeItem(NOTIF_IDS_KEY);
        const activeWithDate = items.filter(i => i.status === 'active' && i.expiry_date);
        await Promise.all(activeWithDate.map(scheduleExpiryNotification));
    }
    catch (err) {
        logger_1.logger.warn('[Notifications] rescheduleAllNotifications error', { message: err instanceof Error ? err.message : String(err) });
    }
}
