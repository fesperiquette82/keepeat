import React, { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { buildApiUrl } from '../../utils/config';

interface RecipeSuggestion {
  id: number;
  title: string;
  image: string;
  usedIngredients: string[];
  missedIngredients: string[];
  sourceUrl: string;
}

export default function RecipesScreen() {
  const { token } = useAuthStore();
  const { language } = useLanguageStore();

  const [recipes, setRecipes] = useState<RecipeSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (fr: string, en: string) => language === 'fr' ? fr : en;

  const fetchRecipes = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get(buildApiUrl('/api/recipes/suggestions'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRecipes(res.data);
    } catch {
      setError(t(
        'Impossible de charger les recettes. Vérifiez votre connexion.',
        'Unable to load recipes. Check your connection.',
      ));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, language]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchRecipes(true);
  };

  const openRecipe = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {t('🍳 Recettes suggérées', '🍳 Suggested Recipes')}
        </Text>
        <Text style={styles.headerSubtitle}>
          {t(
            'Basées sur vos produits à consommer en priorité',
            'Based on your priority products',
          )}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#22c55e" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#666" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchRecipes()}>
            <Text style={styles.retryBtnText}>{t('Réessayer', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : recipes.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="restaurant-outline" size={56} color="#333" />
          <Text style={styles.emptyTitle}>
            {t('Aucune suggestion', 'No suggestions')}
          </Text>
          <Text style={styles.emptyText}>
            {t(
              'Ajoutez des produits avec une date de péremption proche pour obtenir des idées de recettes.',
              'Add products with a near expiry date to get recipe ideas.',
            )}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#22c55e"
            />
          }
        >
          {recipes.map((recipe) => (
            <View key={recipe.id} style={styles.card}>
              {recipe.image ? (
                <Image source={{ uri: recipe.image }} style={styles.cardImage} />
              ) : (
                <View style={styles.cardImagePlaceholder}>
                  <Ionicons name="restaurant-outline" size={40} color="#444" />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {recipe.title}
                </Text>

                {recipe.usedIngredients.length > 0 && (
                  <View style={styles.ingredientsRow}>
                    {recipe.usedIngredients.map((ing) => (
                      <View key={ing} style={styles.badgeUsed}>
                        <Ionicons name="checkmark" size={11} color="#22c55e" />
                        <Text style={styles.badgeUsedText}>{ing}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {recipe.missedIngredients.length > 0 && (
                  <View style={styles.ingredientsRow}>
                    {recipe.missedIngredients.slice(0, 3).map((ing) => (
                      <View key={ing} style={styles.badgeMissed}>
                        <Ionicons name="add-circle-outline" size={11} color="#888" />
                        <Text style={styles.badgeMissedText}>{ing}</Text>
                      </View>
                    ))}
                    {recipe.missedIngredients.length > 3 && (
                      <View style={styles.badgeMissed}>
                        <Text style={styles.badgeMissedText}>
                          +{recipe.missedIngredients.length - 3}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => openRecipe(recipe.sourceUrl)}
                >
                  <Text style={styles.viewBtnText}>
                    {t('Voir la recette', 'View recipe')}
                  </Text>
                  <Ionicons name="open-outline" size={14} color="#22c55e" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  headerSubtitle: { fontSize: 13, color: '#666', marginTop: 4 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorText: { color: '#f97316', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#666', textAlign: 'center' },
  emptyText: { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 20 },

  scrollView: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },

  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  cardImage: { width: '100%', height: 180, backgroundColor: '#1a1a1a' },
  cardImagePlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: 14, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#fff', lineHeight: 22 },

  ingredientsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badgeUsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#22c55e15',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#22c55e40',
  },
  badgeUsedText: { fontSize: 12, color: '#22c55e', fontWeight: '500' },
  badgeMissed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeMissedText: { fontSize: 12, color: '#888' },

  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#22c55e40',
    backgroundColor: '#22c55e10',
    marginTop: 4,
  },
  viewBtnText: { fontSize: 13, color: '#22c55e', fontWeight: '600' },
});
