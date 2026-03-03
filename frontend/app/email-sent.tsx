import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';

const RESEND_COOLDOWN = 30;

export default function EmailSentScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { resendVerification } = useAuthStore();
  const { language } = useLanguageStore();

  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);

  const fr = language === 'fr';

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!email || cooldown > 0) return;
    setIsLoading(true);
    try {
      await resendVerification(decodeURIComponent(email));
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } catch {
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="mail" size={48} color="#22c55e" />
        </View>

        <Text style={styles.title}>
          {fr ? 'Vérifiez votre boîte mail' : 'Check your inbox'}
        </Text>

        <Text style={styles.description}>
          {fr
            ? `Un lien de confirmation a été envoyé à :`
            : `A confirmation link was sent to:`}
        </Text>
        <Text style={styles.emailText}>{email ? decodeURIComponent(email) : ''}</Text>

        <Text style={styles.hint}>
          {fr
            ? 'Cliquez sur le lien dans l\'email pour activer votre compte. Vérifiez aussi vos spams.'
            : 'Click the link in the email to activate your account. Check your spam folder too.'}
        </Text>

        <TouchableOpacity
          style={[styles.resendBtn, (isLoading || cooldown > 0) && styles.resendBtnDisabled]}
          onPress={handleResend}
          disabled={isLoading || cooldown > 0}
        >
          {isLoading ? (
            <ActivityIndicator color="#22c55e" />
          ) : (
            <Text style={styles.resendBtnText}>
              {cooldown > 0
                ? `${fr ? 'Renvoyer dans' : 'Resend in'} ${cooldown}s`
                : sent
                ? (fr ? 'Email renvoyé !' : 'Email resent!')
                : (fr ? 'Renvoyer l\'email' : 'Resend email')}
            </Text>
          )}
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
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginBottom: 6,
  },
  emailText: {
    fontSize: 15,
    color: '#22c55e',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  hint: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  resendBtn: {
    borderWidth: 1,
    borderColor: '#22c55e',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginBottom: 20,
    minWidth: 200,
    alignItems: 'center',
  },
  resendBtnDisabled: { opacity: 0.4 },
  resendBtnText: { color: '#22c55e', fontWeight: '600', fontSize: 15 },
  loginLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loginLinkText: { color: '#666', fontSize: 14 },
});
