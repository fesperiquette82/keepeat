import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { parseISO } from 'date-fns';
import { StockItem } from '../store/stockStore';

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
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
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
