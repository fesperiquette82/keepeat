import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useStockStore } from '../../store/stockStore';
import { C } from '../../utils/theme';
import { daysUntil, resolveStockItems } from '../../data/mockDashboardData';

type StockFilter = 'tous' | 'urgents' | 'frigo' | 'placard';

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: 'tous', label: 'Tous' },
  { key: 'urgents', label: 'Urgents' },
  { key: 'frigo', label: 'Frigo' },
  { key: 'placard', label: 'Placard' },
];

export default function StockScreen() {
  const { items: storeItems, fetchStock } = useStockStore();
  const [activeFilter, setActiveFilter] = useState<StockFilter>('tous');

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items, isMock } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'urgents') {
      return items.filter((item) => {
        const days = daysUntil(item.expiry_date);
        return days !== null && days <= 2;
      });
    }
    if (activeFilter === 'frigo') return items.filter((item) => item.storageZone === 'frigo');
    if (activeFilter === 'placard') return items.filter((item) => item.storageZone === 'placard');
    return items;
  }, [activeFilter, items]);

  const emptyLabel = useMemo(() => {
    if (items.length === 0) return 'Aucun ingrédient en stock pour le moment.';
    if (activeFilter === 'urgents') return 'Aucun produit urgent actuellement 🎉';
    if (activeFilter === 'frigo') return 'Aucun produit au frigo.';
    if (activeFilter === 'placard') return 'Aucun produit au placard.';
    return 'Aucun résultat pour ce filtre.';
  }, [activeFilter, items.length]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stock complet</Text>
        <Text style={styles.subtitle}>{filteredItems.length} ingrédients affichés</Text>
        {isMock && <Text style={styles.mockInfo}>Données de démonstration</Text>}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((filter) => {
          const selected = filter.key === activeFilter;
          return (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterChip, selected && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter.key)}
            >
              <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelActive]}>{filter.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {filteredItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Stock vide</Text>
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const days = daysUntil(item.expiry_date);
            return (
              <View style={styles.card}>
                <View>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{item.storageZone === 'frigo' ? 'Frigo' : 'Placard'} · {item.quantity ?? 'Qté non précisée'}</Text>
                </View>
                <Text style={styles.expiry}>{days === null ? 'Date inconnue' : days <= 0 ? 'À cuisiner' : `${days} jour(s)`}</Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 4, color: C.textMid, fontSize: 14 },
  mockInfo: { marginTop: 4, color: C.textLight, fontSize: 12 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#ECFDF3' },
  filterChipActive: { backgroundColor: C.primary },
  filterChipLabel: { color: '#166534', fontSize: 13, fontWeight: '700' },
  filterChipLabelActive: { color: '#fff' },
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  meta: { color: C.textMid, fontSize: 12, marginTop: 2 },
  expiry: { color: '#15803d', fontSize: 12, fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  emptyText: { fontSize: 14, color: C.textMid, marginTop: 8, textAlign: 'center' },
});
