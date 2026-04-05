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
import {
  computeRecipeAvailabilityFromStock,
  findRecipeBaseById,
  resolveStockItems,
  type RecipeIngredient,
} from '../../data/mockDashboardData';
import { matchRecipeIngredientsToStock } from '../../utils/ingredientMatching';
import { removeStockItems, undoRemovedStockItems } from '../../utils/stockRemoval';
import { logger } from '../../utils/logger';

const TYPE_LABEL: Record<string, string> = {
  apero: 'Apéro',
  toast: 'Toast',
  tartine: 'Tartine',
  poelee: 'Poêlée',
  salade: 'Salade',
  bol: 'Bol',
  rapide: 'Rapide',
};

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function scaleIngredients(ingredients: RecipeIngredient[], factor: number): RecipeIngredient[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: ingredient.scalable === false ? ingredient.quantity : ingredient.quantity * factor,
  }));
}

export default function RecipeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { items: storeItems, fetchStock } = useStockStore();
  const householdSize = useAppSettingsStore((state) => state.householdSize);
  const [isValidating, setIsValidating] = useState(false);
  const [undoItems, setUndoItems] = useState<typeof storeItems>([]);
  const [banner, setBanner] = useState<{ message: string; canUndo: boolean; variant: 'success' | 'error' } | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      logger.debug('[RECIPES_MATCH] detail screen focused - refreshing stock', { recipeId: params.id ?? null });
      fetchStock();
    }, [fetchStock, params.id]),
  );

  const recipeId = typeof params.id === 'string' ? params.id : '';
  const baseRecipe = useMemo(() => findRecipeBaseById(recipeId), [recipeId]);
  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);

  const initialServings = householdSize;
  const [servings, setServings] = useState(initialServings);

  useEffect(() => {
    setServings(initialServings);
  }, [initialServings]);

  const factor = baseRecipe ? servings / baseRecipe.baseServings : 1;
  const scaledIngredients = useMemo(
    () => (baseRecipe ? scaleIngredients(baseRecipe.ingredientsDetailed, factor) : []),
    [baseRecipe, factor],
  );
  const ingredientAvailability = useMemo(
    () => computeRecipeAvailabilityFromStock(items, scaledIngredients),
    [items, scaledIngredients],
  );
  const availableSet = new Set(ingredientAvailability.availableIngredients);

  useEffect(() => {
    logger.debug('[RECIPES_MATCH] detail availability recomputed', {
      recipeId,
      recipeTitle: baseRecipe?.title ?? null,
      stockItemsCount: items.length,
      availableCount: ingredientAvailability.matchedCount,
      missingCount: ingredientAvailability.missingCount,
    });
  }, [baseRecipe?.title, ingredientAvailability.matchedCount, ingredientAvailability.missingCount, items.length, recipeId]);

  if (!baseRecipe) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Recette introuvable</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonLabel}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleValidateRecipe = async () => {
    if (isValidating) return;
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
        <Text style={styles.meta}>{baseRecipe.timeMinutes} min · {TYPE_LABEL[baseRecipe.type] ?? 'Idée simple'}</Text>

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
          <Text style={styles.servingsHint}>Par défaut foyer : {householdSize} personnes</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ingrédients</Text>
          {scaledIngredients.map((ingredient) => {
            const isAvailable = availableSet.has(ingredient.name);
            return (
              <View key={ingredient.name} style={styles.ingredientRow}>
                <View style={styles.ingredientTextWrap}>
                  <Text style={styles.ingredientName}>{ingredient.name}</Text>
                  <Text style={styles.ingredientQuantity}>{formatQuantity(ingredient.quantity)} {ingredient.unit}</Text>
                </View>
                <Text style={[styles.stockBadge, isAvailable ? styles.badgeOk : styles.badgeMissing]}>
                  {isAvailable ? 'Disponible' : 'Manquant'}
                </Text>
              </View>
            );
          })}
          {baseRecipe.optionalBasics && baseRecipe.optionalBasics.length > 0 && (
            <Text style={styles.optionalText}>Option du quotidien : {baseRecipe.optionalBasics.join(', ')}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Préparation</Text>
          {baseRecipe.steps.map((step, index) => (
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
  optionalText: { color: C.textLight, fontSize: 12, fontWeight: '500' },
  stepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  stepIndex: { width: 18, color: C.text, fontWeight: '700' },
  stepText: { flex: 1, color: C.textMid, fontWeight: '500' },
  validateButton: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  validateButtonDisabled: { opacity: 0.7 },
  validateButtonLabel: { color: '#fff', fontSize: 14, fontWeight: '800' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  backButton: { backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  backButtonLabel: { color: '#fff', fontWeight: '700' },
});
