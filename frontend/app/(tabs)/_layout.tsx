import React from 'react';
import { ImageBackground } from 'react-native';
import { Tabs, usePathname, useRouter, useSegments } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguageStore } from '../../store/languageStore';
import FloatingScanButton from '../../component/FloatingScanButton';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { getThemeColors } from '../../utils/theme';

export default function TabsLayout() {
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const { language } = useLanguageStore();
  const insets = useSafeAreaInsets();
  const isFr = language === 'fr';
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const colors = getThemeColors(themeMode);
  const activeLeaf = segments[segments.length - 1];
  const hideFabRoutes = new Set(['/scan', '/add-product', '/settings']);
  const shouldHideFabForPath = hideFabRoutes.has(pathname);
  const showScanFab = !shouldHideFabForPath && (activeLeaf === '(tabs)' || activeLeaf === 'index' || activeLeaf === 'stock');

  return (
    <ImageBackground
      source={require('../../assets/images/KeepEat_fond.png')}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textLight,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 62 + insets.bottom,
            paddingBottom: 8 + insets.bottom,
            paddingTop: 6,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: isFr ? 'Accueil' : 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stock"
          options={{
            title: isFr ? 'Stock' : 'Stock',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="cube-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="recipes"
          options={{
            title: isFr ? 'Recettes' : 'Recipes',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="restaurant-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: isFr ? 'Stats' : 'Stats',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
      {showScanFab ? <FloatingScanButton onPress={() => router.push('/scan')} /> : null}
    </ImageBackground>
  );
}
