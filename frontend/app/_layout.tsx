import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import ErrorBoundary from "../component/ErrorBoundary";

export default function RootLayout() {
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
