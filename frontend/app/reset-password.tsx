import React, { useState, useMemo } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
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

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { resetPassword } = useAuthStore();
  const { language } = useLanguageStore();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [success, setSuccess] = useState(false);

  const fr = language === 'fr';

  const pwdChecks = useMemo(() => checkPassword(password), [password]);
  const isPasswordValid = Object.values(pwdChecks).every(Boolean);

  const handleReset = async () => {
    setLocalError(null);

    if (!token) {
      setLocalError(fr ? 'Lien invalide.' : 'Invalid link.');
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
      await resetPassword(token as string, password);
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg === 'TOKEN_EXPIRED') {
        setTokenExpired(true);
      } else if (msg === 'TOKEN_INVALID') {
        setLocalError(fr ? 'Ce lien est invalide ou a déjà été utilisé.' : 'This link is invalid or has already been used.');
      } else {
        setLocalError(msg || (fr ? 'Erreur lors de la réinitialisation.' : 'Reset failed.'));
      }
    } finally {
      setIsLoading(false);
    }
  };

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

  if (success) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, styles.iconCircleGreen]}>
            <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
          </View>
          <Text style={styles.title}>
            {fr ? 'Mot de passe mis à jour !' : 'Password updated!'}
          </Text>
          <Text style={styles.description}>
            {fr
              ? 'Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.'
              : 'Your password has been successfully reset. You can now sign in.'}
          </Text>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.submitBtnText}>
              {fr ? 'Se connecter' : 'Sign in'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (tokenExpired) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, styles.iconCircleRed]}>
            <Ionicons name="time-outline" size={48} color="#ef4444" />
          </View>
          <Text style={styles.title}>
            {fr ? 'Lien expiré' : 'Link expired'}
          </Text>
          <Text style={styles.description}>
            {fr
              ? 'Ce lien de réinitialisation a expiré (valable 1h). Faites une nouvelle demande.'
              : 'This reset link has expired (valid 1h). Please request a new one.'}
          </Text>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => router.replace('/forgot-password')}
          >
            <Text style={styles.submitBtnText}>
              {fr ? 'Nouvelle demande' : 'New request'}
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
          <View style={styles.formContent}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed-outline" size={40} color="#22c55e" />
            </View>

            <Text style={styles.title}>
              {fr ? 'Nouveau mot de passe' : 'New password'}
            </Text>
            <Text style={styles.description}>
              {fr
                ? 'Choisissez un mot de passe sécurisé pour votre compte.'
                : 'Choose a secure password for your account.'}
            </Text>

            {localError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{localError}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {fr ? 'Nouveau mot de passe' : 'New password'}
              </Text>
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
              <Text style={styles.inputLabel}>
                {fr ? 'Confirmer le mot de passe' : 'Confirm password'}
              </Text>
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
              style={[styles.submitBtn, (!isPasswordValid || isLoading) && styles.submitBtnDisabled]}
              onPress={handleReset}
              disabled={!isPasswordValid || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {fr ? 'Réinitialiser le mot de passe' : 'Reset password'}
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
  formContent: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconCircleGreen: { backgroundColor: '#22c55e15', borderColor: '#22c55e30' },
  iconCircleRed: { backgroundColor: '#ef444415', borderColor: '#ef444430' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
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
  inputGroup: { width: '100%', marginBottom: 16 },
  inputLabel: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    width: '100%',
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
  pwdCheckText: { fontSize: 12, color: '#555' },
  pwdCheckTextOk: { color: '#22c55e' },
  submitBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    height: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLinkText: { color: '#666', fontSize: 14 },
});
