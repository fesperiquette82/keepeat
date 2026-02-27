import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import ErrorBoundary from "../component/ErrorBoundary";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';

// Réveille le backend Render (free tier) dès l'ouverture de l'app.
// Best-effort : silencieux en cas d'erreur.
async function warmUpBackend(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    await fetch(`${API_URL}/health`, { signal: controller.signal });
  } catch {
    // Silence intentionnel
  } finally {
    clearTimeout(timer);
  }
}

export default function RootLayout() {
  useEffect(() => {
    warmUpBackend();
  }, []);

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
