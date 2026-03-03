import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword } = useAuthStore();
  const { language } = useLanguageStore();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const fr = language === 'fr';

  const handleSend = async () => {
    setLocalError(null);
    if (!email.trim()) {
      setLocalError(fr ? 'Veuillez saisir votre adresse email.' : 'Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLocalError(fr ? 'Adresse email invalide.' : 'Invalid email address.');
      return;
    }

    setIsLoading(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
    } catch {
      // Réponse identique qu'un compte existe ou non
    } finally {
      setSent(true);
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Ionicons name="mail" size={48} color="#22c55e" />
          </View>
          <Text style={styles.title}>
            {fr ? 'Email envoyé' : 'Email sent'}
          </Text>
          <Text style={styles.description}>
            {fr
              ? 'Si cette adresse email est associée à un compte, vous recevrez un lien de réinitialisation. Vérifiez aussi vos spams.'
              : 'If this email is associated with an account, you will receive a reset link. Check your spam folder too.'}
          </Text>
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.loginBtnText}>
              {fr ? 'Retour à la connexion' : 'Back to sign in'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-open-outline" size={48} color="#22c55e" />
            </View>

            <Text style={styles.title}>
              {fr ? 'Mot de passe oublié ?' : 'Forgot password?'}
            </Text>
            <Text style={styles.description}>
              {fr
                ? 'Saisissez votre adresse email. Nous vous enverrons un lien pour réinitialiser votre mot de passe.'
                : 'Enter your email address. We\'ll send you a link to reset your password.'}
            </Text>

            {localError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{localError}</Text>
              </View>
            ) : null}

            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="example@email.com"
                placeholderTextColor="#444"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <TouchableOpacity
              style={[styles.sendBtn, isLoading && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>
                  {fr ? 'Envoyer le lien' : 'Send reset link'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backLink}
              onPress={() => router.replace('/login')}
            >
              <Ionicons name="arrow-back-outline" size={16} color="#666" />
              <Text style={styles.backLinkText}>
                {fr ? 'Retour à la connexion' : 'Back to sign in'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
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
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ef444415',
    borderWidth: 1,
    borderColor: '#ef444430',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  errorText: { color: '#ef4444', fontSize: 13, flex: 1 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    width: '100%',
    marginBottom: 20,
  },
  inputIcon: { paddingLeft: 14 },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  sendBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    height: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  loginBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLinkText: { color: '#666', fontSize: 14 },
});
