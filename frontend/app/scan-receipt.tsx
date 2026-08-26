import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import axios from 'axios';
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { buildApiUrl } from '../utils/config';
import { useAuthStore } from '../store/authStore';
import { C } from '../utils/theme';
import { usePremiumUiStore } from '../store/premiumUiStore';
import { resolveReceiptErrorAction } from '../utils/receiptScanFlow';
import { getGalleryErrorMessage, pickImageFromGallery } from '../utils/galleryPicker';
import { computeReceiptItemExpiry, defaultReceiptZone, type ReceiptExpiryProduct, type ReceiptStorageZone } from '../utils/receiptExpiry';

// ─── Types ────────────────────────────────────────────────────────────────────

type StorageZone = ReceiptStorageZone;

interface ReceiptProduct extends ReceiptExpiryProduct {
  name: string;
  raw_title?: string;
  purchase_date?: string | null;
  category: string;
  food_category: string;
  brand?: string | null;
  image_url?: string | null;
  quantity?: number | null;
  unit?: string | null;
  shelf_life_fridge: number | null;
  shelf_life_pantry: number | null;
  shelf_life_freezer: number | null;
  expiry_date_fridge?: string | null;
  expiry_date_pantry?: string | null;
  expiry_date_freezer?: string | null;
}

interface ReceiptOcrResponse {
  purchase_date?: string | null;
  merchant?: string | null;
  currency?: string | null;
  items?: ReceiptProduct[];
  ignored_items?: { raw_title?: string; reason?: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  frais: '🥛', proteines: '🥩', legumes: '🥕', feculents: '🍞',
  desserts: '🍰', boissons: '🧃', epicerie: '🏪', autres: '📦',
};

const STORAGE_ZONES: { key: StorageZone; fr: string; en: string; icon: string }[] = [
  { key: 'fridge',  fr: 'Frigo',   en: 'Fridge',  icon: '❄️' },
  { key: 'pantry',  fr: 'Placard', en: 'Pantry',  icon: '🏠' },
  { key: 'freezer', fr: 'Congélo', en: 'Freezer', icon: '🧊' },
];

function shelfHint(p: ReceiptProduct, fr: boolean): string {
  const parts: string[] = [];
  if (p.shelf_life_fridge) parts.push(fr ? `${p.shelf_life_fridge}j frigo` : `${p.shelf_life_fridge}d fridge`);
  if (p.shelf_life_pantry) parts.push(fr ? `${p.shelf_life_pantry}j placard` : `${p.shelf_life_pantry}d pantry`);
  if (p.shelf_life_freezer) parts.push(fr ? `${p.shelf_life_freezer}j congélo` : `${p.shelf_life_freezer}d frozen`);
  return parts.join(' · ');
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type Mode = 'camera' | 'processing' | 'confirm' | 'fallback' | 'report_sent';

export default function ScanReceiptScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const openPaywall = usePremiumUiStore(state => state.openPaywall);
  const { addItem, fetchHistory } = useStockStore();
  const { language } = useLanguageStore();
  const isFr = language === 'fr';

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [mode, setMode] = useState<Mode>('camera');
  const [products, setProducts] = useState<ReceiptProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  // null = pas de surcharge : chaque produit reçoit sa propre zone déduite
  // de sa catégorie (defaultReceiptZone). Un choix explicite ici force la
  // même zone pour tout le ticket.
  const [zoneOverride, setZoneOverride] = useState<StorageZone | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const effectiveZone = (p: ReceiptProduct): StorageZone => zoneOverride ?? defaultReceiptZone(p);

  // ── Capture & analyse ──────────────────────────────────────────────────────

  const processReceiptImage = async (base64Image: string) => {
    setMode('processing');
    setPendingImage(base64Image);
    try {
      const res = await axios.post(
        buildApiUrl('/api/ocr/receipt'),
        { image: base64Image },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = res.data as ReceiptProduct[] | ReceiptOcrResponse;
      const detected: ReceiptProduct[] = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.items) ? payload.items : []);

      if (detected.length === 0) {
        // Aucun produit reconnu → proposer l'envoi pour traitement manuel
        setMode('fallback');
        return;
      }

      setZoneOverride(null);
      setProducts(detected);
      setSelected(new Set(detected.map((_, i) => i)));
      setMode('confirm');
    } catch (err: any) {
      const action = resolveReceiptErrorAction(err);
      if (action.type === 'premium') {
        openPaywall(action.detail);
        router.push('/premium');
      } else {
        // Erreur réseau / serveur : l'image est déjà dans pendingImage,
        // on propose l'envoi pour traitement manuel comme pour le retour vide
        setMode('fallback');
      }
    }
  };

  const handleReportTicket = async () => {
    if (!pendingImage) return;
    setIsReporting(true);
    try {
      await axios.post(
        buildApiUrl('/api/ocr/receipt/report'),
        { image: pendingImage },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMode('report_sent');
    } catch {
      Alert.alert(
        isFr ? 'Erreur' : 'Error',
        isFr ? "Impossible d'envoyer le ticket." : 'Unable to send the receipt.',
      );
    } finally {
      setIsReporting(false);
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
    if (!photo.base64) {
      Alert.alert(isFr ? 'Erreur' : 'Error', isFr ? "Photo invalide." : 'Invalid photo.');
      return;
    }
    await processReceiptImage(photo.base64);
  };

  const handleImportFromGallery = async () => {
    const picked = await pickImageFromGallery({ includeBase64: true, quality: 0.75 });
    if (picked.status === 'cancelled') return;
    const galleryError = getGalleryErrorMessage(picked, {
      permissionDenied: isFr
        ? "Autorisez l'accès à la galerie pour importer une photo."
        : 'Allow photo library access to import an image.',
      unavailable: isFr
        ? "L'import galerie n'est pas prêt dans ce build. Recompilez l'application après installation de expo-image-picker."
        : 'Gallery import is not available in this build. Rebuild the app after installing expo-image-picker.',
      invalidImage: isFr ? "Impossible d'analyser cette image." : 'Unable to analyse this image.',
    });
    if (galleryError) {
      Alert.alert(
        isFr ? 'Erreur' : 'Error',
        galleryError,
      );
      return;
    }
    if (picked.status !== 'success' || !picked.asset.base64) return;
    await processReceiptImage(picked.asset.base64);
  };

  // ── Ajout des produits sélectionnés ───────────────────────────────────────

  const handleAdd = async () => {
    const toAdd = products.filter((_, i) => selected.has(i));
    if (toAdd.length === 0) return;
    setIsSaving(true);
    try {
      await Promise.all(
        toAdd.map(p => {
          const zone = effectiveZone(p);
          return addItem({
            name:          p.name,
            brand:         p.brand ?? undefined,
            image_url:     p.image_url ?? undefined,
            category:      p.category,
            food_category: p.food_category,
            quantity:      p.quantity != null ? String(p.quantity) : undefined,
            expiry_date:   computeReceiptItemExpiry(p, zone),
            storageZone:   zone === 'fridge' ? 'frigo' : zone === 'freezer' ? 'congelateur' : 'placard',
          }, { source: 'receipt_ocr' });
        }),
      );
      await fetchHistory();
      router.replace('/');
    } catch {
      Alert.alert(isFr ? 'Erreur' : 'Error', isFr ? "Erreur lors de l'ajout." : 'Error while adding.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Permission ────────────────────────────────────────────────────────────

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={64} color={C.primary} />
          <Text style={styles.permText}>
            {isFr ? 'Accès caméra nécessaire' : 'Camera access required'}
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>
              {isFr ? 'Autoriser la caméra' : 'Allow camera'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Camera mode ───────────────────────────────────────────────────────────

  if (mode === 'camera' || mode === 'processing') {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#111" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isFr ? '📋 Scanner un ticket' : '📋 Scan a receipt'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Camera */}
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera}>
            {/* Overlay instructions */}
            <View style={styles.overlay}>
              <View style={styles.frameHint}>
                <Ionicons name="receipt-outline" size={32} color="rgba(255,255,255,0.7)" />
                <Text style={styles.frameHintText}>
                  {isFr
                    ? 'Cadrez tout le ticket dans la zone'
                    : 'Frame the entire receipt in the area'}
                </Text>
              </View>
            </View>

            {/* Processing overlay */}
            {mode === 'processing' && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.processingText}>
                  {isFr ? 'Analyse en cours…' : 'Analysing…'}
                </Text>
              </View>
            )}
          </CameraView>
        </View>

        {/* Capture button */}
        <View style={styles.captureRow}>
          <View style={styles.captureActionsRow}>
            <TouchableOpacity
              style={[styles.captureBtn, mode === 'processing' && styles.captureBtnDisabled]}
              onPress={handleCapture}
              disabled={mode === 'processing'}
            >
              <Ionicons name="camera" size={24} color="#fff" />
              <Text style={styles.captureBtnText}>
                {isFr ? 'Capturer le ticket' : 'Capture receipt'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.galleryBtn, mode === 'processing' && styles.captureBtnDisabled]}
              onPress={handleImportFromGallery}
              disabled={mode === 'processing'}
            >
              <Ionicons name="images-outline" size={21} color="#111827" />
              <Text style={styles.galleryBtnText}>
                {isFr ? 'Galerie' : 'Gallery'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Fallback mode (0 produits détectés) ───────────────────────────────────

  if (mode === 'fallback') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setMode('camera')}>
            <Ionicons name="arrow-back" size={24} color="#111" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isFr ? 'Ticket non reconnu' : 'Receipt not recognised'}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={64} color="#F59E0B" />
          <Text style={styles.fallbackTitle}>
            {isFr ? "L'IA n'a pas pu lire ce ticket" : "The AI couldn't read this receipt"}
          </Text>
          <Text style={styles.fallbackSub}>
            {isFr
              ? "Envoyez-le à notre équipe. Nous ajouterons les produits à votre stock manuellement sous 24h."
              : "Send it to our team. We'll add the products to your stock manually within 24h."}
          </Text>
          <TouchableOpacity
            style={[styles.reportBtn, isReporting && styles.captureBtnDisabled]}
            onPress={handleReportTicket}
            disabled={isReporting}
          >
            {isReporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="mail-outline" size={20} color="#fff" />
                <Text style={styles.captureBtnText}>
                  {isFr ? 'Envoyer pour traitement manuel' : 'Send for manual review'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.switchLink} onPress={() => setMode('camera')}>
            <Text style={styles.switchLinkText}>
              {isFr ? 'Réessayer' : 'Try again'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Report sent confirmation ───────────────────────────────────────────────

  if (mode === 'report_sent') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={72} color={C.primary} />
          <Text style={styles.fallbackTitle}>
            {isFr ? 'Ticket envoyé !' : 'Receipt sent!'}
          </Text>
          <Text style={styles.fallbackSub}>
            {isFr
              ? "Notre équipe va analyser votre ticket et ajouter les produits à votre stock."
              : "Our team will review your receipt and add the products to your stock."}
          </Text>
          <TouchableOpacity style={styles.reportBtn} onPress={() => router.replace('/')}>
            <Text style={styles.captureBtnText}>
              {isFr ? "Retour à l'accueil" : 'Back to home'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Confirm mode ──────────────────────────────────────────────────────────

  const selectedCount = selected.size;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode('camera')}>
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isFr
            ? `${products.length} produit${products.length > 1 ? 's' : ''} détecté${products.length > 1 ? 's' : ''}`
            : `${products.length} product${products.length > 1 ? 's' : ''} detected`}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Subtitle */}
      <Text style={styles.confirmSub}>
        {isFr
          ? 'Sélectionnez les produits. Zone de stockage automatique par produit — forcez-en une pour tout le ticket si besoin.'
          : 'Select products. Storage zone is automatic per product — force one for the whole receipt if needed.'}
      </Text>

      {/* Storage zone override (optionnel, applique la même zone à tout le ticket) */}
      <View style={styles.zoneRow}>
        <Text style={styles.zoneLabel}>{isFr ? 'Forcer :' : 'Force:'}</Text>
        {STORAGE_ZONES.map(z => (
          <TouchableOpacity
            key={z.key}
            style={[styles.zoneChip, zoneOverride === z.key && styles.zoneChipActive]}
            onPress={() => setZoneOverride(current => (current === z.key ? null : z.key))}
          >
            <Text style={styles.zoneChipText}>{z.icon} {isFr ? z.fr : z.en}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Product list */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {products.map((p, i) => {
          const isSelected = selected.has(i);
          const emoji = CATEGORY_EMOJI[p.food_category] ?? '📦';
          const hint = shelfHint(p, isFr);
          return (
            <TouchableOpacity
              key={i}
              style={[styles.productRow, isSelected && styles.productRowSelected]}
              onPress={() => {
                const next = new Set(selected);
                if (next.has(i)) next.delete(i); else next.add(i);
                setSelected(next);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.productEmoji}>
                {p.image_url ? (
                  <Image source={{ uri: p.image_url }} style={styles.productImage} resizeMode="cover" />
                ) : (
                  <Text style={{ fontSize: 24 }}>{emoji}</Text>
                )}
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{p.name}</Text>
                {(() => {
                  const expiry = computeReceiptItemExpiry(p, effectiveZone(p));
                  if (expiry) {
                    const d = new Date(expiry);
                    const label = d.toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    return <Text style={styles.productHint}>{isFr ? `DLC auto : ${label}` : `Auto expiry: ${label}`}</Text>;
                  }
                  return hint ? <Text style={styles.productHint}>{hint}</Text> : null;
                })()}
              </View>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.addBtn,
            (selectedCount === 0 || isSaving) && styles.addBtnDisabled,
          ]}
          onPress={handleAdd}
          disabled={selectedCount === 0 || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.addBtnText}>
                {isFr
                  ? `Ajouter ${selectedCount} produit${selectedCount > 1 ? 's' : ''}`
                  : `Add ${selectedCount} product${selectedCount > 1 ? 's' : ''}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5F2' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permText: { fontSize: 16, color: C.text, textAlign: 'center', fontWeight: '600' },
  permBtn: {
    backgroundColor: C.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14,
  },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  backBtn: {
    padding: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },

  // ── Camera ──
  cameraWrap: { flex: 1, overflow: 'hidden' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  frameHint: { alignItems: 'center', gap: 12 },
  frameHintText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // ── Capture button ──
  captureRow: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  captureActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 5,
  },
  captureBtnDisabled: { opacity: 0.6 },
  captureBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  galleryBtn: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  galleryBtnText: { color: '#111827', fontSize: 14, fontWeight: '700' },

  // ── Confirm ──
  confirmSub: {
    fontSize: 12,
    color: C.textMid,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 12, gap: 8, paddingBottom: 24 },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#F0EDE8',
  },
  productRowSelected: {
    borderColor: C.primaryMid,
    backgroundColor: C.primaryLight,
  },
  productImage: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  productEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F7F5F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', lineHeight: 18 },
  productHint: { fontSize: 11, color: C.textLight, marginTop: 2 },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },

  // ── Fallback ──
  fallbackTitle: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center', marginTop: 16 },
  fallbackSub: { fontSize: 14, color: C.textMid, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 8 },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F59E0B', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24,
    marginTop: 24,
  },
  switchLink: { marginTop: 16, alignItems: 'center' },
  switchLinkText: { color: C.primary, fontSize: 14, fontWeight: '600' },

  // ── Zone selector ──
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0EDE8',
  },
  zoneLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  zoneChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB',
  },
  zoneChipActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  zoneChipText: { fontSize: 12, fontWeight: '700', color: '#111827' },

  // ── Footer ──
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0EDE8',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  addBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
