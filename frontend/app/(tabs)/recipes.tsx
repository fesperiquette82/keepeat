
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { buildApiUrl } from '../../utils/config';
import { C, shadowSm } from '../../utils/theme';

interface RecipeSuggestion {
  id: number;
  title: string;
  image: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}

type FilterTab = 'tous' | 'urgents' | 'frigo' | 'placard';
const FILTER_TABS: { key: FilterTab; labelFr: string; labelEn: string }[] = [
  { key: 'tous',    labelFr: 'Tous',    labelEn: 'All'    },
  { key: 'urgents', labelFr: 'Urgents', labelEn: 'Urgent' },
  { key: 'frigo',   labelFr: 'Frigo',   labelEn: 'Fridge' },
  { key: 'placard', labelFr: 'Placard', labelEn: 'Pantry' },
];

export default function RecipesScreen() {
  const { token } = useAuthStore();
  const { language } = useLanguageStore();
  const isFr = language === 'fr';

  const [recipes, setRecipes]         = useState<RecipeSuggestion[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<FilterTab>('tous');

  const t = (fr: string, en: string) => isFr ? fr : en;

  const fetchRecipes = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get(buildApiUrl('/api/recipes/suggestions'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRecipes(res.data);
    } catch {
      setError(t(
        'Impossible de charger les recettes. Vérifiez votre connexion.',
        'Unable to load recipes. Check your connection.',
      ));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, language]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchRecipes(true);
  };

  const openRecipe = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>{t('Recettes 🌿', 'Recipes 🌿')}</Text>
          <Text style={styles.headerSub}>{t('Inspirées de vos produits', 'Based on your products')}</Text>
        </View>
        {/* Decoration */}
        <View style={styles.illustration} pointerEvents="none">
          <Text style={styles.illustEmoji1}>🥗</Text>
          <Text style={styles.illustEmoji2}>🧄</Text>
          <Text style={styles.illustEmoji3}>🌿</Text>
        </View>
      </View>

      {/* Category tabs */}
      <View style={styles.tabsRow}>
        {FILTER_TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {isFr ? tab.labelFr : tab.labelEn}
              </Text>
              {active && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#ccc" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchRecipes()}>
            <Text style={styles.retryBtnText}>{t('Réessayer', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : recipes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🍳</Text>
          <Text style={styles.emptyTitle}>{t('Aucune suggestion', 'No suggestions')}</Text>
          <Text style={styles.emptyText}>
            {t(
              'Ajoutez des produits avec une date de péremption proche pour obtenir des idées de recettes.',
              'Add products with a near expiry date to get recipe ideas.',
            )}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.primary} />
          }
        >
          {/* Section header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {t('Recettes avec vos urgences', 'Recipes with your urgent items')} 🗓️
            </Text>
            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="ellipsis-horizontal" size={16} color={C.textLight} />
            </TouchableOpacity>
          </View>

          {recipes.map((recipe) => (
            <TouchableOpacity
              key={recipe.id}
              style={styles.card}
              onPress={() => openRecipe(recipe.sourceUrl)}
              activeOpacity={0.88}
            >
              {/* Image */}
              <View style={styles.cardImgWrap}>
                {recipe.image ? (
                  <Image source={{ uri: recipe.image }} style={styles.cardImg} />
                ) : (
                  <View style={styles.cardImgPlaceholder}>
                    <Ionicons name="restaurant-outline" size={32} color="#ccc" />
                  </View>
                )}
                {/* Ingredient count badge */}
                {recipe.usedIngredients.length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{recipe.usedIngredients.length}</Text>
                  </View>
                )}
              </View>

              {/* Body */}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>{recipe.title}</Text>

                {/* Used ingredients */}
                {recipe.usedIngredients.length > 0 && (
                  <View style={styles.ingredientsRow}>
                    {recipe.usedIngredients.slice(0, 3).map(ing => (
                      <View key={ing} style={styles.badgeUsed}>
                        <Ionicons name="checkmark" size={10} color={C.primary} />
                        <Text style={styles.badgeUsedText} numberOfLines={1}>{ing}</Text>
                      </View>
                    ))}
                    {recipe.usedIngredients.length > 3 && (
                      <Text style={styles.badgeMore}>+{recipe.usedIngredients.length - 3}</Text>
                    )}
                  </View>
                )}

                {/* Footer: missing count + open */}
                <View style={styles.cardFooter}>
                  {recipe.missedIngredients.length > 0 && (
                    <Text style={styles.missedText}>
                      {recipe.missedIngredients.length} {t('manquant(s)', 'missing')}
                    </Text>
                  )}
                  <View style={styles.viewBtn}>
                    <Text style={styles.viewBtnText}>{t('Voir', 'View')}</Text>
                    <Ionicons name="open-outline" size={12} color={C.primary} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

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
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1A1A' },
  headerSub:   { fontSize: 13, color: C.textMid, marginTop: 3 },

  illustration: { width: 80, height: 60, position: 'relative', marginRight: 4, marginTop: -4 },
  illustEmoji1: { position: 'absolute', right: 0,  top: 0,  fontSize: 38 },
  illustEmoji2: { position: 'absolute', right: 30, top: 10, fontSize: 24 },
  illustEmoji3: { position: 'absolute', right: 10, top: 24, fontSize: 20 },

  // ── Tabs ──
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    position: 'relative',
  },
  tabText:       { fontSize: 14, fontWeight: '600', color: C.textLight },
  tabTextActive: { color: C.primary, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0, left: 8, right: 8,
    height: 2.5,
    backgroundColor: C.primary,
    borderRadius: 2,
  },

  // ── States ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorText: { color: C.orange, fontSize: 14, textAlign: 'center' },
  retryBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, marginTop: 8,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  emptyEmoji: { fontSize: 52, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center' },
  emptyText:  { fontSize: 13, color: C.textMid, textAlign: 'center', lineHeight: 20 },

  // ── List ──
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 40, gap: 10 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },

  // ── Recipe card ──
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...shadowSm,
    borderWidth: 1,
    borderColor: '#F0EDE8',
  },
  cardImgWrap: { position: 'relative' },
  cardImg: { width: 100, height: 100, resizeMode: 'cover' },
  cardImgPlaceholder: {
    width: 100, height: 100,
    backgroundColor: '#F0EDE8',
    alignItems: 'center', justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    bottom: 6, left: 6,
    backgroundColor: C.red,
    borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  cardBody: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', lineHeight: 19 },

  ingredientsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  badgeUsed: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: C.primaryMid,
  },
  badgeUsedText: { fontSize: 10, color: C.primary, fontWeight: '600', maxWidth: 60 },
  badgeMore: { fontSize: 11, color: C.textLight, fontWeight: '600', alignSelf: 'center' },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  missedText: { fontSize: 11, color: C.textLight },
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1, borderColor: C.primaryMid,
    backgroundColor: C.primaryLight,
  },
  viewBtnText: { fontSize: 12, color: C.primary, fontWeight: '600' },
});
