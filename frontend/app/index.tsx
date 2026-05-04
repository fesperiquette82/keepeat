import { View } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { logger } from '../utils/logger';

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
    } else {
      logger.info('[APP_INDEX] user exists, navigating to /(tabs)');
      router.replace('/(tabs)');
    }
  }, [isLoaded, user, router]);

  return <View style={{ flex: 1, backgroundColor: '#F7F8FA' }} />;
}
