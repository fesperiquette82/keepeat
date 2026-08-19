import React, { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getThemeColors, getThemeText } from '../utils/theme';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { deleteAccount } from '../utils/accountService';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const T = getThemeText(C);
  const styles = useMemo(() => createStyles(C, T), [C, T]);

  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);

  const [password, setPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleDelete = () => {
    if (!password) {
      setLocalError('Veuillez saisir votre mot de passe pour confirmer.');
      return;
    }
    Alert.alert(
      'Supprimer définitivement le compte ?',
      'Votre compte, votre stock, vos tickets scannés et votre historique seront effacés immédiatement. Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => void confirmDelete(),
        },
      ],
    );
  };

  const confirmDelete = async () => {
    if (!token) return;
    setLocalError(null);
    setIsDeleting(true);
    try {
      await deleteAccount(token, password);
      await logout();
      // La navigation vers /login est gérée par _layout.tsx via le changement d'état user.
    } catch (err: any) {
      setIsDeleting(false);
      if (err?.message?.includes('403') || err?.message === 'Mot de passe incorrect') {
        setLocalError('Mot de passe incorrect.');
      } else {
        setLocalError('Impossible de supprimer le compte pour le moment. Réessayez plus tard.');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} disabled={isDeleting}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Supprimer mon compte</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.content}>
        <View style={styles.warningCard}>
          <Ionicons name="warning-outline" size={22} color="#B91C1C" />
          <Text style={styles.warningText}>
            Cette action est <Text style={styles.bold}>immédiate et définitive</Text>. Elle supprime :
          </Text>
          <View style={styles.list}>
            <Text style={styles.listItem}>• votre compte (e-mail, mot de passe, préférences)</Text>
            <Text style={styles.listItem}>• votre stock alimentaire</Text>
            <Text style={styles.listItem}>• vos tickets de caisse scannés</Text>
            <Text style={styles.listItem}>• votre historique de notifications</Text>
          </View>
          <Text style={styles.warningText}>
            Pensez à exporter vos données avant de continuer si vous souhaitez en garder une copie
            (Réglages → Exporter mes données).
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Confirmez avec votre mot de passe</Text>
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            placeholderTextColor={C.textLight}
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setLocalError(null);
            }}
            editable={!isDeleting}
          />
          {!!localError && <Text style={styles.errorText}>{localError}</Text>}
        </View>

        <TouchableOpacity
          style={[styles.deleteButton, (isDeleting || !password) && styles.deleteButtonDisabled]}
          onPress={handleDelete}
          disabled={isDeleting || !password}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
          )}
          <Text style={styles.deleteButtonText}>
            {isDeleting ? 'Suppression…' : 'Supprimer définitivement mon compte'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, T: ReturnType<typeof getThemeText>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: C.text },
  content: { padding: 16, gap: 14 },
  warningCard: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 14, gap: 8 },
  warningText: { color: '#7F1D1D', fontSize: 13.5, lineHeight: 19 },
  bold: { fontWeight: '800' },
  list: { gap: 2, paddingLeft: 4 },
  listItem: { color: '#7F1D1D', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 8 },
  label: { color: C.text, fontSize: 14, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: C.text,
  },
  errorText: { color: '#B91C1C', fontSize: 12.5, fontWeight: '600' },
  deleteButton: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteButtonDisabled: { opacity: 0.55 },
  deleteButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14.5 },
});
