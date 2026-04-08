import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStockStore } from '../../store/stockStore';
import { C, shadowSm, T } from '../../utils/theme';
import { daysUntil, findExpiringSoon, resolveStockItems } from '../../data/mockDashboardData';
import { countLabelFr } from '../../utils/uiText';
import { storageZoneLabel, UI_LABELS } from '../../utils/uiLabels';
import { fetchRecipesSuggestions } from '../../utils/recipesApi';
import { logger } from '../../utils/logger';
import { isFallbackRecipe } from '../../utils/recipesScoping';

function expiryText(days: number | null): string {
  if (days === null) return 'Date non renseignée';
  if (days < 0) return `Périmé depuis ${Math.abs(days)} j`;
  if (days === 0) return 'Expire aujourd’hui';
  if (days === 1) return 'Expire demain';
  return `Expire dans ${days} j`;
}

export default function HomeDashboardScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock } = useStockStore();
  const [recipesOnHome, setRecipesOnHome] = React.useState<any[]>([]);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items, isMock } = useMemo(() => resolveStockItems(storeItems), [storeItems]);

  const summary = useMemo(() => {
    const frigo = items.filter((item) => item.storageZone === 'frigo').length;
    const placard = items.filter((item) => item.storageZone === 'placard').length;
    const urgents = items.filter((item) => {
      const days = daysUntil(item.expiry_date);
      return days !== null && days <= 2;
    }).length;
    return { frigo, placard, urgents };
  }, [items]);

  const expiringSoon = useMemo(() => findExpiringSoon(items), [items]);
  const recipes = useMemo(
    () =>
      recipesOnHome.map((recipe) => ({
        ...recipe,
        timeMinutes: recipe.duration_min ?? recipe.timeMinutes ?? 0,
        matchedCount: recipe.available_count ?? recipe.availableCount ?? 0,
        missingCount: recipe.missing_count ?? recipe.missingCount ?? 0,
      })),
    [recipesOnHome],
  );
  const summaryCards = useMemo(() => ([
    { key: 'placard', label: 'Placard', value: summary.placard, icon: 'file-tray-stacked-outline' as const },
    { key: 'frigo', label: 'Frigo', value: summary.frigo, icon: 'snow-outline' as const },
    { key: 'urgents', label: 'Urgents', value: summary.urgents, icon: 'alarm-outline' as const, urgent: true },
  ]), [summary.frigo, summary.placard, summary.urgents]);

  useEffect(() => {
    let cancelled = false;
    const loadHomeRecipes = async () => {
      try {
        const payload = await fetchRecipesSuggestions('stock');
        if (cancelled) return;
        const backendRecipesOnHome = payload.recipes ?? [];
        const homeRecipes = backendRecipesOnHome.filter((recipe) => !isFallbackRecipe(recipe));
        setRecipesOnHome(homeRecipes.slice(0, 2));
        logger.debug('[RECIPES_MATCH] home suggestions diagnostics', {
          homeRecipesCount: backendRecipesOnHome.length,
          fallbackHomeRecipesCount: backendRecipesOnHome.length - homeRecipes.length,
          homeRecipes: homeRecipes.map((recipe) => ({ id: recipe.id, title: recipe.title })).slice(0, 10),
        });
      } catch (error) {
        logger.warn('[RECIPES_MATCH] home suggestions failed', { error: String(error) });
        if (!cancelled) setRecipesOnHome([]);
      }
    };
    loadHomeRecipes();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Stock maison</Text>
            <Text style={styles.subtitle}>{countLabelFr(items.length, 'ingrédient')} au total</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={19} color={C.text} />
          </TouchableOpacity>
        </View>

        {isMock && (
          <Text style={styles.mockText}>Mode démo actif (données mockées réalistes)</Text>
        )}

        <View style={styles.summaryGrid}>
          {summaryCards.map((card) => (
            <View key={card.key} style={styles.summaryCard}>
              <View style={styles.summaryCardHeader}>
                <View style={styles.summaryIconBadge}>
                  <Ionicons name={card.icon} size={14} color="#166534" />
                </View>
                <Text style={styles.summaryLabel}>{card.label}</Text>
              </View>
              <Text style={[styles.summaryValue, card.urgent && styles.urgentValue]}>{card.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>À consommer bientôt</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/stock')}>
              <Text style={styles.linkText}>{UI_LABELS.fr.actions.viewStock}</Text>
            </TouchableOpacity>
          </View>
          {expiringSoon.length === 0 ? (
            <Text style={styles.emptyText}>Aucun produit urgent pour le moment 🎉</Text>
          ) : (
            expiringSoon.map((item) => (
              <View key={item.id} style={styles.rowItem}>
                <View style={styles.rowMain}>
                  <View style={styles.squareThumb}>
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={styles.squareThumbImage} />
                    ) : (
                      <Ionicons name="nutrition-outline" size={16} color={C.textMid} />
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.rowMeta}>{storageZoneLabel(item.storageZone)} · {item.quantity ?? UI_LABELS.fr.unknownQuantity}</Text>
                  </View>
                </View>
                <Text style={styles.rowExpiry}>{expiryText(daysUntil(item.expiry_date))}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.recipesCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recettes</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/recipes')}>
              <Text style={styles.linkText}>{UI_LABELS.fr.actions.viewRecipes}</Text>
            </TouchableOpacity>
          </View>
          {recipes.length === 0 ? (
            <Text style={styles.emptyText}>Aucune recette disponible avec votre stock.</Text>
          ) : (
            recipes.map((recipe) => (
              <View key={recipe.id} style={styles.recipeRow}>
                <View style={styles.rowMain}>
                  <View style={styles.squareThumb}>
                    {recipe.image_url ? (
                      <Image source={{ uri: recipe.image_url }} style={styles.squareThumbImage} />
                    ) : (
                      <Ionicons name="restaurant-outline" size={16} color={C.textMid} />
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{recipe.title}</Text>
                    <Text style={styles.recipeMeta}>
                      {recipe.timeMinutes} min
                      {` · ${countLabelFr(recipe.matchedCount, 'ingrédient')} disponible${recipe.matchedCount > 1 ? 's' : ''}`}
                      {recipe.missingCount > 0 ? ` · Il manque ${countLabelFr(recipe.missingCount, 'ingrédient')}` : ''}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.tipInline}>
          <Ionicons name="leaf-outline" size={15} color={C.primary} />
          <Text style={styles.tipText}>Anti-gaspi : priorisez les produits à J-2.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 4, ...T.secondary },
  mockText: { ...T.tertiary, opacity: 0.85 },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 6 },
  summaryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryIconBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCFCE7' },
  summaryLabel: { ...T.secondarySmall },
  summaryValue: { color: C.text, fontSize: 23, fontWeight: '800' },
  urgentValue: { color: '#15803d' },
  sectionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 13, gap: 8, ...shadowSm },
  recipesCard: { backgroundColor: '#fff', borderRadius: 14, padding: 13, gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  linkText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  emptyText: { ...T.secondary, paddingVertical: 8 },
  rowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowText: { flex: 1 },
  squareThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#F3F4F6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  squareThumbImage: { width: '100%', height: '100%' },
  rowTitle: { fontSize: 15, color: C.text, fontWeight: '600' },
  rowMeta: { ...T.secondarySmall, marginTop: 2 },
  rowExpiry: { color: '#166534', fontSize: 12, fontWeight: '700' },
  recipeRow: { paddingVertical: 5 },
  recipeMeta: { ...T.secondarySmall, marginTop: 2 },
  tipInline: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 2 },
  tipText: { flex: 1, color: '#166534', fontSize: 12, fontWeight: '600' },
});
