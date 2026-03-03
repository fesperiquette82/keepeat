import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { verifyEmail } = useAuthStore();
  const { language } = useLanguageStore();

  const [status, setStatus] = useState<'loading' | 'success' | 'expired' | 'error'>('loading');

  const fr = language === 'fr';

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    verifyEmail(token as string)
      .then(() => {
        setStatus('success');
        // _layout.tsx détecte user non-null et redirige vers '/'
      })
      .catch((err: any) => {
        const msg = err?.message ?? '';
        if (msg === 'TOKEN_EXPIRED') {
          setStatus('expired');
        } else {
          setStatus('error');
        }
      });
  }, [token]);

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color="#22c55e" />
          <Text style={styles.loadingText}>
            {fr ? 'Vérification en cours...' : 'Verifying...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, styles.iconCircleGreen]}>
            <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
          </View>
          <Text style={styles.title}>
            {fr ? 'Email confirmé !' : 'Email confirmed!'}
          </Text>
          <Text style={styles.description}>
            {fr
              ? 'Votre compte est activé. Redirection en cours...'
              : 'Your account is activated. Redirecting...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, styles.iconCircleRed]}>
          <Ionicons
            name={status === 'expired' ? 'time-outline' : 'close-circle-outline'}
            size={48}
            color="#ef4444"
          />
        </View>

        <Text style={styles.title}>
          {status === 'expired'
            ? (fr ? 'Lien expiré' : 'Link expired')
            : (fr ? 'Lien invalide' : 'Invalid link')}
        </Text>

        <Text style={styles.description}>
          {status === 'expired'
            ? (fr
                ? 'Ce lien de confirmation a expiré (valable 24h). Demandez-en un nouveau.'
                : 'This confirmation link has expired (valid 24h). Request a new one.')
            : (fr
                ? 'Ce lien est invalide ou a déjà été utilisé.'
                : 'This link is invalid or has already been used.')}
        </Text>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.replace('/email-sent?email=' as any)}
        >
          <Text style={styles.actionBtnText}>
            {fr ? 'Renvoyer un email de confirmation' : 'Resend confirmation email'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => router.replace('/login')}
        >
          <Ionicons name="arrow-back-outline" size={16} color="#666" />
          <Text style={styles.loginLinkText}>
            {fr ? 'Retour à la connexion' : 'Back to sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  iconCircleGreen: { backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e30' },
  iconCircleRed: { backgroundColor: '#ef444415', borderWidth: 1, borderColor: '#ef444430' },
  loadingText: { color: '#888', fontSize: 15, marginTop: 16 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  actionBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginBottom: 16,
    minWidth: 200,
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  loginLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  loginLinkText: { color: '#666', fontSize: 14 },
});
