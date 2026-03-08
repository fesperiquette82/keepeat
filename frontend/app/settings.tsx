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
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  accountCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#22c55e15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInfo: { flex: 1, gap: 6 },
  accountEmail: { color: '#fff', fontSize: 14, fontWeight: '600' },
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
  licensePremium: { backgroundColor: '#f59e0b15', borderColor: '#f59e0b40' },
  licenseFree: { backgroundColor: '#ffffff08', borderColor: '#333' },
  licenseText: { fontSize: 11, fontWeight: '700' },
  licenseTextPremium: { color: '#f59e0b' },
  licenseTextFree: { color: '#666' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  logoutText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },

  languageOptions: {
    gap: 10,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  languageButtonActive: {
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
  },
  flagText: {
    fontSize: 24,
  },
  languageText: {
    fontSize: 16,
    color: '#888',
    flex: 1,
  },
  languageTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    width: '47%',
    alignItems: 'center',
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
  },
  aboutCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
  },
  appInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  appLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#22c55e20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  appTagline: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  versionLabel: {
    fontSize: 14,
    color: '#888',
  },
  versionValue: {
    fontSize: 14,
    color: '#fff',
  },
  featuresList: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#ccc',
    flex: 1,
  },
  alertsCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  alertIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    fontWeight: '600',
    color: '#fff',
  },
  alertDesc: {
    fontSize: 13,
    color: '#888',
  },
  alertLastCheck: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  alertLastCheckValue: {
    color: '#22c55e',
    fontWeight: '500',
  },
  alertDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
  },
});
