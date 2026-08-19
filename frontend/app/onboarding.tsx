import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuthStore } from '../store/authStore';
import { useLanguageStore } from '../store/languageStore';
import { markOnboardingSeen } from '../utils/onboardingStorage';

/**
 * BUG-043 (audit commercial, point 10 — angle mort activation) : un nouvel
 * inscrit arrivait directement sur le tableau de bord, vide tant qu'aucun
 * produit n'est ajouté — aucune alerte, aucune recette, aucune économie
 * affichée. Cet écran, montré une seule fois juste après l'inscription/la
 * connexion, amène directement au geste qui donne de la valeur à l'app.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const userId = useAuthStore((state) => state.user?.id);
  const { language } = useLanguageStore();
  const fr = language === 'fr';

  const proceed = async (destination: '/scan' | '/scan-receipt' | '/(tabs)') => {
    if (userId) {
      await markOnboardingSeen(userId);
    }
    router.replace(destination as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoIcon}>
          <Image source={require('../assets/images/icon.png')} style={styles.logoImage} resizeMode="contain" />
        </View>

        <Text style={styles.title}>
          {fr ? 'Bienvenue sur KeepEat !' : 'Welcome to KeepEat!'}
        </Text>
        <Text style={styles.description}>
          {fr
            ? "KeepEat vous alerte avant que ça périme et vous suggère des recettes avec ce que vous avez déjà. Ça commence par remplir votre stock — ça prend une minute."
            : 'KeepEat warns you before food expires and suggests recipes from what you already have. It starts with filling your stock — it takes a minute.'}
        </Text>

        <TouchableOpacity
          testID="onboarding-scan-product"
          style={styles.primaryBtn}
          onPress={() => proceed('/scan')}
        >
          <Ionicons name="barcode-outline" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>
            {fr ? 'Scanner un produit' : 'Scan a product'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding-scan-receipt"
          style={styles.secondaryBtn}
          onPress={() => proceed('/scan-receipt')}
        >
          <Ionicons name="receipt-outline" size={20} color="#22c55e" />
          <Text style={styles.secondaryBtnText}>
            {fr ? 'Scanner un ticket de caisse' : 'Scan a receipt'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding-skip"
          style={styles.skipLink}
          onPress={() => proceed('/(tabs)')}
        >
          <Text style={styles.skipLinkText}>
            {fr ? 'Plus tard' : 'Later'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  logoIcon: { width: 96, height: 96, marginBottom: 24 },
  logoImage: { width: 96, height: 96 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 14,
  },
  description: {
    fontSize: 15,
    color: '#a3a3a3',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 15,
    width: '100%',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 15,
    width: '100%',
    marginBottom: 20,
  },
  secondaryBtnText: { color: '#22c55e', fontWeight: '700', fontSize: 15 },
  skipLink: { padding: 8 },
  skipLinkText: { color: '#666', fontSize: 14 },
});
