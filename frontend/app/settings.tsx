import React, { useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { C, T } from '../utils/theme';
import { useAppSettingsStore, type ReminderLeadDays } from '../store/appSettingsStore';

function formatLastUpdate(value: string | null): string {
  if (!value) return 'Pas encore mis à jour';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Pas encore mis à jour';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SettingsScreen() {
  const router = useRouter();
  const {
    language,
    householdSize,
    productRemindersEnabled,
    reminderDaysBefore,
    lastRemindersUpdate,
    setLanguage,
    setHouseholdSize,
    setProductRemindersEnabled,
    setReminderDaysBefore,
  } = useAppSettingsStore();

  const reminderOptions: ReminderLeadDays[] = useMemo(() => [1, 2, 3], []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Paramètres</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Langue</Text>
          <View style={styles.rowWrap}>
            <TouchableOpacity style={[styles.chip, language === 'fr' && styles.chipActive]} onPress={() => setLanguage('fr')}>
              <Text style={[styles.chipText, language === 'fr' && styles.chipTextActive]}>🇫🇷 Français</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, language === 'en' && styles.chipActive]} onPress={() => setLanguage('en')}>
              <Text style={[styles.chipText, language === 'en' && styles.chipTextActive]}>🇬🇧 English</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Nombre de personnes du foyer</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity style={styles.counterBtn} onPress={() => setHouseholdSize(householdSize - 1)}>
              <Ionicons name="remove" size={16} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.counterValue}>{householdSize} personnes</Text>
            <TouchableOpacity style={styles.counterBtn} onPress={() => setHouseholdSize(householdSize + 1)}>
              <Ionicons name="add" size={16} color={C.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Valeur par défaut utilisée pour les recettes.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inlineRow}>
            <Text style={styles.sectionTitle}>Rappels produits</Text>
            <Switch
              trackColor={{ false: '#D1D5DB', true: '#86EFAC' }}
              thumbColor={productRemindersEnabled ? '#16A34A' : '#F3F4F6'}
              value={productRemindersEnabled}
              onValueChange={(enabled) => setProductRemindersEnabled(enabled)}
            />
          </View>

          <Text style={styles.subLabel}>Délai avant péremption</Text>
          <View style={styles.rowWrap}>
            {reminderOptions.map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.chip, reminderDaysBefore === days && styles.chipActive]}
                onPress={() => setReminderDaysBefore(days)}
                disabled={!productRemindersEnabled}
              >
                <Text style={[styles.chipText, reminderDaysBefore === days && styles.chipTextActive, !productRemindersEnabled && styles.disabledText]}>
                  J-{days}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.systemInfo}>Dernière mise à jour des rappels : {formatLastUpdate(lastRemindersUpdate)}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  systemInfo: { color: C.textLight, fontSize: 12, fontWeight: '500' },
});
