import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

export default function SettingsScreen() {
  const router = useRouter();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { stats, fetchStats } = useStockStore();
  const { user, logout, token } = useAuthStore();
  const [lastRecallCheck, setLastRecallCheck] = useState<string | null>(null);

  const fr = language === 'fr';

  useEffect(() => {
    loadLanguage();
    fetchStats();
    if (token) {
      fetch(`${API_URL}/api/recalls/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => setLastRecallCheck(data.last_check ?? null))
        .catch(() => {});
    }
  }, []);

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
            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#f59e0b20' }]}>
                <Ionicons name="alert-circle-outline" size={22} color="#f59e0b" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>
                  {fr ? 'Produits rappelés' : 'Recalled products'}
                </Text>
                <Text style={styles.alertDesc}>
                  {fr
                    ? 'Vérification toutes les 6h sur rappel.conso.gouv.fr'
                    : 'Checked every 6h on rappel.conso.gouv.fr'}
                </Text>
                <Text style={styles.alertLastCheck}>
                  {fr ? 'Dernière vérification : ' : 'Last check: '}
                  <Text style={styles.alertLastCheckValue}>{formatLastCheck(lastRecallCheck)}</Text>
                </Text>
              </View>
            </View>

            <View style={styles.alertDivider} />

            <View style={styles.alertRow}>
              <View style={[styles.alertIconWrapper, { backgroundColor: '#3b82f620' }]}>
                <Ionicons name="time-outline" size={22} color="#3b82f6" />
              </View>
              <View style={styles.alertInfo}>
                <Text style={styles.alertTitle}>
                  {fr ? 'Inactivité' : 'Inactivity'}
                </Text>
                <Text style={styles.alertDesc}>
                  {fr
                    ? 'Rappel si aucune action sur votre stock depuis 7 jours'
                    : 'Reminder if no stock action in 7 days'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('about')}</Text>
          <View style={styles.aboutCard}>
            <View style={styles.appInfo}>
              <View style={styles.appLogo}>
                <Ionicons name="leaf" size={32} color="#22c55e" />
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
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
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
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
