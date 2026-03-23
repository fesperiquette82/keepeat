
import React, { useCallback, useEffect, useState } from 'react';
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
import { C, shadowSm } from '../../utils/theme';

interface MonthlyStats {
  month: string;   // "YYYY-MM"
  consumed: number;
  thrown: number;
  score: number;       // 0-100
  saved_euros: number; // estimation €
}

interface GamifData {
  total_consumed: number;
  total_thrown: number;
  total_saved_euros: number;
  current_streak: number;
  level_index: number;
  level_name: string;
  level_emoji: string;
  progress_to_next: number;
  next_level: string | null;
}

function scoreLabel(score: number, isFr: boolean): { text: string; icon: string; color: string } {
  if (score >= 80) return { text: isFr ? 'Excellent' : 'Excellent', icon: '🌱', color: '#16a34a' };
  if (score >= 60) return { text: isFr ? 'Bien'      : 'Good',      icon: '👍', color: '#65a30d' };
  return              { text: isFr ? 'À améliorer' : 'Needs work', icon: '💪', color: C.orange };
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

  const [data, setData]                 = useState<MonthlyStats[]>([]);
  const [gamif, setGamif]               = useState<GamifData | null>(null);
  const [isLoading, setIsLoading]       = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const fetchStats = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const [monthly, gamifRes] = await Promise.all([
        axios.get(buildApiUrl('/api/stats/monthly?months=6'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(buildApiUrl('/api/gamification'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setData(monthly.data);
      setGamif(gamifRes.data);
    } catch {
      setError(
        isFr
          ? 'Impossible de charger les stats. Vérifiez votre connexion.'
          : 'Unable to load stats. Check your connection.',
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isFr, token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleRefresh = () => { setIsRefreshing(true); fetchStats(true); };

  const currentMonth = data.length > 0 ? data[data.length - 1] : null;
  const maxBar = data.length > 0 ? Math.max(...data.map(d => d.consumed + d.thrown), 1) : 1;

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>{t('Score anti-gaspillage 📊', 'Waste Score 📊')}</Text>
          <Text style={styles.headerSub}>{t('6 derniers mois', 'Last 6 months')}</Text>
        </View>
        <View style={styles.illustration} pointerEvents="none">
          <Text style={styles.illustEmoji1}>📊</Text>
          <Text style={styles.illustEmoji2}>🌱</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#ccc" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.primary} />
          }
        >
          {/* Carte niveau gamification */}
          {gamif && (
            <View style={styles.levelCard}>
              <View style={styles.levelTop}>
                <Text style={styles.levelEmoji}>{gamif.level_emoji}</Text>
                <View style={styles.levelInfo}>
                  <Text style={styles.levelName}>{gamif.level_name}</Text>
                  {gamif.next_level && (
                    <Text style={styles.levelNext}>
                      {isFr ? `→ ${gamif.next_level}` : `→ ${gamif.next_level}`}
                    </Text>
                  )}
                </View>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>Lvl {gamif.level_index + 1}</Text>
                </View>
              </View>
              {/* Barre de progression */}
              <View style={styles.levelBarTrack}>
                <View style={[styles.levelBarFill, { width: `${Math.round(gamif.progress_to_next * 100)}%` as any }]} />
              </View>
              <View style={styles.levelBottom}>
                <Text style={styles.levelStat}>
                  {gamif.current_streak > 0
                    ? `🔥 ${gamif.current_streak} ${isFr ? 'j sans gaspillage' : 'd without waste'}`
                    : (isFr ? '💪 Zéro gaspi aujourd\'hui !' : '💪 No waste today!')}
                </Text>
                <Text style={styles.levelStat}>
                  {`🌱 ~${gamif.total_saved_euros}€ ${isFr ? 'sauvés au total' : 'saved total'}`}
                </Text>
              </View>
            </View>
          )}

          {/* Score du mois courant */}
          {currentMonth && (() => {
            const label = scoreLabel(currentMonth.score, isFr);
            const total = currentMonth.consumed + currentMonth.thrown;
            return (
              <View style={styles.scoreCard}>
                <Text style={styles.scoreCardMonth}>
                  {t('Ce mois-ci', 'This month')} · {formatMonth(currentMonth.month, language)}
                </Text>
                <View style={styles.scoreRow}>
                  <Text style={[styles.scoreNumber, { color: label.color }]}>
                    {total === 0 ? '—' : `${currentMonth.score}%`}
                  </Text>
                  <View style={styles.scoreRight}>
                    <Text style={styles.scoreEmoji}>{label.icon}</Text>
                    <Text style={[styles.scoreLabel, { color: label.color }]}>{label.text}</Text>
                  </View>
                </View>
                {total > 0 ? (
                  <>
                    <Text style={styles.scoreSummary}>
                      {currentMonth.consumed} {t('produit(s) sauvé(s)', 'product(s) saved')}
                      {currentMonth.thrown > 0 ? ` · ${currentMonth.thrown} ${t('jeté(s)', 'wasted')}` : ''}
                    </Text>
                    {currentMonth.saved_euros > 0 && (
                      <View style={styles.savingsRow}>
                        <Text style={styles.savingsEmoji}>💶</Text>
                        <Text style={styles.savingsText}>
                          ~{currentMonth.saved_euros.toFixed(1)}€ {t('économisés ce mois', 'saved this month')}
                        </Text>
                      </View>
                    )}
                  </>
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
              <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
              <Text style={styles.legendText}>{t('Consommé', 'Consumed')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.red }]} />
              <Text style={styles.legendText}>{t('Jeté', 'Wasted')}</Text>
            </View>
          </View>

          {/* Barres mensuelles */}
          <View style={styles.barsCard}>
            {data.map((m) => {
              const total = m.consumed + m.thrown;
              const consumedRatio = total > 0 ? m.consumed / maxBar : 0;
              const thrownRatio   = total > 0 ? m.thrown   / maxBar : 0;
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
                        <View style={[styles.barFill, { flex: consumedRatio, backgroundColor: C.primary }]} />
                        <View style={[styles.barFill, { flex: thrownRatio,   backgroundColor: C.red }]} />
                        <View style={{ flex: 1 - consumedRatio - thrownRatio }} />
                      </>
                    )}
                  </View>
                  <View style={styles.barNumbers}>
                    {m.consumed > 0 && <Text style={styles.barConsumed}>{m.consumed}</Text>}
                    {m.thrown   > 0 && <Text style={styles.barThrown}>{m.thrown}</Text>}
                    {total === 0     && <Text style={styles.barNone}>—</Text>}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Info */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={15} color={C.textLight} />
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
  container: { flex: 1, backgroundColor: '#F7F5F2' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1A1A' },
  headerSub:   { fontSize: 13, color: C.textMid, marginTop: 3 },

  illustration: { width: 70, height: 52, position: 'relative', marginRight: 4, marginTop: -2 },
  illustEmoji1: { position: 'absolute', right: 0,  top: 0,  fontSize: 36 },
  illustEmoji2: { position: 'absolute', right: 28, top: 14, fontSize: 22 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorText: { color: C.orange, fontSize: 14, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14, paddingBottom: 40 },

  // ── Level card ──
  levelCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
    ...shadowSm,
  },
  levelTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelEmoji: { fontSize: 32 },
  levelInfo: { flex: 1 },
  levelName: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  levelNext: { fontSize: 12, color: C.textLight, marginTop: 2 },
  levelBadge: {
    backgroundColor: C.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  levelBadgeText: { fontSize: 12, fontWeight: '700', color: C.primary },
  levelBarTrack: {
    height: 8,
    backgroundColor: C.primaryMid,
    borderRadius: 4,
    overflow: 'hidden',
  },
  levelBarFill: {
    height: '100%',
    backgroundColor: C.primary,
    borderRadius: 4,
  },
  levelBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  levelStat: { fontSize: 12, color: C.textMid, fontWeight: '500' },

  // ── Score card ──
  scoreCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F0EDE8',
    gap: 8,
    ...shadowSm,
  },
  scoreCardMonth: { fontSize: 13, color: C.textMid, fontWeight: '500' },
  scoreRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreNumber:    { fontSize: 52, fontWeight: '800', lineHeight: 60 },
  scoreRight:     { alignItems: 'flex-end', gap: 4 },
  scoreEmoji:     { fontSize: 32 },
  scoreLabel:     { fontSize: 16, fontWeight: '700' },
  scoreSummary:   { fontSize: 13, color: C.textMid },
  savingsRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  savingsEmoji:   { fontSize: 16 },
  savingsText:    { fontSize: 13, color: '#16a34a', fontWeight: '600' },

  // ── Legend ──
  legendRow: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:  { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: C.textMid },

  // ── Bars ──
  barsCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0EDE8',
    gap: 14,
    ...shadowSm,
  },
  barRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: {
    width: 34, fontSize: 11, color: C.textLight,
    fontWeight: '600', textAlign: 'center', lineHeight: 14,
  },
  barLabelActive: { color: C.primary },
  barYear:  { fontSize: 10, color: C.textLight },
  barTrack: {
    flex: 1, height: 22,
    backgroundColor: '#F0EDE8',
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barFill:    { height: '100%' },
  barEmpty:   { flex: 1, backgroundColor: '#F0EDE8' },
  barNumbers: { width: 50, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  barConsumed: { fontSize: 12, color: C.primary, fontWeight: '600' },
  barThrown:   { fontSize: 12, color: C.red,     fontWeight: '600' },
  barNone:     { fontSize: 12, color: C.textLight },

  // ── Info ──
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#F0EDE8',
  },
  infoText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },
});
