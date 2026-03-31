import React, { useEffect, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useStockStore } from '../../store/stockStore';
import { C, T } from '../../utils/theme';
import { buildRecipeSuggestions, resolveStockItems } from '../../data/mockDashboardData';
import { countLabelFr } from '../../utils/uiText';
import { UI_LABELS } from '../../utils/uiLabels';

const TYPE_LABEL: Record<string, string> = {
  apero: 'Apéro',
  toast: 'Toast',
  tartine: 'Tartine',
  poelee: 'Poêlée',
  salade: 'Salade',
  bol: 'Bol',
  rapide: 'Rapide',
};

function previewIngredients(values: string[], max = 3): string {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')} +${values.length - max}`;
}

export default function RecipesScreen() {
  const router = useRouter();
  const { items: storeItems, fetchStock } = useStockStore();
  const [imageErrors, setImageErrors] = React.useState<Record<string, boolean>>({});
  const [expandedCards, setExpandedCards] = React.useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const { items } = useMemo(() => resolveStockItems(storeItems, { useMockFallback: false }), [storeItems]);
  const suggestions = useMemo(() => buildRecipeSuggestions(items), [items]);

  const emptyMessage = items.length === 0
    ? 'Aucune recette disponible : ajoutez d’abord des ingrédients au stock.'
    : 'Suggestions indisponibles pour le moment.';

  const toggleCardDetails = (recipeId: string) => {
    setExpandedCards((prev) => ({ ...prev, [recipeId]: !prev[recipeId] }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recettes</Text>
        <Text style={styles.subtitle}>Suggestions simples liées à votre stock actuel.</Text>
      </View>

      {suggestions.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Aucune recette disponible</Text>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/stock')}>
            <Text style={styles.ctaText}>{UI_LABELS.fr.actions.viewStock}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardMain}>
                <View style={styles.thumb}>
                  {item.image_url && !imageErrors[item.id] ? (
                    <Image
                      source={{ uri: item.image_url }}
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
                  <TouchableOpacity onPress={() => toggleCardDetails(item.id)} style={styles.detailsButton}>
                    <Text style={styles.detailsButtonLabel}>{expandedCards[item.id] ? 'Masquer les détails' : 'Voir les détails'}</Text>
                  </TouchableOpacity>
                  {expandedCards[item.id] && (
                    <View style={styles.detailsWrap}>
                      <Text style={styles.ingredientsLine} numberOfLines={2}>
                        Disponibles : {previewIngredients(item.availableIngredients)}
                      </Text>
                      {item.missingIngredients.length > 0 && (
                        <Text style={styles.ingredientsHint} numberOfLines={2}>
                          Manquants : {previewIngredients(item.missingIngredients)}
                        </Text>
                      )}
                      {item.optionalBasics && item.optionalBasics.length > 0 && (
                        <Text style={styles.ingredientsHint} numberOfLines={2}>
                          Option du quotidien : {previewIngredients(item.optionalBasics)}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </View>
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
  listContent: { padding: 16, gap: 8, paddingBottom: 24 },
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
  detailsWrap: { marginTop: 3, gap: 2 },
  ingredientsLine: { color: C.textMid, fontSize: 12, fontWeight: '500' },
  ingredientsHint: { color: C.textLight, fontSize: 11, fontWeight: '500' },
  cta: { marginTop: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  emptyText: { marginTop: 8, ...T.secondary, textAlign: 'center' },
});
