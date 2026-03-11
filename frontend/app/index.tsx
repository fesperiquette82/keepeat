
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStockStore, StockItem } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { format, parseISO, differenceInDays } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { C, shadow, shadowSm } from '../utils/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { items, priorityItems, stats, fetchStock, fetchPriorityItems, fetchStats, markConsumed, markThrown, isLoading, isOnline, pendingMutations } = useStockStore();
  const { t, language } = useLanguageStore();
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    await Promise.all([fetchStock(), fetchPriorityItems(), fetchStats()]);
  }, [fetchStock, fetchPriorityItems, fetchStats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const getExpiryStatus = (expiryDate: string | null | undefined) => {
    if (!expiryDate) return { status: 'unknown', color: C.textLight, bg: C.border + '40', text: t('noDate') };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = parseISO(expiryDate);
    const daysUntil = differenceInDays(expiry, today);

    if (daysUntil < 0)  return { status: 'expired', color: C.red,    bg: C.redLight,    text: t('expired') };
    if (daysUntil === 0) return { status: 'today',   color: C.orange, bg: C.orangeLight, text: t('today') };
    if (daysUntil <= 2)  return { status: 'soon',    color: C.yellow, bg: C.yellowLight, text: `${daysUntil}${t('daysLeft')}` };
    return                       { status: 'ok',      color: C.primary, bg: C.primaryLight, text: `${daysUntil}${t('daysLeft')}` };
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      return format(parseISO(dateStr), 'dd MMM yyyy', { locale: language === 'fr' ? fr : enUS });
    } catch {
      return dateStr;
    }
  };

  const handleQuickAction = (item: StockItem, action: 'consume' | 'throw') => {
    const title = action === 'consume' ? t('markConsumed') : t('markThrown');
    const message = action === 'consume'
      ? t('confirmConsume').replace('{name}', item.name)
      : t('confirmThrow').replace('{name}', item.name);

    Alert.alert(title, message, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        style: action === 'throw' ? 'destructive' : 'default',
        onPress: async () => {
          if (action === 'consume') await markConsumed(item.id);
          else await markThrown(item.id);
          await loadData();
        },
      },
    ]);
  };

  const renderStockItem = (item: StockItem) => {
    const expiryInfo = getExpiryStatus(item.expiry_date);

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.itemCard}
        onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
        activeOpacity={0.85}
      >
        {/* Barre colorée gauche */}
        <View style={[styles.itemAccent, { backgroundColor: expiryInfo.color }]} />

        <View style={styles.itemContent}>
          <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
          {item.brand ? <Text style={styles.itemBrand} numberOfLines={1}>{item.brand}</Text> : null}

          <View style={styles.itemFooter}>
            <View style={[styles.expiryBadge, { backgroundColor: expiryInfo.bg }]}>
              <Ionicons name="calendar-outline" size={13} color={expiryInfo.color} />
              <Text style={[styles.expiryDate, { color: expiryInfo.color }]}>
                {formatDate(item.expiry_date)}
              </Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: expiryInfo.bg }]}>
              <Text style={[styles.statusText, { color: expiryInfo.color }]}>{expiryInfo.text}</Text>
            </View>
          </View>
        </View>

        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.blueLight }]}
            onPress={e => { e.stopPropagation(); router.push({ pathname: '/edit-product', params: { id: item.id } }); }}
          >
            <Ionicons name="pencil" size={18} color={C.blue} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.primaryLight }]}
            onPress={e => { e.stopPropagation(); handleQuickAction(item, 'consume'); }}
          >
            <Ionicons name="checkmark" size={20} color={C.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.redLight }]}
            onPress={e => { e.stopPropagation(); handleQuickAction(item, 'throw'); }}
          >
            <Ionicons name="trash-outline" size={18} color={C.red} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoCircle}>
            <Ionicons name="leaf" size={20} color="#fff" />
          </View>
          <View>
            <Text style={styles.title}>KeepEat</Text>
            <Text style={styles.subtitle}>{t('subtitle')}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={22} color={C.textMid} />
        </TouchableOpacity>
      </View>

      {/* Bandeau offline */}
      {(!isOnline || pendingMutations.length > 0) && (
        <View style={styles.offlineBanner}>
          <Ionicons name={isOnline ? 'sync-outline' : 'cloud-offline-outline'} size={15} color="#fff" />
          <Text style={styles.offlineBannerText}>
            {!isOnline
              ? language === 'fr'
                ? `Hors ligne${pendingMutations.length > 0 ? ` — ${pendingMutations.length} modification${pendingMutations.length > 1 ? 's' : ''} en attente` : ''}`
                : `Offline${pendingMutations.length > 0 ? ` — ${pendingMutations.length} pending change${pendingMutations.length > 1 ? 's' : ''}` : ''}`
              : language === 'fr'
              ? `Synchronisation (${pendingMutations.length})…`
              : `Syncing (${pendingMutations.length})…`}
          </Text>
        </View>
      )}

      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderTopColor: C.primary }]}>
          <Text style={[styles.statNumber, { color: C.primary }]}>{stats.total_items}</Text>
          <Text style={styles.statLabel}>{t('inStock')}</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: C.yellow }]}>
          <Text style={[styles.statNumber, { color: C.yellow }]}>{stats.expiring_soon}</Text>
          <Text style={styles.statLabel}>{t('expiringSoon')}</Text>
        </View>
        <View style={[styles.statCard, { borderTopColor: C.red }]}>
          <Text style={[styles.statNumber, { color: C.red }]}>{stats.expired}</Text>
          <Text style={styles.statLabel}>{t('expired')}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* Priority Section */}
        {priorityItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconBg, { backgroundColor: C.orangeLight }]}>
                <Ionicons name="flame" size={16} color={C.orange} />
              </View>
              <Text style={styles.sectionTitle}>{t('consumeFirst')}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{priorityItems.length}</Text>
              </View>
            </View>
            {priorityItems.map((item: StockItem) => renderStockItem(item))}
          </View>
        )}

        {/* All Items */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBg, { backgroundColor: C.primaryLight }]}>
              <Ionicons name="cube-outline" size={16} color={C.primary} />
            </View>
            <Text style={styles.sectionTitle}>{t('myStock')}</Text>
            <View style={[styles.countBadge, { backgroundColor: C.primaryMid }]}>
              <Text style={[styles.countBadgeText, { color: C.primary }]}>{items.length}</Text>
            </View>
          </View>

          {isLoading && items.length === 0 ? (
            <ActivityIndicator size="large" color={C.primary} style={styles.loader} />
          ) : items.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="basket-outline" size={48} color={C.primary} />
              </View>
              <Text style={styles.emptyText}>{t('emptyStock')}</Text>
              <Text style={styles.emptySubtext}>{t('scanToAdd')}</Text>
            </View>
          ) : (
            items.map((item: StockItem) => renderStockItem(item))
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/scan')}>
        <Ionicons name="barcode-outline" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: C.card,
    ...shadowSm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: C.textLight, marginTop: 1 },
  settingsButton: {
    padding: 8,
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.offline,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineBannerText: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderTopWidth: 3,
    ...shadow,
  },
  statNumber: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 10, color: C.textMid, marginTop: 3, textAlign: 'center', fontWeight: '500' },

  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 110 },

  section: { marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 8,
  },
  sectionIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, flex: 1 },
  countBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: { fontSize: 12, fontWeight: '700', color: C.textMid },

  itemCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    ...shadow,
  },
  itemAccent: { width: 4, alignSelf: 'stretch' },
  itemContent: { flex: 1, paddingVertical: 12, paddingHorizontal: 12 },
  itemName: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 2 },
  itemBrand: { fontSize: 12, color: C.textMid, marginBottom: 6 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expiryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  expiryDate: { fontSize: 11, fontWeight: '600' },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: '700' },

  itemActions: { flexDirection: 'row', gap: 6, paddingRight: 12 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 4 },
  emptySubtext: { fontSize: 14, color: C.textMid },

  loader: { marginVertical: 40 },

  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
  },
});
