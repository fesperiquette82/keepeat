import { View } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

export default function Root() {
  const router = useRouter();
  const isLoaded = useAuthStore(state => state.isLoaded);
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace('/login');
    } else {
      router.replace('/(tabs)');
    }
  }, [isLoaded, user, router]);

  return <View style={{ flex: 1, backgroundColor: '#F7F8FA' }} />;
}
