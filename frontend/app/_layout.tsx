import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import ErrorBoundary from "../component/ErrorBoundary";
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';
import { requestNotificationPermissions, registerPushToken, checkAndNotifyUrgentOnOpen } from '../utils/notificationService';
import { buildApiUrl } from '../utils/config';
import { useNetworkSync } from '../utils/useNetworkSync';

async function warmUpBackend(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    await fetch(buildApiUrl('/health'), { signal: controller.signal });
  } catch {
    // Best-effort
  } finally {
    clearTimeout(timer);
  }
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { user, token, isLoaded, loadAuth } = useAuthStore();
  const { loadLanguage } = useLanguageStore();
  const { items } = useStockStore();

  // Surveillance de la connectivité réseau + sync automatique
  useNetworkSync();

  // Barre de navigation Android toujours visible, fond blanc
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setBackgroundColorAsync('#ffffff');
      NavigationBar.setButtonStyleAsync('dark');
    }
  }, []);

  // Initialisation au démarrage + keepalive Render.com toutes les 4 min
  useEffect(() => {
    warmUpBackend();
    loadAuth();
    loadLanguage();
    requestNotificationPermissions();
    const keepAlive = setInterval(() => {
      fetch(buildApiUrl('/health')).catch(() => {});
    }, 4 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, []);

  // Enregistrement du push token + notif locale urgente au démarrage
  useEffect(() => {
    if (user && token) {
      registerPushToken(token);
      if (items.length > 0) {
        checkAndNotifyUrgentOnOpen(items);
      }
    }
  }, [user?.id]);

  // Guard auth : redirige selon l'état de connexion
  useEffect(() => {
    if (!isLoaded) return;

    const segment = segments[0] as string | undefined;
    const PUBLIC_SCREENS = ['login', 'register', 'email-sent', 'verify-email', 'forgot-password', 'reset-password'];
    const inPublicScreen = PUBLIC_SCREENS.includes(segment ?? '');

    if (!user && !inPublicScreen) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace('/login' as any);
    } else if (user && (segment === 'login' || segment === 'register')) {
      router.replace('/');
    }
  }, [user, isLoaded, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <View style={styles.container}>
          <StatusBar style="dark" />
          <Slot />
        </View>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
});
