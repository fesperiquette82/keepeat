import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ImageBackground } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStockStore } from '../../store/stockStore';
import { getThemeColors, getThemeText, screenBackdropColor, shadowSm, type ThemeMode } from '../../utils/theme';
import { useAppSettingsStore } from '../../store/appSettingsStore';
import { daysUntil, findExpiringSoon, resolveHomeStockOverviewState, resolveStockItems } from '../../utils/stockDashboard';
import { countLabelFr } from '../../utils/uiText';
import { storageZoneLabel, UI_LABELS } from '../../utils/uiLabels';
import { logger } from '../../utils/logger';
import { expiryColor, expiryText } from '../../utils/expiryLabels';
import { useRecipesStore } from '../../store/recipesStore';
import { formatRecipeDuration, joinRecipeMeta, resolveRecipeDurationMinutes, resolveRecipeIngredientCounts } from '../../utils/recipeDisplay';

export default function HomeDashboardScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock, isLoading: isStockLoading } = useStockStore();
  const fetchSuggestions = useRecipesStore((state) => state.fetchSuggestions);
  const [recipesOnHome, setRecipesOnHome] = React.useState<any[]>([]);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  // BUG-098 : l'accueil n'affiche que le stock réel. Vide, il le dit : il
  // remplaçait auparavant le stock par un jeu de faux produits.
  const items = useMemo(() => resolveStockItems(storeItems), [storeItems]);
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T, themeMode), [C, T, themeMode]);

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
  const stockOverviewState = resolveHomeStockOverviewState({
    itemCount: items.length,
    expiringSoonCount: expiringSoon.length,
    isLoading: isStockLoading,
  });
  const recipes = useMemo(
    () =>
      recipesOnHome.map((recipe) => {
        const counts = resolveRecipeIngredientCounts(recipe);
        return {
          ...recipe,
          timeMinutes: resolveRecipeDurationMinutes(recipe),
          matchedCount: counts.available,
          missingCount: counts.missing,
          imageUrl: recipe.image || recipe.imageUrl || '',
        };
      }),
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
        const backendRecipesOnHome = await fetchSuggestions('expiryDay');
        if (cancelled) return;
        setRecipesOnHome(backendRecipesOnHome.slice(0, 4));
        logger.debug('[RECIPES_MATCH] home suggestions diagnostics', {
          recipesOnHomeCount: backendRecipesOnHome.length,
          recipesOnHomeIds: backendRecipesOnHome.map((recipe) => recipe.id).slice(0, 10),
          recipesOnHomeTitles: backendRecipesOnHome.map((recipe) => recipe.title).slice(0, 10),
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
  }, [fetchSuggestions]);

  return (
    <ImageBackground source={require('../../assets/images/KeepEat_fond.png')} style={styles.bgImage} resizeMode="cover">
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
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Aperçu du stock :</Text>
              {expiringSoon.length > 0 && (
                <View style={[styles.sectionDot, { backgroundColor: expiryColor(daysUntil(expiringSoon[0].expiry_date), themeMode) }]} />
              )}
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/stock')}>
              <Text style={styles.linkText}>{UI_LABELS.fr.actions.viewStock}</Text>
            </TouchableOpacity>
          </View>
          {stockOverviewState === 'loading' ? (
            <Text style={styles.emptyText}>Chargement de votre stock…</Text>
          ) : stockOverviewState === 'empty' ? (
            <View testID="home-stock-empty">
              <Text style={styles.emptyText}>Votre stock est vide. Ajoutez un premier produit pour suivre ses dates.</Text>
              <TouchableOpacity testID="home-stock-empty-add" onPress={() => router.push('/scan')}>
                <Text style={styles.linkText}>{UI_LABELS.fr.actions.addProduct}</Text>
              </TouchableOpacity>
            </View>
          ) : stockOverviewState === 'no-urgent' ? (
            <Text style={styles.emptyText}>Aucun produit urgent pour le moment 🎉</Text>
          ) : (
            expiringSoon.map((item) => {
              const days = daysUntil(item.expiry_date);
              const urgColor = expiryColor(days, themeMode);
              return (
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
                  <Text style={[styles.rowExpiry, { color: urgColor }]}>{expiryText(days)}</Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.recipesCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Vos recettes à venir</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/recipes')}>
              <Text style={styles.linkText}>{UI_LABELS.fr.actions.viewRecipes}</Text>
            </TouchableOpacity>
          </View>
          {recipes.length === 0 ? (
            <Text style={styles.emptyText}>Aucune recette disponible avec votre stock.</Text>
          ) : (
            recipes.map((recipe) => (
              <TouchableOpacity
                key={recipe.id}
                style={styles.recipeRow}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: recipe.id } })}
              >
                <View style={styles.rowMain}>
                  <View style={styles.squareThumb}>
                    {recipe.imageUrl ? (
                      <Image source={{ uri: recipe.imageUrl }} style={styles.squareThumbImage} />
                    ) : (
                      <Ionicons name="restaurant-outline" size={16} color={C.textMid} />
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{recipe.title}</Text>
                    <Text style={styles.recipeMeta}>
                      {joinRecipeMeta([
                        formatRecipeDuration(recipe.timeMinutes),
                        `${countLabelFr(recipe.matchedCount, 'ingrédient')} disponible${recipe.matchedCount > 1 ? 's' : ''}`,
                        recipe.missingCount > 0 && `Il manque ${countLabelFr(recipe.missingCount, 'ingrédient')}`,
                      ])}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.tipInline}>
          <Ionicons name="leaf-outline" size={15} color={C.primary} />
          <Text style={styles.tipText}>Anti-gaspi : priorisez les produits à J-2.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
    </ImageBackground>
  );
}

// BUG-072 : ces cartes utilisaient `#fff` en dur tout en affichant du texte
// issu du thème actif. En mode sombre, `C.text` est quasi blanc : le contenu
// devenait illisible (texte très clair sur fond blanc). On emploie les jetons
// `C.card`/`C.bg` déjà définis pour les deux thèmes.
const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>, themeMode: ThemeMode) => StyleSheet.create({
  bgImage: { flex: 1 },
  container: { flex: 1, backgroundColor: screenBackdropColor(themeMode) },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { marginTop: 4, ...T.secondary },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 6 },
  summaryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryIconBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCFCE7' },
  summaryLabel: { ...T.secondarySmall },
  summaryValue: { color: C.text, fontSize: 23, fontWeight: '800' },
  urgentValue: { color: themeMode === 'dark' ? C.primary : '#15803d' },
  sectionCard: { backgroundColor: C.card, borderRadius: 14, padding: 13, gap: 8, ...shadowSm },
  recipesCard: { backgroundColor: C.card, borderRadius: 14, padding: 13, gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  linkText: { color: C.primaryText, fontWeight: '700', fontSize: 13 },
  emptyText: { ...T.secondary, paddingVertical: 8 },
  rowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowText: { flex: 1 },
  squareThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: C.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  squareThumbImage: { width: '100%', height: '100%' },
  rowTitle: { fontSize: 15, color: C.text, fontWeight: '600' },
  rowMeta: { ...T.secondarySmall, marginTop: 2 },
  rowExpiry: { fontSize: 12, fontWeight: '700' },
  recipeRow: { paddingVertical: 5 },
  recipeMeta: { ...T.secondarySmall, marginTop: 2 },
  tipInline: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 2 },
  tipText: { flex: 1, color: C.primaryText, fontSize: 12, fontWeight: '600' },
});
