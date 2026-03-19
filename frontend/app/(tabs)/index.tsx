
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStockStore, StockItem, HistoryItem } from '../../store/stockStore';
import { useLanguageStore } from '../../store/languageStore';
import { useAuthStore } from '../../store/authStore';
import { parseISO, differenceInDays, format } from 'date-fns';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { fr as frLocale, enUS } from 'date-fns/locale';
import { C, shadowSm } from '../../utils/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysUntil(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return differenceInDays(parseISO(expiryDate), today);
}

function expiryLabel(
  expiryDate: string | null | undefined,
  isFr: boolean,
): { text: string; color: string } | null {
  const days = getDaysUntil(expiryDate);
  if (days === null) return null;
  if (days < 0)  return { text: isFr ? 'Périmé !' : 'Expired!', color: C.red };
  if (days === 0) return { text: isFr ? "Expire aujourd'hui !" : 'Expires today!', color: C.red };
  if (days === 1) return { text: isFr ? 'Expire demain' : 'Expires tomorrow', color: C.orange };
  if (days <= 7)  return { text: isFr ? `Expire dans ${days} jours` : `Expires in ${days} days`, color: C.orange };
  return null;
}

function shortDate(expiryDate: string | null | undefined, lang: string): string {
  if (!expiryDate) return '';
  try {
    return format(parseISO(expiryDate), 'd MMM.', { locale: lang === 'fr' ? frLocale : enUS });
  } catch { return ''; }
}

// ─── Category tabs ────────────────────────────────────────────────────────────

type FilterTab = 'tous' | 'urgents' | 'frigo' | 'placard';

const FILTER_TABS: { key: FilterTab; labelFr: string; labelEn: string }[] = [
  { key: 'tous',    labelFr: 'Tous',    labelEn: 'All'    },
  { key: 'urgents', labelFr: 'Urgents', labelEn: 'Urgent' },
  { key: 'frigo',   labelFr: 'Frigo',   labelEn: 'Fridge' },
  { key: 'placard', labelFr: 'Placard', labelEn: 'Pantry' },
];

const FRIGO_CATS    = new Set(['frais', 'proteines', 'legumes', 'boissons']);
const PLACARD_CATS  = new Set(['feculents', 'desserts', 'epicerie', 'autres']);

const CATEGORY_EMOJI: Record<string, string> = {
  frais: '🥛', proteines: '🥩', legumes: '🥕', feculents: '🍞',
  desserts: '🍰', boissons: '🧃', epicerie: '🏪', autres: '📦',
};

// ─── Main component ────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    items, stats, historyItems,
    fetchStock, fetchPriorityItems, fetchStats, fetchHistory,
    markConsumed, markThrown,
    isLoading, isOnline, pendingMutations,
  } = useStockStore();
  const { t, language } = useLanguageStore();
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedTab, setSelectedTab] = useState<FilterTab>('tous');
  const isFr = language === 'fr';

  // Prénom depuis l'email
  const firstName = useMemo(() => {
    const raw = user?.email?.split('@')[0] ?? '';
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  }, [user?.email]);

  const loadData = useCallback(async () => {
    await Promise.all([fetchStock(), fetchPriorityItems(), fetchStats(), fetchHistory()]);
  }, [fetchStock, fetchPriorityItems, fetchStats, fetchHistory]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleConsume = (item: StockItem) => {
    Alert.alert(
      t('markConsumed'),
      t('confirmConsume').replace('{name}', item.name),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('confirm'), onPress: () => markConsumed(item.id) },
      ]
    );
  };

  const handleThrow = (item: StockItem) => {
    Alert.alert(
      t('markThrown'),
      t('confirmThrow').replace('{name}', item.name),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('confirm'), style: 'destructive', onPress: () => markThrown(item.id) },
      ]
    );
  };

  // Filtrage par tab
  const filteredItems = useMemo(() => {
    switch (selectedTab) {
      case 'urgents':
        return items.filter(i => { const d = getDaysUntil(i.expiry_date); return d !== null && d <= 7; });
      case 'frigo':
        return items.filter(i => FRIGO_CATS.has(i.food_category ?? 'autres'));
      case 'placard':
        return items.filter(i => PLACARD_CATS.has(i.food_category ?? 'autres'));
      default:
        return items;
    }
  }, [items, selectedTab]);

  // Message contextuel
  const urgentCount = items.filter(i => { const d = getDaysUntil(i.expiry_date); return d !== null && d <= 7; }).length;
  const heroMsg = () => {
    if (urgentCount > 0)
      return isFr
        ? `${urgentCount} produit${urgentCount > 1 ? 's' : ''} expirent bientôt`
        : `${urgentCount} product${urgentCount > 1 ? 's' : ''} expiring soon`;
    if (items.length === 0)
      return isFr ? 'Votre stock est vide 🛒' : 'Your stock is empty 🛒';
    return isFr ? 'Tout est en ordre ✅' : 'Everything is fine ✅';
  };

  // ─── Product card ─────────────────────────────────────────────────────────

  const renderCard = (item: StockItem) => {
    const expiry  = expiryLabel(item.expiry_date, isFr);
    const dateStr = shortDate(item.expiry_date, language);
    const emoji   = CATEGORY_EMOJI[item.food_category ?? 'autres'] ?? '📦';
    const placeholderBg = expiry
      ? (expiry.color === C.red ? C.redLight : C.orangeLight)
      : C.primaryLight;

    // Swipe droite → consommer (vert à gauche)
    const leftActions = () => (
      <View style={styles.swipeConsumeAction}>
        <Ionicons name="checkmark-circle" size={28} color="#fff" />
        <Text style={styles.swipeActionText}>{isFr ? 'Consommé' : 'Used'}</Text>
      </View>
    );

    // Swipe gauche → jeter (rouge à droite)
    const rightActions = () => (
      <View style={styles.swipeThrowAction}>
        <Ionicons name="trash" size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{isFr ? 'Jeté' : 'Thrown'}</Text>
      </View>
    );

    return (
      <Swipeable
        key={item.id}
        renderLeftActions={leftActions}
        renderRightActions={rightActions}
        onSwipeableOpen={(direction) => {
          if (direction === 'left') markConsumed(item.id);
          else markThrown(item.id);
        }}
      >
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
          activeOpacity={0.88}
        >
          {/* Thumbnail */}
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.cardImg} />
          ) : (
            <View style={[styles.cardImgPlaceholder, { backgroundColor: placeholderBg }]}>
              <Text style={styles.cardImgEmoji}>{emoji}</Text>
            </View>
          )}

          {/* Body */}
          <View style={styles.cardBody}>
            {/* Top row: name + menu */}
            <View style={styles.cardTopRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <TouchableOpacity
                style={styles.menuBtn}
                onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={C.textLight} />
              </TouchableOpacity>
            </View>

            {/* Brand */}
            {item.brand ? <Text style={styles.cardBrand} numberOfLines={1}>{item.brand}</Text> : null}

            {/* Expiry row */}
            {expiry ? (
              <View style={styles.cardExpiryRow}>
                <View style={[styles.expiryDot, { backgroundColor: expiry.color }]} />
                <Text style={[styles.expiryText, { color: expiry.color }]} numberOfLines={1}>
                  {expiry.text}
                </Text>
                <TouchableOpacity
                  style={styles.consumePill}
                  onPress={() => handleConsume(item)}
                >
                  <Ionicons name="checkmark" size={12} color="#fff" />
                  <Text style={styles.consumePillText}>{isFr ? 'Consommé' : 'Consumed'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.cardExpiryRow}>
                <TouchableOpacity
                  style={[styles.consumePill, styles.consumePillGhost]}
                  onPress={() => handleConsume(item)}
                >
                  <Ionicons name="checkmark" size={12} color={C.primary} />
                  <Text style={[styles.consumePillText, { color: C.primary }]}>
                    {isFr ? 'Consommé' : 'Consumed'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Date + throw */}
            <View style={styles.cardBottomRow}>
              {dateStr ? <Text style={styles.cardDate}>{dateStr}</Text> : <View />}
              <TouchableOpacity
                style={styles.throwBtn}
                onPress={() => handleThrow(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="trash-outline" size={13} color={C.textLight} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>
            {isFr ? `Bonjour ${firstName} 👋` : `Hello ${firstName} 👋`}
          </Text>
          <Text style={styles.heroMsg}>{heroMsg()}</Text>
        </View>
        {/* Decorative illustration */}
        <View style={styles.illustration} pointerEvents="none">
          <Text style={styles.illustEmoji1}>🥕</Text>
          <Text style={styles.illustEmoji2}>🫙</Text>
          <Text style={styles.illustEmoji3}>🌿</Text>
        </View>
        {/* Settings icon */}
        <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={19} color={C.textMid} />
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {(!isOnline || pendingMutations.length > 0) && (
        <View style={styles.offlineBanner}>
          <Ionicons name={isOnline ? 'sync-outline' : 'cloud-offline-outline'} size={13} color="#fff" />
          <Text style={styles.offlineText}>
            {!isOnline ? (isFr ? 'Hors ligne' : 'Offline') : (isFr ? 'Synchronisation…' : 'Syncing…')}
          </Text>
        </View>
      )}

      {/* Stat cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: C.primaryLight }]}>
          <Text style={styles.statEmoji}>🧺</Text>
          <Text style={[styles.statNum, { color: C.primary }]}>{stats.total_items}</Text>
          <Text style={styles.statLbl}>{isFr ? 'Produits' : 'Products'}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#FEF2F2' }]}>
          <Text style={styles.statEmoji}>⚠️</Text>
          <Text style={[styles.statNum, { color: C.red }]}>
            {stats.expired + (stats.expiring_soon ?? 0)}
          </Text>
          <Text style={styles.statLbl}>{isFr ? 'Urgents' : 'Urgent'}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#F5F3FF' }]}>
          <Text style={styles.statEmoji}>🍽️</Text>
          <Text style={[styles.statNum, { color: '#7C3AED' }]}>{stats.consumed_this_week}</Text>
          <Text style={styles.statLbl}>{isFr ? 'Consommés\ncette sem.' : 'Used\nthis week'}</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.scanBtnLarge} onPress={() => router.push('/scan')}>
          <Ionicons name="scan-outline" size={22} color="#fff" />
          <Text style={styles.scanBtnLargeText}>{isFr ? 'Scanner un produit' : 'Scan a product'}</Text>
        </TouchableOpacity>
        <View style={styles.actionsBtnsRow}>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => router.push('/add-product' as any)}>
            <Ionicons name="add" size={17} color={C.textMid} />
            <Text style={styles.outlineBtnText}>{isFr ? 'Ajouter' : 'Add'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => router.push('/recipes' as any)}>
            <Ionicons name="book-outline" size={15} color={C.textMid} />
            <Text style={styles.outlineBtnText}>{isFr ? 'Recettes' : 'Recipes'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Réapprovisionner — scroll horizontal des produits récents */}
      {historyItems.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.historySectionTitle}>
            {isFr ? '🔁 Réapprovisionner' : '🔁 Re-stock'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyScroll}
          >
            {historyItems.map((item: HistoryItem, idx: number) => {
              const emoji = CATEGORY_EMOJI[item.food_category] ?? '📦';
              const params: Record<string, string> = { name: item.name, found: 'true' };
              if (item.brand)              params.brand              = item.brand;
              if (item.image_url)          params.image_url          = item.image_url;
              if (item.category)           params.category           = item.category;
              if (item.barcode)            params.barcode            = item.barcode;
              if (item.shelf_life_fridge)  params.shelf_life_fridge  = String(item.shelf_life_fridge);
              if (item.shelf_life_pantry)  params.shelf_life_pantry  = String(item.shelf_life_pantry);
              if (item.shelf_life_freezer) params.shelf_life_freezer = String(item.shelf_life_freezer);
              if (item.shelf_life_category) params.shelf_life_category = item.shelf_life_category;
              if (item.shelf_life_tips)    params.shelf_life_tips    = item.shelf_life_tips;
              return (
                <TouchableOpacity
                  key={`${item.name}_${idx}`}
                  style={styles.historyCard}
                  onPress={() => router.push({ pathname: '/add-product', params })}
                  activeOpacity={0.8}
                >
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.historyCardImg} />
                  ) : (
                    <View style={styles.historyCardImgPlaceholder}>
                      <Text style={styles.historyCardEmoji}>{emoji}</Text>
                    </View>
                  )}
                  <Text style={styles.historyCardName} numberOfLines={2}>{item.name}</Text>
                  <View style={styles.historyCardPlusBtn}>
                    <Ionicons name="add" size={14} color={C.primary} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Category tabs */}
      <View style={styles.tabsRow}>
        {FILTER_TABS.map(tab => {
          const active = selectedTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => setSelectedTab(tab.key)}
              activeOpacity={0.7}
            >
              <View style={styles.tabLabelRow}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {isFr ? tab.labelFr : tab.labelEn}
                </Text>
                {tab.key === 'urgents' && urgentCount > 0 && (
                  <View style={styles.urgentBadge}>
                    <Text style={styles.urgentBadgeText}>{urgentCount}</Text>
                  </View>
                )}
              </View>
              {active && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          {filteredItems.length > 0
            ? filteredItems.map(item => renderCard(item))
            : !isLoading && (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="basket-outline" size={44} color={C.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {isFr ? 'Aucun produit' : 'No products'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {selectedTab === 'tous'
                    ? (isFr ? 'Scannez un produit pour démarrer' : 'Scan a product to get started')
                    : (isFr ? 'Aucun produit dans cette catégorie' : 'No products in this category')}
                </Text>
                {selectedTab === 'tous' && (
                  <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/scan')}>
                    <Ionicons name="camera-outline" size={18} color="#fff" />
                    <Text style={styles.emptyBtnText}>{isFr ? 'Scanner un produit' : 'Scan a product'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          }

          {/* Motivation */}
          {stats.consumed_this_week > 0 && filteredItems.length > 0 && (
            <View style={styles.motivationBanner}>
              <Text style={styles.motivationText}>
                🌱 {isFr
                  ? `Bravo ! ${stats.consumed_this_week} produit${stats.consumed_this_week > 1 ? 's' : ''} consommé${stats.consumed_this_week > 1 ? 's' : ''} cette semaine.`
                  : `Well done! ${stats.consumed_this_week} product${stats.consumed_this_week > 1 ? 's' : ''} used this week.`}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F2' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 24, fontWeight: '800', color: '#1A1A1A', lineHeight: 30 },
  heroMsg:  { fontSize: 13, color: C.textMid, marginTop: 3 },
  settingsBtn: {
    padding: 7, backgroundColor: '#F7F5F2', borderRadius: 10,
    borderWidth: 1, borderColor: '#E8E5E0', marginTop: 2,
    zIndex: 10,
  },

  // Decorative illustration
  illustration: {
    width: 80, height: 60,
    position: 'relative',
    marginRight: 8,
    marginTop: -4,
  },
  illustEmoji1: { position: 'absolute', right: 0,  top: 0,  fontSize: 38 },
  illustEmoji2: { position: 'absolute', right: 28, top: 12, fontSize: 28 },
  illustEmoji3: { position: 'absolute', right: 8,  top: 26, fontSize: 22 },

  // ── Offline ──
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#92400E',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  offlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ── Stat cards ──
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 0,
    gap: 10,
    backgroundColor: '#fff',
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 1,
  },
  statEmoji: { fontSize: 22, marginBottom: 2 },
  statNum:   { fontSize: 20, fontWeight: '800' },
  statLbl:   { fontSize: 10, color: C.textMid, fontWeight: '500', textAlign: 'center', lineHeight: 14 },

  // ── Action buttons ──
  actionsRow: {
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  scanBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 22,
    paddingVertical: 15,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 5,
  },
  scanBtnLargeText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  actionsBtnsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingVertical: 11,
    borderWidth: 1.5,
    borderColor: '#E8E5E0',
  },
  outlineBtnText: { color: C.textMid, fontSize: 13, fontWeight: '600' },

  // ── History / Re-stock ──
  historySection: {
    backgroundColor: '#fff',
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  historySectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
    paddingHorizontal: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  historyScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  historyCard: {
    width: 76,
    alignItems: 'center',
    gap: 5,
  },
  historyCardImg: {
    width: 56,
    height: 56,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  historyCardImgPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: C.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCardEmoji: { fontSize: 24 },
  historyCardName: {
    fontSize: 10,
    color: C.text,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 13,
  },
  historyCardPlusBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMid,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Category tabs ──
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    position: 'relative',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: C.textLight },
  tabTextActive: { color: C.primary, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    right: 8,
    height: 2.5,
    backgroundColor: C.primary,
    borderRadius: 2,
  },

  // ── List ──
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 40, gap: 10 },

  // ── Product card ──
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...shadowSm,
    borderWidth: 1,
    borderColor: '#F0EDE8',
  },
  cardImg: {
    width: 80,
    height: 90,
    resizeMode: 'cover',
  },
  cardImgPlaceholder: {
    width: 80,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImgEmoji: { fontSize: 32 },

  cardBody: {
    flex: 1,
    paddingTop: 10,
    paddingRight: 10,
    paddingLeft: 10,
    paddingBottom: 8,
    justifyContent: 'space-between',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardName: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', flex: 1, marginRight: 4 },
  menuBtn: { padding: 2 },

  cardBrand: { fontSize: 12, color: C.textMid, marginTop: 1 },

  cardExpiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    flexWrap: 'nowrap',
  },
  expiryDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  expiryText: { fontSize: 12, fontWeight: '600', flex: 1 },

  consumePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  consumePillGhost: {
    backgroundColor: C.primaryLight,
    borderWidth: 1,
    borderColor: C.primaryMid,
  },
  consumePillText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  cardDate:  { fontSize: 11, color: C.textLight },
  throwBtn:  { padding: 2 },

  // ── Empty state ──
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle:    { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: C.textMid, textAlign: 'center', marginBottom: 24 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 13,
  },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Motivation ──
  motivationBanner: {
    backgroundColor: C.primaryLight,
    borderRadius: 14, padding: 14,
    marginTop: 4,
    borderWidth: 1, borderColor: C.primaryMid,
  },
  motivationText: { fontSize: 13, color: '#166534', fontWeight: '600', textAlign: 'center' },

  // ── Swipe actions ──
  swipeConsumeAction: {
    width: 90,
    backgroundColor: C.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  swipeThrowAction: {
    width: 90,
    backgroundColor: C.red,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // ── Urgent badge sur onglet ──
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  urgentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  urgentBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
