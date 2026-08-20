import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import type { PurchaseError, ProductSubscription } from 'react-native-iap';
import { usePremiumUiStore } from '../store/premiumUiStore';
import { useAuthStore } from '../store/authStore';
import { verifyPremiumPurchase } from '../utils/billingService';
import { buildApiUrl } from '../utils/config';
import { buildPremiumCopy } from '../utils/premiumPaywallCopy';
import { fetchWithTimeout as fetch } from '../utils/fetchWithTimeout';
import {
  initIAP,
  endIAP,
  loadSubscription,
  subscribeToPurchaseUpdates,
  startPurchase,
  restoreSubscriptions,
  getFormattedPrice,
  type PurchaseResult,
} from '../utils/iapService';

interface GamificationSnapshot {
  total_saved_euros: number;
  current_streak: number;
}

interface MonthlyStatsItem {
  month: string;
  saved_euros: number;
}

interface PersonalizedStats {
  monthlySavedEuros: number | null;
  totalSavedEuros: number | null;
  wasteFreeDays: number | null;
}

export default function PremiumScreen() {
  const router = useRouter();
  const token = useAuthStore(state => state.token);
  const refreshEntitlements = useAuthStore(state => state.refreshEntitlements);
  const refreshUsage = useAuthStore(state => state.refreshUsage);
  const entitlements = useAuthStore(state => state.entitlements);
  const usage = useAuthStore(state => state.usage);
  const context = usePremiumUiStore(state => state.context);
  const closePaywall = usePremiumUiStore(state => state.closePaywall);

  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [isStoreLoading, setIsStoreLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [personalizedStats, setPersonalizedStats] = useState<PersonalizedStats>({
    monthlySavedEuros: null,
    totalSavedEuros: null,
    wasteFreeDays: null,
  });
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
      await refreshUsage();
      Alert.alert(
        'Bienvenue dans KeepEat Premium !',
        'Toutes les fonctionnalités premium sont maintenant activées.',
        [{ text: 'Super !', onPress: handleClose }],
      );
    } catch {
      Alert.alert('Erreur', "Impossible de vérifier l'achat. Contactez le support si le problème persiste.");
    } finally {
      setIsPurchasing(false);
    }
  }, [token, refreshEntitlements, refreshUsage, handleClose]);

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
          if (String(err.code) !== 'E_USER_CANCELLED') {
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

  useEffect(() => {
    if (!token) return;

    const fetchPersonalizedStats = async () => {
      try {
        const [gamifRes, monthlyRes] = await Promise.all([
          fetch(buildApiUrl('/api/gamification'), { headers: { Authorization: `Bearer ${token}` } }),
          fetch(buildApiUrl('/api/stats/monthly?months=1'), { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const nextStats: PersonalizedStats = {
          monthlySavedEuros: null,
          totalSavedEuros: null,
          wasteFreeDays: null,
        };

        if (gamifRes.ok) {
          const gamifData = await gamifRes.json() as GamificationSnapshot;
          if (typeof gamifData.total_saved_euros === 'number') {
            nextStats.totalSavedEuros = gamifData.total_saved_euros;
          }
          if (typeof gamifData.current_streak === 'number') {
            nextStats.wasteFreeDays = gamifData.current_streak;
          }
        }

        if (monthlyRes.ok) {
          const monthlyData = await monthlyRes.json() as MonthlyStatsItem[];
          if (Array.isArray(monthlyData) && monthlyData[0] && typeof monthlyData[0].saved_euros === 'number') {
            nextStats.monthlySavedEuros = monthlyData[0].saved_euros;
          }
        }

        setPersonalizedStats(nextStats);
      } catch {
        setPersonalizedStats({ monthlySavedEuros: null, totalSavedEuros: null, wasteFreeDays: null });
      }
    };

    fetchPersonalizedStats();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    refreshEntitlements();
    refreshUsage();
  }, [refreshEntitlements, refreshUsage, token]);

  const handleSubscribe = async () => {
    if (isPurchasing || !product) return;
    setIsPurchasing(true);
    try {
      await startPurchase(product);
      // Le résultat arrive via purchaseUpdatedListener — setIsPurchasing(false) géré là-bas
    } catch {
      Alert.alert('Erreur', "Impossible de lancer l'achat. Réessayez dans un instant.");
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
      await refreshUsage();
      Alert.alert('Restauration terminée', 'Vos droits premium ont été synchronisés.');
      handleClose();
    } catch {
      Alert.alert('Erreur', 'Impossible de restaurer les achats.');
    } finally {
      setIsPurchasing(false);
    }
  };

  const priceText = getFormattedPrice(product);
  const copy = buildPremiumCopy({ entitlements, usage });

  const personalizedLines = useMemo(() => {
    const lines: string[] = [];
    if (typeof personalizedStats.monthlySavedEuros === 'number' && personalizedStats.monthlySavedEuros > 0) {
      lines.push(`Vous avez déjà économisé ~${personalizedStats.monthlySavedEuros.toFixed(1)} € ce mois-ci.`);
    }
    if (typeof personalizedStats.totalSavedEuros === 'number' && personalizedStats.totalSavedEuros > 0) {
      lines.push(`Total suivi dans l’app : ~${personalizedStats.totalSavedEuros.toFixed(1)} € économisés.`);
    }
    if (typeof personalizedStats.wasteFreeDays === 'number' && personalizedStats.wasteFreeDays > 0) {
      lines.push(`Votre série actuelle : ${personalizedStats.wasteFreeDays} jour(s) sans gaspillage.`);
    }
    return lines;
  }, [personalizedStats.monthlySavedEuros, personalizedStats.totalSavedEuros, personalizedStats.wasteFreeDays]);

  const primaryButtonText = priceText === '...'
    ? `${copy.ctaLabel} — prix visible sur Google Play`
    : `${copy.ctaLabel} — ${priceText}/mois`;

  const contextLabel = useMemo(() => {
    if (!context) return null;
    if (context.code === 'QUOTA_EXCEEDED') {
      if (typeof context.remaining === 'number') {
        return `Quota atteint pour ${context.feature ?? 'cette fonctionnalité'} (${context.remaining} restant).`;
      }
      return `Quota atteint pour ${context.feature ?? 'cette fonctionnalité'}.`;
    }
    return `Accès Premium requis pour ${context.feature ?? 'cette fonctionnalité'}.`;
  }, [context]);

  return (
    <SafeAreaView testID="premium-paywall" style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{copy.heroTitle}</Text>
        <Text style={styles.subtitle}>{copy.heroSubtitle}</Text>

        <View style={styles.featureList}>
          {copy.benefits.map((benefit) => (
            <Text key={benefit.id} style={styles.feature}>• {benefit.text}</Text>
          ))}
        </View>

        <View style={styles.statusBox}>
          {personalizedLines.length > 0 ? (
            <>
              {personalizedLines.map((line) => (
                <Text key={line} style={styles.statusText}>{line}</Text>
              ))}
              <Text style={styles.statusTextStrong}>Premium vous aide à aller plus loin.</Text>
            </>
          ) : (
            <Text style={styles.statusText}>{copy.genericPersonalization}</Text>
          )}
        </View>

        {!!contextLabel && (
          <View style={styles.contextBox}>
            <Text style={styles.contextText}>{contextLabel}</Text>
          </View>
        )}

        {isStoreLoading ? (
          <ActivityIndicator style={styles.loader} color="#16A34A" />
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, (isPurchasing || !product) && styles.disabled]}
            onPress={handleSubscribe}
            disabled={isPurchasing || !product}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryLabel}>{product ? primaryButtonText : "Abonnement indisponible pour l'instant"}</Text>
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
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 14 },
  title: { fontSize: 27, fontWeight: '800', color: '#111827', lineHeight: 34 },
  subtitle: { fontSize: 15, color: '#4B5563', lineHeight: 21 },
  featureList: { gap: 8 },
  feature: { fontSize: 14, color: '#1F2937', lineHeight: 20 },
  statusBox: { backgroundColor: '#F3F4F6', borderRadius: 10, padding: 10, gap: 4 },
  statusText: { color: '#374151', fontSize: 13, lineHeight: 19 },
  statusTextStrong: { color: '#111827', fontSize: 13, fontWeight: '700', marginTop: 2 },
  contextBox: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10 },
  contextText: { color: '#1D4ED8', fontSize: 12, fontWeight: '600' },
  loader: { marginVertical: 16 },
  primaryButton: { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: { borderRadius: 10, borderWidth: 1, borderColor: '#16A34A', paddingVertical: 12, alignItems: 'center' },
  secondaryLabel: { color: '#166534', fontWeight: '700' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  linkLabel: { color: '#6B7280', fontWeight: '600' },
  disabled: { opacity: 0.6 },
});
