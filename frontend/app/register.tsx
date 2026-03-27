import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
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

function checkPassword(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/.test(password),
  };
}

export default function RegisterScreen() {
  const router = useRouter();
  const { register, error, clearError } = useAuthStore();
  const { language } = useLanguageStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const fr = language === 'fr';

  const pwdChecks = useMemo(() => checkPassword(password), [password]);
  const isPasswordValid = Object.values(pwdChecks).every(Boolean);

  const handleRegister = async () => {
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError(fr ? 'Veuillez saisir une adresse email.' : 'Please enter an email.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLocalError(fr ? 'Adresse email invalide.' : 'Invalid email address.');
      return;
    }
    if (!isPasswordValid) {
      setLocalError(
        fr
          ? 'Le mot de passe ne respecte pas tous les critères de sécurité.'
          : 'Password does not meet all security requirements.'
      );
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(fr ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(email.trim().toLowerCase(), password);
      router.replace(`/email-sent?email=${encodeURIComponent(result.email)}` as any);
    } catch (err: any) {
      setLocalError(
        err.message?.includes('already') || err.message?.includes('409')
          ? (fr ? 'Cette adresse email est déjà utilisée.' : 'This email is already registered.')
          : err.message?.includes('WEAK_PASSWORD')
          ? (fr ? 'Mot de passe trop faible.' : 'Password too weak.')
          : err.message || (fr ? "Erreur lors de l'inscription." : 'Registration failed.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const displayError = localError || error;

  const criteriaLabels = fr
    ? {
        length: '8 caractères minimum',
        upper: 'Une lettre majuscule (A-Z)',
        lower: 'Une lettre minuscule (a-z)',
        digit: 'Un chiffre (0-9)',
        special: 'Un caractère spécial (!@#$...)',
      }
    : {
        length: 'At least 8 characters',
        upper: 'One uppercase letter (A-Z)',
        lower: 'One lowercase letter (a-z)',
        digit: 'One digit (0-9)',
        special: 'One special character (!@#$...)',
      };

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
              <Image
                source={require('../assets/images/branding/keepeat-logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.logoTitle}>KeepEat</Text>
            <Text style={styles.logoTagline}>
              {fr ? 'Vos aliments, au bon moment' : 'Your food, at the right time'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>{fr ? 'Créer un compte' : 'Create account'}</Text>

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
                  placeholder={fr ? 'Créez un mot de passe sécurisé' : 'Create a secure password'}
                  placeholderTextColor="#444"
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Checklist critères mot de passe */}
              {password.length > 0 && (
                <View style={styles.pwdChecklist}>
                  {(Object.entries(pwdChecks) as [keyof typeof pwdChecks, boolean][]).map(([key, ok]) => (
                    <View key={key} style={styles.pwdCheckRow}>
                      <Ionicons
                        name={ok ? 'checkmark-circle' : 'close-circle-outline'}
                        size={14}
                        color={ok ? '#22c55e' : '#555'}
                      />
                      <Text style={[styles.pwdCheckText, ok && styles.pwdCheckTextOk]}>
                        {criteriaLabels[key]}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{fr ? 'Confirmer le mot de passe' : 'Confirm password'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={fr ? 'Répéter le mot de passe' : 'Repeat password'}
                  placeholderTextColor="#444"
                  secureTextEntry={!showPassword}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!isPasswordValid || isLoading) && styles.submitBtnDisabled,
              ]}
              onPress={handleRegister}
              disabled={!isPasswordValid || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>{fr ? 'Créer mon compte' : 'Create account'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchLink}
              onPress={() => router.replace('/login')}
            >
              <Text style={styles.switchLinkText}>
                {fr ? 'Déjà un compte ? ' : 'Already have an account? '}
                <Text style={styles.switchLinkHighlight}>{fr ? 'Se connecter' : 'Sign in'}</Text>
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
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoImage: { width: 120, height: 120 },
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

  pwdChecklist: {
    marginTop: 10,
    gap: 6,
    paddingLeft: 4,
  },
  pwdCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pwdCheckText: {
    fontSize: 12,
    color: '#555',
  },
  pwdCheckTextOk: {
    color: '#22c55e',
  },

  submitBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  switchLink: { alignItems: 'center' },
  switchLinkText: { color: '#666', fontSize: 14 },
  switchLinkHighlight: { color: '#22c55e', fontWeight: '600' },
});
