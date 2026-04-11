import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useStockStore } from '../../store/stockStore';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { BackendRecipeSuggestion, useRecipesStore } from '../../store/recipesStore';
import { ActionBanner } from '../../component/ActionBanner';
import { getThemeColors, getThemeText, ThemeColors } from '../../utils/theme';
import { matchRecipeIngredientsToStock } from '../../utils/ingredientMatching';
import { removeStockItems, undoRemovedStockItems } from '../../utils/stockRemoval';
import { logger } from '../../utils/logger';
import { buildRecipeIngredientDisplayRows } from '../../utils/recipeIngredientDisplay';
import { formatFrenchRecipeText } from '../../utils/recipeFrenchTypography';

interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

function formatQuantity(value: number | string | null | undefined): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1).replace(/\.0$/, '');
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return '';
}

function scaleIngredients(ingredients: RecipeIngredient[], factor: number): RecipeIngredient[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: ingredient.quantity * factor,
  }));
}

function toIngredientList(recipe: BackendRecipeSuggestion | null): RecipeIngredient[] {
  if (!recipe) return [];
  const used = Array.isArray(recipe.usedIngredients) ? recipe.usedIngredients : [];
  const missed = Array.isArray(recipe.missedIngredients) ? recipe.missedIngredients : [];
  const unique = Array.from(new Set([...used, ...missed].map((item) => item.trim()).filter(Boolean)));
  return unique.map((name) => ({ name: formatFrenchRecipeText(name), quantity: 1, unit: 'portion' }));
}

function resolveSteps(recipe: BackendRecipeSuggestion | null): string[] {
  if (!recipe) return [];
  const steps = (recipe.debug as { steps?: unknown } | undefined)?.steps;
  if (Array.isArray(steps)) {
    const safeSteps = steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
    if (safeSteps.length > 0) return safeSteps.map((step) => formatFrenchRecipeText(step));
  }
  if (recipe.instructions_summary) {
    const fallback = recipe.instructions_summary
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);
    if (fallback.length > 0) return fallback.map((step) => formatFrenchRecipeText(step));
  }
  return ['Préparez les ingrédients.', 'Cuisinez la recette simplement.', 'Servez aussitôt.'];
}

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const recipeId = typeof params.id === 'string' ? params.id : '';

  const { items: storeItems, fetchStock } = useStockStore();
  const householdSize = useAppSettingsStore((state) => state.householdSize);
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);
  const fetchRecipeById = useRecipesStore((state) => state.fetchRecipeById);

  const [isScreenLoading, setIsScreenLoading] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [baseRecipe, setBaseRecipe] = useState<BackendRecipeSuggestion | null>(null);

  const [isValidating, setIsValidating] = useState(false);
  const [undoItems, setUndoItems] = useState<typeof storeItems>([]);
  const [banner, setBanner] = useState<{ message: string; canUndo: boolean; variant: 'success' | 'error' } | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  useFocusEffect(
    React.useCallback(() => {
      logger.debug('[RECIPES_MATCH] detail screen focused - refreshing stock', { recipeId: params.id ?? null });
      fetchStock();
    }, [fetchStock, params.id]),
  );

  const items = useMemo(() => storeItems.filter((item) => item.status === 'active'), [storeItems]);
  const initialServings = householdSize;
  const [servings, setServings] = useState(initialServings);

  useEffect(() => {
    setServings(initialServings);
  }, [initialServings]);

  const recipeIngredients = useMemo(() => toIngredientList(baseRecipe), [baseRecipe]);
  const factor = useMemo(() => servings / Math.max(1, householdSize), [householdSize, servings]);
  const scaledIngredients = useMemo(() => scaleIngredients(recipeIngredients, factor), [factor, recipeIngredients]);
  const ingredientRows = useMemo(() => buildRecipeIngredientDisplayRows(items, scaledIngredients), [items, scaledIngredients]);

  const ingredientAvailability = useMemo(() => {
    const matchedCount = ingredientRows.filter((row) => row.isAvailable).length;
    const missingCount = Math.max(0, ingredientRows.length - matchedCount);
    return { matchedCount, missingCount };
  }, [ingredientRows]);
  const recipeSteps = useMemo(() => resolveSteps(baseRecipe), [baseRecipe]);
  const totalTime = useMemo(() => {
    if (!baseRecipe) return 15;
    const prep = typeof baseRecipe.prep_time_min === 'number' ? baseRecipe.prep_time_min : 0;
    const cook = typeof baseRecipe.cook_time_min === 'number' ? baseRecipe.cook_time_min : 0;
    return prep + cook > 0 ? prep + cook : 15;
  }, [baseRecipe]);

  useEffect(() => {
    logger.debug('[RECIPES] detail state updated', {
      recipeId,
      hasRecipe: !!baseRecipe,
      stockItemsCount: items.length,
      matchedCount: ingredientAvailability.matchedCount,
      missingCount: ingredientAvailability.missingCount,
      isScreenLoading,
    });
  }, [baseRecipe, ingredientAvailability.matchedCount, ingredientAvailability.missingCount, isScreenLoading, items.length, recipeId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!recipeId) {
        setScreenError('Recette introuvable');
        setIsScreenLoading(false);
        return;
      }
      setIsScreenLoading(true);
      setScreenError(null);
      try {
        const recipe = await fetchRecipeById(recipeId);
        if (cancelled) return;
        if (!recipe) {
          setBaseRecipe(null);
          setScreenError('Recette introuvable');
          return;
        }
        setBaseRecipe(recipe);
      } catch (error) {
        if (cancelled) return;
        logger.warn('[RECIPES_MATCH] fetch recipe detail failed', { recipeId, error: String(error) });
        setBaseRecipe(null);
        setScreenError('Impossible de charger la recette.');
      } finally {
        if (!cancelled) setIsScreenLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [fetchRecipeById, recipeId]);

  const handleValidateRecipe = async () => {
    if (isValidating || !baseRecipe) return;
    setIsValidating(true);
    try {
      await fetchStock();
      const latestItems = useStockStore.getState().items;
      const ingredientNames = scaledIngredients.map((ingredient) => ingredient.name);
      const { matchedIds, unmatchedIngredients } = matchRecipeIngredientsToStock(latestItems, ingredientNames);
      const result = await removeStockItems(matchedIds, 'used');
      const removedCount = result.removedItems.length;
      const failedCount = result.failedCount;

      if (removedCount === 0 && failedCount === 0) {
        setUndoItems([]);
        setBanner({
          message: `${unmatchedIngredients.length} ingrédient${unmatchedIngredients.length > 1 ? 's' : ''} non trouvé${unmatchedIngredients.length > 1 ? 's' : ''} dans le stock.`,
          canUndo: false,
          variant: 'error',
        });
        return;
      }

      if (failedCount > 0) {
        setUndoItems(result.removedItems);
        setBanner({
          message: `${removedCount} retiré${removedCount > 1 ? 's' : ''}, ${unmatchedIngredients.length} non trouvé${unmatchedIngredients.length > 1 ? 's' : ''}, ${failedCount} échec${failedCount > 1 ? 's' : ''}.`,
          canUndo: removedCount > 0,
          variant: 'error',
        });
        return;
      }

      setUndoItems(result.removedItems);
      setBanner({
        message: `${removedCount} ingrédient${removedCount > 1 ? 's' : ''} retiré${removedCount > 1 ? 's' : ''} du stock.${unmatchedIngredients.length > 0 ? ` ${unmatchedIngredients.length} non trouvé${unmatchedIngredients.length > 1 ? 's' : ''}.` : ''}`,
        canUndo: removedCount > 0,
        variant: 'success',
      });
    } catch {
      Alert.alert('Erreur', 'Impossible de valider la recette pour le stock.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleUndo = async () => {
    if (undoItems.length === 0) return;
    const result = await undoRemovedStockItems(undoItems);
    setUndoItems([]);
    if (result.failedCount === 0) {
      setBanner({ message: 'Annulation réussie : ingrédients restaurés.', canUndo: false, variant: 'success' });
      return;
    }
    setBanner({
      message: `Annulation partielle : ${result.restoredCount} restauré(s), ${result.failedCount} échec(s).`,
      canUndo: false,
      variant: 'error',
    });
  };

  if (isScreenLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Chargement de la recette…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenError || !baseRecipe) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>{screenError ?? 'Recette introuvable'}</Text>
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
        <Text style={styles.headerTitle}>Détail recette</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!!baseRecipe.image && (
          <Image source={{ uri: baseRecipe.image }} style={styles.heroImage} resizeMode="cover" />
        )}
        <Text style={styles.title}>{formatFrenchRecipeText(baseRecipe.title)}</Text>
        <Text style={styles.meta}>{totalTime} min · Idée simple</Text>

        <View style={styles.servingsCard}>
          <Text style={styles.sectionTitle}>Portions</Text>
          <View style={styles.servingsControls}>
            <TouchableOpacity style={styles.counterButton} onPress={() => setServings((prev) => Math.max(1, prev - 1))}>
              <Ionicons name="remove" size={18} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.servingsValue}>{servings} personnes</Text>
            <TouchableOpacity style={styles.counterButton} onPress={() => setServings((prev) => Math.min(12, prev + 1))}>
              <Ionicons name="add" size={18} color={C.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.servingsHint}>Par défaut foyer : {householdSize} personnes</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ingrédients</Text>
          {ingredientRows.map((row, index) => {
            const { ingredient, isAvailable } = row;
            const formattedQuantity = formatQuantity(ingredient.quantity);
            const rowKey = `${ingredient.name}-${index}`;
            const hasImage = !!row.imageUrl && !imageErrors[rowKey];
            const canNavigate = !!row.matchedStockItemId;
            const rowContent = (
              <>
                <View style={styles.ingredientThumb}>
                  {hasImage ? (
                    <Image
                      source={{ uri: row.imageUrl ?? undefined }}
                      style={styles.ingredientThumbImage}
                      onError={() => setImageErrors((prev) => ({ ...prev, [rowKey]: true }))}
                    />
                  ) : (
                    <Ionicons name="nutrition-outline" size={16} color={C.textMid} />
                  )}
                </View>
                <View style={styles.ingredientTextWrap}>
                  <Text style={styles.ingredientName}>{ingredient.name}</Text>
                  <Text style={styles.ingredientQuantity}>
                    {formattedQuantity}
                    {formattedQuantity ? ' ' : ''}
                    {ingredient.unit}
                  </Text>
                </View>
                <Text style={[styles.stockBadge, isAvailable ? styles.badgeOk : styles.badgeMissing]}>
                  {isAvailable ? 'Disponible' : 'Manquant'}
                </Text>
              </>
            );
            if (canNavigate) {
              return (
                <TouchableOpacity
                  key={rowKey}
                  style={styles.ingredientRow}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/edit-product', params: { id: row.matchedStockItemId! } })}
                >
                  {rowContent}
                </TouchableOpacity>
              );
            }
            return (
              <View key={rowKey} style={styles.ingredientRow}>
                {rowContent}
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Préparation</Text>
          {recipeSteps.map((step: string, index: number) => (
            <View key={`${baseRecipe.id}-${index + 1}`} style={styles.stepRow}>
              <Text style={styles.stepIndex}>{index + 1}.</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={[styles.validateButton, isValidating && styles.validateButtonDisabled]} disabled={isValidating} onPress={handleValidateRecipe}>
          <Text style={styles.validateButtonLabel}>{isValidating ? 'Validation…' : "J’ai réalisé cette recette"}</Text>
        </TouchableOpacity>
      </ScrollView>

      {banner && (
        <ActionBanner
          message={banner.message}
          variant={banner.variant}
          actionLabel={banner.canUndo ? 'Annuler' : undefined}
          onActionPress={banner.canUndo ? handleUndo : undefined}
          onClose={() => setBanner(null)}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(C: ThemeColors, T: ReturnType<typeof getThemeText>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  backIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 28, gap: 12 },
  heroImage: { width: '100%', height: 200, borderRadius: 12, backgroundColor: '#E5E7EB' },
  title: { color: C.text, fontSize: 24, fontWeight: '800' },
  meta: { ...T.secondary },
  servingsCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 8 },
  servingsControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counterButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  servingsValue: { color: C.text, fontSize: 16, fontWeight: '700' },
  servingsHint: { color: C.textLight, fontSize: 12, fontWeight: '500' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ingredientThumb: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ingredientThumbImage: { width: '100%', height: '100%' },
  ingredientTextWrap: { flex: 1 },
  ingredientName: { color: C.text, fontSize: 14, fontWeight: '600' },
  ingredientQuantity: { color: C.textMid, fontSize: 13, fontWeight: '500' },
  stockBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  badgeOk: { backgroundColor: '#DCFCE7', color: '#166534' },
  badgeMissing: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  stepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  stepIndex: { width: 18, color: C.text, fontWeight: '700' },
  stepText: { flex: 1, color: C.textMid, fontWeight: '500' },
  validateButton: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  validateButtonDisabled: { opacity: 0.7 },
  validateButtonLabel: { color: '#fff', fontSize: 14, fontWeight: '800' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  backButton: { backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  backButtonLabel: { color: '#fff', fontWeight: '700' },
  });
}
