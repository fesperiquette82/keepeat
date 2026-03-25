import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import ErrorBoundary from "../component/ErrorBoundary";
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';
import { requestNotificationPermissions, registerPushToken, checkAndNotifyUrgentOnOpen } from '../utils/notificationService';
import { API_ENV, API_URL, buildApiUrl } from '../utils/config';
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

async function logBackendBuildInfo(): Promise<void> {
  try {
    const res = await fetch(buildApiUrl('/api/build-info'));
    const data = await res.json();
    console.info('[ENV_DEBUG] backend build info', data);
  } catch (err: any) {
    console.info('[ENV_DEBUG] backend build info unavailable', { message: err?.message ?? String(err) });
  }
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore(state => state.user);
  const token = useAuthStore(state => state.token);
  const isLoaded = useAuthStore(state => state.isLoaded);
  const loadAuth = useAuthStore(state => state.loadAuth);
  const loadLanguage = useLanguageStore(state => state.loadLanguage);
  const items = useStockStore(state => state.items);

  // Surveillance de la connectivité réseau + sync automatique
  useNetworkSync();

  const publicScreens = useMemo(() => ['login', 'register', 'email-sent', 'verify-email', 'forgot-password', 'reset-password'], []);

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
    console.info('[ENV_DEBUG] app api target', { apiEnv: API_ENV, apiUrl: API_URL });
    warmUpBackend();
    logBackendBuildInfo();
    loadAuth();
    loadLanguage();
    requestNotificationPermissions();
    const keepAlive = setInterval(() => {
      fetch(buildApiUrl('/health')).catch(() => {});
    }, 4 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, [loadAuth, loadLanguage]);

  // Enregistrement du push token + notif locale urgente au démarrage
  useEffect(() => {
    if (user && token) {
      registerPushToken(token);
      if (items.length > 0) {
        checkAndNotifyUrgentOnOpen(items);
      }
    }
  }, [items, token, user]);

  // Guard auth : redirige selon l'état de connexion
  useEffect(() => {
    if (!isLoaded) return;

    const segment = segments[0] as string | undefined;
    const inPublicScreen = publicScreens.includes(segment ?? '');

    if (!user && !inPublicScreen) {
      router.replace('/login');
    } else if (user && (segment === 'login' || segment === 'register')) {
      router.replace('/');
    }
  }, [isLoaded, publicScreens, router, segments, user]);

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
