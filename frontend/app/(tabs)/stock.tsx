import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable } from 'react-native-gesture-handler';
import { useStockStore } from '../../store/stockStore';
import { ActionBanner } from '../../component/ActionBanner';
import { getThemeColors, getThemeText } from '../../utils/theme';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { daysUntil, resolveStockItems } from '../../data/mockDashboardData';
import { removeStockItems, undoRemovedStockItems } from '../../utils/stockRemoval';
import { countLabelFr } from '../../utils/uiText';
import { storageZoneLabel, UI_LABELS } from '../../utils/uiLabels';

type StockFilter = 'tous' | 'urgents' | 'frigo' | 'placard';
type StockSort = 'expiry' | 'alpha' | 'recent' | 'oldest';

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: 'tous', label: 'Tous' },
  { key: 'urgents', label: 'Urgents' },
  { key: 'frigo', label: 'Frigo' },
  { key: 'placard', label: 'Placard' },
];

const SORTS: { key: StockSort; label: string }[] = [
  { key: 'expiry', label: 'Péremption' },
  { key: 'alpha', label: 'A → Z' },
  { key: 'recent', label: 'Ajout récent' },
  { key: 'oldest', label: 'Ajout ancien' },
];

function formatExpiryLabel(expiryDate?: string): string {
  const days = daysUntil(expiryDate);
  if (days === null) return 'Date inconnue';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days <= 7) return `Dans ${days} j`;
  if (days > 365) return '> 12 mois';
  if (days > 180) return 'Longue conservation';
  if (!expiryDate) return 'Date inconnue';
  const expiry = new Date(expiryDate);
  return `Le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(expiry)}`;
}

export default function StockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items: storeItems, fetchStock } = useStockStore();
  const [activeFilter, setActiveFilter] = useState<StockFilter>('tous');
  const [activeSort, setActiveSort] = useState<StockSort>('expiry');
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const [undoItems, setUndoItems] = useState<typeof storeItems>([]);
  const [banner, setBanner] = useState<{ message: string; canUndo: boolean; variant: 'success' | 'error' } | null>(null);
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);

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

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];

    if (activeSort === 'alpha') {
      return list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    if (activeSort === 'recent') {
      return list.sort((a, b) => new Date(b.added_date).getTime() - new Date(a.added_date).getTime());
    }
    if (activeSort === 'oldest') {
      return list.sort((a, b) => new Date(a.added_date).getTime() - new Date(b.added_date).getTime());
    }
    return list.sort((a, b) => (daysUntil(a.expiry_date) ?? 9999) - (daysUntil(b.expiry_date) ?? 9999));
  }, [activeSort, filteredItems]);

  const emptyLabel = useMemo(() => {
    if (items.length === 0) return 'Aucun ingrédient en stock pour le moment.';
    if (activeFilter === 'urgents') return 'Aucun produit urgent actuellement 🎉';
    if (activeFilter === 'frigo') return 'Aucun produit au frigo.';
    if (activeFilter === 'placard') return 'Aucun produit au placard.';
    return 'Aucun résultat pour ce filtre.';
  }, [activeFilter, items.length]);

  const handleSwipeAction = async (itemId: string, action: 'used' | 'thrown') => {
    if (processingIds[itemId]) return;
    setProcessingIds((prev) => ({ ...prev, [itemId]: true }));
    try {
      const result = await removeStockItems([itemId], action);
      if (result.removedItems.length > 0) {
        setUndoItems(result.removedItems);
        setBanner({
          message: action === 'used' ? 'Article retiré du stock (utilisé).' : 'Article retiré du stock (jeté).',
          canUndo: true,
          variant: 'success',
        });
      } else {
        setUndoItems([]);
        setBanner({
          message: "Impossible de retirer l'article pour le moment.",
          canUndo: false,
          variant: 'error',
        });
      }
    } catch {
      Alert.alert('Erreur', "Impossible de mettre à jour l'élément.");
    } finally {
      setProcessingIds((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  const handleUndo = async () => {
    if (undoItems.length === 0) return;
    const result = await undoRemovedStockItems(undoItems);
    if (result.restoredCount === undoItems.length) {
      setBanner({ message: 'Annulation réussie : article restauré.', canUndo: false, variant: 'success' });
    } else {
      setBanner({
        message: `Annulation partielle : ${result.restoredCount} restauré(s), ${result.failedCount} échec(s).`,
        canUndo: false,
        variant: 'error',
      });
    }
    setUndoItems([]);
  };

  const renderSwipeAction = (label: string, color: string, icon: 'restaurant-outline' | 'trash-outline') => (
    <View style={[styles.swipeAction, { backgroundColor: color }]}>
      <Ionicons name={icon} size={18} color="#fff" />
      <Text style={styles.swipeActionText}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stock complet</Text>
        <Text style={styles.subtitle}>{countLabelFr(sortedItems.length, 'ingrédient')} affiché{sortedItems.length > 1 ? 's' : ''}</Text>
        <Text style={styles.swipeHint}>Glisser à droite = utilisé · à gauche = jeté</Text>
        {isMock && <Text style={styles.mockInfo}>Données de démonstration</Text>}
      </View>

      <View style={styles.controlsCard}>
        <Text style={styles.controlsSectionLabel}>Filtres</Text>
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
        <Text style={styles.controlsSectionLabel}>Tri</Text>
        <View style={styles.sortRow}>
          {SORTS.map((sort) => {
            const selected = sort.key === activeSort;
            return (
              <TouchableOpacity
                key={sort.key}
                style={[styles.sortChip, selected && styles.sortChipActive]}
                onPress={() => setActiveSort(sort.key)}
              >
                <Text style={[styles.sortChipLabel, selected && styles.sortChipLabelActive]}>{sort.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {sortedItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Stock vide</Text>
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      ) : (
        <FlatList
          data={sortedItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            return (
              <Swipeable
                overshootLeft={false}
                overshootRight={false}
                renderLeftActions={() => renderSwipeAction('Utilisé', '#16A34A', 'restaurant-outline')}
                renderRightActions={() => renderSwipeAction('Jeté', '#DC2626', 'trash-outline')}
                onSwipeableOpen={(direction) => {
                  if (direction === 'left') {
                    handleSwipeAction(item.id, 'thrown');
                  } else {
                    handleSwipeAction(item.id, 'used');
                  }
                }}
              >
                <TouchableOpacity
                  style={styles.card}
                  activeOpacity={0.8}
                  onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
                >
                  <View style={styles.cardMain}>
                    <View style={styles.thumb}>
                      {item.image_url && !imageErrors[item.id] ? (
                        <Image
                          source={{ uri: item.image_url }}
                          style={styles.thumbImage}
                          onError={() => setImageErrors((prev) => ({ ...prev, [item.id]: true }))}
                        />
                      ) : (
                        <Ionicons name="nutrition-outline" size={17} color={C.textMid} />
                      )}
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.meta}>{storageZoneLabel(item.storageZone)} · {item.quantity ?? UI_LABELS.fr.unknownQuantity}</Text>
                    </View>
                  </View>
                  <Text style={styles.expiry}>{formatExpiryLabel(item.expiry_date)}</Text>
                </TouchableOpacity>
              </Swipeable>
            );
          }}
        />
      )}
      {banner && (
        <ActionBanner
          message={banner.message}
          variant={banner.variant}
          actionLabel={banner.canUndo ? 'Annuler' : undefined}
          onActionPress={banner.canUndo ? handleUndo : undefined}
          onClose={() => setBanner(null)}
          bottomOffset={insets.bottom + 136}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 4, ...T.secondary },
  swipeHint: { marginTop: 4, color: C.textLight, fontSize: 12, fontWeight: '600' },
  mockInfo: { marginTop: 4, ...T.tertiary },
  controlsCard: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, gap: 8 },
  controlsSectionLabel: { ...T.secondarySmall, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#ECFDF3' },
  filterChipActive: { backgroundColor: C.primary },
  filterChipLabel: { color: '#166534', fontSize: 13, fontWeight: '700' },
  filterChipLabelActive: { color: '#fff' },
  sortRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  sortChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#F3F4F6' },
  sortChipActive: { backgroundColor: '#D1FAE5' },
  sortChipLabel: { color: C.textMid, fontSize: 12, fontWeight: '700' },
  sortChipLabelActive: { color: '#166534' },
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cardText: { flex: 1 },
  thumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  meta: { ...T.secondarySmall, marginTop: 2 },
  expiry: { color: '#15803d', fontSize: 12, fontWeight: '700' },
  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 92, borderRadius: 12, marginVertical: 2, gap: 4 },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  emptyText: { ...T.secondary, marginTop: 8, textAlign: 'center' },
});
