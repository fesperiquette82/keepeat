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
import AnimatedLogo from '../component/AnimatedLogo';

export default function LoginScreen() {
  const router = useRouter();
  const { login, resendVerification, error, clearError } = useAuthStore();
  const { language } = useLanguageStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  const fr = language === 'fr';

  const handleDevLogin = async () => {
    setLocalError(null);
    clearError();
    setEmailNotVerified(false);
    setIsLoading(true);
    try {
      await login('fesperiquette@hotmail.com', 'essai');
    } catch (err: any) {
      setLocalError(err.message || (fr ? 'Connexion dev échouée.' : 'Dev login failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setLocalError(null);
    clearError();
    setEmailNotVerified(false);

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
      if (err.message === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
      } else {
        setLocalError(
          err.message || (fr ? 'Email ou mot de passe incorrect.' : 'Invalid email or password.')
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email.trim()) {
      setLocalError(fr ? 'Saisissez votre email pour renvoyer la confirmation.' : 'Enter your email to resend confirmation.');
      return;
    }
    setResendLoading(true);
    try {
      await resendVerification(email.trim().toLowerCase());
      setResendDone(true);
      router.push(`/email-sent?email=${encodeURIComponent(email.trim().toLowerCase())}` as any);
    } catch {
      // L'action ne lance pas d'erreur côté frontend (anti-énumération)
      setResendDone(true);
    } finally {
      setResendLoading(false);
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
          {/* Logo — animé au montage (fade-in + scale spring) */}
          <AnimatedLogo delay={100}>
            <View style={styles.logoSection}>
              <View style={styles.logoIcon}>
                <Ionicons name="leaf" size={40} color="#22c55e" />
              </View>
              <Text style={styles.logoTitle}>KeepEat</Text>
              <Text style={styles.logoTagline}>
                {fr ? 'Vos aliments, au bon moment' : 'Your food, at the right time'}
              </Text>
            </View>
          </AnimatedLogo>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>{fr ? 'Connexion' : 'Sign in'}</Text>

            {displayError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{displayError}</Text>
              </View>
            ) : null}

            {/* Bandeau email non vérifié */}
            {emailNotVerified && (
              <View style={styles.warningBox}>
                <Ionicons name="mail-outline" size={16} color="#f59e0b" />
                <View style={styles.warningContent}>
                  <Text style={styles.warningText}>
                    {fr
                      ? 'Votre adresse email n\'a pas encore été confirmée.'
                      : 'Your email address has not been confirmed yet.'}
                  </Text>
                  <TouchableOpacity
                    onPress={handleResendVerification}
                    disabled={resendLoading || resendDone}
                    style={styles.resendBtn}
                  >
                    {resendLoading ? (
                      <ActivityIndicator size="small" color="#f59e0b" />
                    ) : (
                      <Text style={styles.resendBtnText}>
                        {resendDone
                          ? (fr ? 'Email envoyé !' : 'Email sent!')
                          : (fr ? 'Renvoyer l\'email de confirmation' : 'Resend confirmation email')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

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
              <View style={styles.passwordLabelRow}>
                <Text style={styles.inputLabel}>{fr ? 'Mot de passe' : 'Password'}</Text>
                <TouchableOpacity onPress={() => router.push('/forgot-password' as any)}>
                  <Text style={styles.forgotLink}>
                    {fr ? 'Mot de passe oublié ?' : 'Forgot password?'}
                  </Text>
                </TouchableOpacity>
              </View>
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

            <TouchableOpacity
              style={styles.bypassBtn}
              onPress={handleDevLogin}
              disabled={isLoading}
            >
              <Ionicons name="construct-outline" size={14} color="#555" />
              <Text style={styles.bypassBtnText}>Connexion dev (fesperiquette)</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  logoSection: { alignItems: 'center', marginBottom: 36 },
  logoIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  logoTitle: { fontSize: 34, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  logoTagline: { fontSize: 14, color: '#6B7280', marginTop: 6 },

  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  formTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 20 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: '#EF4444', fontSize: 13, flex: 1 },

  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warningContent: { flex: 1, gap: 8 },
  warningText: { color: '#92400E', fontSize: 13 },
  resendBtn: { alignSelf: 'flex-start' },
  resendBtnText: { color: '#D97706', fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  inputGroup: { marginBottom: 16 },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inputLabel: { color: '#374151', fontSize: 13, fontWeight: '700' },
  forgotLink: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  inputIcon: { paddingLeft: 14 },
  input: {
    flex: 1,
    color: '#111827',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  inputPassword: { paddingRight: 0 },
  eyeBtn: { padding: 14 },

  submitBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  switchLink: { alignItems: 'center' },
  switchLinkText: { color: '#6B7280', fontSize: 14 },
  switchLinkHighlight: { color: '#22c55e', fontWeight: '700' },

  bypassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  bypassBtnText: { color: '#9CA3AF', fontSize: 12 },
});
