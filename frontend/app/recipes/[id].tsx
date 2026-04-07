import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useStockStore } from '../../store/stockStore';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { ActionBanner } from '../../component/ActionBanner';
import { C, T } from '../../utils/theme';
import { matchRecipeIngredientsToStock } from '../../utils/ingredientMatching';
import { removeStockItems, undoRemovedStockItems } from '../../utils/stockRemoval';
import { logger } from '../../utils/logger';
import { fetchRecipeById } from '../../utils/recipesApi';

interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
  scalable?: boolean;
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

function scaleIngredients(ingredients: any[], factor: number): any[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: typeof ingredient.quantity === 'number' ? ingredient.quantity * factor : ingredient.quantity,
  }));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toIngredientList(recipe: BackendRecipeSuggestion | null): RecipeIngredient[] {
  if (!recipe) return [];
  const used = Array.isArray(recipe.usedIngredients) ? recipe.usedIngredients : [];
  const missed = Array.isArray(recipe.missedIngredients) ? recipe.missedIngredients : [];
  const unique = Array.from(new Set([...used, ...missed].map((item) => item.trim()).filter(Boolean)));
  return unique.map((name) => ({ name, quantity: 1, unit: 'portion' }));
}

function resolveSteps(recipe: BackendRecipeSuggestion | null): string[] {
  if (!recipe) return [];
  const steps = (recipe.debug as { steps?: unknown } | undefined)?.steps;
  if (Array.isArray(steps)) {
    const safeSteps = steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
    if (safeSteps.length > 0) return safeSteps;
  }
  if (recipe.instructions_summary) {
    const fallback = recipe.instructions_summary
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);
    if (fallback.length > 0) return fallback;
  }
  return ['Préparez les ingrédients.', 'Cuisinez la recette simplement.', 'Servez aussitôt.'];
}

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const recipeId = typeof params.id === 'string' ? params.id : '';

  const { items: storeItems, fetchStock } = useStockStore();
  const householdSize = useAppSettingsStore((state) => state.householdSize);
  const fetchRecipeById = useRecipesStore((state) => state.fetchRecipeById);

  const [isScreenLoading, setIsScreenLoading] = useState(true);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [baseRecipe, setBaseRecipe] = useState<BackendRecipeSuggestion | null>(null);

  const [isValidating, setIsValidating] = useState(false);
  const [undoItems, setUndoItems] = useState<typeof storeItems>([]);
  const [banner, setBanner] = useState<{ message: string; canUndo: boolean; variant: 'success' | 'error' } | null>(null);
  const [remoteRecipe, setRemoteRecipe] = useState<any | null>(null);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      logger.debug('[RECIPES_MATCH] detail screen focused - refreshing stock', { recipeId: params.id ?? null });
      fetchStock();
    }, [fetchStock, params.id]),
  );

  const recipeId = typeof params.id === 'string' ? params.id : '';
  const items = useMemo(() => storeItems.filter((item) => item.status === 'active'), [storeItems]);
  const baseRecipe = useMemo(() => {
    if (!remoteRecipe) return null;
    return {
      id: remoteRecipe.id,
      title: remoteRecipe.title,
      timeMinutes: remoteRecipe.duration_min ?? 0,
      type: String(remoteRecipe.dish_type || 'rapide').toLowerCase(),
      baseServings: 1,
      ingredientsDetailed: (remoteRecipe.ingredients ?? []).map((ingredient: any) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: typeof ingredient.quantity === 'string' && ingredient.quantity.trim().length > 0 ? ingredient.quantity : 'portion',
      })),
      optionalBasics: [],
      steps: Array.isArray(remoteRecipe.steps) ? remoteRecipe.steps : [],
    };
  }, [remoteRecipe]);

  const initialServings = householdSize;
  const [servings, setServings] = useState(initialServings);

  const items = useMemo(() => storeItems.filter((item) => item.status === 'active'), [storeItems]);

  useEffect(() => {
    setServings(initialServings);
  }, [initialServings]);

  const factor = baseRecipe ? servings / baseRecipe.baseServings : 1;
  const scaledIngredients = useMemo(
    () => (baseRecipe ? scaleIngredients(baseRecipe.ingredientsDetailed, factor) : []),
    [baseRecipe, factor],
  );
  const ingredientAvailability = useMemo(
    () => {
      const stockSet = new Set(items.map((item) => String(item.name || '').trim().toLowerCase()));
      const availableIngredients = scaledIngredients
        .map((ingredient) => ingredient.name)
        .filter((name) => stockSet.has(String(name || '').trim().toLowerCase()));
      return {
        availableIngredients,
        matchedCount: availableIngredients.length,
        missingCount: Math.max(0, scaledIngredients.length - availableIngredients.length),
      };
    },
    [items, scaledIngredients],
  );

  const recipeIngredients = useMemo(() => toIngredientList(baseRecipe), [baseRecipe]);
  const factor = useMemo(() => servings / Math.max(1, householdSize), [householdSize, servings]);
  const scaledIngredients = useMemo(() => scaleIngredients(recipeIngredients, factor), [factor, recipeIngredients]);

  const availableNames = useMemo(() => {
    const stockNames = items.map((item) => normalizeName(item.name));
    const names: string[] = [];
    for (const ingredient of scaledIngredients) {
      const ingredientName = normalizeName(ingredient.name);
      const matched = stockNames.some((stockName) => stockName.includes(ingredientName) || ingredientName.includes(stockName));
      if (matched) names.push(ingredient.name);
    }
    return names;
  }, [items, scaledIngredients]);

  const ingredientAvailability = useMemo(() => {
    const availableSet = new Set(availableNames.map((value) => normalizeName(value)));
    const matchedCount = scaledIngredients.filter((ingredient) => availableSet.has(normalizeName(ingredient.name))).length;
    const missingCount = Math.max(0, scaledIngredients.length - matchedCount);
    return { matchedCount, missingCount };
  }, [availableNames, scaledIngredients]);

  const availableSet = useMemo(() => new Set(availableNames.map((value) => normalizeName(value))), [availableNames]);
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
  }, [baseRecipe?.title, ingredientAvailability.matchedCount, ingredientAvailability.missingCount, items.length, recipeId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!recipeId) return;
      setIsLoadingRecipe(true);
      try {
        const recipe = await fetchRecipeById(recipeId);
        if (!cancelled) setRemoteRecipe(recipe);
      } catch (error) {
        logger.warn('[RECIPES_MATCH] fetch recipe detail failed', { recipeId, error: String(error) });
        if (!cancelled) setRemoteRecipe(null);
      } finally {
        if (!cancelled) setIsLoadingRecipe(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  if (!baseRecipe) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>{isLoadingRecipe ? 'Chargement de la recette…' : 'Recette introuvable'}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonLabel}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.title}>{baseRecipe.title}</Text>
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
          {scaledIngredients.map((ingredient) => {
            const isAvailable = availableSet.has(ingredient.name);
            const formattedQuantity = formatQuantity(ingredient.quantity);
            return (
              <View key={ingredient.name} style={styles.ingredientRow}>
                <View style={styles.ingredientTextWrap}>
                  <Text style={styles.ingredientName}>{ingredient.name}</Text>
                  <Text style={styles.ingredientQuantity}>
                    {formattedQuantity}{formattedQuantity ? ' ' : ''}{ingredient.unit}
                  </Text>
                </View>
                <Text style={[styles.stockBadge, isAvailable ? styles.badgeOk : styles.badgeMissing]}>
                  {isAvailable ? 'Disponible' : 'Manquant'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Préparation</Text>
          {baseRecipe.steps.map((step: string, index: number) => (
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  backIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 28, gap: 12 },
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
