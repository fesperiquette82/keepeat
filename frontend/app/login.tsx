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

export default function LoginScreen() {
  const router = useRouter();
  const { login, error, clearError } = useAuthStore();
  const { language } = useLanguageStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const fr = language === 'fr';

  const handleLogin = async () => {
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError(fr ? 'Veuillez saisir votre adresse email.' : 'Please enter your email.');
      return;
    }
    if (!password) {
      setLocalError(fr ? 'Veuillez saisir votre mot de passe.' : 'Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // La navigation est gérée par _layout.tsx via le changement d'état user
    } catch (err: any) {
      setLocalError(err.message || (fr ? 'Email ou mot de passe incorrect.' : 'Invalid email or password.'));
    } finally {
      setIsLoading(false);
    }
  };

  const displayError = localError || error;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoSection}>
            <View style={styles.logoIcon}>
              <Ionicons name="leaf" size={40} color="#22c55e" />
            </View>
            <Text style={styles.logoTitle}>KeepEat</Text>
            <Text style={styles.logoTagline}>
              {fr ? 'Vos aliments, au bon moment' : 'Your food, at the right time'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>{fr ? 'Connexion' : 'Sign in'}</Text>

            {displayError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{displayError}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
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
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{fr ? 'Mot de passe' : 'Password'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.inputPassword]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={fr ? 'Votre mot de passe' : 'Your password'}
                  placeholderTextColor="#444"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#666" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, isLoading && styles.submitBtnDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>{fr ? 'Se connecter' : 'Sign in'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => router.replace('/register')}
            >
              <Text style={styles.switchLinkText}>
                {fr ? 'Pas encore de compte ? ' : "Don't have an account? "}
                <Text style={styles.switchLinkHighlight}>{fr ? "S'inscrire" : 'Sign up'}</Text>
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
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  logoSection: { alignItems: 'center', marginBottom: 40 },
  logoIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoTitle: { fontSize: 32, fontWeight: 'bold', color: '#22c55e' },
  logoTagline: { fontSize: 14, color: '#666', marginTop: 6 },

  form: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 24,
  },
  formTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 20 },

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
  },
  errorText: { color: '#ef4444', fontSize: 13, flex: 1 },

  inputGroup: { marginBottom: 16 },
  inputLabel: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c0c0c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  inputIcon: { paddingLeft: 14 },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  inputPassword: { paddingRight: 0 },
  eyeBtn: { padding: 14 },

  submitBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  switchLink: { alignItems: 'center' },
  switchLinkText: { color: '#666', fontSize: 14 },
  switchLinkHighlight: { color: '#22c55e', fontWeight: '600' },
});
