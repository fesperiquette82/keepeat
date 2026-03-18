import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { buildApiUrl } from '../../utils/config';

interface MonthlyStats {
  month: string;   // "YYYY-MM"
  consumed: number;
  thrown: number;
  score: number;   // 0-100
}

function scoreLabel(score: number, fr: boolean): { text: string; icon: string; color: string } {
  if (score >= 80) return { text: fr ? 'Excellent' : 'Excellent', icon: '🌱', color: '#22c55e' };
  if (score >= 60) return { text: fr ? 'Bien'      : 'Good',      icon: '👍', color: '#84cc16' };
  return              { text: fr ? 'À améliorer' : 'Needs work', icon: '💪', color: '#f97316' };
}

function formatMonth(month: string, lang: string): string {
  const [year, m] = month.split('-');
  const date = new Date(parseInt(year), parseInt(m) - 1, 1);
  return date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'long', year: 'numeric' });
}

export default function StatsScreen() {
  const { token } = useAuthStore();
  const { language } = useLanguageStore();
  const isFr = language === 'fr';
  const t = (fr: string, en: string) => isFr ? fr : en;

  const [data, setData] = useState<MonthlyStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get(buildApiUrl('/api/stats/monthly?months=6'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch {
      setError(t(
        'Impossible de charger les stats. Vérifiez votre connexion.',
        'Unable to load stats. Check your connection.',
      ));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => { fetchStats(); }, [token]);

  const handleRefresh = () => { setIsRefreshing(true); fetchStats(true); };

  // Mois courant = dernier élément
  const currentMonth = data.length > 0 ? data[data.length - 1] : null;
  const maxBar = data.length > 0 ? Math.max(...data.map(d => d.consumed + d.thrown), 1) : 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {t('📊 Score anti-gaspillage', '📊 Waste Score')}
        </Text>
        <Text style={styles.headerSubtitle}>
          {t('6 derniers mois', 'Last 6 months')}
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
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#22c55e" />
          }
        >
          {/* Score du mois courant */}
          {currentMonth && (() => {
            const label = scoreLabel(currentMonth.score, isFr);
            const totalMonth = currentMonth.consumed + currentMonth.thrown;
            return (
              <View style={styles.scoreCard}>
                <Text style={styles.scoreCardLabel}>
                  {t('Ce mois-ci', 'This month')} · {formatMonth(currentMonth.month, language)}
                </Text>
                <View style={styles.scoreRow}>
                  <Text style={[styles.scoreNumber, { color: label.color }]}>
                    {currentMonth.score === 0 && totalMonth === 0 ? '—' : `${currentMonth.score}%`}
                  </Text>
                  <View style={styles.scoreRight}>
                    <Text style={styles.scoreEmoji}>{label.icon}</Text>
                    <Text style={[styles.scoreLabel, { color: label.color }]}>{label.text}</Text>
                  </View>
                </View>
                {totalMonth > 0 ? (
                  <Text style={styles.scoreSummary}>
                    {currentMonth.consumed} {t('produit(s) sauvé(s)', 'product(s) saved')}{currentMonth.thrown > 0 ? ` · ${currentMonth.thrown} ${t('jeté(s)', 'wasted')}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.scoreSummary}>
                    {t('Aucune donnée ce mois-ci', 'No data this month')}
                  </Text>
                )}
              </View>
            );
          })()}

          {/* Légende */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
              <Text style={styles.legendText}>{t('Consommé', 'Consumed')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.legendText}>{t('Jeté', 'Wasted')}</Text>
            </View>
          </View>

          {/* Barres mensuelles */}
          <View style={styles.barsContainer}>
            {data.map((m) => {
              const total = m.consumed + m.thrown;
              const consumedRatio = total > 0 ? m.consumed / maxBar : 0;
              const thrownRatio = total > 0 ? m.thrown / maxBar : 0;
              const isCurrentMonth = m.month === currentMonth?.month;

              return (
                <View key={m.month} style={styles.barRow}>
                  <Text style={[styles.barLabel, isCurrentMonth && styles.barLabelActive]}>
                    {formatMonth(m.month, language).split(' ')[0].slice(0, 3).toUpperCase()}
                    {'\n'}
                    <Text style={styles.barYear}>{m.month.split('-')[0].slice(2)}</Text>
                  </Text>
                  <View style={styles.barTrack}>
                    {total === 0 ? (
                      <View style={styles.barEmpty} />
                    ) : (
                      <>
                        <View style={[styles.barFill, { flex: consumedRatio, backgroundColor: '#22c55e' }]} />
                        <View style={[styles.barFill, { flex: thrownRatio, backgroundColor: '#ef4444' }]} />
                        <View style={{ flex: 1 - consumedRatio - thrownRatio }} />
                      </>
                    )}
                  </View>
                  <View style={styles.barNumbers}>
                    {m.consumed > 0 && (
                      <Text style={styles.barConsumed}>{m.consumed}</Text>
                    )}
                    {m.thrown > 0 && (
                      <Text style={styles.barThrown}>{m.thrown}</Text>
                    )}
                    {total === 0 && (
                      <Text style={styles.barNone}>—</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Info */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#555" />
            <Text style={styles.infoText}>
              {t(
                'Le score représente le % de produits consommés avant péremption.',
                'The score is the % of products consumed before expiry.',
              )}
            </Text>
          </View>
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorText: { color: '#f97316', fontSize: 14, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 20, paddingBottom: 40 },

  // Score card
  scoreCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    gap: 8,
  },
  scoreCardLabel: { fontSize: 13, color: '#666', fontWeight: '500' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreNumber: { fontSize: 52, fontWeight: '800', lineHeight: 60 },
  scoreRight: { alignItems: 'flex-end', gap: 4 },
  scoreEmoji: { fontSize: 32 },
  scoreLabel: { fontSize: 16, fontWeight: '700' },
  scoreSummary: { fontSize: 13, color: '#888' },

  // Légende
  legendRow: { flexDirection: 'row', gap: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 13, color: '#888' },

  // Barres
  barsContainer: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    gap: 14,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: {
    width: 34,
    fontSize: 11,
    color: '#555',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 14,
  },
  barLabelActive: { color: '#22c55e' },
  barYear: { fontSize: 10, color: '#444' },
  barTrack: {
    flex: 1,
    height: 22,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barFill: { height: '100%' },
  barEmpty: { flex: 1, backgroundColor: '#1a1a1a' },
  barNumbers: { width: 50, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  barConsumed: { fontSize: 12, color: '#22c55e', fontWeight: '600' },
  barThrown: { fontSize: 12, color: '#ef4444', fontWeight: '600' },
  barNone: { fontSize: 12, color: '#333' },

  // Info
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  infoText: { flex: 1, fontSize: 12, color: '#555', lineHeight: 18 },
});
