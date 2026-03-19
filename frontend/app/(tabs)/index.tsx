
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
import axios from 'axios';
import { buildApiUrl } from '../../utils/config';
import { parseISO, differenceInDays, format } from 'date-fns';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
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

interface GamifData {
  level_name: string;
  level_emoji: string;
  level_index: number;
  progress_to_next: number;
  current_streak: number;
  next_level: string | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const {
    items, stats, historyItems,
    fetchStock, fetchPriorityItems, fetchStats, fetchHistory,
    markConsumed, markThrown,
    isLoading, isOnline, pendingMutations,
  } = useStockStore();
  const { t, language } = useLanguageStore();
  const [refreshing, setRefreshing]   = useState(false);
  const [selectedTab, setSelectedTab] = useState<FilterTab>('tous');
  const [gamif, setGamif]             = useState<GamifData | null>(null);
  const [riskyItemIds, setRiskyItemIds] = useState<Set<string>>(new Set());
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

  // Gamification + prédictions — chargement silencieux en parallèle
  useEffect(() => {
    if (!token) return;
    Promise.allSettled([
      axios.get(buildApiUrl('/api/gamification'), { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(buildApiUrl('/api/predictions'), { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([gamifRes, predRes]) => {
      if (gamifRes.status === 'fulfilled') setGamif(gamifRes.value.data);
      if (predRes.status === 'fulfilled') {
        const ids = new Set<string>((predRes.value.data as { id: string }[]).map(p => p.id));
        setRiskyItemIds(ids);
      }
    });
  }, [token]);

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
  const expiredCount = items.filter(i => { const d = getDaysUntil(i.expiry_date); return d !== null && d < 0; }).length;

  const heroMsg = (): { text: string; color?: string } => {
    if (expiredCount > 0)
      return {
        text: isFr
          ? `⛔ ${expiredCount} produit${expiredCount > 1 ? 's' : ''} périmé${expiredCount > 1 ? 's' : ''} !`
          : `⛔ ${expiredCount} expired product${expiredCount > 1 ? 's' : ''}!`,
        color: '#ef4444',
      };
    if (urgentCount > 0)
      return {
        text: isFr
          ? `⚠️ ${urgentCount} produit${urgentCount > 1 ? 's' : ''} à consommer rapidement`
          : `⚠️ ${urgentCount} product${urgentCount > 1 ? 's' : ''} to use soon`,
        color: '#f97316',
      };
    if (stats.consumed_this_week > 0)
      return {
        text: isFr
          ? `🌱 ${stats.consumed_this_week} sauvé${stats.consumed_this_week > 1 ? 's' : ''} cette semaine · ~${Math.round(stats.consumed_this_week * 2.5)}€`
          : `🌱 ${stats.consumed_this_week} saved this week · ~${Math.round(stats.consumed_this_week * 2.5)}€`,
        color: '#16a34a',
      };
    if (items.length === 0)
      return { text: isFr ? 'Votre stock est vide 🛒' : 'Your stock is empty 🛒' };
    return { text: isFr ? '✅ Tout est sous contrôle' : '✅ Everything under control' };
  };

  // À faire maintenant — items contextuels
  const todoItems = useMemo(() => {
    const list: { emoji: string; label: string; action: () => void; color: string }[] = [];
    if (expiredCount > 0) {
      list.push({
        emoji: '⛔',
        label: isFr
          ? `Jeter ou consommer ${expiredCount} produit${expiredCount > 1 ? 's' : ''} périmé${expiredCount > 1 ? 's' : ''}`
          : `Discard or use ${expiredCount} expired product${expiredCount > 1 ? 's' : ''}`,
        action: () => setSelectedTab('urgents'),
        color: '#ef4444',
      });
    }
    const nonExpiredUrgent = urgentCount - expiredCount;
    if (nonExpiredUrgent > 0) {
      list.push({
        emoji: '⏰',
        label: isFr
          ? `Consommer ${nonExpiredUrgent} produit${nonExpiredUrgent > 1 ? 's' : ''} avant expiration`
          : `Use ${nonExpiredUrgent} product${nonExpiredUrgent > 1 ? 's' : ''} before expiry`,
        action: () => setSelectedTab('urgents'),
        color: '#f97316',
      });
    }
    if (items.length > 0) {
      list.push({
        emoji: '🍳',
        label: isFr ? 'Voir les recettes avec mon stock' : 'See recipes with my stock',
        action: () => router.push('/(tabs)/recipes' as any),
        color: C.primary,
      });
    }
    return list;
  }, [expiredCount, urgentCount, items.length, isFr]);

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
      <ReanimatedSwipeable
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
            {/* Top row: name + menu + badge risque */}
            <View style={styles.cardTopRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              {riskyItemIds.has(item.id) && (
                <View style={styles.riskyBadge}>
                  <Text style={styles.riskyBadgeText}>{isFr ? '⚠️ à risque' : '⚠️ risk'}</Text>
                </View>
              )}
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

            {/* Expiry row — pill uniquement si ≤1 jour */}
            {expiry ? (
              <View style={styles.cardExpiryRow}>
                <View style={[styles.expiryDot, { backgroundColor: expiry.color }]} />
                <Text style={[styles.expiryText, { color: expiry.color }]} numberOfLines={1}>
                  {expiry.text}
                </Text>
                {(getDaysUntil(item.expiry_date) ?? 99) <= 1 && (
                  <TouchableOpacity
                    style={styles.consumePill}
                    onPress={() => handleConsume(item)}
                  >
                    <Ionicons name="checkmark" size={12} color="#fff" />
                    <Text style={styles.consumePillText}>{isFr ? 'Consommer' : 'Mark used'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

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
      </ReanimatedSwipeable>
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
        </View>
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

      {/* Hero card — urgence (ligne 1) + économie (ligne 2) */}
      {(() => {
        const isExpired = expiredCount > 0;
        const isUrgent  = urgentCount > 0;
        const hasUrgence = isExpired || isUrgent;
        const hasEco     = stats.consumed_this_week > 0;

        const bgColor     = isExpired ? '#FEF2F2' : isUrgent ? '#FFF7ED' : items.length === 0 ? '#F7F5F2' : '#F0FDF4';
        const borderColor = isExpired ? '#FECACA' : isUrgent ? '#FED7AA' : items.length === 0 ? '#E8E5E0' : '#BBF7D0';
        const urgColor    = isExpired ? '#ef4444' : '#f97316';
        const iconName: any = isExpired ? 'warning' : isUrgent ? 'time-outline' : items.length === 0 ? 'cart-outline' : 'checkmark-circle';
        const iconColor   = isExpired ? '#ef4444' : isUrgent ? '#f97316' : items.length === 0 ? '#9ca3af' : '#16a34a';

        const urgenceText = isExpired
          ? (isFr ? `⛔ ${expiredCount} produit${expiredCount > 1 ? 's' : ''} périmé${expiredCount > 1 ? 's' : ''}` : `⛔ ${expiredCount} expired product${expiredCount > 1 ? 's' : ''}`)
          : (isFr ? `⚠️ ${urgentCount} produit${urgentCount > 1 ? 's' : ''} à consommer rapidement` : `⚠️ ${urgentCount} product${urgentCount > 1 ? 's' : ''} to use soon`);

        const ctaUrgenceLabel = isExpired ? (isFr ? 'Voir →' : 'See →') : (isFr ? 'Voir →' : 'See →');
        const ctaUrgenceAction = () => setSelectedTab('urgents');

        const fallbackText  = items.length === 0
          ? (isFr ? '🛒 Votre stock est vide' : '🛒 Your stock is empty')
          : (isFr ? '✅ Tout est sous contrôle' : '✅ Everything under control');
        const fallbackColor = items.length === 0 ? '#9ca3af' : '#16a34a';
        const fallbackCta   = items.length === 0
          ? (isFr ? 'Scanner maintenant →' : 'Scan now →')
          : (isFr ? 'Voir les recettes →' : 'See recipes →');
        const fallbackAction = items.length === 0
          ? () => router.push('/scan')
          : () => router.push('/(tabs)/recipes' as any);

        return (
          <View style={[styles.heroCard, { backgroundColor: bgColor, borderColor }]}>
            <Ionicons name={iconName} size={24} color={iconColor} style={styles.heroCardIcon} />
            <View style={[styles.heroCardBody, { gap: hasUrgence && hasEco ? 6 : 2 }]}>
              {/* Ligne urgence */}
              {hasUrgence ? (
                <View style={styles.heroRow}>
                  <Text style={[styles.heroCardText, { color: urgColor, flex: 1 }]} numberOfLines={1}>
                    {urgenceText}
                  </Text>
                  <TouchableOpacity onPress={ctaUrgenceAction}>
                    <Text style={[styles.heroCardCta, { color: urgColor }]}>{ctaUrgenceLabel}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* Fallback si aucun urgent */
                <View style={styles.heroRow}>
                  <Text style={[styles.heroCardText, { color: fallbackColor, flex: 1 }]}>
                    {fallbackText}
                  </Text>
                  {!hasEco && (
                    <TouchableOpacity onPress={fallbackAction}>
                      <Text style={[styles.heroCardCta, { color: fallbackColor }]}>{fallbackCta}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {/* Ligne économie */}
              {hasEco && (
                <View style={styles.heroRow}>
                  <Text style={[styles.heroCardText, { color: '#16a34a', flex: 1 }]}>
                    {isFr
                      ? `💶 ~${Math.round(stats.consumed_this_week * 2.5)}€ économisés cette semaine`
                      : `💶 ~${Math.round(stats.consumed_this_week * 2.5)}€ saved this week`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })()}

      {/* Widget gamification compact */}
      {gamif && (
        <TouchableOpacity
          style={styles.gamifWidget}
          onPress={() => router.push('/(tabs)/stats' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.gamifEmoji}>{gamif.level_emoji}</Text>
          <Text style={styles.gamifName}>{gamif.level_name}</Text>
          {/* Barre de progression */}
          <View style={styles.gamifBarTrack}>
            <View style={[styles.gamifBarFill, { flex: gamif.progress_to_next }]} />
            <View style={{ flex: 1 - gamif.progress_to_next }} />
          </View>
          {gamif.current_streak > 0 && (
            <Text style={styles.gamifStreak}>🔥 {gamif.current_streak}j</Text>
          )}
          <Ionicons name="chevron-forward" size={12} color={C.textLight} />
        </TouchableOpacity>
      )}

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        {urgentCount > 0 ? (
          <TouchableOpacity
            style={[styles.scanBtnLarge, { backgroundColor: expiredCount > 0 ? '#ef4444' : C.orange }]}
            onPress={() => setSelectedTab('urgents')}
          >
            <Ionicons name="time-outline" size={22} color="#fff" />
            <View style={styles.scanBtnTextBlock}>
              <Text style={styles.scanBtnLargeText}>
                {isFr ? 'Gérer les urgents' : 'Handle urgent items'}
              </Text>
              <Text style={styles.scanBtnSubText}>
                {isFr ? `${urgentCount} produit${urgentCount > 1 ? 's' : ''} à traiter` : `${urgentCount} item${urgentCount > 1 ? 's' : ''} to handle`}
              </Text>
            </View>
            <View style={styles.urgentBadge}>
              <Text style={styles.urgentBadgeText}>{urgentCount}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.scanBtnLarge} onPress={() => router.push('/scan')}>
            <Ionicons name="scan-outline" size={22} color="#fff" />
            <View style={styles.scanBtnTextBlock}>
              <Text style={styles.scanBtnLargeText}>{isFr ? 'Scanner un produit' : 'Scan a product'}</Text>
              <Text style={styles.scanBtnSubText}>{isFr ? 'Code-barres, ticket ou date' : 'Barcode, receipt or date'}</Text>
            </View>
          </TouchableOpacity>
        )}
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

      {/* À faire maintenant */}
      {todoItems.length > 0 && (
        <View style={styles.todoSection}>
          <Text style={styles.todoSectionTitle}>
            {isFr ? '✅ À faire maintenant' : '✅ To do now'}
          </Text>
          {todoItems.map((todo, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.todoItem}
              onPress={todo.action}
              activeOpacity={0.7}
            >
              <Text style={styles.todoItemEmoji}>{todo.emoji}</Text>
              <Text style={[styles.todoItemLabel, { color: todo.color }]}>{todo.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={todo.color} />
            </TouchableOpacity>
          ))}
        </View>
      )}

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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 22, fontWeight: '800', color: '#1A1A1A', lineHeight: 28 },
  settingsBtn: {
    padding: 7, backgroundColor: '#F7F5F2', borderRadius: 10,
    borderWidth: 1, borderColor: '#E8E5E0',
  },

  // ── Hero card ──
  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: '#fff',
  },
  heroCardIcon: { flexShrink: 0 },
  heroCardBody: { flex: 1, gap: 4 },
  heroCardText: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  heroCardCta:  { fontSize: 12, fontWeight: '600', opacity: 0.85, marginTop: 2 },
  heroRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  // ── Gamification widget ──
  gamifWidget: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#F3F0FF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E8E5FF',
  },
  gamifEmoji:    { fontSize: 16 },
  gamifName:     { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
  gamifBarTrack: {
    flex: 1,
    height: 5,
    backgroundColor: '#DDD6FE',
    borderRadius: 3,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  gamifBarFill:  { height: '100%', backgroundColor: '#7c3aed', borderRadius: 3 },
  gamifStreak:   { fontSize: 11, fontWeight: '600', color: C.orange },

  // ── Badge risque prédiction ──
  riskyBadge: {
    backgroundColor: '#FFF7ED',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  riskyBadgeText: { fontSize: 9, fontWeight: '700', color: C.orange },

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
  scanBtnTextBlock: { flex: 1, gap: 1 },
  scanBtnSubText: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500' },
  urgentBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    minWidth: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  urgentBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
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

  // ── À faire maintenant ──
  todoSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
    gap: 6,
  },
  todoSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  todoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F0EDE8',
  },
  todoItemEmoji: { fontSize: 16 },
  todoItemLabel: { flex: 1, fontSize: 13, fontWeight: '600' },

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
