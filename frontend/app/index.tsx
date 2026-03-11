
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStockStore, StockItem } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { parseISO, differenceInDays, format } from 'date-fns';
import { fr as frLocale, enUS } from 'date-fns/locale';
import { C, shadow, shadowSm } from '../utils/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysUntil(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return differenceInDays(parseISO(expiryDate), today);
}

function humanDate(expiryDate: string | null | undefined, lang: string): string {
  const days = getDaysUntil(expiryDate);
  if (days === null) return lang === 'fr' ? 'Sans date' : 'No date';
  if (days < 0)  return lang === 'fr' ? 'Périmé !' : 'Expired!';
  if (days === 0) return lang === 'fr' ? "Aujourd'hui !" : 'Today!';
  if (days === 1) return lang === 'fr' ? 'Demain' : 'Tomorrow';
  if (days <= 7) return lang === 'fr' ? `Dans ${days} jours` : `In ${days} days`;
  try {
    return format(parseISO(expiryDate!), 'dd MMM', { locale: lang === 'fr' ? frLocale : enUS });
  } catch { return expiryDate ?? ''; }
}

function getUrgencyLevel(days: number | null): 'expired' | 'today' | 'soon' | 'week' | 'ok' {
  if (days === null) return 'ok';
  if (days < 0)  return 'expired';
  if (days === 0) return 'today';
  if (days <= 2)  return 'soon';
  if (days <= 7)  return 'week';
  return 'ok';
}

const URGENCY_COLOR: Record<string, string> = {
  expired: C.red,
  today:   C.orange,
  soon:    C.yellow,
  week:    '#8B5CF6',
  ok:      C.primary,
};

const URGENCY_BG: Record<string, string> = {
  expired: C.redLight,
  today:   C.orangeLight,
  soon:    C.yellowLight,
  week:    '#F5F3FF',
  ok:      C.primaryLight,
};

// ─── Food categories ──────────────────────────────────────────────────────────

type FoodCategory = 'tous' | 'frais' | 'proteines' | 'legumes' | 'feculents' | 'desserts' | 'boissons' | 'epicerie' | 'autres';

interface CategoryDef {
  key: FoodCategory;
  emoji: string;
  labelFr: string;
  labelEn: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'tous',      emoji: '🏠', labelFr: 'Tous',       labelEn: 'All'      },
  { key: 'frais',     emoji: '🥛', labelFr: 'Frais',      labelEn: 'Fresh'    },
  { key: 'proteines', emoji: '🥩', labelFr: 'Protéines',  labelEn: 'Proteins' },
  { key: 'legumes',   emoji: '🥕', labelFr: 'Légumes',    labelEn: 'Veggies'  },
  { key: 'feculents', emoji: '🍞', labelFr: 'Féculents',  labelEn: 'Grains'   },
  { key: 'desserts',  emoji: '🍰', labelFr: 'Desserts',   labelEn: 'Desserts' },
  { key: 'boissons',  emoji: '🧃', labelFr: 'Boissons',   labelEn: 'Drinks'   },
  { key: 'epicerie',  emoji: '🏪', labelFr: 'Épicerie',   labelEn: 'Pantry'   },
  { key: 'autres',    emoji: '📦', labelFr: 'Autres',     labelEn: 'Other'    },
];

// ─── Main component ────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const {
    items, stats,
    fetchStock, fetchPriorityItems, fetchStats,
    markConsumed, markThrown,
    isLoading, isOnline, pendingMutations,
  } = useStockStore();
  const { t, language } = useLanguageStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<FoodCategory>('tous');
  const fr = language === 'fr';

  const loadData = useCallback(async () => {
    await Promise.all([fetchStock(), fetchPriorityItems(), fetchStats()]);
  }, [fetchStock, fetchPriorityItems, fetchStats]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleAction = (item: StockItem, action: 'consume' | 'throw') => {
    const isConsume = action === 'consume';
    Alert.alert(
      isConsume ? t('markConsumed') : t('markThrown'),
      (isConsume ? t('confirmConsume') : t('confirmThrow')).replace('{name}', item.name),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          style: isConsume ? 'default' : 'destructive',
          onPress: async () => {
            if (isConsume) await markConsumed(item.id);
            else await markThrown(item.id);
            await loadData();
          },
        },
      ]
    );
  };

  // Filtrage par catégorie
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'tous') return items;
    return items.filter(i => (i.food_category ?? 'autres') === selectedCategory);
  }, [items, selectedCategory]);

  // Catégories présentes dans le stock (pour afficher seulement les pills utiles)
  const presentCategories = useMemo(() => {
    const cats = new Set(items.map(i => i.food_category ?? 'autres'));
    return CATEGORIES.filter(c => c.key === 'tous' || cats.has(c.key));
  }, [items]);

  // Groupement par urgence (sur les items filtrés)
  const urgent = filteredItems.filter(i => { const d = getDaysUntil(i.expiry_date); return d !== null && d <= 2; });
  const thisWeek = filteredItems.filter(i => { const d = getDaysUntil(i.expiry_date); return d !== null && d > 2 && d <= 7; });
  const okItems = filteredItems.filter(i => { const d = getDaysUntil(i.expiry_date); return d === null || d > 7; });

  // Message contextuel header
  const heroMsg = () => {
    if (urgent.length > 0)
      return fr
        ? `⚠️ ${urgent.length} produit${urgent.length > 1 ? 's' : ''} à utiliser rapidement !`
        : `⚠️ ${urgent.length} product${urgent.length > 1 ? 's' : ''} to use quickly!`;
    if (thisWeek.length > 0)
      return fr
        ? `👀 ${thisWeek.length} produit${thisWeek.length > 1 ? 's' : ''} à surveiller cette semaine`
        : `👀 ${thisWeek.length} product${thisWeek.length > 1 ? 's' : ''} to watch this week`;
    if (items.length === 0)
      return fr ? '🛒 Votre stock est vide' : '🛒 Your stock is empty';
    return fr ? '✅ Tout est en ordre !' : '✅ Everything is fine!';
  };

  // ─── Item card ───────────────────────────────────────────────────────────────

  const renderUrgentCard = (item: StockItem) => {
    const days = getDaysUntil(item.expiry_date);
    const level = getUrgencyLevel(days);
    const color = URGENCY_COLOR[level];
    const bg = URGENCY_BG[level];

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.urgentCard, { backgroundColor: bg, borderColor: color + '40' }]}
        onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
        activeOpacity={0.85}
      >
        <View style={styles.urgentCardLeft}>
          <View style={[styles.urgentDot, { backgroundColor: color }]} />
          <View style={styles.urgentInfo}>
            <Text style={styles.urgentName} numberOfLines={1}>{item.name}</Text>
            {item.brand ? <Text style={styles.urgentBrand}>{item.brand}</Text> : null}
          </View>
        </View>
        <View style={styles.urgentRight}>
          <Text style={[styles.urgentDate, { color }]}>{humanDate(item.expiry_date, language)}</Text>
          <View style={styles.urgentActions}>
            <TouchableOpacity
              style={[styles.urgentBtn, { backgroundColor: C.primary }]}
              onPress={e => { e.stopPropagation(); handleAction(item, 'consume'); }}
            >
              <Ionicons name="checkmark" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.urgentBtn, { backgroundColor: C.red }]}
              onPress={e => { e.stopPropagation(); handleAction(item, 'throw'); }}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCompactCard = (item: StockItem) => {
    const days = getDaysUntil(item.expiry_date);
    const level = getUrgencyLevel(days);
    const color = URGENCY_COLOR[level];

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.compactCard}
        onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
        activeOpacity={0.85}
      >
        <View style={[styles.compactAccent, { backgroundColor: color }]} />
        <View style={styles.compactContent}>
          <Text style={styles.compactName} numberOfLines={1}>{item.name}</Text>
          {item.brand ? <Text style={styles.compactBrand} numberOfLines={1}>{item.brand}</Text> : null}
        </View>
        <Text style={[styles.compactDate, { color }]}>{humanDate(item.expiry_date, language)}</Text>
        <View style={styles.compactActions}>
          <TouchableOpacity
            style={[styles.compactBtn, { backgroundColor: C.primaryLight }]}
            onPress={e => { e.stopPropagation(); handleAction(item, 'consume'); }}
          >
            <Ionicons name="checkmark" size={16} color={C.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.compactBtn, { backgroundColor: C.redLight }]}
            onPress={e => { e.stopPropagation(); handleAction(item, 'throw'); }}
          >
            <Ionicons name="trash-outline" size={14} color={C.red} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoCircle}>
            <Ionicons name="leaf" size={18} color="#fff" />
          </View>
          <View>
            <Text style={styles.greeting}>{fr ? 'Bonjour !' : 'Hello!'}</Text>
            <Text style={styles.heroMsg}>{heroMsg()}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={20} color={C.textMid} />
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {(!isOnline || pendingMutations.length > 0) && (
        <View style={styles.offlineBanner}>
          <Ionicons name={isOnline ? 'sync-outline' : 'cloud-offline-outline'} size={14} color="#fff" />
          <Text style={styles.offlineText}>
            {!isOnline
              ? fr ? 'Hors ligne' : 'Offline'
              : fr ? `Sync en cours…` : `Syncing…`}
          </Text>
        </View>
      )}

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statPill}>
          <Text style={[styles.statNum, { color: C.primary }]}>{stats.total_items}</Text>
          <Text style={styles.statLbl}>{fr ? 'en stock' : 'in stock'}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statPill}>
          <Text style={[styles.statNum, { color: C.red }]}>{stats.expired + (stats.expiring_soon ?? 0)}</Text>
          <Text style={styles.statLbl}>{fr ? 'urgents' : 'urgent'}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statPill}>
          <Text style={[styles.statNum, { color: '#8B5CF6' }]}>{stats.consumed_this_week}</Text>
          <Text style={styles.statLbl}>{fr ? 'conso. cette sem.' : 'used this week'}</Text>
        </View>
      </View>

      {/* Category filter pills */}
      {presentCategories.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsRow}
          contentContainerStyle={styles.pillsContent}
        >
          {presentCategories.map(cat => {
            const active = selectedCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setSelectedCategory(cat.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.pillEmoji}>{cat.emoji}</Text>
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                  {fr ? cat.labelFr : cat.labelEn}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >

          {/* Section urgente */}
          {urgent.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: C.redLight }]}>
                  <Ionicons name="flame" size={14} color={C.red} />
                </View>
                <Text style={[styles.sectionTitle, { color: C.red }]}>
                  {fr ? 'À utiliser maintenant' : 'Use now'}
                </Text>
                <View style={[styles.badge, { backgroundColor: C.redLight }]}>
                  <Text style={[styles.badgeText, { color: C.red }]}>{urgent.length}</Text>
                </View>
              </View>
              {urgent.map(item => renderUrgentCard(item))}
            </View>
          )}

          {/* Section cette semaine */}
          {thisWeek.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: '#F5F3FF' }]}>
                  <Ionicons name="time-outline" size={14} color="#8B5CF6" />
                </View>
                <Text style={[styles.sectionTitle, { color: '#8B5CF6' }]}>
                  {fr ? 'À surveiller cette semaine' : 'Watch this week'}
                </Text>
                <View style={[styles.badge, { backgroundColor: '#F5F3FF' }]}>
                  <Text style={[styles.badgeText, { color: '#8B5CF6' }]}>{thisWeek.length}</Text>
                </View>
              </View>
              {thisWeek.map(item => renderCompactCard(item))}
            </View>
          )}

          {/* Tout le stock */}
          {okItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: C.primaryLight }]}>
                  <Ionicons name="cube-outline" size={14} color={C.primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: C.primary }]}>
                  {fr ? 'En stock' : 'In stock'}
                </Text>
                <View style={[styles.badge, { backgroundColor: C.primaryMid }]}>
                  <Text style={[styles.badgeText, { color: C.primary }]}>{okItems.length}</Text>
                </View>
              </View>
              {okItems.map(item => renderCompactCard(item))}
            </View>
          )}

          {/* Empty state */}
          {items.length === 0 && !isLoading && (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="basket-outline" size={44} color={C.primary} />
              </View>
              <Text style={styles.emptyTitle}>{fr ? 'Votre stock est vide' : 'Your stock is empty'}</Text>
              <Text style={styles.emptySubtitle}>
                {fr ? 'Scannez un code-barres pour ajouter un produit' : 'Scan a barcode to add a product'}
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/scan')}>
                <Ionicons name="barcode-outline" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>{fr ? 'Scanner un produit' : 'Scan a product'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Anti-gaspi motivation */}
          {stats.consumed_this_week > 0 && (
            <View style={styles.motivationBanner}>
              <Text style={styles.motivationText}>
                🌱 {fr
                  ? `Bravo ! Vous avez consommé ${stats.consumed_this_week} produit${stats.consumed_this_week > 1 ? 's' : ''} cette semaine.`
                  : `Well done! You used ${stats.consumed_this_week} product${stats.consumed_this_week > 1 ? 's' : ''} this week.`}
              </Text>
            </View>
          )}

        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/scan')}>
        <Ionicons name="barcode-outline" size={24} color="#fff" />
      </TouchableOpacity>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: C.card,
    ...shadowSm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  logoCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  greeting: { fontSize: 13, color: C.textMid, fontWeight: '600' },
  heroMsg: { fontSize: 14, color: C.text, fontWeight: '700', marginTop: 1, flexShrink: 1 },
  settingsBtn: {
    padding: 8, backgroundColor: C.bg, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#92400E',
    paddingHorizontal: 16, paddingVertical: 6,
  },
  offlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  statsBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    ...shadow,
  },
  statPill: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLbl: { fontSize: 10, color: C.textLight, fontWeight: '600', marginTop: 1, textAlign: 'center' },
  statDivider: { width: 1, height: 30, backgroundColor: C.border },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 },

  section: { marginBottom: 16 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginBottom: 10,
  },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', flex: 1 },
  badge: {
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '800' },

  // Carte urgente (grande, colorée)
  urgentCard: {
    borderRadius: 16, borderWidth: 1,
    padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    ...shadow,
  },
  urgentCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  urgentDot: { width: 10, height: 10, borderRadius: 5 },
  urgentInfo: { flex: 1 },
  urgentName: { fontSize: 16, fontWeight: '800', color: C.text },
  urgentBrand: { fontSize: 12, color: C.textMid, marginTop: 2 },
  urgentRight: { alignItems: 'flex-end', gap: 8 },
  urgentDate: { fontSize: 13, fontWeight: '800' },
  urgentActions: { flexDirection: 'row', gap: 6 },
  urgentBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },

  // Carte compacte (standard)
  compactCard: {
    backgroundColor: C.card,
    borderRadius: 12, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
    ...shadowSm,
  },
  compactAccent: { width: 4, alignSelf: 'stretch' },
  compactContent: { flex: 1, paddingVertical: 10, paddingHorizontal: 10 },
  compactName: { fontSize: 14, fontWeight: '700', color: C.text },
  compactBrand: { fontSize: 11, color: C.textMid, marginTop: 1 },
  compactDate: { fontSize: 12, fontWeight: '700', paddingHorizontal: 6 },
  compactActions: { flexDirection: 'row', gap: 4, paddingRight: 10 },
  compactBtn: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: C.textMid, textAlign: 'center', marginBottom: 24 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14,
    paddingHorizontal: 24, paddingVertical: 14,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 5,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Motivation
  motivationBanner: {
    backgroundColor: C.primaryLight,
    borderRadius: 14, padding: 14,
    marginTop: 8,
    borderWidth: 1, borderColor: C.primaryMid,
  },
  motivationText: { fontSize: 13, color: '#166534', fontWeight: '600', textAlign: 'center' },

  // FAB
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 10,
  },

  // Category filter pills
  pillsRow: {
    maxHeight: 52,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pillsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: C.bg,
    borderWidth: 1.5, borderColor: C.border,
  },
  pillActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  pillEmoji: { fontSize: 14 },
  pillLabel: { fontSize: 13, fontWeight: '600', color: C.textMid },
  pillLabelActive: { color: C.primary, fontWeight: '700' },
});
