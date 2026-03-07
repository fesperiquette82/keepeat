import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { parseISO } from 'date-fns';
import { StockItem } from '../store/stockStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';
const PUSH_TOKEN_KEY = 'keepeat_push_token';

const NOTIF_IDS_KEY = 'keepeat_notification_ids';

// Configure le handler global (doit être appelé avant tout scheduling)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
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
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Obtient le push token Expo de l'appareil et l'enregistre sur le backend.
 * À appeler après authentification de l'utilisateur.
 */
export async function registerPushToken(authToken: string): Promise<void> {
  if (Platform.OS === 'web') return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  try {
    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants.easConfig as any)?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const expoPushToken = tokenData.data;

    // Éviter de re-enregistrer le même token à chaque lancement
    const cached = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (cached === expoPushToken) return;

    await fetch(`${API_URL}/api/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: expoPushToken }),
    });

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, expoPushToken);
  } catch (err) {
    console.warn('[Push] registerPushToken error:', err);
  }
}

/**
 * Supprime le push token du backend lors de la déconnexion.
 */
export async function unregisterPushToken(authToken: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const cached = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!cached) return;
    await fetch(`${API_URL}/api/push-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: cached }),
    });
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (err) {
    console.warn('[Push] unregisterPushToken error:', err);
  }
}

async function loadNotifIds(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_IDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveNotifIds(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(map));
}

export async function scheduleExpiryNotification(item: StockItem): Promise<void> {
  if (!item.expiry_date || item.status !== 'active') return;

  try {
    const expiryDate = parseISO(item.expiry_date);
    const triggerDate = new Date(expiryDate.getTime() - 24 * 60 * 60 * 1000);

    // Ne pas planifier si le trigger est dans le passé
    if (triggerDate <= new Date()) return;

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
  } catch (err) {
    console.warn('[Notifications] scheduleExpiryNotification error:', err);
  }
}

export async function cancelExpiryNotification(itemId: string): Promise<void> {
  try {
    const map = await loadNotifIds();
    const notifId = map[itemId];
    if (notifId) {
      await Notifications.cancelScheduledNotificationAsync(notifId);
      delete map[itemId];
      await saveNotifIds(map);
    }
  } catch (err) {
    console.warn('[Notifications] cancelExpiryNotification error:', err);
  }
}

export async function rescheduleAllNotifications(items: StockItem[]): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(NOTIF_IDS_KEY);

    const activeWithDate = items.filter(i => i.status === 'active' && i.expiry_date);
    await Promise.all(activeWithDate.map(scheduleExpiryNotification));
  } catch (err) {
    console.warn('[Notifications] rescheduleAllNotifications error:', err);
  }
}
