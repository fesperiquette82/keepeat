import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '../store/authStore';
import { connectGmail, disconnectGmail, fetchGmailAuthUrl, fetchGmailStatus, type GmailConnectionStatus } from '../utils/gmailApi';

export default function GmailConnectScreen() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const result = await fetchGmailStatus(token);
      setStatus(result);
    } catch {
      // best-effort — l'écran reste utilisable, juste sans statut affiché
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async () => {
    if (!token || isConnecting) return;
    setIsConnecting(true);
    try {
      const { authorization_url, state } = await fetchGmailAuthUrl(token);
      const result = await WebBrowser.openAuthSessionAsync(authorization_url, 'keepeat://oauth/gmail/callback');
      if (result.type !== 'success' || !('url' in result)) {
        return;
      }
      const url = new URL(result.url);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state') ?? state;
      if (!code) {
        Alert.alert('Erreur', "La connexion Gmail n'a pas abouti. Réessayez.");
        return;
      }
      const connected = await connectGmail(token, code, returnedState);
      setStatus(connected);
    } catch (error: any) {
      if (error?.message === 'gmail_auth_url_failed_503') {
        Alert.alert('Indisponible', "L'import mail n'est pas encore configuré pour cette version de l'app.");
      } else {
        Alert.alert('Erreur', "Impossible de connecter Gmail. Réessayez plus tard.");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!token) return;
    setIsConnecting(true);
    try {
      const result = await disconnectGmail(token);
      setStatus(result);
    } catch {
      Alert.alert('Erreur', 'Impossible de déconnecter Gmail.');
    } finally {
      setIsConnecting(false);
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
          Connectez votre boîte Gmail pour importer automatiquement les tickets de caisse reçus par email
          (fonctionnalité premium). KeepEat ne recherche que les emails de tickets de caisse — jamais le
          reste de votre boîte — et ne conserve aucun contenu d&apos;email au-delà de l&apos;extraction des articles.
        </Text>

        {isLoading ? (
          <ActivityIndicator style={styles.loader} color="#16A34A" />
        ) : status?.connected ? (
          <>
            <Text style={styles.statusConnected}>✓ Gmail connecté</Text>
            <TouchableOpacity style={styles.dangerButton} onPress={handleDisconnect} disabled={isConnecting}>
              {isConnecting ? <ActivityIndicator color="#DC2626" /> : <Text style={styles.dangerLabel}>Déconnecter</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={handleConnect} disabled={isConnecting}>
            {isConnecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Connecter Gmail</Text>}
          </TouchableOpacity>
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
  statusConnected: { color: '#16A34A', fontWeight: '700', fontSize: 15 },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  dangerButton: { borderRadius: 10, borderWidth: 1, borderColor: '#DC2626', paddingVertical: 12, alignItems: 'center' },
  dangerLabel: { color: '#DC2626', fontWeight: '700' },
});
