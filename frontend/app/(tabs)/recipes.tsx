import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useStockStore } from '../../store/stockStore';
import { C } from '../../utils/theme';
import { buildRecipeSuggestions, resolveStockItems } from '../../data/mockDashboardData';

export default function RecipesScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock } = useStockStore();

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);
  const suggestions = useMemo(() => buildRecipeSuggestions(items).filter((recipe) => recipe.matchRate >= 34), [items]);

  const emptyMessage = items.length === 0
    ? 'Aucune recette disponible : ajoutez d’abord des ingrédients au stock.'
    : 'Aucune recette pertinente pour le stock actuel.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recettes</Text>
        <Text style={styles.subtitle}>Suggestions simples liées à votre stock actuel.</Text>
      </View>

      {suggestions.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Aucune recette disponible</Text>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
            <Text style={styles.ctaText}>Voir le stock</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.timeMinutes} min · Compatibilité {item.matchRate}%</Text>
              <Text style={styles.cardInfo}>
                {item.missingCount === 0 ? 'Tout est disponible ✅' : `Il manque ${item.missingCount} ingrédient(s)`}
              </Text>
            </View>
          )}
          ListFooterComponent={
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
              <Text style={styles.ctaText}>Voir le stock pour compléter</Text>
            </TouchableOpacity>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 6, color: C.textMid, fontSize: 14 },
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 13, gap: 5 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: C.textMid, fontSize: 13 },
  cardInfo: { color: '#166534', fontWeight: '700', fontSize: 12 },
  cta: { marginTop: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  emptyText: { marginTop: 8, color: C.textMid, fontSize: 14, textAlign: 'center' },
});
