import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
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
import { extractPremiumErrorDetail } from '../utils/premiumErrors';
import { usePremiumUiStore } from '../store/premiumUiStore';
import { getGalleryErrorMessage, pickImageFromGallery } from '../utils/galleryPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceiptProduct {
  name: string;
  category: string;
  food_category: string;
  shelf_life_fridge: number | null;
  shelf_life_pantry: number | null;
  shelf_life_freezer: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  frais: '🥛', proteines: '🥩', legumes: '🥕', feculents: '🍞',
  desserts: '🍰', boissons: '🧃', epicerie: '🏪', autres: '📦',
};

function shelfHint(p: ReceiptProduct, isFr: boolean): string {
  if (p.shelf_life_fridge)   return isFr ? `~${p.shelf_life_fridge}j frigo`    : `~${p.shelf_life_fridge}d fridge`;
  if (p.shelf_life_pantry)   return isFr ? `~${p.shelf_life_pantry}j placard`  : `~${p.shelf_life_pantry}d pantry`;
  if (p.shelf_life_freezer)  return isFr ? `~${p.shelf_life_freezer}j congélo` : `~${p.shelf_life_freezer}d freezer`;
  return '';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type Mode = 'camera' | 'processing' | 'confirm';

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

  // ── Capture & analyse ──────────────────────────────────────────────────────

  const processReceiptImage = async (base64Image: string) => {
    setMode('processing');
    try {
      const res = await axios.post(
        buildApiUrl('/api/ocr/receipt'),
        { image: base64Image },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const detected: ReceiptProduct[] = res.data;

      if (detected.length === 0) {
        Alert.alert(
          isFr ? 'Aucun produit détecté' : 'No products detected',
          isFr
            ? 'Assurez-vous que le ticket est bien éclairé et lisible.'
            : 'Make sure the receipt is well-lit and readable.',
        );
        setMode('camera');
        return;
      }

      setProducts(detected);
      setSelected(new Set(detected.map((_, i) => i)));
      setMode('confirm');
    } catch (err: any) {
      const premiumError = extractPremiumErrorDetail(err);
      if (premiumError) {
        openPaywall(premiumError);
        router.push('/premium');
      } else {
        Alert.alert(
          isFr ? 'Erreur' : 'Error',
          isFr ? "Impossible d'analyser le ticket." : 'Unable to analyse the receipt.',
        );
      }
      setMode('camera');
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
        toAdd.map(p =>
          addItem({
            name:          p.name,
            category:      p.category,
            food_category: p.food_category,
          }),
        ),
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
          ? 'Sélectionnez les produits à ajouter au stock (sans date — à renseigner plus tard)'
          : 'Select products to add to stock (no date — set later)'}
      </Text>

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
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{p.name}</Text>
                {hint ? (
                  <Text style={styles.productHint}>{hint}</Text>
                ) : null}
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
  productEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
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
