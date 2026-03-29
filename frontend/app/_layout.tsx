import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import ErrorBoundary from "../component/ErrorBoundary";
import AnimatedSplashOverlay from '../component/AnimatedSplashOverlay';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';
import { requestNotificationPermissions, registerPushToken, checkAndNotifyUrgentOnOpen } from '../utils/notificationService';
import { API_ENV, API_URL, buildApiUrl } from '../utils/config';
import { useNetworkSync } from '../utils/useNetworkSync';
import { logger } from '../utils/logger';
import { APP_CONFIG } from '../utils/appConfig';


// Garde le splash natif visible tant que le root n'est pas prêt.
void SplashScreen.preventAutoHideAsync().catch(() => {
  // Sur Expo Go/web, cela peut échouer silencieusement : l'overlay RN prend le relais.
});

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
    logger.debug('[ENV_DEBUG] backend build info', data);
  } catch (err) {
    logger.debug('[ENV_DEBUG] backend build info unavailable', { message: err instanceof Error ? err.message : String(err) });
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
  const [appReady, setAppReady] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [showAnimatedOverlay, setShowAnimatedOverlay] = useState(true);

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
    logger.info('[ENV] app api target', { apiEnv: API_ENV, apiUrl: API_URL, appVariant: APP_CONFIG.appVariant });
    warmUpBackend();
    if (APP_CONFIG.enableDebugTools) {
      logBackendBuildInfo();
    }
    loadAuth();
    loadLanguage();
    requestNotificationPermissions();
    const keepAlive = setInterval(() => {
      fetch(buildApiUrl('/health'))
        .then(() => {
          if (APP_CONFIG.enableNetworkTracing) {
            logger.debug('[NETWORK_TRACE] keepalive success');
          }
        })
        .catch((err) => {
          if (APP_CONFIG.enableNetworkTracing) {
            logger.warn('[NETWORK_TRACE] keepalive failed', { message: err instanceof Error ? err.message : String(err) });
          }
        });
    }, 4 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, [loadAuth, loadLanguage]);


  // Marque l'app prête dès que l'état critique d'auth est chargé.
  useEffect(() => {
    if (isLoaded) {
      setAppReady(true);
    }
  }, [isLoaded]);

  // Cache le splash natif uniquement quand l'app est prête + animation terminée.
  useEffect(() => {
    if (!appReady || !animationDone) return;

    let cancelled = false;
    const hideSplash = async () => {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Expo Go/web: le splash natif n'est pas toujours contrôlable.
      } finally {
        if (!cancelled) {
          setShowAnimatedOverlay(false);
        }
      }
    };

    hideSplash();

    return () => {
      cancelled = true;
    };
  }, [appReady, animationDone]);

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
          <AnimatedSplashOverlay
            visible={showAnimatedOverlay}
            onAnimationFinished={() => setAnimationDone(true)}
          />
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
