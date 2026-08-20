import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { fetchEmailImportAddress } from '../utils/emailImportApi';

export default function EmailImportScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const [address, setAddress] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchEmailImportAddress(token);
      setConfigured(result.configured);
      setAddress(result.address);
    } catch (err: any) {
      if (err?.message === 'email_import_address_failed_403') {
        setError('premium_required');
      } else {
        setError('unknown');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleShare = async () => {
    if (!address) return;
    try {
      await Share.share({ message: address });
    } catch {
      // best-effort — l'adresse reste affichée à l'écran même si le partage échoue
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Import automatique des tickets</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.description}>
          Transférez vos tickets de caisse reçus par email vers l&apos;adresse ci-dessous
          (fonctionnalité premium). Les articles sont automatiquement ajoutés à votre stock,
          sans que vous ayez à ouvrir l&apos;app.
        </Text>

        {isLoading ? (
          <ActivityIndicator style={styles.loader} color="#16A34A" />
        ) : error === 'premium_required' ? (
          <Text style={styles.errorText}>
            L&apos;import automatique est réservé aux abonnés Premium.
          </Text>
        ) : error === 'unknown' ? (
          <Text style={styles.errorText}>Impossible de récupérer votre adresse d&apos;import.</Text>
        ) : !configured ? (
          <Text style={styles.errorText}>
            L&apos;import automatique n&apos;est pas encore disponible pour cette version de l&apos;app.
          </Text>
        ) : (
          <>
            <View style={styles.addressBox}>
              <Text style={styles.addressText} selectable>{address}</Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleShare}>
              <Text style={styles.primaryLabel}>Partager cette adresse</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  backText: { color: '#16A34A', fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '800', color: '#111827', flexShrink: 1 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 14 },
  description: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  loader: { marginVertical: 8 },
  errorText: { color: '#DC2626', fontSize: 14, lineHeight: 20 },
  addressBox: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 12 },
  addressText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700' },
});
