
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
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { useStockStore } from '../../store/stockStore';
import { ALLOWED_PROD_API_URLS, API_ENV, API_URL, API_URL_GUARDRAIL_REASON, API_URL_GUARDRAIL_STATUS, buildApiUrl } from '../../utils/config';
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

interface RecipesDebugMeta {
  backend_commit?: string;
  backend_version?: string;
  recipes_source?: string;
  catalog_hash?: string;
  catalog_name?: string;
  catalog_locale?: string;
  requested_locale?: string;
  effective_locale?: string;
  endpoint?: string;
  filter?: string | null;
  filter_effective?: string | null;
  served_at?: string;
}

interface RecipesDiagnosticsState {
  lastEndpoint: string | null;
  lastFetchAt: string | null;
  responseShape: 'array' | 'object_with_meta' | 'unknown';
  transformation: string;
  backendCommit: string;
  backendVersion: string;
  recipesSource: string;
  catalogHash: string;
  catalogLocale: string;
  localeSent: string;
  acceptLanguageSent: string;
  requestedLocale: string;
  effectiveLocale: string;
  filterSent: string;
  filterUsed: string;
}

const RECIPES_DEBUG_CACHE_KEY = 'keepeat:recipes:debug:last_response';
const RECIPES_DEBUG_ENABLED = typeof __DEV__ !== 'undefined' && __DEV__;

function recipesDebugLog(message: string, payload?: unknown) {
  if (!RECIPES_DEBUG_ENABLED) return;
  if (payload !== undefined) {
    console.info(message, payload);
    return;
  }
  console.info(message);
}

function headerValue(headers: any, key: string): string | undefined {
  const direct = headers?.[key] ?? headers?.[key.toLowerCase()] ?? headers?.[key.toUpperCase()];
  return typeof direct === 'string' ? direct : undefined;
}

function resolveUserLocale(language: string | undefined): string {
  if (language === 'en') return 'en-US';
  return 'fr-FR';
}

function getRecipesPayload(data: any): { recipes: any[]; meta: RecipesDebugMeta | null; shape: RecipesDiagnosticsState['responseShape'] } {
  if (Array.isArray(data)) return { recipes: data, meta: null, shape: 'array' };
  if (data && Array.isArray(data.recipes)) return { recipes: data.recipes, meta: (data.meta ?? null) as RecipesDebugMeta | null, shape: 'object_with_meta' };
  if (data && Array.isArray(data.data)) return { recipes: data.data, meta: (data.meta ?? null) as RecipesDebugMeta | null, shape: 'object_with_meta' };
  return { recipes: [], meta: null, shape: 'unknown' };
}

function normalizeSuggestionRecipe(raw: any, index: number): RecipeSuggestion {
  return {
    id: raw?.id ?? `recipe-${index}`,
    title: raw?.title ?? '',
    image: raw?.image ?? '',
    usedIngredients: raw?.usedIngredients ?? raw?.used_ingredients ?? raw?.matchedIngredients ?? raw?.matched_ingredients ?? [],
    missedIngredients: raw?.missedIngredients ?? raw?.missingIngredients ?? raw?.missing_ingredients ?? [],
    sourceUrl: raw?.sourceUrl ?? raw?.source_url ?? '',
    is_fallback: Boolean(raw?.is_fallback),
    is_ai: Boolean(raw?.is_ai),
    ingredients_used: raw?.ingredients_used ?? [],
    instructions_summary: raw?.instructions_summary ?? '',
    prep_time_min: typeof raw?.prep_time_min === 'number' ? raw.prep_time_min : undefined,
  };
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
  // Vue principale: privilégier un flux personnalisé (accessible) plutôt qu'un "all" brut.
  tous:    'personalized',
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
  const [isDebugVisible, setIsDebugVisible] = useState(false);
  const [titleTapCount, setTitleTapCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<RecipesDiagnosticsState>({
    lastEndpoint: null,
    lastFetchAt: null,
    responseShape: 'unknown',
    transformation: 'none',
    backendCommit: 'unknown',
    backendVersion: 'unknown',
    recipesSource: 'unknown',
    catalogHash: 'unknown',
    catalogLocale: 'unknown',
    localeSent: 'unknown',
    acceptLanguageSent: 'unknown',
    requestedLocale: 'unknown',
    effectiveLocale: 'unknown',
    filterSent: 'unknown',
    filterUsed: 'unknown',
  });

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

  useEffect(() => {
    if (titleTapCount <= 0) return;
    const timer = setTimeout(() => setTitleTapCount(0), 1200);
    return () => clearTimeout(timer);
  }, [titleTapCount]);

  const onTitlePress = useCallback(() => {
    setTitleTapCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setIsDebugVisible(true);
        return 0;
      }
      return next;
    });
  }, []);

  const purgeRecipesDebugCache = useCallback(async () => {
    await AsyncStorage.removeItem(RECIPES_DEBUG_CACHE_KEY);
    recipesDebugLog('[RECIPES_DEBUG] local diagnostics cache purged', { key: RECIPES_DEBUG_CACHE_KEY });
  }, []);

  const fetchRecipes = useCallback(async (tab: FilterTab, silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const endpointPath = tab === 'ai'
        ? '/api/recipes/ai?include_meta=true'
        : `/api/recipes/suggestions?filter=${TAB_TO_FILTER[tab]}&include_meta=true&locale=${encodeURIComponent(resolveUserLocale(language))}`;
      const url = buildApiUrl(endpointPath);
      const userLocale = resolveUserLocale(language);
      recipesDebugLog('[RECIPES_DEBUG] fetchRecipes call', { tab, url, silent });
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Language': userLocale,
        },
      });
      const payload = getRecipesPayload(res.data);
      recipesDebugLog('[RECIPES_DEBUG] fetchRecipes response', {
        tab,
        status: res.status,
        shape: payload.shape,
        count: payload.recipes.length,
        ids: payload.recipes.slice(0, 10).map((r: any) => r?.id),
        titles: payload.recipes.slice(0, 10).map((r: any) => r?.title),
      });
      const backendCommit = headerValue(res.headers, 'x-backend-commit') ?? payload.meta?.backend_commit ?? 'unknown';
      const backendVersion = headerValue(res.headers, 'x-backend-version') ?? payload.meta?.backend_version ?? 'unknown';
      const recipesSource = headerValue(res.headers, 'x-recipes-source') ?? payload.meta?.recipes_source ?? 'unknown';
      const catalogHash = headerValue(res.headers, 'x-catalog-hash') ?? payload.meta?.catalog_hash ?? 'unknown';
      const catalogLocale = headerValue(res.headers, 'x-catalog-locale') ?? payload.meta?.catalog_locale ?? 'unknown';
      const requestedLocale = headerValue(res.headers, 'x-requested-locale') ?? payload.meta?.requested_locale ?? 'unknown';
      const effectiveLocale = headerValue(res.headers, 'x-effective-locale') ?? payload.meta?.effective_locale ?? 'unknown';
      const filterSent = TAB_TO_FILTER[tab];
      const filterUsed = headerValue(res.headers, 'x-recipes-filter') ?? payload.meta?.filter_effective ?? payload.meta?.filter ?? filterSent;
      const nowIso = new Date().toISOString();
      const transformation = tab === 'ai'
        ? 'transformed: ai response normalized to RecipeSuggestion card model'
        : 'transformed: /api/recipes/suggestions response normalized to RecipeSuggestion card model';
      setDiagnostics({
        lastEndpoint: payload.meta?.endpoint ?? endpointPath,
        lastFetchAt: nowIso,
        responseShape: payload.shape,
        transformation,
        backendCommit,
        backendVersion,
        recipesSource,
        catalogHash,
        catalogLocale,
        localeSent: userLocale,
        acceptLanguageSent: userLocale,
        requestedLocale,
        effectiveLocale,
        filterSent,
        filterUsed,
      });
      await AsyncStorage.setItem(
        RECIPES_DEBUG_CACHE_KEY,
        JSON.stringify({
          tab,
          endpoint: payload.meta?.endpoint ?? endpointPath,
          fetchedAt: nowIso,
          backendCommit,
          backendVersion,
          recipesSource,
            catalogHash,
            catalogLocale,
            localeSent: userLocale,
            acceptLanguageSent: userLocale,
            requestedLocale,
            effectiveLocale,
            filterSent,
            filterUsed,
            shape: payload.shape,
          }),
      );
      // Normaliser les recettes IA au même format
      if (tab === 'ai') {
        const aiRecipes = payload.recipes.map((r, i) => ({
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
        const normalizedRecipes = payload.recipes.map((recipe, index) => normalizeSuggestionRecipe(recipe, index));
        recipesDebugLog('[RECIPES_DEBUG] suggestions normalization summary', {
          tab,
          count_raw: payload.recipes.length,
          count_normalized: normalizedRecipes.length,
          sample_keys: payload.recipes[0] ? Object.keys(payload.recipes[0]).slice(0, 20) : [],
        });
        setRecipes(normalizedRecipes);
      }
    } catch (err: any) {
      recipesDebugLog('[RECIPES_DEBUG] fetchRecipes error', { tab, message: err?.message, status: err?.response?.status });
      setError(
        isFr
          ? 'Impossible de charger les recettes. Vérifiez votre connexion.'
          : 'Unable to load recipes. Check your connection.',
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isFr, language, token]);

  useEffect(() => { fetchRecipes(activeTab); }, [fetchRecipes, activeTab]);

  // Chargement silencieux des 3 recettes preview (urgent en priorité, all en fallback)
  useEffect(() => {
    if (!token) return;
    const userLocale = resolveUserLocale(language);
    const load = async () => {
      try {
        recipesDebugLog('[RECIPES_DEBUG] preview request urgent');
        let res = await axios.get(buildApiUrl(`/api/recipes/suggestions?filter=urgent&locale=${encodeURIComponent(userLocale)}`), {
          headers: { Authorization: `Bearer ${token}`, 'Accept-Language': userLocale },
        });
        const urgentPayload = getRecipesPayload(res.data);
        const urgentNormalized = urgentPayload.recipes.map((recipe, index) => normalizeSuggestionRecipe(recipe, index));
        if (urgentNormalized.length > 0) {
          recipesDebugLog('[RECIPES_DEBUG] preview uses urgent', { count: urgentNormalized.length, shape: urgentPayload.shape });
          setPreviewRecipes(urgentNormalized.slice(0, 3));
          return;
        }
        recipesDebugLog('[RECIPES_DEBUG] preview urgent empty, fallback to all');
        res = await axios.get(buildApiUrl(`/api/recipes/suggestions?filter=personalized&locale=${encodeURIComponent(userLocale)}`), {
          headers: { Authorization: `Bearer ${token}`, 'Accept-Language': userLocale },
        });
        const allPayload = getRecipesPayload(res.data);
        const allNormalized = allPayload.recipes.map((recipe, index) => normalizeSuggestionRecipe(recipe, index));
        recipesDebugLog('[RECIPES_DEBUG] preview uses all', { count: allNormalized.length, shape: allPayload.shape });
        setPreviewRecipes(allNormalized.slice(0, 3));
      } catch (err: any) {
        recipesDebugLog('[RECIPES_DEBUG] preview load error', { message: err?.message, status: err?.response?.status });
      }
    };
    load();
  }, [language, token]);

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
          <TouchableOpacity onPress={onTitlePress} onLongPress={() => setIsDebugVisible(true)} delayLongPress={500} activeOpacity={0.9}>
            <Text style={styles.headerTitle}>{t('Recettes 🌿', 'Recipes 🌿')}</Text>
          </TouchableOpacity>
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
              <Ionicons name="sparkles-outline" size={15} color={C.primary} />
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
                  <View style={[styles.cardImgPlaceholder, recipe.is_ai && { backgroundColor: C.primaryLight }]}>
                    <Ionicons name={recipe.is_ai ? 'sparkles' : 'restaurant-outline'} size={32} color={recipe.is_ai ? C.primary : '#ccc'} />
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
                        <Ionicons name="checkmark" size={10} color={C.primary} />
                        <Text style={styles.badgeUsedText} numberOfLines={1}>{ing}</Text>
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

      <Modal visible={isDebugVisible} animationType="fade" transparent onRequestClose={() => setIsDebugVisible(false)}>
        <Pressable style={styles.debugBackdrop} onPress={() => setIsDebugVisible(false)}>
          <Pressable style={styles.debugPanel} onPress={() => {}}>
            <Text style={styles.debugTitle}>Diagnostic recettes</Text>
            <Text style={styles.debugLine}>app_env: {API_ENV}</Text>
            <Text style={styles.debugLine}>app_version: {Constants.expoConfig?.version ?? 'unknown'}</Text>
            <Text style={styles.debugLine}>app_commit: {String(process.env.EXPO_PUBLIC_APP_COMMIT ?? Constants.expoConfig?.extra?.appCommit ?? 'unknown')}</Text>
            <Text style={styles.debugLine}>build_time: {String(process.env.EXPO_PUBLIC_BUILD_TIME ?? Constants.expoConfig?.extra?.buildTime ?? 'unknown')}</Text>
            <Text style={styles.debugLine}>expo_release_channel: {String((Constants as any).expoConfig?.releaseChannel ?? 'n/a')}</Text>
            <Text style={styles.debugLine}>eas_channel: {String((Constants as any).easConfig?.channel ?? 'n/a')}</Text>
            <Text style={styles.debugLine}>runtime_version: {String((Constants as any).expoConfig?.runtimeVersion ?? 'n/a')}</Text>
            <Text style={styles.debugLine}>update_id: {String((Constants as any).expoConfig?.extra?.expoClient?.updateId ?? (Constants as any).easConfig?.updateId ?? 'n/a')}</Text>
            <Text style={styles.debugLine}>api_base_url: {API_URL}</Text>
            <Text style={styles.debugLine}>api_guardrail: {API_URL_GUARDRAIL_STATUS} ({API_URL_GUARDRAIL_REASON})</Text>
            <Text style={styles.debugLine}>allowed_prod_api_urls: {ALLOWED_PROD_API_URLS.join(', ')}</Text>
            <Text style={styles.debugLine}>backend_commit: {diagnostics.backendCommit}</Text>
            <Text style={styles.debugLine}>backend_version: {diagnostics.backendVersion}</Text>
            <Text style={styles.debugLine}>recipes_source: {diagnostics.recipesSource}</Text>
            <Text style={styles.debugLine}>catalog_hash: {diagnostics.catalogHash}</Text>
            <Text style={styles.debugLine}>catalog_locale: {diagnostics.catalogLocale}</Text>
            <Text style={styles.debugLine}>locale_sent: {diagnostics.localeSent}</Text>
            <Text style={styles.debugLine}>accept_language_sent: {diagnostics.acceptLanguageSent}</Text>
            <Text style={styles.debugLine}>requested_locale: {diagnostics.requestedLocale}</Text>
            <Text style={styles.debugLine}>effective_locale: {diagnostics.effectiveLocale}</Text>
            <Text style={styles.debugLine}>filter_sent: {diagnostics.filterSent}</Text>
            <Text style={styles.debugLine}>filter_used: {diagnostics.filterUsed}</Text>
            <Text style={styles.debugLine}>last_endpoint: {diagnostics.lastEndpoint ?? 'none'}</Text>
            <Text style={styles.debugLine}>last_fetch_at: {diagnostics.lastFetchAt ?? 'none'}</Text>
            <Text style={styles.debugLine}>response_shape: {diagnostics.responseShape}</Text>
            <Text style={styles.debugLine}>transformation: {diagnostics.transformation}</Text>
            <View style={styles.debugActions}>
              <TouchableOpacity style={styles.debugBtn} onPress={purgeRecipesDebugCache}>
                <Text style={styles.debugBtnText}>Purger cache debug local</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.debugBtn} onPress={() => setIsDebugVisible(false)}>
                <Text style={styles.debugBtnText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  fallbackHeader:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primaryLight, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  sectionTitleFallback: { fontSize: 13, fontWeight: '700', color: C.primary },

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
    backgroundColor: C.primary,
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
  cardAi: { borderColor: C.primaryMid, borderWidth: 1.5 },
  aiBadge: {
    position: 'absolute',
    top: 6, left: 6,
    backgroundColor: '#1F2937',
    borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  aiBadgeText:    { fontSize: 10, fontWeight: '800', color: '#fff' },
  aiInstructions: { fontSize: 12, color: C.textMid, lineHeight: 17, marginBottom: 2 },
  badgeUsedAi:    { backgroundColor: C.primaryLight },

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

  debugBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 18,
  },
  debugPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    maxHeight: '82%',
    gap: 4,
  },
  debugTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 4 },
  debugLine: { fontSize: 11, color: '#374151' },
  debugActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  debugBtn: { backgroundColor: C.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  debugBtnText: { color: C.primary, fontSize: 12, fontWeight: '700' },
});
