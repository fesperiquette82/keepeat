import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useStockStore } from '../../store/stockStore';
import { C, T } from '../../utils/theme';
import { countLabelFr } from '../../utils/uiText';
import { UI_LABELS } from '../../utils/uiLabels';
import { useLanguageStore } from '../../store/languageStore';
import { logger } from '../../utils/logger';
import { useRecipesStore, type BackendRecipeSuggestion, type RecipesFilter } from '../../store/recipesStore';

const TYPE_LABEL: Record<string, string> = {
  apero: 'Apéro',
  toast: 'Toast',
  tartine: 'Tartine',
  poelee: 'Poêlée',
  salade: 'Salade',
  bol: 'Bol',
  rapide: 'Rapide',
};

const FILTER_ORDER: RecipesFilter[] = ['expiryDay', 'expiryWeek', 'expiryMonth', 'stock'];

const FILTER_LABEL_KEYS: Record<RecipesFilter, string> = {
  expiryDay: 'recipesFilterExpiryDay',
  expiryWeek: 'recipesFilterExpiryWeek',
  expiryMonth: 'recipesFilterExpiryMonth',
  stock: 'recipesFilterAll',
};

const EMPTY_FILTER_LABEL_KEYS: Record<RecipesFilter, string> = {
  stock: 'recipesEmptyAll',
  expiryDay: 'recipesEmptyExpiryDay',
  expiryWeek: 'recipesEmptyExpiryWeek',
  expiryMonth: 'recipesEmptyExpiryMonth',
};

interface RecipeCard {
  id: string;
  title: string;
  timeMinutes: number;
  type: string;
  matchedCount: number;
  missingCount: number;
  imageUrl: string;
}

function toRecipeCard(recipe: BackendRecipeSuggestion): RecipeCard {
  const prep = typeof recipe.prep_time_min === 'number' ? recipe.prep_time_min : 0;
  const cook = typeof recipe.cook_time_min === 'number' ? recipe.cook_time_min : 0;
  return {
    id: recipe.id,
    title: recipe.title,
    timeMinutes: prep + cook > 0 ? prep + cook : 15,
    type: 'rapide',
    matchedCount: Array.isArray(recipe.usedIngredients) ? recipe.usedIngredients.length : 0,
    missingCount: Array.isArray(recipe.missedIngredients) ? recipe.missedIngredients.length : 0,
    imageUrl: typeof recipe.image === 'string' ? recipe.image : '',
  };
}

export default function RecipesScreen() {
  const router = useRouter();
  const { t } = useLanguageStore();
  const { items: storeItems, fetchStock } = useStockStore();
  const [activeFilter, setActiveFilter] = useState<RecipesFilter>('expiryDay');
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const recipesByFilter = useRecipesStore((state) => state.suggestionsByFilter);
  const isLoading = useRecipesStore((state) => state.isLoading);
  const fetchRecipesSuggestions = useRecipesStore((state) => state.fetchSuggestions);

  useFocusEffect(
    React.useCallback(() => {
      fetchStock();
      fetchRecipesSuggestions(activeFilter);
    }, [activeFilter, fetchRecipesSuggestions, fetchStock]),
  );

  useEffect(() => {
    fetchRecipesSuggestions(activeFilter);
  }, [activeFilter, fetchRecipesSuggestions]);

  const recipes = useMemo(() => {
    const raw = recipesByFilter[activeFilter] ?? [];
    return raw.map(toRecipeCard);
  }, [activeFilter, recipesByFilter]);

  const classicSuggestions = useMemo(() => recipes, [recipes]);
  const hasAnySuggestion = classicSuggestions.length > 0;

  useEffect(() => {
    logger.debug('[RECIPES] backend recipes state updated', {
      activeFilter,
      stockCount: storeItems.length,
      recipesCount: recipes.length,
      isLoading,
    });
  }, [activeFilter, isLoading, recipes.length, storeItems.length]);

  const filters = useMemo(
    () =>
      FILTER_ORDER.map((key) => ({
        key,
        label: t(FILTER_LABEL_KEYS[key]),
      })),
    [t],
  );

  const emptyMessage = useMemo(() => {
    const activeStockCount = storeItems.filter((item) => item.status === 'active').length;
    if (activeStockCount === 0) {
      return 'Aucune recette disponible : ajoutez d’abord des ingrédients au stock.';
    }
    if (isLoading) {
      return 'Chargement des suggestions…';
    }
    return t(EMPTY_FILTER_LABEL_KEYS[activeFilter]);
  }, [activeFilter, isLoading, storeItems, t]);

  const listHeader = useMemo(() => {
    const topRecipes = classicSuggestions.slice(0, 3);
    return (
      <View style={styles.planCard}>
        <Text style={styles.planTitle}>Plan anti-gaspi</Text>
        {topRecipes.length === 0 ? (
          <Text style={styles.planEmptyText}>Aucun plan utile pour ce segment.</Text>
        ) : (
          <>
            <Text style={styles.planMeta}>
              {topRecipes.length} recette{topRecipes.length > 1 ? 's' : ''} · {countLabelFr(topRecipes.reduce((sum, recipe) => sum + recipe.matchedCount, 0), 'ingrédient')} disponible{topRecipes.reduce((sum, recipe) => sum + recipe.matchedCount, 0) > 1 ? 's' : ''}
            </Text>
            {topRecipes.map((recipe, index) => (
              <TouchableOpacity
                key={`plan-${recipe.id}`}
                onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: recipe.id } })}
                style={styles.planRecipeButton}
              >
                <Text style={styles.planRecipeTitle}>{index + 1}. {recipe.title}</Text>
                <Text style={styles.planRecipeMeta}>{recipe.timeMinutes} min · {countLabelFr(recipe.matchedCount, 'ingrédient')} disponible{recipe.matchedCount > 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
        <Text style={styles.planSectionHint}>Suggestions classiques</Text>
      </View>
    );
  }, [classicSuggestions, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recettes</Text>
        <Text style={styles.subtitle}>Suggestions simples liées à votre stock actuel.</Text>
      </View>

      <View style={styles.controlsCard}>
        <Text style={styles.controlsSectionLabel}>Péremption ciblée</Text>
        <View style={styles.filterRow}>
          {filters.map((filter) => {
            const selected = filter.key === activeFilter;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, selected && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter.key)}
              >
                <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelActive]}>{filter.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {!hasAnySuggestion ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Aucune recette disponible</Text>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
            <Text style={styles.ctaText}>{UI_LABELS.fr.actions.viewStock}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={classicSuggestions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: item.id } })}
            >
              <View style={styles.cardMain}>
                <View style={styles.thumb}>
                  {item.imageUrl && !imageErrors[item.id] ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.thumbImage}
                      onError={() => setImageErrors((prev) => ({ ...prev, [item.id]: true }))}
                    />
                  ) : (
                    <Ionicons name="restaurant-outline" size={18} color={C.textMid} />
                  )}
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>{item.timeMinutes} min · {TYPE_LABEL[item.type] ?? 'Idée simple'}</Text>
                  <Text style={styles.cardInfo}>
                    {countLabelFr(item.matchedCount, 'ingrédient')} dispo{item.matchedCount > 1 ? 's' : ''} · {item.missingCount === 0 ? 'Tout est là ✅' : `Il manque ${countLabelFr(item.missingCount, 'ingrédient')}`}
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: item.id } })}
                    style={styles.detailsButton}
                  >
                    <Text style={styles.detailsButtonLabel}>Voir la recette complète</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
              <Text style={styles.ctaText}>Voir le stock pour compléter</Text>
            </TouchableOpacity>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 6, ...T.secondary },
  controlsCard: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, gap: 8 },
  controlsSectionLabel: { ...T.secondarySmall, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 8, paddingBottom: 2, flexWrap: 'wrap' },
  filterChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#ECFDF3' },
  filterChipActive: { backgroundColor: C.primary },
  filterChipLabel: { color: '#166534', fontSize: 13, fontWeight: '700' },
  filterChipLabelActive: { color: '#fff' },
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
  planCard: { backgroundColor: '#ECFDF3', borderRadius: 12, borderWidth: 1, borderColor: '#BBF7D0', padding: 12, marginBottom: 6, gap: 6 },
  planTitle: { color: '#14532D', fontSize: 16, fontWeight: '800' },
  planMeta: { color: '#166534', fontSize: 12, fontWeight: '700' },
  planEmptyText: { color: '#166534', fontSize: 13, fontWeight: '600' },
  planRecipeButton: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#DCFCE7' },
  planRecipeTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  planRecipeMeta: { color: C.textMid, fontSize: 12, fontWeight: '600' },
  planSectionHint: { marginTop: 2, color: C.textMid, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 11, gap: 4 },
  cardMain: { flexDirection: 'row', gap: 10 },
  cardText: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  cardMeta: { ...T.secondary },
  cardInfo: { color: '#166534', fontWeight: '700', fontSize: 12 },
  detailsButton: { marginTop: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  detailsButtonLabel: { color: '#166534', fontSize: 12, fontWeight: '700' },
  cta: { marginTop: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  emptyText: { marginTop: 8, ...T.secondary, textAlign: 'center' },
});
