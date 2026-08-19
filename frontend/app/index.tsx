import { View } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useStockStore } from '../store/stockStore';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { logger } from '../utils/logger';
import { hasSeenOnboarding, markOnboardingSeen } from '../utils/onboardingStorage';
import { resolvePostLoginDestination } from '../utils/postLoginDestination';

export default function Root() {
  const router = useRouter();
  const isLoaded = useAuthStore(state => state.isLoaded);
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    logger.info('[APP_INDEX] effect triggered', { isLoaded, hasUser: !!user });
    if (!isLoaded) {
      logger.info('[APP_INDEX] isLoaded=false, waiting');
      return;
    }
    if (!user) {
      logger.info('[APP_INDEX] no user, navigating to /login');
      router.replace('/login');
      return;
    }

    let cancelled = false;
    (async () => {
      const seen = await hasSeenOnboarding(user.id);
      const hasStockItems = useStockStore.getState().items.length > 0;
      const destination = resolvePostLoginDestination({ hasSeenOnboarding: seen, hasStockItems });
      if (cancelled) return;
      if (destination === '/(tabs)' && !seen) {
        // Stock non vide sans que l'onboarding ait été vu (autre appareil,
        // session précédente) : rien à montrer, on marque comme vu pour de bon.
        void markOnboardingSeen(user.id);
      }
      logger.info('[APP_INDEX] user exists, navigating', { destination });
      router.replace(destination as any);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, user, router]);

  return <View style={{ flex: 1, backgroundColor: '#F7F8FA' }} />;
}
