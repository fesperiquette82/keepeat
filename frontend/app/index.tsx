
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

export default function HomeScreen() {
  const router = useRouter();
  const { items, priorityItems, stats, fetchStock, fetchPriorityItems, fetchStats, markConsumed, markThrown, isLoading } = useStockStore();
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
    if (!expiryDate) return { status: 'unknown', color: '#666', text: t('noDate') };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = parseISO(expiryDate);
    const daysUntil = differenceInDays(expiry, today);
    
    if (daysUntil < 0) {
      return { status: 'expired', color: '#ef4444', text: t('expired') };
    } else if (daysUntil === 0) {
      return { status: 'today', color: '#f97316', text: t('today') };
    } else if (daysUntil <= 2) {
      return { status: 'soon', color: '#eab308', text: `${daysUntil}${t('daysLeft')}` };
    }
    return { status: 'ok', color: '#22c55e', text: `${daysUntil}${t('daysLeft')}` };
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
    
    Alert.alert(
      title,
      message,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          style: action === 'throw' ? 'destructive' : 'default',
          onPress: async () => {
            if (action === 'consume') {
              await markConsumed(item.id);
            } else {
              await markThrown(item.id);
            }
            await loadData();
          },
        },
      ]
    );
  };

  const renderStockItem = (item: StockItem, showPriority: boolean = false) => {
    const expiryInfo = getExpiryStatus(item.expiry_date);
    
    return (
      <TouchableOpacity 
        key={item.id} 
        style={styles.itemCard}
        onPress={() => router.push({ pathname: '/edit-product', params: { id: item.id } })}
        activeOpacity={0.7}
      >
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
            {item.brand && <Text style={styles.itemBrand} numberOfLines={1}>{item.brand}</Text>}
          </View>
          
          <View style={styles.itemDetails}>
            <View style={[styles.expiryBadge, { backgroundColor: expiryInfo.color + '20' }]}>
              <Ionicons name="calendar-outline" size={14} color={expiryInfo.color} />
              <Text style={[styles.expiryText, { color: expiryInfo.color }]}>
                {formatDate(item.expiry_date)}
              </Text>
            </View>
            <Text style={[styles.statusText, { color: expiryInfo.color }]}>
              {expiryInfo.text}
            </Text>
          </View>
        </View>
        
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.editButton]}
            onPress={(e) => {
              e.stopPropagation();
              router.push({ pathname: '/edit-product', params: { id: item.id } });
            }}
          >
            <Ionicons name="pencil" size={20} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.consumeButton]}
            onPress={(e) => {
              e.stopPropagation();
              handleQuickAction(item, 'consume');
            }}
          >
            <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.throwButton]}
            onPress={(e) => {
              e.stopPropagation();
              handleQuickAction(item, 'throw');
            }}
          >
            <Ionicons name="trash" size={22} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>KeepEat</Text>
          <Text style={styles.subtitle}>{t('subtitle')}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => router.push('/settings')}
        >
          <Ionicons name="settings-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: '#22c55e20' }]}>
          <Text style={[styles.statNumber, { color: '#22c55e' }]}>{stats.total_items}</Text>
          <Text style={styles.statLabel}>{t('inStock')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#eab30820' }]}>
          <Text style={[styles.statNumber, { color: '#eab308' }]}>{stats.expiring_soon}</Text>
          <Text style={styles.statLabel}>{t('expiringSoon')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#ef444420' }]}>
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>{stats.expired}</Text>
          <Text style={styles.statLabel}>{t('expired')}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#22c55e"
          />
        }
      >
        {/* Priority Section */}
        {priorityItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="warning" size={20} color="#f97316" />
              <Text style={styles.sectionTitle}>{t('consumeFirst')}</Text>
            </View>
            {priorityItems.map((item: StockItem) => renderStockItem(item, true))}
          </View>
        )}

        {/* All Items Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="cube-outline" size={20} color="#fff" />
            <Text style={styles.sectionTitle}>{t('myStock')}</Text>
            <Text style={styles.itemCount}>({items.length})</Text>
          </View>
          
          {isLoading && items.length === 0 ? (
            <ActivityIndicator size="large" color="#22c55e" style={styles.loader} />
          ) : items.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="basket-outline" size={64} color="#333" />
              <Text style={styles.emptyText}>{t('emptyStock')}</Text>
              <Text style={styles.emptySubtext}>{t('scanToAdd')}</Text>
            </View>
          ) : (
            items.map((item: StockItem) => renderStockItem(item))
          )}
        </View>
      </ScrollView>

      {/* FAB - Add Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/scan')}
      >
        <Ionicons name="barcode-outline" size={28} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  settingsButton: {
    padding: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  itemCount: {
    fontSize: 14,
    color: '#666',
  },
  itemCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    marginBottom: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  itemBrand: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  itemDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  expiryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  expiryText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 10,
  },
  editButton: {
    backgroundColor: '#3b82f615',
  },
  consumeButton: {
    backgroundColor: '#22c55e15',
  },
  throwButton: {
    backgroundColor: '#ef444415',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#444',
    marginTop: 4,
  },
  loader: {
    marginVertical: 40,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
