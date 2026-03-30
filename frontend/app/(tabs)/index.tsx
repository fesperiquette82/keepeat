import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStockStore } from '../../store/stockStore';
import { C, shadowSm } from '../../utils/theme';
import { buildRecipeSuggestions, daysUntil, findExpiringSoon, resolveStockItems } from '../../data/mockDashboardData';

function expiryText(days: number | null): string {
  if (days === null) return 'Date non renseignée';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return 'Expire aujourd’hui';
  if (days === 1) return 'Expire demain';
  return `Expire dans ${days} j`;
}

export default function HomeDashboardScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock } = useStockStore();

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items, isMock } = useMemo(() => resolveStockItems(storeItems), [storeItems]);

  const summary = useMemo(() => {
    const frigo = items.filter((item) => item.storageZone === 'frigo').length;
    const placard = items.filter((item) => item.storageZone === 'placard').length;
    const urgents = items.filter((item) => {
      const days = daysUntil(item.expiry_date);
      return days !== null && days <= 2;
    }).length;
    return { frigo, placard, urgents };
  }, [items]);

  const expiringSoon = useMemo(() => findExpiringSoon(items), [items]);
  const recipes = useMemo(() => buildRecipeSuggestions(items).slice(0, 2), [items]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={styles.title}>Stock maison</Text>
          <Text style={styles.subtitle}>{items.length} ingrédients au total</Text>
        </View>

        {isMock && (
          <Text style={styles.mockText}>Mode démo actif (données mockées réalistes)</Text>
        )}

        <TouchableOpacity style={styles.scannerCta} onPress={() => router.push('/scan')} activeOpacity={0.9}>
          <Ionicons name="scan" size={24} color="#fff" />
          <Text style={styles.scannerCtaText}>Scanner un produit</Text>
        </TouchableOpacity>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Placard</Text><Text style={styles.summaryValue}>{summary.placard}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Frigo</Text><Text style={styles.summaryValue}>{summary.frigo}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Urgents</Text><Text style={[styles.summaryValue, styles.urgentValue]}>{summary.urgents}</Text></View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>À consommer bientôt</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/stock')}>
              <Text style={styles.linkText}>Voir stock</Text>
            </TouchableOpacity>
          </View>
          {expiringSoon.length === 0 ? (
            <Text style={styles.emptyText}>Aucun produit urgent pour le moment 🎉</Text>
          ) : (
            expiringSoon.map((item) => (
              <View key={item.id} style={styles.rowItem}>
                <View>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowMeta}>{item.storageZone === 'frigo' ? 'Frigo' : 'Placard'} · {item.quantity ?? 'Qté non précisée'}</Text>
                </View>
                <Text style={styles.rowExpiry}>{expiryText(daysUntil(item.expiry_date))}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.recipesCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recettes</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/recipes')}>
              <Text style={styles.linkText}>Voir les recettes</Text>
            </TouchableOpacity>
          </View>
          {recipes.length === 0 ? (
            <Text style={styles.emptyText}>Aucune recette disponible avec votre stock.</Text>
          ) : (
            recipes.map((recipe) => (
              <View key={recipe.id} style={styles.recipeRow}>
                <Text style={styles.rowTitle}>{recipe.title}</Text>
                <Text style={styles.recipeMeta}>{recipe.timeMinutes} min · {recipe.matchRate}% du stock</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.tipInline}>
          <Ionicons name="leaf-outline" size={15} color={C.primary} />
          <Text style={styles.tipText}>Anti-gaspi : priorisez les produits à J-2.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 4, color: C.textMid, fontSize: 14 },
  mockText: { color: C.textLight, fontSize: 12 },
  scannerCta: {
    backgroundColor: C.primary,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    ...shadowSm,
  },
  scannerCtaText: { color: '#fff', fontSize: 21, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  summaryLabel: { color: C.textMid, fontSize: 12, marginBottom: 4 },
  summaryValue: { color: C.text, fontSize: 23, fontWeight: '800' },
  urgentValue: { color: '#15803d' },
  sectionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 13, gap: 8, ...shadowSm },
  recipesCard: { backgroundColor: '#fff', borderRadius: 14, padding: 13, gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  linkText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  emptyText: { color: C.textMid, fontSize: 13, paddingVertical: 8 },
  rowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 8 },
  rowTitle: { fontSize: 15, color: C.text, fontWeight: '600' },
  rowMeta: { color: C.textMid, fontSize: 12, marginTop: 2 },
  rowExpiry: { color: '#166534', fontSize: 12, fontWeight: '700' },
  recipeRow: { paddingVertical: 5 },
  recipeMeta: { color: C.textMid, marginTop: 2, fontSize: 12 },
  tipInline: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 2 },
  tipText: { flex: 1, color: '#166534', fontSize: 12, fontWeight: '600' },
});
