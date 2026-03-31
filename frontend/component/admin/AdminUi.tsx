import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { C, shadowSm } from '../../utils/theme';

export function AdminScaffold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized === 'ok' || normalized === 'healthy' ? styles.badgeOk : normalized === 'degraded' ? styles.badgeWarn : styles.badgeError;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={styles.badgeText}>{status}</Text>
    </View>
  );
}

export function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {!!hint && <Text style={styles.kpiHint}>{hint}</Text>}
    </View>
  );
}

export function AdminSectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function LoadingState({ label = 'Chargement...' }: { label?: string }) {
  return (
    <View style={styles.stateBlock}>
      <ActivityIndicator size="large" color={C.primary} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <View style={styles.stateBlock}>
      <Text style={styles.errorText}>Erreur</Text>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.stateBlock}>
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value || 0);
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-FR');
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backText: { color: C.text, fontSize: 17, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: C.text },
  content: { padding: 16, gap: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeOk: { backgroundColor: '#DCFCE7' },
  badgeWarn: { backgroundColor: '#FEF3C7' },
  badgeError: { backgroundColor: '#FEE2E2' },
  badgeText: { fontSize: 12, fontWeight: '700', color: C.text },
  kpiCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 4, minWidth: 140, ...shadowSm },
  kpiLabel: { color: C.textMid, fontSize: 12, fontWeight: '600' },
  kpiValue: { color: C.text, fontSize: 22, fontWeight: '800' },
  kpiHint: { color: C.textLight, fontSize: 12 },
  sectionCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10, ...shadowSm },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  stateBlock: { backgroundColor: '#fff', borderRadius: 12, padding: 18, alignItems: 'center', gap: 8 },
  stateText: { color: C.textMid, textAlign: 'center' },
  errorText: { color: C.red, fontWeight: '700' },
});
