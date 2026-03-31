import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { usePremiumUiStore } from '../store/premiumUiStore';
import { useAuthStore } from '../store/authStore';
import { restorePremiumPurchase, verifyPremiumPurchase } from '../utils/billingService';

export default function PremiumScreen() {
  const router = useRouter();
  const token = useAuthStore(state => state.token);
  const refreshEntitlements = useAuthStore(state => state.refreshEntitlements);
  const context = usePremiumUiStore(state => state.context);
  const closePaywall = usePremiumUiStore(state => state.closePaywall);

  const handleClose = () => {
    closePaywall();
    router.back();
  };

  const handleSubscribe = async () => {
    if (!token) return;
    try {
      await verifyPremiumPurchase(token, {
        platform: 'android',
        product_id: 'premium_monthly',
        purchase_token: `demo_${Date.now()}`,
      });
      await refreshEntitlements();
      Alert.alert('Premium activé', 'Votre abonnement premium est actif.');
      handleClose();
    } catch {
      Alert.alert('Erreur', 'Impossible d’activer premium pour le moment.');
    }
  };

  const handleRestore = async () => {
    if (!token) return;
    try {
      await restorePremiumPurchase(token);
      await refreshEntitlements();
      Alert.alert('Restauration terminée', 'Vos droits premium ont été synchronisés.');
      handleClose();
    } catch {
      Alert.alert('Erreur', 'Impossible de restaurer les achats.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>KeepEat Premium</Text>
        <Text style={styles.subtitle}>Débloquez toutes les fonctionnalités premium.</Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>Raison: {context?.code ?? 'PREMIUM_REQUIRED'}</Text>
          {!!context?.feature && <Text style={styles.statusText}>Feature: {context.feature}</Text>}
          {typeof context?.remaining === 'number' && <Text style={styles.statusText}>Restant: {context.remaining}</Text>}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubscribe}>
          <Text style={styles.primaryLabel}>S’abonner à premium_monthly</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleRestore}>
          <Text style={styles.secondaryLabel}>Restaurer mes achats</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={handleClose}>
          <Text style={styles.linkLabel}>Plus tard</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#4B5563' },
  statusBox: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 10, gap: 4 },
  statusText: { color: '#374151', fontSize: 12 },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  secondaryButton: { borderRadius: 10, borderWidth: 1, borderColor: '#16A34A', paddingVertical: 12, alignItems: 'center' },
  secondaryLabel: { color: '#166534', fontWeight: '700' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkLabel: { color: '#6B7280', fontWeight: '600' },
});
