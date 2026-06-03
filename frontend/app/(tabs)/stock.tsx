import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Alert, TextInput, ImageBackground } from 'react-native';
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
import { expiryColor } from '../../utils/expiryLabels';
import { createSwipeActionQueue, resolveStockRemovalBanner, resolveSwipeActionFromOpenSide } from '../../utils/stockSwipe';
import { debugSwipeLogger } from '../../utils/debugSwipeLogger';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const swipeActionQueueRef = useRef(createSwipeActionQueue());
  // Refs pour fermer chaque Swipeable avant suppression — sans close() le gesture handler
  // de RNGH reste en état "ouvert" quand l'item se démonte, bloquant les swipes suivants.
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const [undoItems, setUndoItems] = useState<typeof storeItems>([]);
  const [banner, setBanner] = useState<{ message: string; canUndo: boolean; variant: 'success' | 'error' } | null>(null);
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);

  useEffect(() => {
    fetchStock({ reason: 'stock.tab.mount' });
  }, [fetchStock]);

  const { items, isMock } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);

  const mostUrgentDays = useMemo(() => {
    const allDays = items.map((item) => daysUntil(item.expiry_date)).filter((d): d is number => d !== null);
    if (allDays.length === 0) return null;
    return Math.min(...allDays);
  }, [items]);

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

  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedItems;
    return sortedItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [sortedItems, searchQuery]);

  // Cleanup swipeable refs for removed items to prevent gesture handler lingering
  useEffect(() => {
    const currentIds = new Set(displayedItems.map((item) => item.id));
    const refsCountBefore = swipeableRefs.current.size;
    const refIdsToRemove: string[] = [];

    swipeableRefs.current.forEach((_, key) => {
      if (!currentIds.has(key)) {
        refIdsToRemove.push(key);
        swipeableRefs.current.delete(key);
      }
    });

    if (refIdsToRemove.length > 0) {
      debugSwipeLogger.info('StockScreen.cleanup', `Removed orphaned refs`, {
        removedRefIds: refIdsToRemove,
        refCountBefore: refsCountBefore,
        refCountAfter: swipeableRefs.current.size,
        displayedItemsCount: displayedItems.length,
      });
    }
  }, [displayedItems]);

  const emptyLabel = useMemo(() => {
    if (searchQuery.trim()) return `Aucun résultat pour "${searchQuery.trim()}".`;
    if (items.length === 0) return 'Aucun ingrédient en stock pour le moment.';
    if (activeFilter === 'urgents') return 'Aucun produit urgent actuellement 🎉';
    if (activeFilter === 'frigo') return 'Aucun produit au frigo.';
    if (activeFilter === 'placard') return 'Aucun produit au placard.';
    return 'Aucun résultat pour ce filtre.';
  }, [activeFilter, items.length, searchQuery]);

  const handleSwipeAction = async (itemId: string, action: 'used' | 'thrown') => {
    debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Starting for item=${itemId} action=${action}`, {
      itemId,
      action,
      isProcessing: !!processingIds[itemId],
      refsCount: swipeableRefs.current.size,
      allRefIds: Array.from(swipeableRefs.current.keys()),
    });

    if (processingIds[itemId]) {
      debugSwipeLogger.warn('StockScreen.handleSwipeAction', `[DELETE_FLOW] Item already processing, skipping`, { itemId });
      return;
    }

    setProcessingIds((prev) => ({ ...prev, [itemId]: true }));
    try {
      // Close Swipeable ref BEFORE removing to prevent gesture handler lingering
      const swipeRef = swipeableRefs.current.get(itemId);
      if (swipeRef) {
        swipeRef.close();
        debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Swipeable closed before removal`, { itemId });
      } else {
        debugSwipeLogger.warn('StockScreen.handleSwipeAction', `[DELETE_FLOW] Swipeable ref not found`, { itemId, refsCount: swipeableRefs.current.size });
      }

      debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Calling removeStockItems`, { itemId, action });
      const result = await removeStockItems([itemId], action);
      debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] removeStockItems result`, {
        itemId,
        action,
        removedItemsCount: result.removedItems.length,
        notFoundCount: result.notFoundCount,
        failedCount: result.failedCount,
        refsCountAfterRemoval: swipeableRefs.current.size,
        refStillExists: swipeableRefs.current.has(itemId),
      });

      const nextBanner = resolveStockRemovalBanner(action, result);
      setUndoItems(nextBanner.canUndo ? result.removedItems : []);
      setBanner(nextBanner);

      debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Banner set`, {
        itemId,
        message: nextBanner.message,
        canUndo: nextBanner.canUndo,
      });

      // Auto-dismiss banner after 3 seconds to avoid visual interference on next deletion
      const bannerId = `${itemId}:${Date.now()}`;
      const timeoutId = setTimeout(() => {
        setBanner(null);
        debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Banner auto-dismissed`, {
          itemId,
          bannerId,
        });
      }, 3000);

      // Store timeout for cleanup if component unmounts
      return () => clearTimeout(timeoutId);
    } catch (err) {
      debugSwipeLogger.error('StockScreen.handleSwipeAction', `Exception caught`, {
        itemId,
        action,
        error: err instanceof Error ? err.message : String(err),
      });
      Alert.alert('Erreur', "Impossible de mettre à jour l'élément.");
    } finally {
      setProcessingIds((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      debugSwipeLogger.info('StockScreen.handleSwipeAction', `[DELETE_FLOW] Finished for item=${itemId}`, {
        itemId,
        refsCount: swipeableRefs.current.size,
        allRefIds: Array.from(swipeableRefs.current.keys()),
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
    <ImageBackground source={require('../../assets/images/KeepEat_fond.png')} style={styles.bgImage} resizeMode="cover">
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text testID="stock-screen-title" style={styles.title}>Stock complet</Text>
          {mostUrgentDays !== null && (
            <View style={[styles.titleDot, { backgroundColor: expiryColor(mostUrgentDays) }]} />
          )}
        </View>
        <Text style={styles.subtitle}>{countLabelFr(displayedItems.length, 'ingrédient')} affiché{displayedItems.length > 1 ? 's' : ''}</Text>
        <Text style={styles.swipeHint}>Glisser à droite = utilisé · à gauche = jeté</Text>
        {isMock && <Text style={styles.mockInfo}>Données de démonstration</Text>}
      </View>

      <View style={styles.controlsCard}>
        {activeFilter === 'tous' && <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color={C.textMid} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Rechercher un produit..."
            placeholderTextColor={C.textLight}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={C.textMid} />
            </TouchableOpacity>
          )}
        </View>}
        <Text style={styles.controlsSectionLabel}>Filtres</Text>
        <View style={styles.filterRow}>
          {FILTERS.map((filter) => {
            const selected = filter.key === activeFilter;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, selected && styles.filterChipActive]}
                onPress={() => { setActiveFilter(filter.key); if (filter.key !== 'tous') setSearchQuery(''); }}
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

      {displayedItems.length === 0 ? (
        <View testID="stock-empty-state" style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{searchQuery.trim() ? 'Aucun résultat' : 'Stock vide'}</Text>
          <Text testID="stock-empty-message" style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      ) : (
        <FlatList
          data={displayedItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            return (
              <Swipeable
                ref={(ref) => {
                  if (ref) {
                    swipeableRefs.current.set(item.id, ref);
                    debugSwipeLogger.info('StockScreen.Swipeable.ref', `Ref added`, {
                      itemId: item.id,
                      itemName: item.name,
                      refsCount: swipeableRefs.current.size,
                    });
                  } else {
                    swipeableRefs.current.delete(item.id);
                    debugSwipeLogger.info('StockScreen.Swipeable.ref', `Ref removed`, {
                      itemId: item.id,
                      itemName: item.name,
                      refsCount: swipeableRefs.current.size,
                    });
                  }
                }}
                overshootLeft={false}
                overshootRight={false}
                renderLeftActions={() => renderSwipeAction('Utilisé', '#16A34A', 'restaurant-outline')}
                renderRightActions={() => renderSwipeAction('Jeté', '#DC2626', 'trash-outline')}
                onSwipeableLeftOpen={() => {
                  const refCountBefore = swipeableRefs.current.size;
                  debugSwipeLogger.info('StockScreen.onSwipeableLeftOpen', `Swiped left`, {
                    itemId: item.id,
                    itemName: item.name,
                    refsCountBefore: refCountBefore,
                    allRefIds: Array.from(swipeableRefs.current.keys()),
                    processingIds: Object.keys(processingIds).filter((id) => processingIds[id]),
                  });
                  // Fermer tous les autres Swipeable d'abord (pattern std pour FlatList).
                  const closedRefs: string[] = [];
                  swipeableRefs.current.forEach((ref, key) => {
                    if (key !== item.id) {
                      ref?.close();
                      closedRefs.push(key);
                    }
                  });
                  debugSwipeLogger.info('StockScreen.onSwipeableLeftOpen', `Other swipeables closed, enqueueing action`, {
                    itemId: item.id,
                    closedRefIds: closedRefs,
                    refsCountAfterClose: swipeableRefs.current.size,
                  });
                  void swipeActionQueueRef.current.enqueue(async () => {
                    debugSwipeLogger.info('StockScreen.onSwipeableLeftOpen.queue', `[DELETE_FLOW] Action starting`, { itemId: item.id });
                    await handleSwipeAction(item.id, resolveSwipeActionFromOpenSide('left'));
                    debugSwipeLogger.info('StockScreen.onSwipeableLeftOpen.queue', `[DELETE_FLOW] Action complete`, { itemId: item.id });
                    // NOTE: ref is already closed in handleSwipeAction before removeStockItems
                    // so no need to close again here
                  });
                }}
                onSwipeableRightOpen={() => {
                  const refCountBefore = swipeableRefs.current.size;
                  debugSwipeLogger.info('StockScreen.onSwipeableRightOpen', `Swiped right`, {
                    itemId: item.id,
                    itemName: item.name,
                    refsCountBefore: refCountBefore,
                    allRefIds: Array.from(swipeableRefs.current.keys()),
                    processingIds: Object.keys(processingIds).filter((id) => processingIds[id]),
                  });
                  const closedRefs: string[] = [];
                  swipeableRefs.current.forEach((ref, key) => {
                    if (key !== item.id) {
                      ref?.close();
                      closedRefs.push(key);
                    }
                  });
                  debugSwipeLogger.info('StockScreen.onSwipeableRightOpen', `Other swipeables closed, enqueueing action`, {
                    itemId: item.id,
                    closedRefIds: closedRefs,
                    refsCountAfterClose: swipeableRefs.current.size,
                  });
                  void swipeActionQueueRef.current.enqueue(async () => {
                    debugSwipeLogger.info('StockScreen.onSwipeableRightOpen.queue', `[DELETE_FLOW] Action starting`, { itemId: item.id });
                    await handleSwipeAction(item.id, resolveSwipeActionFromOpenSide('right'));
                    debugSwipeLogger.info('StockScreen.onSwipeableRightOpen.queue', `[DELETE_FLOW] Action complete`, { itemId: item.id });
                    // NOTE: ref is already closed in handleSwipeAction before removeStockItems
                    // so no need to close again here
                  });
                }}
              >
                <TouchableOpacity
                  testID="stock-item-row"
                  accessibilityLabel={`stock-item-${item.id}`}
                  style={styles.card}
                  activeOpacity={0.8}
                  onPress={() => router.push({ pathname: '/stock/[id]', params: { id: item.id } })}
                >
                  <View style={styles.cardMain}>
                    <View style={styles.thumb}>
                      {item.image_url && !imageErrors[`${item.id}:${item.image_url}`] ? (
                        <Image
                          source={{ uri: item.image_url }}
                          style={styles.thumbImage}
                          onError={() => setImageErrors((prev) => ({ ...prev, [`${item.id}:${item.image_url}`]: true }))}
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
                  <View style={styles.expiryBadge}>
                    <View style={[styles.expiryDot, { backgroundColor: expiryColor(daysUntil(item.expiry_date)) }]} />
                    <Text style={[styles.expiry, { color: expiryColor(daysUntil(item.expiry_date)) }]}>{formatExpiryLabel(item.expiry_date)}</Text>
                  </View>
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
    </ImageBackground>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>) => StyleSheet.create({
  bgImage: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleDot: { width: 10, height: 10, borderRadius: 5 },
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
  expiryBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  expiryDot: { width: 8, height: 8, borderRadius: 4 },
  expiry: { fontSize: 12, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, paddingVertical: 0 },
  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 92, borderRadius: 12, marginVertical: 2, gap: 4 },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  emptyText: { ...T.secondary, marginTop: 8, textAlign: 'center' },
});
