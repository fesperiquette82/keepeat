import React, { useEffect, useState, useRef, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import type { PurchaseError, Subscription } from 'react-native-iap';
import { usePremiumUiStore } from '../store/premiumUiStore';
import { useAuthStore } from '../store/authStore';
import { verifyPremiumPurchase } from '../utils/billingService';
import {
  initIAP,
  endIAP,
  loadSubscription,
  subscribeToPurchaseUpdates,
  startPurchase,
  restoreSubscriptions,
  getFormattedPrice,
  PREMIUM_SKU,
  type PurchaseResult,
} from '../utils/iapService';

export default function PremiumScreen() {
  const router = useRouter();
  const token = useAuthStore(state => state.token);
  const refreshEntitlements = useAuthStore(state => state.refreshEntitlements);
  const context = usePremiumUiStore(state => state.context);
  const closePaywall = usePremiumUiStore(state => state.closePaywall);

  const [product, setProduct] = useState<Subscription | null>(null);
  const [isStoreLoading, setIsStoreLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleClose = useCallback(() => {
    closePaywall();
    router.back();
  }, [closePaywall, router]);

  const handlePurchaseResult = useCallback(async (result: PurchaseResult) => {
    if (!token) return;
    setIsPurchasing(true);
    try {
      await verifyPremiumPurchase(token, {
        platform: 'android',
        product_id: result.productId,
        purchase_token: result.purchaseToken,
      });
      await refreshEntitlements();
      Alert.alert(
        'Bienvenue dans KeepEat Premium !',
        'Toutes les fonctionnalités sont maintenant débloquées.',
        [{ text: 'Super !', onPress: handleClose }],
      );
    } catch {
      Alert.alert('Erreur', "Impossible de vérifier l'achat. Contactez le support si le problème persiste.");
    } finally {
      setIsPurchasing(false);
    }
  }, [token, refreshEntitlements, handleClose]);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      await initIAP();
      if (!mounted) return;
      const sub = await loadSubscription();
      if (mounted) {
        setProduct(sub);
        setIsStoreLoading(false);
      }
      cleanupRef.current = subscribeToPurchaseUpdates(
        handlePurchaseResult,
        (err: PurchaseError) => {
          if (err.code !== 'E_USER_CANCELLED') {
            Alert.alert('Erreur', err.message || 'Achat échoué.');
          }
          setIsPurchasing(false);
        },
      );
    };

    setup();

    return () => {
      mounted = false;
      cleanupRef.current?.();
      endIAP();
    };
  }, [handlePurchaseResult]);

  const handleSubscribe = async () => {
    if (isPurchasing) return;
    setIsPurchasing(true);
    try {
      await startPurchase(PREMIUM_SKU);
      // Le résultat arrive via purchaseUpdatedListener — setIsPurchasing(false) géré là-bas
    } catch {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (!token || isPurchasing) return;
    setIsPurchasing(true);
    try {
      const purchases = await restoreSubscriptions();
      if (purchases.length === 0) {
        Alert.alert('Aucun achat trouvé', "Aucun abonnement actif n'a été trouvé pour ce compte Google Play.");
        return;
      }
      for (const p of purchases) {
        await verifyPremiumPurchase(token, {
          platform: 'android',
          product_id: p.productId,
          purchase_token: p.purchaseToken,
        });
      }
      await refreshEntitlements();
      Alert.alert('Restauration terminée', 'Vos droits premium ont été synchronisés.');
      handleClose();
    } catch {
      Alert.alert('Erreur', 'Impossible de restaurer les achats.');
    } finally {
      setIsPurchasing(false);
    }
  };

  const priceText = getFormattedPrice(product);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>KeepEat Premium</Text>
        <Text style={styles.subtitle}>Débloquez toutes les fonctionnalités sans limite.</Text>

        <View style={styles.featureList}>
          <Text style={styles.feature}>• Scan OCR ticket de caisse (200/mois)</Text>
          <Text style={styles.feature}>• Recettes IA personnalisées (200/mois)</Text>
          <Text style={styles.feature}>• Rappels prioritaires configurables</Text>
          <Text style={styles.feature}>• Statistiques avancées sur 24 mois</Text>
        </View>

        {context && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>Raison : {context.code}</Text>
            {!!context.feature && <Text style={styles.statusText}>Fonctionnalité : {context.feature}</Text>}
            {typeof context.remaining === 'number' && (
              <Text style={styles.statusText}>Utilisations restantes : {context.remaining}</Text>
            )}
          </View>
        )}

        {isStoreLoading ? (
          <ActivityIndicator style={styles.loader} color="#16A34A" />
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, isPurchasing && styles.disabled]}
            onPress={handleSubscribe}
            disabled={isPurchasing}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryLabel}>S'abonner — {priceText}/mois</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.secondaryButton, isPurchasing && styles.disabled]}
          onPress={handleRestore}
          disabled={isPurchasing}
        >
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
  featureList: { gap: 6 },
  feature: { fontSize: 14, color: '#374151' },
  statusBox: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 10, gap: 4 },
  statusText: { color: '#374151', fontSize: 12 },
  loader: { marginVertical: 16 },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: { borderRadius: 10, borderWidth: 1, borderColor: '#16A34A', paddingVertical: 12, alignItems: 'center' },
  secondaryLabel: { color: '#166534', fontWeight: '700' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkLabel: { color: '#6B7280', fontWeight: '600' },
  disabled: { opacity: 0.6 },
});
