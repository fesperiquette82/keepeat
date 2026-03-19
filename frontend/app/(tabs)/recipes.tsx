
import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { useStockStore } from '../../store/stockStore';
import { buildApiUrl } from '../../utils/config';
import { C, shadowSm } from '../../utils/theme';

interface RecipeSuggestion {
  id: number;
  title: string;
  image: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
  is_fallback?: boolean;
  is_ai?: boolean;
  ingredients_used?: string[];
  instructions_summary?: string;
  prep_time_min?: number;
}

type FilterTab = 'tous' | 'urgents' | 'frigo' | 'placard' | 'ai';
const FILTER_TABS: { key: FilterTab; labelFr: string; labelEn: string }[] = [
  { key: 'tous',    labelFr: 'Tous',    labelEn: 'All'    },
  { key: 'urgents', labelFr: 'Urgents', labelEn: 'Urgent' },
  { key: 'frigo',   labelFr: 'Frigo',   labelEn: 'Fridge' },
  { key: 'placard', labelFr: 'Placard', labelEn: 'Pantry' },
  { key: 'ai',      labelFr: '✨ IA',   labelEn: '✨ AI'  },
];

const TAB_TO_FILTER: Record<FilterTab, string> = {
  tous:    'all',
  urgents: 'urgent',
  frigo:   'frigo',
  placard: 'placard',
  ai:      'ai',
};

const SECTION_TITLES: Record<FilterTab, { fr: string; en: string }> = {
  tous:    { fr: 'Recettes avec votre stock 🧺',    en: 'Recipes from your stock 🧺'      },
  urgents: { fr: 'Recettes avec vos urgences 🗓️',  en: 'Recipes with your urgent items 🗓️' },
  frigo:   { fr: 'Recettes avec le frigo ❄️',       en: 'Fridge recipes ❄️'                },
  placard: { fr: 'Recettes avec le placard 🏪',     en: 'Pantry recipes 🏪'                },
  ai:      { fr: 'Recettes IA personnalisées ✨',   en: 'AI personalized recipes ✨'        },
};

const EMPTY_TEXTS: Record<FilterTab, { fr: string; en: string }> = {
  tous:    { fr: 'Votre stock est vide ou aucune recette trouvée.', en: 'Your stock is empty or no recipes found.'   },
  urgents: { fr: 'Aucun produit urgent. Bravo ! 🎉',               en: 'No urgent items. Well done! 🎉'             },
  frigo:   { fr: 'Aucun produit au frigo dans le stock.',           en: 'No fridge products in your stock.'          },
  placard: { fr: 'Aucun produit au placard dans le stock.',         en: 'No pantry products in your stock.'          },
  ai:      { fr: 'Stock vide — ajoutez des produits pour générer des recettes IA.', en: 'Empty stock — add products to generate AI recipes.' },
};

export default function RecipesScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const { language } = useLanguageStore();
  const { items } = useStockStore();
  const isFr = language === 'fr';

  const [recipes, setRecipes]         = useState<RecipeSuggestion[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<FilterTab>('tous');
  const [previewRecipes, setPreviewRecipes] = useState<RecipeSuggestion[]>([]);

  const t = (fr: string, en: string) => isFr ? fr : en;

  // Produits urgents (≤7 jours) pour la bannière contextuelle
  const urgentItems = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return items
      .filter(item => {
        if (!item.expiry_date) return false;
        const exp = new Date(item.expiry_date);
        exp.setHours(0, 0, 0, 0);
        const diff = Math.round((exp.getTime() - now.getTime()) / 86400000);
        return diff <= 7;
      })
      .sort((a, b) => {
        const da = new Date(a.expiry_date!).getTime();
        const db = new Date(b.expiry_date!).getTime();
        return da - db;
      })
      .slice(0, 4);
  }, [items]);

  const fetchRecipes = useCallback(async (tab: FilterTab, silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const url = tab === 'ai'
        ? buildApiUrl('/api/recipes/ai')
        : buildApiUrl(`/api/recipes/suggestions?filter=${TAB_TO_FILTER[tab]}`);
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Normaliser les recettes IA au même format
      if (tab === 'ai') {
        const aiRecipes = (res.data as any[]).map((r, i) => ({
          id: -(i + 1),
          title: r.title,
          image: '',
          usedIngredients: r.ingredients_used ?? [],
          missedIngredients: [],
          sourceUrl: '',
          is_ai: true,
          ingredients_used: r.ingredients_used ?? [],
          instructions_summary: r.instructions_summary ?? '',
          prep_time_min: r.prep_time_min ?? null,
        }));
        setRecipes(aiRecipes);
      } else {
        setRecipes(res.data);
      }
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

  useEffect(() => { fetchRecipes(activeTab); }, [fetchRecipes, activeTab]);

  // Chargement silencieux des 3 recettes preview (urgent en priorité, all en fallback)
  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        let res = await axios.get(buildApiUrl('/api/recipes/suggestions?filter=urgent'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if ((res.data as RecipeSuggestion[]).length > 0) {
          setPreviewRecipes((res.data as RecipeSuggestion[]).slice(0, 3));
          return;
        }
        res = await axios.get(buildApiUrl('/api/recipes/suggestions?filter=all'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        setPreviewRecipes((res.data as RecipeSuggestion[]).slice(0, 3));
      } catch { /* silencieux */ }
    };
    load();
  }, [token]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchRecipes(activeTab, true);
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

      {/* Preview 3 recettes — chargement silencieux */}
      {previewRecipes.length > 0 && (
        <View style={styles.previewSection}>
          <Text style={styles.previewTitle}>
            {isFr ? '✨ Suggérées pour vous' : '✨ Suggested for you'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewScroll}
          >
            {previewRecipes.map(recipe => (
              <TouchableOpacity
                key={recipe.id}
                style={styles.previewCard}
                onPress={() => openRecipe(recipe.sourceUrl)}
                activeOpacity={0.85}
              >
                {recipe.image ? (
                  <Image source={{ uri: recipe.image }} style={styles.previewCardImg} />
                ) : (
                  <View style={[styles.previewCardImg, styles.previewCardImgPlaceholder]}>
                    <Ionicons name="restaurant-outline" size={28} color="#ccc" />
                  </View>
                )}
                <View style={styles.previewCardOverlay} />
                <Text style={styles.previewCardTitle} numberOfLines={2}>{recipe.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchRecipes(activeTab)}>
            <Text style={styles.retryBtnText}>{t('Réessayer', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : recipes.length === 0 ? (
        <View style={styles.center}>
          {activeTab === 'urgents' ? (
            <>
              <Text style={styles.emptyEmoji}>🎉</Text>
              <Text style={styles.emptyTitle}>{t('Aucun urgent', 'Nothing urgent')}</Text>
              <Text style={styles.emptyText}>{t('Bravo ! Aucun produit ne périme dans les 7 jours.', 'Great! No products expiring in the next 7 days.')}</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setActiveTab('tous')}>
                <Ionicons name="restaurant-outline" size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>{t('Voir toutes les recettes', 'See all recipes')}</Text>
              </TouchableOpacity>
            </>
          ) : activeTab === 'tous' ? (
            <>
              <Text style={styles.emptyEmoji}>🛒</Text>
              <Text style={styles.emptyTitle}>{t('Stock vide', 'Empty stock')}</Text>
              <Text style={styles.emptyText}>{t('Ajoutez des produits à votre stock pour obtenir des suggestions.', 'Add products to your stock to get recipe suggestions.')}</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/scan' as any)}>
                <Ionicons name="scan-outline" size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>{t('Scanner un produit', 'Scan a product')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.emptyEmoji}>🍳</Text>
              <Text style={styles.emptyTitle}>{t('Aucune suggestion', 'No suggestions')}</Text>
              <Text style={styles.emptyText}>
                {isFr ? EMPTY_TEXTS[activeTab].fr : EMPTY_TEXTS[activeTab].en}
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setActiveTab('tous')}>
                <Ionicons name="restaurant-outline" size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>{t('Voir toutes les recettes', 'See all recipes')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.primary} />
          }
        >
          {/* Bannière contextuelle urgents */}
          {activeTab === 'urgents' && urgentItems.length > 0 && !recipes[0]?.is_fallback && (
            <View style={styles.urgentBanner}>
              <Ionicons name="time-outline" size={15} color={C.orange} />
              <View style={styles.urgentBannerBody}>
                <Text style={styles.urgentBannerLabel}>
                  {isFr ? 'À utiliser avant expiration :' : 'To use before expiry:'}
                </Text>
                <Text style={styles.urgentBannerNames}>
                  {urgentItems.map(item => {
                    const now = new Date();
                    now.setHours(0, 0, 0, 0);
                    const exp = new Date(item.expiry_date!);
                    exp.setHours(0, 0, 0, 0);
                    const d = Math.round((exp.getTime() - now.getTime()) / 86400000);
                    const tag = d < 0
                      ? (isFr ? 'périmé' : 'expired')
                      : d === 0
                        ? (isFr ? "aujourd'hui" : 'today')
                        : d === 1
                          ? (isFr ? 'demain' : 'tomorrow')
                          : (isFr ? `dans ${d}j` : `in ${d}d`);
                    return `${item.name.split(' ').slice(0, 2).join(' ')} (${tag})`;
                  }).join('  ·  ')}
                </Text>
              </View>
            </View>
          )}

          {/* Section header */}
          {recipes[0]?.is_fallback ? (
            <View style={[styles.sectionHeader, styles.fallbackHeader]}>
              <Ionicons name="sparkles-outline" size={15} color="#7c3aed" />
              <Text style={styles.sectionTitleFallback}>
                {t('Suggestions populaires 🌍', 'Popular suggestions 🌍')}
              </Text>
            </View>
          ) : (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {isFr ? SECTION_TITLES[activeTab].fr : SECTION_TITLES[activeTab].en}
              </Text>
            </View>
          )}

          {recipes.map((recipe) => (
            <TouchableOpacity
              key={recipe.id}
              style={[styles.card, recipe.is_ai && styles.cardAi]}
              onPress={() => recipe.sourceUrl ? openRecipe(recipe.sourceUrl) : null}
              activeOpacity={recipe.sourceUrl ? 0.88 : 1}
            >
              {/* Image */}
              <View style={styles.cardImgWrap}>
                {recipe.image ? (
                  <Image source={{ uri: recipe.image }} style={styles.cardImg} />
                ) : (
                  <View style={[styles.cardImgPlaceholder, recipe.is_ai && { backgroundColor: '#EDE9FE' }]}>
                    <Ionicons name={recipe.is_ai ? 'sparkles' : 'restaurant-outline'} size={32} color={recipe.is_ai ? '#7c3aed' : '#ccc'} />
                  </View>
                )}
                {/* Badge count ou badge IA */}
                {recipe.is_ai ? (
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                ) : recipe.usedIngredients.length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{recipe.usedIngredients.length}</Text>
                  </View>
                )}
              </View>

              {/* Body */}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>{recipe.title}</Text>

                {/* Résumé instructions (IA seulement) */}
                {recipe.is_ai && recipe.instructions_summary && (
                  <Text style={styles.aiInstructions} numberOfLines={3}>
                    {recipe.instructions_summary}
                  </Text>
                )}

                {/* Used ingredients */}
                {recipe.usedIngredients.length > 0 && (
                  <View style={styles.ingredientsRow}>
                    {recipe.usedIngredients.slice(0, 3).map(ing => (
                      <View key={ing} style={[styles.badgeUsed, recipe.is_ai && styles.badgeUsedAi]}>
                        <Ionicons name="checkmark" size={10} color={recipe.is_ai ? '#7c3aed' : C.primary} />
                        <Text style={[styles.badgeUsedText, recipe.is_ai && { color: '#7c3aed' }]} numberOfLines={1}>{ing}</Text>
                      </View>
                    ))}
                    {recipe.usedIngredients.length > 3 && (
                      <Text style={styles.badgeMore}>+{recipe.usedIngredients.length - 3}</Text>
                    )}
                  </View>
                )}

                {/* Footer */}
                <View style={styles.cardFooter}>
                  {recipe.prep_time_min && (
                    <Text style={styles.missedText}>⏱ {recipe.prep_time_min} min</Text>
                  )}
                  {!recipe.is_ai && recipe.missedIngredients.length > 0 && (
                    <Text style={styles.missedText}>
                      {recipe.missedIngredients.length} {t('manquant(s)', 'missing')}
                    </Text>
                  )}
                  {!recipe.is_ai && recipe.sourceUrl && (
                    <View style={styles.viewBtn}>
                      <Text style={styles.viewBtnText}>{t('Voir', 'View')}</Text>
                      <Ionicons name="open-outline" size={12} color={C.primary} />
                    </View>
                  )}
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
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 12, marginTop: 16,
  },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── List ──
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 40, gap: 10 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle:         { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  fallbackHeader:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f3e8ff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  sectionTitleFallback: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },

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

  // ── IA card ──
  cardAi: { borderColor: '#E8E5FF', borderWidth: 1.5 },
  aiBadge: {
    position: 'absolute',
    top: 6, left: 6,
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  aiBadgeText:    { fontSize: 10, fontWeight: '800', color: '#fff' },
  aiInstructions: { fontSize: 12, color: C.textMid, lineHeight: 17, marginBottom: 2 },
  badgeUsedAi:    { backgroundColor: '#EDE9FE' },

  // ── Preview recettes ──
  previewSection: {
    backgroundColor: '#fff',
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  previewScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 12 },
  previewCard: {
    width: 120,
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    ...shadowSm,
  },
  previewCardImg: { width: 120, height: 120, resizeMode: 'cover' },
  previewCardImgPlaceholder: {
    backgroundColor: '#F0EDE8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  previewCardTitle: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 15,
  },

  // ── Urgent context banner ──
  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  urgentBannerBody: { flex: 1, gap: 3 },
  urgentBannerLabel: { fontSize: 12, fontWeight: '700', color: C.orange },
  urgentBannerNames: { fontSize: 12, color: '#92400e', lineHeight: 18 },
});
