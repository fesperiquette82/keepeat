import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useStockStore } from '../../store/stockStore';
import { useRecipesStore } from '../../store/recipesStore';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { getThemeColors, getThemeText } from '../../utils/theme';
import { daysUntil, resolveStockItems } from '../../data/mockDashboardData';
import { storageZoneLabel, UI_LABELS } from '../../utils/uiLabels';
import { expiryColor } from '../../utils/expiryLabels';
import { dedupeRecipesById } from '../../utils/recipesScoping';
import { buildRecipeDetailRoute, buildStockItemRecipeSections, type RecipeCandidate } from '../../utils/stockItemRecipes';

type BlockState = 'loading' | 'error' | 'success';

function formatExpiryLabel(expiryDate?: string): string {
  const days = daysUntil(expiryDate);
  if (days === null) return 'Date inconnue';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return 'Expire aujourd’hui';
  if (days === 1) return 'Expire demain';
  return `Expire dans ${days} j`;
}

function RecipeListBlock({
  title,
  emptyText,
  state,
  recipes,
  expanded,
  onToggle,
  onOpenRecipe,
  styles,
  C,
}: {
  title: string;
  emptyText: string;
  state: BlockState;
  recipes: RecipeCandidate[];
  expanded: boolean;
  onToggle: () => void;
  onOpenRecipe: (id: string) => void;
  styles: ReturnType<typeof createStyles>;
  C: ReturnType<typeof getThemeColors>;
}) {
  const visibleRecipes = expanded ? recipes : recipes.slice(0, 3);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {recipes.length > 3 && (
          <TouchableOpacity onPress={onToggle}>
            <Text style={styles.seeAll}>{expanded ? 'Réduire' : 'Voir toutes'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {state === 'loading' ? <Text style={styles.sectionLoading}>Chargement…</Text> : null}
      {state === 'error' ? <Text style={styles.sectionError}>Impossible de charger les recettes pour ce bloc.</Text> : null}
      {state === 'success' && recipes.length === 0 ? <Text style={styles.sectionEmpty}>{emptyText}</Text> : null}

      {state === 'success' && visibleRecipes.map((recipe) => (
        <TouchableOpacity
          key={recipe.id}
          style={styles.recipeCard}
          onPress={() => onOpenRecipe(recipe.id)}
          activeOpacity={0.85}
        >
          <View style={styles.recipeThumb}>
            {recipe.image ? (
              <Image source={{ uri: recipe.image }} style={styles.recipeThumbImage} />
            ) : (
              <Ionicons name="restaurant-outline" size={18} color={C.textMid} />
            )}
          </View>
          <View style={styles.recipeTextWrap}>
            <Text style={styles.recipeTitle}>{recipe.title}</Text>
            <Text style={styles.recipeMeta}>{typeof recipe.duration_min === 'number' ? `${recipe.duration_min} min` : 'Recette simple'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMid} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function StockItemDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const itemId = typeof params.id === 'string' ? params.id : '';

  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);

  const { items: storeItems, fetchStock } = useStockStore();
  const fetchSuggestions = useRecipesStore((state) => state.fetchSuggestions);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeCandidate[]>([]);
  const [showAllDirect, setShowAllDirect] = useState(false);
  const [showAllAntiWaste, setShowAllAntiWaste] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        await fetchStock();
        const [stockRecipes, expiryDayRecipes, expiryWeekRecipes] = await Promise.all([
          fetchSuggestions('stock'),
          fetchSuggestions('expiryDay'),
          fetchSuggestions('expiryWeek'),
        ]);
        if (cancelled) return;
        setRecipes(dedupeRecipesById([...stockRecipes, ...expiryDayRecipes, ...expiryWeekRecipes]) as RecipeCandidate[]);
      } catch {
        if (cancelled) return;
        setLoadError('Impossible de charger les recettes liées à cet article.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchStock, fetchSuggestions, itemId]);

  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);
  const selectedItem = useMemo(() => items.find((item) => item.id === itemId) ?? null, [itemId, items]);

  const sections = useMemo(() => {
    if (!selectedItem) return { directRecipes: [], antiWasteRecipes: [] };
    return buildStockItemRecipeSections(selectedItem, items, recipes);
  }, [items, recipes, selectedItem]);

  const blockState: BlockState = isLoading ? 'loading' : loadError ? 'error' : 'success';
  const everythingEmpty = !isLoading && !loadError && sections.directRecipes.length === 0 && sections.antiWasteRecipes.length === 0;

  if (!selectedItem) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Article introuvable</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonLabel}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Détail produit</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.productCard}>
          <View style={styles.productImageWrap}>
            {selectedItem.image_url ? (
              <Image source={{ uri: selectedItem.image_url }} style={styles.productImage} />
            ) : (
              <Ionicons name="nutrition-outline" size={24} color={C.textMid} />
            )}
          </View>

          <View style={styles.productInfos}>
            <Text style={styles.productName}>{selectedItem.name}</Text>
            <Text style={styles.productMeta}>Emplacement : {storageZoneLabel(selectedItem.storageZone)}</Text>
            <Text style={styles.productMeta}>Quantité : {selectedItem.quantity ?? UI_LABELS.fr.unknownQuantity}</Text>
            <View style={styles.expiryRow}>
              <View style={[styles.expiryDot, { backgroundColor: expiryColor(daysUntil(selectedItem.expiry_date)) }]} />
              <Text style={[styles.productExpiry, { color: expiryColor(daysUntil(selectedItem.expiry_date)) }]}>{formatExpiryLabel(selectedItem.expiry_date)}</Text>
            </View>
          </View>
        </View>

        <RecipeListBlock
          title="Recettes avec cet ingrédient"
          emptyText="Aucune recette ne référence directement cet ingrédient."
          state={blockState}
          recipes={sections.directRecipes}
          expanded={showAllDirect}
          onToggle={() => setShowAllDirect((prev) => !prev)}
          onOpenRecipe={(recipeId) => router.push(buildRecipeDetailRoute(recipeId))}
          styles={styles}
          C={C}
        />

        <RecipeListBlock
          title="Recettes anti-gaspi liées"
          emptyText="Aucune suggestion anti-gaspi spécifique pour cet article."
          state={blockState}
          recipes={sections.antiWasteRecipes}
          expanded={showAllAntiWaste}
          onToggle={() => setShowAllAntiWaste((prev) => !prev)}
          onOpenRecipe={(recipeId) => router.push(buildRecipeDetailRoute(recipeId))}
          styles={styles}
          C={C}
        />

        {everythingEmpty && (
          <View style={styles.globalEmptyWrap}>
            <Text style={styles.globalEmptyText}>Aucune recette liée à cet article pour le moment.</Text>
          </View>
        )}

        {loadError ? <Text style={styles.globalError}>{loadError}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, gap: 10 },
  errorTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  backButton: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  backButtonLabel: { color: '#fff', fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  backIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: '800' },
  content: { paddingHorizontal: 16, paddingBottom: 28, gap: 12 },
  productCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, flexDirection: 'row', gap: 12 },
  productImageWrap: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  productImage: { width: '100%', height: '100%' },
  productInfos: { flex: 1, gap: 2 },
  productName: { color: C.text, fontSize: 16, fontWeight: '800' },
  productMeta: { ...T.secondary, fontSize: 13 },
  expiryRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  expiryDot: { width: 8, height: 8, borderRadius: 4 },
  productExpiry: { fontSize: 12, fontWeight: '700' },
  sectionCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  seeAll: { color: C.primary, fontSize: 13, fontWeight: '700' },
  sectionLoading: { ...T.secondary, fontWeight: '600' },
  sectionError: { color: '#B91C1C', fontSize: 13, fontWeight: '600' },
  sectionEmpty: { ...T.secondary, fontSize: 13 },
  recipeCard: { borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  recipeThumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  recipeThumbImage: { width: '100%', height: '100%' },
  recipeTextWrap: { flex: 1 },
  recipeTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  recipeMeta: { ...T.secondarySmall },
  globalEmptyWrap: { paddingVertical: 8 },
  globalEmptyText: { ...T.secondary, textAlign: 'center', fontWeight: '600' },
  globalError: { color: '#B91C1C', fontSize: 12, textAlign: 'center' },
});
