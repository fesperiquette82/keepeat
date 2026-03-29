import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';
import { useAuthStore } from '../store/authStore';
import { buildApiUrl } from '../utils/config';
import { APP_CONFIG } from '../utils/appConfig';
import { logger } from '../utils/logger';
import { runAllDiagnosticChecks, type DiagnosticCheckResult } from '../utils/diagnostics/healthChecks';

const ALERT_PREFS_KEY = 'keepeat_alert_prefs';

export default function SettingsScreen() {
  const router = useRouter();
  const language = useLanguageStore(state => state.language);
  const setLanguage = useLanguageStore(state => state.setLanguage);
  const t = useLanguageStore(state => state.t);
  const loadLanguage = useLanguageStore(state => state.loadLanguage);
  const stats = useStockStore(state => state.stats);
  const fetchStats = useStockStore(state => state.fetchStats);
  const pendingMutations = useStockStore(state => state.pendingMutations);
  const isOnline = useStockStore(state => state.isOnline);
  const pendingMutationsCount = pendingMutations.length;
  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);
  const token = useAuthStore(state => state.token);
  const [lastRecallCheck, setLastRecallCheck] = useState<string | null>(null);
  const [alertJ2,       setAlertJ2]       = useState(true);
  const [alertJ0,       setAlertJ0]       = useState(true);
  const [alertWeekly,   setAlertWeekly]   = useState(false);
  const [alertRecall,   setAlertRecall]   = useState(true);
  const [diagnosticResults, setDiagnosticResults] = useState<DiagnosticCheckResult[]>([]);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);

  const fr = language === 'fr';
  const loadAlertPrefs = useMemo(() => async () => {
    const raw = await AsyncStorage.getItem(ALERT_PREFS_KEY);
    if (!raw) return;
    try {
      const prefs = JSON.parse(raw);
      if (prefs.alertJ2     !== undefined) setAlertJ2(prefs.alertJ2);
      if (prefs.alertJ0     !== undefined) setAlertJ0(prefs.alertJ0);
      if (prefs.alertWeekly !== undefined) setAlertWeekly(prefs.alertWeekly);
      if (prefs.alertRecall !== undefined) setAlertRecall(prefs.alertRecall);
    } catch {}
  }, []);

  useEffect(() => {
    loadLanguage();
    fetchStats();
    if (token) {
      fetch(buildApiUrl('/api/recalls/status'), {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => setLastRecallCheck(data.last_check ?? null))
        .catch((err) => {
          logger.warn('[Settings] recalls status unavailable', { message: err instanceof Error ? err.message : String(err) });
        });
    }
    loadAlertPrefs().catch((err) => {
      logger.warn('[Settings] load alert prefs failed', { message: err instanceof Error ? err.message : String(err) });
    });
  }, [fetchStats, loadAlertPrefs, loadLanguage, token]);

  const saveAlertPrefs = (patch: object) => {
    const current = { alertJ2, alertJ0, alertWeekly, alertRecall, ...patch };
    AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(current)).catch((err) => {
      logger.warn('[Settings] save alert prefs failed', { message: err instanceof Error ? err.message : String(err) });
    });
  };

  const runDiagnostics = useCallback(async () => {
    if (!APP_CONFIG.enableDiagnosticScreen) return;
    setIsRunningDiagnostics(true);
    try {
      const results = await runAllDiagnosticChecks({
        token,
        pendingMutationsCount,
        isOnline,
      });
      setDiagnosticResults(results);
      logger.info('[Diagnostics] checks completed', {
        total: results.length,
        ok: results.filter(r => r.status === 'ok').length,
        warn: results.filter(r => r.status === 'warn').length,
        error: results.filter(r => r.status === 'error').length,
      });
    } finally {
      setIsRunningDiagnostics(false);
    }
  }, [isOnline, pendingMutationsCount, token]);

  useEffect(() => {
    if (APP_CONFIG.enableDiagnosticScreen) {
      runDiagnostics().catch((err) => {
        logger.warn('[Diagnostics] initial run failed', { message: err instanceof Error ? err.message : String(err) });
      });
    }
  }, [runDiagnostics]);

  const statusStyle = (status: DiagnosticCheckResult['status']) => {
    if (status === 'ok') return styles.diagStatusOk;
    if (status === 'warn') return styles.diagStatusWarn;
    return styles.diagStatusError;
  };

  const formatLastCheck = (iso: string | null): string => {
    if (!iso) return fr ? 'Jamais effectuée' : 'Never performed';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 1) return fr ? 'À l\'instant' : 'Just now';
    if (diff < 60) return fr ? `Il y a ${diff} min` : `${diff} min ago`;
    const h = Math.floor(diff / 60);
    if (h < 24) return fr ? `Il y a ${h}h` : `${h}h ago`;
    const d = Math.floor(h / 24);
    return fr ? `Il y a ${d} jour${d > 1 ? 's' : ''}` : `${d} day${d > 1 ? 's' : ''} ago`;
  };

  const handleLogout = () => {
    Alert.alert(
      fr ? 'Déconnexion' : 'Sign out',
      fr ? 'Voulez-vous vous déconnecter ?' : 'Do you want to sign out?',
      [
        { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
        {
          text: fr ? 'Se déconnecter' : 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            // La navigation est gérée par _layout.tsx
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Account Section */}
        {user && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{fr ? 'Compte' : 'Account'}</Text>
            <View style={styles.accountCard}>
              <View style={styles.accountRow}>
                <View style={styles.accountIconWrapper}>
                  <Ionicons name="person-circle-outline" size={28} color="#22c55e" />
                </View>
                <View style={styles.accountInfo}>
                  <Text style={styles.accountEmail}>{user.email}</Text>
                  <View style={[styles.licenseBadge, user.is_premium ? styles.licensePremium : styles.licenseFree]}>
                    <Ionicons
                      name={user.is_premium ? 'star' : 'star-outline'}
                      size={12}
                      color={user.is_premium ? '#f59e0b' : '#666'}
                    />
                    <Text style={[styles.licenseText, user.is_premium ? styles.licenseTextPremium : styles.licenseTextFree]}>
                      {user.is_premium ? 'Premium' : (fr ? 'Gratuit' : 'Free')}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={18} color="#ef4444" />
                <Text style={styles.logoutText}>{fr ? 'Se déconnecter' : 'Sign out'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Language Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('language')}</Text>
          <View style={styles.languageOptions}>
            <TouchableOpacity
              style={[styles.languageButton, language === 'fr' && styles.languageButtonActive]}
              onPress={() => setLanguage('fr')}
            >
              <Text style={styles.flagText}>🇫🇷</Text>
              <Text style={[styles.languageText, language === 'fr' && styles.languageTextActive]}>
                {t('french')}
              </Text>
              {language === 'fr' && (
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.languageButton, language === 'en' && styles.languageButtonActive]}
              onPress={() => setLanguage('en')}
            >
              <Text style={styles.flagText}>🇬🇧</Text>
              <Text style={[styles.languageText, language === 'en' && styles.languageTextActive]}>
                {t('english')}
              </Text>
              {language === 'en' && (
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {APP_CONFIG.enableDiagnosticScreen && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{fr ? 'Diagnostic interne' : 'Internal diagnostics'}</Text>
            <View style={styles.debugCard}>
              <Text style={styles.debugTitle}>{fr ? 'Flags actifs' : 'Active flags'}</Text>
              <Text style={styles.debugLine}>appVariant: {APP_CONFIG.appVariant}</Text>
              <Text style={styles.debugLine}>enableDebugTools: {String(APP_CONFIG.enableDebugTools)}</Text>
              <Text style={styles.debugLine}>enableVerboseLogs: {String(APP_CONFIG.enableVerboseLogs)}</Text>
              <Text style={styles.debugLine}>enableDiagnosticScreen: {String(APP_CONFIG.enableDiagnosticScreen)}</Text>
              <Text style={styles.debugLine}>enableNetworkTracing: {String(APP_CONFIG.enableNetworkTracing)}</Text>

              <TouchableOpacity
                style={[styles.diagRefreshBtn, isRunningDiagnostics && styles.diagRefreshBtnDisabled]}
                onPress={() => runDiagnostics().catch((err) => logger.warn('[Diagnostics] rerun failed', { message: err instanceof Error ? err.message : String(err) }))}
                disabled={isRunningDiagnostics}
              >
                <Text style={styles.diagRefreshText}>
                  {isRunningDiagnostics
                    ? (fr ? 'Checks en cours…' : 'Checks running…')
                    : (fr ? 'Relancer tous les checks' : 'Rerun all checks')}
                </Text>
              </TouchableOpacity>

              {diagnosticResults.map((result) => (
                <View key={result.key} style={styles.diagResultCard}>
                  <View style={styles.diagHeaderRow}>
                    <Text style={styles.diagLabel}>{result.label}</Text>
                    <Text style={[styles.diagStatus, statusStyle(result.status)]}>{result.status.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.diagSummary}>{result.summary}</Text>
                  <Text style={styles.diagDetails}>
                    {result.details} · {result.durationMs}ms
                  </Text>
                  {result.error ? <Text style={styles.diagError}>err: {result.error}</Text> : null}
                  <Text style={styles.diagTimestamp}>{new Date(result.timestamp).toLocaleTimeString()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Statistics Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('statistics')}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: '#22c55e20' }]}>
                <Ionicons name="cube" size={24} color="#22c55e" />
              </View>
              <Text style={styles.statValue}>{stats.total_items}</Text>
              <Text style={styles.statLabel}>{t('inStock')}</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: '#3b82f620' }]}>
                <Ionicons name="checkmark-done" size={24} color="#3b82f6" />
              </View>
              <Text style={styles.statValue}>{stats.consumed_this_week}</Text>
              <Text style={styles.statLabel}>{t('consumedThisWeek')}</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: '#ef444420' }]}>
                <Ionicons name="trash" size={24} color="#ef4444" />
              </View>
              <Text style={styles.statValue}>{stats.thrown_this_week}</Text>
              <Text style={styles.statLabel}>{t('thrownThisWeek')}</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: '#eab30820' }]}>
                <Ionicons name="warning" size={24} color="#eab308" />
              </View>
              <Text style={styles.statValue}>{stats.expiring_soon}</Text>
              <Text style={styles.statLabel}>{t('expiringSoon')}</Text>
            </View>
          </View>
        </View>

        {/* Push Alerts Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{fr ? 'Alertes push' : 'Push alerts'}</Text>
          <View style={styles.alertsCard}>

            {/* J-2 */}
            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#f97316' + '20' }]}>
                <Ionicons name="alarm-outline" size={22} color="#f97316" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>{fr ? 'Alerte J-2' : '2 days before'}</Text>
                <Text style={styles.alertDesc}>{fr ? 'Notifie 2 jours avant la date de péremption' : 'Notify 2 days before expiry'}</Text>
              </View>
              <Switch
                value={alertJ2}
                onValueChange={v => { setAlertJ2(v); saveAlertPrefs({ alertJ2: v }); }}
                trackColor={{ false: '#E5E7EB', true: '#86efac' }}
                thumbColor={alertJ2 ? '#22c55e' : '#9CA3AF'}
              />
            </View>

            <View style={styles.alertDivider} />

            {/* J-0 */}
            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#ef444420' }]}>
                <Ionicons name="alert-circle-outline" size={22} color="#ef4444" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>{fr ? "Alerte J-0 (aujourd'hui)" : 'Expiry day alert'}</Text>
                <Text style={styles.alertDesc}>{fr ? "Notifie le jour même de la péremption" : 'Notify on the expiry day'}</Text>
              </View>
              <Switch
                value={alertJ0}
                onValueChange={v => { setAlertJ0(v); saveAlertPrefs({ alertJ0: v }); }}
                trackColor={{ false: '#E5E7EB', true: '#86efac' }}
                thumbColor={alertJ0 ? '#22c55e' : '#9CA3AF'}
              />
            </View>

            <View style={styles.alertDivider} />

            {/* Récap hebdo */}
            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#7c3aed20' }]}>
                <Ionicons name="bar-chart-outline" size={22} color="#7c3aed" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>{fr ? 'Récap hebdomadaire' : 'Weekly summary'}</Text>
                <Text style={styles.alertDesc}>{fr ? 'Bilan du gaspillage chaque lundi matin' : 'Waste recap every Monday morning'}</Text>
              </View>
              <Switch
                value={alertWeekly}
                onValueChange={v => { setAlertWeekly(v); saveAlertPrefs({ alertWeekly: v }); }}
                trackColor={{ false: '#E5E7EB', true: '#86efac' }}
                thumbColor={alertWeekly ? '#22c55e' : '#9CA3AF'}
              />
            </View>

            <View style={styles.alertDivider} />

            {/* Rappels produits */}
            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#f59e0b20' }]}>
                <Ionicons name="shield-checkmark-outline" size={22} color="#f59e0b" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>{fr ? 'Rappels produits' : 'Product recalls'}</Text>
                <Text style={styles.alertDesc}>
                  {fr ? 'Vérification toutes les 6h · rappel.conso.gouv.fr' : 'Checked every 6h · rappel.conso.gouv.fr'}
                </Text>
                <Text style={styles.alertLastCheck}>
                  {fr ? 'Dernière vérif. : ' : 'Last check: '}
                  <Text style={styles.alertLastCheckValue}>{formatLastCheck(lastRecallCheck)}</Text>
                </Text>
              </View>
              <Switch
                value={alertRecall}
                onValueChange={v => { setAlertRecall(v); saveAlertPrefs({ alertRecall: v }); }}
                trackColor={{ false: '#E5E7EB', true: '#86efac' }}
                thumbColor={alertRecall ? '#22c55e' : '#9CA3AF'}
              />
            </View>

          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('about')}</Text>
          <View style={styles.aboutCard}>
            <View style={styles.appInfo}>
              <View style={styles.appLogo}>
                <Image
                  source={require('../assets/images/branding/keepeat-logo.png')}
                  style={styles.appLogoImage}
                  resizeMode="contain"
                />
              </View>
              <View>
                <Text style={styles.appName}>KeepEat</Text>
                <Text style={styles.appTagline}>
                  {language === 'fr' ? 'Vos aliments, au bon moment' : 'Your food, at the right time'}
                </Text>
              </View>
            </View>
            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>{t('version')}</Text>
              <Text style={styles.versionValue}>1.0.0 (MVP)</Text>
            </View>
          </View>
        </View>

        {/* Features Description */}
        <View style={styles.section}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="barcode-outline" size={20} color="#22c55e" />
              <Text style={styles.featureText}>
                {language === 'fr' 
                  ? 'Scan code-barres via Open Food Facts' 
                  : 'Barcode scan via Open Food Facts'}
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="calendar-outline" size={20} color="#22c55e" />
              <Text style={styles.featureText}>
                {language === 'fr' 
                  ? 'Suivi des dates de péremption' 
                  : 'Expiry date tracking'}
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="notifications-outline" size={20} color="#22c55e" />
              <Text style={styles.featureText}>
                {language === 'fr' 
                  ? 'Alertes visuelles (J-2 / J-0)' 
                  : 'Visual alerts (2 days / Today)'}
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="trending-down-outline" size={20} color="#22c55e" />
              <Text style={styles.featureText}>
                {language === 'fr' 
                  ? 'Réduisez le gaspillage alimentaire' 
                  : 'Reduce food waste'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  backButton: {
    padding: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  accountCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountIconWrapper: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DCFCE7',
  },
  accountInfo: { flex: 1, gap: 6 },
  accountEmail: { color: '#111827', fontSize: 14, fontWeight: '700' },
  licenseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  licensePremium: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  licenseFree: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  licenseText: { fontSize: 11, fontWeight: '700' },
  licenseTextPremium: { color: '#D97706' },
  licenseTextFree: { color: '#6B7280' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  logoutText: { color: '#EF4444', fontSize: 14, fontWeight: '700' },

  languageOptions: {
    gap: 10,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  languageButtonActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#22c55e',
  },
  flagText: {
    fontSize: 26,
  },
  languageText: {
    fontSize: 16,
    color: '#6B7280',
    flex: 1,
    fontWeight: '500',
  },
  languageTextActive: {
    color: '#111827',
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    width: '47%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '500',
  },
  aboutCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  appInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  appLogo: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  appLogoImage: {
    width: 64,
    height: 64,
  },
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  appTagline: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  versionLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  versionValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  featuresList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
    fontWeight: '500',
  },
  alertsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  debugCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  debugTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  debugLine: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '500',
  },
  diagRefreshBtn: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  diagRefreshBtnDisabled: {
    opacity: 0.6,
  },
  diagRefreshText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  diagResultCard: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    gap: 3,
  },
  diagHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  diagLabel: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  diagStatus: {
    fontSize: 10,
    fontWeight: '800',
  },
  diagStatusOk: {
    color: '#86efac',
  },
  diagStatusWarn: {
    color: '#fcd34d',
  },
  diagStatusError: {
    color: '#fca5a5',
  },
  diagSummary: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
  },
  diagDetails: {
    color: '#9ca3af',
    fontSize: 11,
  },
  diagError: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '600',
  },
  diagTimestamp: {
    color: '#6b7280',
    fontSize: 10,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  alertIconWrapper: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  alertInfo: {
    flex: 1,
    gap: 3,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  alertDesc: {
    fontSize: 13,
    color: '#6B7280',
  },
  alertLastCheck: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  alertLastCheckValue: {
    color: '#22c55e',
    fontWeight: '600',
  },
  alertDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
});
