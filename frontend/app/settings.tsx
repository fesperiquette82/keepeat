import React, { useCallback, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { getThemeColors, getThemeText } from '../utils/theme';
import { useAppSettingsStore, type ReminderLeadDays } from '../store/appSettingsStore';
import { useStockStore } from '../store/stockStore';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { restorePremiumPurchase } from '../utils/billingService';
import { isAdminUser } from '../utils/adminAccess';
import { logger } from '../utils/logger';
import { resolvePremiumStatus } from '../utils/premiumStatus';
import { buildLogoutConfirmationCopy } from '../utils/settingsLogout';
import { shareDebugLogsToGitHub } from '../utils/debugLogsGitHubSync';
import { uploadDebugLogsToBackend } from '../utils/debugLogsBackendUpload';
import { exportAccountData } from '../utils/accountService';
import { saveAndShareAccountExport } from '../utils/accountExportFile';

function formatLastUpdate(value: string | null, language: 'fr' | 'en', fallbackText: string): string {
  if (!value) return fallbackText;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackText;
  return date.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPremiumDate(value: string, language: 'fr' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function SettingsScreen() {
  const router = useRouter();
  const [debugLogsUploading, setDebugLogsUploading] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const {
    language,
    householdSize,
    productRemindersEnabled,
    reminderDaysBefore,
    lastReminderRefreshAt,
    reminderRefreshLoading,
    reminderRefreshError,
    reminderRefreshSuccessAt,
    setLanguage,
    setHouseholdSize,
    setProductRemindersEnabled,
    setReminderDaysBefore,
    forceRefreshReminderProducts,
    themeMode,
    setThemeMode,
  } = useAppSettingsStore();
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);
  const isRefreshingPriorityItems = useStockStore((state) => state.isRefreshingPriorityItems);
  const refreshInProgress = reminderRefreshLoading || isRefreshingPriorityItems;
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const refreshEntitlements = useAuthStore((state) => state.refreshEntitlements);
  const logout = useAuthStore((state) => state.logout);
  const entitlements = useAuthStore((state) => state.entitlements);
  const plan = useAuthStore((state) => state.plan);
  const authError = useAuthStore((state) => state.error);
  const canAccessAdmin = isAdminUser(user);
  const { t } = useLanguageStore();
  const onPressRefreshRecalls = useCallback(() => {
    logger.info('[SETTINGS] refresh button pressed');
    logger.info('[SETTINGS] calling forceRefreshReminderProducts');
    void forceRefreshReminderProducts();
  }, [forceRefreshReminderProducts]);

  const onPressExportDebugLogs = useCallback(async () => {
    setDebugLogsUploading(true);
    try {
      const result = await shareDebugLogsToGitHub();
      if (result.success) {
        Alert.alert('Debug Logs Uploaded', result.message, [
          { text: 'OK', style: 'default' },
          ...(result.url ? [{ text: 'Open Issue', onPress: () => {
            // TODO: Open URL in browser
            logger.info('[SETTINGS] Issue URL', { url: result.url });
          } }] : []),
        ]);
      } else {
        Alert.alert('Upload Failed', result.message);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to upload logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDebugLogsUploading(false);
    }
  }, []);

  const onPressUploadDebugLogsToBackend = useCallback(async () => {
    setDebugLogsUploading(true);
    try {
      const result = await uploadDebugLogsToBackend();
      if (result.success) {
        Alert.alert('Debug Logs Uploaded', result.message);
      } else {
        Alert.alert('Upload Failed', result.message);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to upload logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDebugLogsUploading(false);
    }
  }, []);

  const reminderOptions: ReminderLeadDays[] = useMemo(() => [1, 2, 3], []);
  const premiumStatus = useMemo(() => resolvePremiumStatus({
    token,
    plan,
    user,
    entitlements,
    error: authError,
  }), [authError, entitlements, plan, token, user]);
  const premiumDateText = useMemo(() => {
    if (!premiumStatus.premiumDate || !premiumStatus.premiumDateKind) return null;
    const label = premiumStatus.premiumDateKind === 'renewal'
      ? t('premiumRenewsOn')
      : t('premiumExpiresOn');
    return `${label} ${formatPremiumDate(premiumStatus.premiumDate, language)}`;
  }, [language, premiumStatus.premiumDate, premiumStatus.premiumDateKind, t]);
  const logoutConfirmation = useMemo(() => buildLogoutConfirmationCopy(t), [t]);
  const onPressLogout = useCallback(() => {
    Alert.alert(
      logoutConfirmation.title,
      logoutConfirmation.message,
      [
        { text: logoutConfirmation.cancelLabel, style: 'cancel' },
        {
          text: logoutConfirmation.confirmLabel,
          style: 'destructive',
          onPress: () => {
            void logout().catch(() => {
              Alert.alert(t('errorTitle'), t('logoutErrorMessage'));
            });
          },
        },
      ],
    );
  }, [logout, logoutConfirmation, t]);

  const onPressExportData = useCallback(async () => {
    if (!token) return;
    setExportingData(true);
    try {
      const payload = await exportAccountData(token);
      const shared = await saveAndShareAccountExport(payload);
      if (!shared) {
        Alert.alert(t('exportDataSuccess'), t('exportDataUnavailable'));
      }
    } catch {
      Alert.alert(t('errorTitle'), t('exportDataError'));
    } finally {
      setExportingData(false);
    }
  }, [t, token]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('settingsTitle')}</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('languageSection')}</Text>
          <View style={styles.rowWrap}>
            <TouchableOpacity style={[styles.chip, language === 'fr' && styles.chipActive]} onPress={() => setLanguage('fr')}>
              <Text style={[styles.chipText, language === 'fr' && styles.chipTextActive]}>🇫🇷 {t('french')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, language === 'en' && styles.chipActive]} onPress={() => setLanguage('en')}>
              <Text style={[styles.chipText, language === 'en' && styles.chipTextActive]}>🇬🇧 {t('english')}</Text>
            </TouchableOpacity>
          </View>
        </View>


        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('themeSection')}</Text>
          <View style={styles.rowWrap}>
            <TouchableOpacity style={[styles.chip, themeMode === 'light' && styles.chipActive]} onPress={() => setThemeMode('light')}>
              <Text style={[styles.chipText, themeMode === 'light' && styles.chipTextActive]}>{t('themeLight')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, themeMode === 'dark' && styles.chipActive]} onPress={() => setThemeMode('dark')}>
              <Text style={[styles.chipText, themeMode === 'dark' && styles.chipTextActive]}>{t('themeDark')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('householdSize')}</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity style={styles.counterBtn} onPress={() => setHouseholdSize(householdSize - 1)}>
              <Ionicons name="remove" size={16} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.counterValue}>{t('peopleCount', { count: householdSize })}</Text>
            <TouchableOpacity style={styles.counterBtn} onPress={() => setHouseholdSize(householdSize + 1)}>
              <Ionicons name="add" size={16} color={C.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>{t('defaultRecipeHint')}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inlineRow}>
            <Text style={styles.sectionTitle}>{t('productReminders')}</Text>
            <Switch
              trackColor={{ false: '#D1D5DB', true: '#86EFAC' }}
              thumbColor={productRemindersEnabled ? '#16A34A' : '#F3F4F6'}
              value={productRemindersEnabled}
              onValueChange={(enabled) => setProductRemindersEnabled(enabled)}
            />
          </View>

          <Text style={styles.subLabel}>{t('reminderLeadTime')}</Text>
          <View style={styles.rowWrap}>
            {reminderOptions.map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.chip, reminderDaysBefore === days && styles.chipActive]}
                onPress={() => setReminderDaysBefore(days)}
                disabled={!productRemindersEnabled || isRefreshingPriorityItems}
              >
                <Text style={[styles.chipText, reminderDaysBefore === days && styles.chipTextActive, (!productRemindersEnabled || isRefreshingPriorityItems) && styles.disabledText]}>
                  J-{days}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.systemInfo}>
            {t('remindersLastUpdate', { date: formatLastUpdate(lastReminderRefreshAt, language, t('notUpdatedYet')) })}
          </Text>

          <TouchableOpacity
            style={[styles.refreshButton, refreshInProgress && styles.refreshButtonDisabled]}
            onPress={onPressRefreshRecalls}
            disabled={refreshInProgress}
          >
            {refreshInProgress ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
            )}
              <Text style={styles.refreshButtonText}>
              {refreshInProgress ? t('updateInProgress') : t('updateNow')}
            </Text>
          </TouchableOpacity>

          {!!reminderRefreshSuccessAt && (
            <Text style={styles.successText}>
              {t('remindersUpdatedSuccess')}
            </Text>
          )}
          {!!reminderRefreshError && <Text style={styles.errorText}>{reminderRefreshError}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('premium')}</Text>
          {premiumStatus.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#16A34A" />
              <Text style={styles.systemInfo}>{t('premiumStatusLoading')}</Text>
            </View>
          ) : premiumStatus.isPremiumActive ? (
            <>
              <Text style={styles.systemInfo}>{t('currentPlanPremium')}</Text>
              <Text style={styles.systemInfo}>{t('premiumStatusActive')}</Text>
              {!!premiumDateText && <Text style={styles.systemInfo}>{premiumDateText}</Text>}
            </>
          ) : (
            <>
              <Text style={styles.systemInfo}>{t('currentPlan', { plan })}</Text>
              <TouchableOpacity style={styles.refreshButton} onPress={() => router.push('/premium')}>
                <Ionicons name="diamond-outline" size={16} color="#FFFFFF" />
                <Text style={styles.refreshButtonText}>{t('upgradePremium')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.restoreButton}
                onPress={async () => {
                  if (!token) return;
                  try {
                    await restorePremiumPurchase(token);
                    await refreshEntitlements();
                    Alert.alert(t('restoreTitle'), t('restoreSuccess'));
                  } catch {
                    Alert.alert(t('errorTitle'), t('restoreError'));
                  }
                }}
              >
                <Text style={styles.restoreButtonText}>{t('restorePurchases')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {canAccessAdmin && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('adminSection')}</Text>
            <Text style={styles.systemInfo}>{t('adminMonitoringAccess')}</Text>
            <TouchableOpacity style={styles.refreshButton} onPress={() => router.push('/admin')}>
              <Ionicons name="analytics-outline" size={16} color="#FFFFFF" />
              <Text style={styles.refreshButtonText}>{t('openMonitoringBackoffice')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Debug</Text>
          <Text style={styles.systemInfo}>Export swipe gesture debug logs for troubleshooting</Text>
          <TouchableOpacity
            style={[styles.refreshButton, debugLogsUploading && styles.disabledButton]}
            onPress={onPressUploadDebugLogsToBackend}
            disabled={debugLogsUploading}
          >
            {debugLogsUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.refreshButtonText}>
              {debugLogsUploading ? 'Uploading...' : '📤 Upload Logs to Backend'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.refreshButton, debugLogsUploading && styles.disabledButton]}
            onPress={onPressExportDebugLogs}
            disabled={debugLogsUploading}
          >
            {debugLogsUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="logo-github" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.refreshButtonText}>
              {debugLogsUploading ? 'Uploading...' : '📤 Export to GitHub'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('accountSection')}</Text>

          <Text style={styles.systemInfo}>{t('exportDataHint')}</Text>
          <TouchableOpacity
            style={[styles.exportButton, exportingData && styles.disabledButton]}
            onPress={onPressExportData}
            disabled={exportingData}
          >
            {exportingData ? (
              <ActivityIndicator size="small" color="#166534" />
            ) : (
              <Ionicons name="download-outline" size={16} color="#166534" />
            )}
            <Text style={styles.exportButtonText}>{t('exportDataButton')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutButton} onPress={onPressLogout}>
            <Ionicons name="log-out-outline" size={16} color="#FFFFFF" />
            <Text style={styles.logoutButtonText}>{t('logoutButton')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-delete-account-button"
            style={styles.deleteAccountButton}
            onPress={() => router.push('/delete-account')}
          >
            <Ionicons name="trash-outline" size={16} color="#DC2626" />
            <Text style={styles.deleteAccountButtonText}>{t('deleteAccountButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '800', color: C.text },
  content: { padding: 16, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  subLabel: { color: C.textMid, fontSize: 13, fontWeight: '600' },
  rowWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  chipActive: { borderColor: '#22C55E', backgroundColor: '#DCFCE7' },
  chipText: { color: C.textMid, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#166534' },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counterBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  counterValue: { color: C.text, fontWeight: '700', fontSize: 16 },
  hint: { ...T.secondarySmall },
  inlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  disabledText: { opacity: 0.5 },
  disabledButton: { opacity: 0.6 },
  systemInfo: { color: C.textLight, fontSize: 12, fontWeight: '500' },
  refreshButton: {
    marginTop: 4,
    backgroundColor: '#16A34A',
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshButtonDisabled: { opacity: 0.7 },
  refreshButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  restoreButton: { borderWidth: 1, borderColor: '#16A34A', borderRadius: 10, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoutButton: {
    marginTop: 4,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  exportButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#16A34A',
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
  },
  exportButtonText: { color: '#166534', fontWeight: '700', fontSize: 14 },
  deleteAccountButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
  },
  deleteAccountButtonText: { color: '#DC2626', fontWeight: '700', fontSize: 14 },
  restoreButtonText: { color: '#166534', fontWeight: '700', fontSize: 14 },
  successText: { color: '#166534', fontSize: 12, fontWeight: '500' },
  errorText: { color: '#B91C1C', fontSize: 12, fontWeight: '500' },
});
