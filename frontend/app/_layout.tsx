import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import ErrorBoundary from "../component/ErrorBoundary";
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { requestNotificationPermissions, registerPushToken } from '../utils/notificationService';
import { useNetworkSync } from '../utils/useNetworkSync';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';

async function warmUpBackend(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    await fetch(`${API_URL}/health`, { signal: controller.signal });
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

  // Surveillance de la connectivité réseau + sync automatique
  useNetworkSync();

  // Initialisation au démarrage
  useEffect(() => {
    warmUpBackend();
    loadAuth();
    loadLanguage();
    requestNotificationPermissions();
  }, []);

  // Enregistrement du push token dès que l'utilisateur est authentifié
  useEffect(() => {
    if (user && token) {
      registerPushToken(token);
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
    <ErrorBoundary>
      <View style={styles.container}>
        <StatusBar style="light" />
        <Slot />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
