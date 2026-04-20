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
import { buildStockItemDetailRecipeBlocks } from '../../utils/stockItemDetailRecipes';
import {
  buildRecipeDetailRoute,
  type RecipeCandidate,
} from '../../utils/stockItemRecipes';
import {
  buildProductEditRoute,
  STOCK_DETAIL_EDIT_ICON,
  STOCK_DETAIL_EDIT_LABEL,
} from '../../utils/productEditNavigation';
import type { DashboardStockItem } from '../../data/mockDashboardData';

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
  const recomputeRecipeAssociationsFromCache = useRecipesStore((state) => state.recomputeRecipeAssociationsFromCache);
  const getRecipesForStockItem = useRecipesStore((state) => state.getRecipesForStockItem);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllDirect, setShowAllDirect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        await fetchStock({ reason: 'stock.detail.mount' });
        recomputeRecipeAssociationsFromCache(useStockStore.getState().items as DashboardStockItem[]);
        if (cancelled) return;
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
  }, [fetchStock, itemId, recomputeRecipeAssociationsFromCache]);

  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);
  const selectedItem = useMemo(() => items.find((item) => item.id === itemId) ?? null, [itemId, items]);

  const sections = useMemo(() => {
    if (!selectedItem) return { directRecipes: [], antiWasteRecipes: [], globalSuggestions: [] };
    return {
      directRecipes: getRecipesForStockItem(selectedItem.id) as RecipeCandidate[],
      antiWasteRecipes: [],
      globalSuggestions: [],
    };
  }, [getRecipesForStockItem, selectedItem]);

  const blockState: BlockState = isLoading ? 'loading' : loadError ? 'error' : 'success';
  const recipeBlocks = useMemo(() => buildStockItemDetailRecipeBlocks(sections), [sections]);

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
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(buildProductEditRoute(selectedItem.id))}
          accessibilityRole="button"
          accessibilityLabel="Modifier le produit"
        >
          <Ionicons name={STOCK_DETAIL_EDIT_ICON} size={15} color={C.textMid} />
          <Text style={styles.editButtonLabel}>{STOCK_DETAIL_EDIT_LABEL}</Text>
        </TouchableOpacity>
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

        {recipeBlocks.map((block) => (
          <RecipeListBlock
            key={block.title}
            title={block.title}
            emptyText={block.emptyText}
            state={blockState}
            recipes={block.recipes}
            expanded={showAllDirect}
            onToggle={() => setShowAllDirect((prev) => !prev)}
            onOpenRecipe={(recipeId) => router.push(buildRecipeDetailRoute(recipeId))}
            styles={styles}
            C={C}
          />
        ))}

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
  headerTitle: { color: C.text, fontSize: 22, fontWeight: '800', flex: 1 },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  editButtonLabel: { color: C.textMid, fontSize: 13, fontWeight: '700' },
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
  globalError: { color: '#B91C1C', fontSize: 12, textAlign: 'center' },
});
