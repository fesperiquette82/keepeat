import { View } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useStockStore } from '../store/stockStore';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { logger } from '../utils/logger';
import { hasSeenOnboarding, markOnboardingSeen } from '../utils/onboardingStorage';
import { decidePostLoginDestination } from '../utils/postLoginDestination';

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
      // BUG-095 : sur un nouvel appareil, le stock local est vide au moment de
      // décider ; le stock du serveur est consulté avant d'imposer l'onboarding.
      const destination = await decidePostLoginDestination({
        hasSeenOnboarding: seen,
        localStockCount: () => useStockStore.getState().items.length,
        loadRemoteStock: () => useStockStore.getState().fetchStock({ force: true, reason: 'post_login_destination' }),
      });
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
