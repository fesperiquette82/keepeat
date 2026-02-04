import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLanguageStore } from '../store/languageStore';
import { useStockStore } from '../store/stockStore';

export default function SettingsScreen() {
  const router = useRouter();
  const { language, setLanguage, t, loadLanguage } = useLanguageStore();
  const { stats, fetchStats } = useStockStore();

  useEffect(() => {
    loadLanguage();
    fetchStats();
  }, []);

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
});
