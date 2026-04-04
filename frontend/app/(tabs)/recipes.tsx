import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useStockStore } from '../../store/stockStore';
import { C, T } from '../../utils/theme';
import { buildRecipeSuggestionsByScope, resolveStockItems, type RecipeSuggestionScope } from '../../data/mockDashboardData';
import { countLabelFr } from '../../utils/uiText';
import { UI_LABELS } from '../../utils/uiLabels';

const TYPE_LABEL: Record<string, string> = {
  apero: 'Apéro',
  toast: 'Toast',
  tartine: 'Tartine',
  poelee: 'Poêlée',
  salade: 'Salade',
  bol: 'Bol',
  rapide: 'Rapide',
};

type RecipesFilter = 'expiry48h' | 'expiry7d' | 'stock';

const FILTERS: { key: RecipesFilter; label: string }[] = [
  { key: 'expiry48h', label: '48h' },
  { key: 'expiry7d', label: '7 jours' },
  { key: 'stock', label: 'Stock classique' },
];

const EMPTY_FILTER_LABELS: Record<Exclude<RecipesFilter, 'stock'>, string> = {
  expiry48h: 'Aucun produit à consommer dans les prochaines 48h.',
  expiry7d: 'Aucun produit à consommer dans les 7 prochains jours.',
};

export default function RecipesScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock } = useStockStore();
  const [imageErrors, setImageErrors] = React.useState<Record<string, boolean>>({});
  const [activeFilter, setActiveFilter] = React.useState<RecipesFilter>('expiry48h');

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);
  const scope = activeFilter as RecipeSuggestionScope;
  const suggestions = useMemo(() => buildRecipeSuggestionsByScope(items, scope), [items, scope]);

  const emptyMessage = useMemo(() => {
    if (items.length === 0) {
      return 'Aucune recette disponible : ajoutez d’abord des ingrédients au stock.';
    }
    if (activeFilter !== 'stock') {
      return EMPTY_FILTER_LABELS[activeFilter];
    }
    return 'Suggestions indisponibles pour le moment.';
  }, [activeFilter, items.length]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recettes</Text>
        <Text style={styles.subtitle}>Suggestions simples liées à votre stock actuel.</Text>
      </View>

      <View style={styles.controlsCard}>
        <Text style={styles.controlsSectionLabel}>Péremption ciblée</Text>
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
      </View>

      {suggestions.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Aucune recette disponible</Text>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
            <Text style={styles.ctaText}>{UI_LABELS.fr.actions.viewStock}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardMain}>
                <View style={styles.thumb}>
                  {item.image_url && !imageErrors[item.id] ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={styles.thumbImage}
                      onError={() => setImageErrors((prev) => ({ ...prev, [item.id]: true }))}
                    />
                  ) : (
                    <Ionicons name="restaurant-outline" size={18} color={C.textMid} />
                  )}
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>{item.timeMinutes} min · {TYPE_LABEL[item.type] ?? 'Idée simple'}</Text>
                  <Text style={styles.cardInfo}>
                    {countLabelFr(item.matchedCount, 'ingrédient')} dispo{item.matchedCount > 1 ? 's' : ''} · {item.missingCount === 0 ? 'Tout est là ✅' : `Il manque ${countLabelFr(item.missingCount, 'ingrédient')}`}
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: item.id } })}
                    style={styles.detailsButton}
                  >
                    <Text style={styles.detailsButtonLabel}>Voir la recette complète</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
  subtitle: { marginTop: 6, ...T.secondary },
  controlsCard: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, gap: 8 },
  controlsSectionLabel: { ...T.secondarySmall, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 8, paddingBottom: 2, flexWrap: 'wrap' },
  filterChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#ECFDF3' },
  filterChipActive: { backgroundColor: C.primary },
  filterChipLabel: { color: '#166534', fontSize: 13, fontWeight: '700' },
  filterChipLabelActive: { color: '#fff' },
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 11, gap: 4 },
  cardMain: { flexDirection: 'row', gap: 10 },
  cardText: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  cardMeta: { ...T.secondary },
  cardInfo: { color: '#166534', fontWeight: '700', fontSize: 12 },
  detailsButton: { marginTop: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  detailsButtonLabel: { color: '#166534', fontSize: 12, fontWeight: '700' },
  cta: { marginTop: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  emptyText: { marginTop: 8, ...T.secondary, textAlign: 'center' },
});
