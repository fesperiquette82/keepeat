import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLanguageStore } from '../store/languageStore';
import { getGalleryErrorMessage, pickImageFromGallery } from '../utils/galleryPicker';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { getThemeColors } from '../utils/theme';

export default function ScanScreen() {
  const router = useRouter();
  const { t } = useLanguageStore();
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const styles = useMemo(() => createStyles(C, themeMode), [C, themeMode]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  // Navigate-first : navigation immédiate sans attendre le lookup API.
  // Le lookup est effectué dans add-product.tsx (avec cache mémoire).
  const handleBarcodeDetected = (data: string) => {
    if (scanned) return;
    setScanned(true);
    router.push({ pathname: '/add-product', params: { barcode: data } });
  };
  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    handleBarcodeDetected(data);
  };

  const handleImportBarcode = async () => {
    const picked = await pickImageFromGallery({ includeBase64: false, quality: 0.9 });
    if (picked.status === 'cancelled') return;
    const galleryError = getGalleryErrorMessage(picked, {
      permissionDenied: t('galleryPermissionRequired'),
      unavailable: t('galleryUnavailable'),
      invalidImage: t('invalidImage'),
    });
    if (galleryError) {
      Alert.alert(t('errorTitle'), galleryError);
      return;
    }
    if (picked.status !== 'success') return;
    try {
      const results = await scanFromURLAsync(picked.asset.uri, ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39']);
      const barcode = results?.[0]?.data;
      if (!barcode) {
        Alert.alert(t('errorTitle'), t('barcodeNotDetected'));
        return;
      }
      handleBarcodeDetected(barcode);
    } catch {
      Alert.alert(t('errorTitle'), t('scanFailed'));
    }
  };

  const handleManualSearch = () => {
    if (!manualBarcode.trim()) return;
    router.push({ pathname: '/add-product', params: { barcode: manualBarcode.trim() } });
  };

  const handleManualAdd = () => {
    router.push({
      pathname: '/add-product',
      params: { found: 'false' },
    });
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#22c55e" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={80} color="#22c55e" />
          <Text style={styles.permissionTitle}>{t('cameraPermission')}</Text>
          <Text style={styles.permissionText}>{t('cameraPermissionText')}</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>{t('cameraPermission')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.manualButton} onPress={handleManualAdd}>
            <Ionicons name="create-outline" size={20} color="#22c55e" />
            <Text style={styles.manualButtonText}>{t('manualEntry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('scanTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Camera View */}
      {!showManualInput ? (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            <View style={styles.overlay}>
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
            </View>

          </CameraView>

          <View style={styles.instructions}>
            <Text style={styles.instructionsText}>{t('scanInstructions')}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.manualInputContainer}>
          <TextInput
            style={styles.barcodeInput}
            value={manualBarcode}
            onChangeText={setManualBarcode}
            placeholder={t('barcodePlaceholder')}
            placeholderTextColor="#666"
            keyboardType="numeric"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.searchButton, !manualBarcode.trim() && styles.searchButtonDisabled]}
            onPress={handleManualSearch}
            disabled={!manualBarcode.trim()}
          >
            <Text style={styles.searchButtonText}>{t('searching').replace('...', '')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Actions */}
      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={[styles.actionBtn, showManualInput && styles.actionBtnActive]}
          onPress={() => setShowManualInput(!showManualInput)}
        >
          <Ionicons
            name={showManualInput ? 'camera' : 'keypad'}
            size={22}
            color={showManualInput ? '#16A34A' : '#1F2937'}
          />
          <Text style={[styles.actionBtnText, showManualInput && styles.actionBtnTextActive]}>
            {showManualInput ? t('scanner') : t('manualEntry')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleManualAdd}>
          <Ionicons name="add-circle-outline" size={22} color="#1F2937" />
          <Text style={styles.actionBtnText}>{t('addManually')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/scan-receipt' as any)}>
          <Ionicons name="receipt-outline" size={22} color="#1F2937" />
          <Text style={styles.actionBtnText}>{t('ticket')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleImportBarcode}>
          <Ionicons name="images-outline" size={22} color="#1F2937" />
          <Text style={styles.actionBtnText}>{t('gallery')}</Text>
        </TouchableOpacity>

        {scanned && (
          <TouchableOpacity style={[styles.actionBtn, styles.rescanBtn]} onPress={() => setScanned(false)}>
            <Ionicons name="refresh" size={24} color="#22c55e" />
            <Text style={[styles.actionBtnText, { color: '#22c55e' }]}>{t('rescan')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>, themeMode: 'light' | 'dark') => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  backButton: {
    padding: 8,
    backgroundColor: themeMode === 'dark' ? C.surfaceMuted : '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  headerTitle: { fontSize: 19, fontWeight: '900', color: C.text, letterSpacing: 0.2 },

  cameraContainer: { flex: 1, overflow: 'hidden' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: { width: 280, height: 150, position: 'relative' },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#22C55E',
    shadowColor: '#22C55E',
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 5,
    elevation: 3,
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3.5, borderLeftWidth: 3.5, borderTopLeftRadius: 5 },
  topRight: { top: 0, right: 0, borderTopWidth: 3.5, borderRightWidth: 3.5, borderTopRightRadius: 5 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3.5, borderLeftWidth: 3.5, borderBottomLeftRadius: 5 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3.5, borderRightWidth: 3.5, borderBottomRightRadius: 5 },

  instructions: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    alignItems: 'center',
    backgroundColor: themeMode === 'dark' ? 'rgba(2,6,23,0.86)' : C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  instructionsText: {
    color: '#F8FAFC',
    fontSize: 16,
    lineHeight: 21,
    textAlign: 'center',
    fontWeight: '700',
  },

  manualInputContainer: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#F7F8FA' },
  barcodeInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    fontSize: 22,
    color: '#111827',
    textAlign: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    fontWeight: '700',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  searchButton: {
    backgroundColor: '#22c55e',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  searchButtonDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0 },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    minWidth: 100,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  actionBtnActive: { backgroundColor: '#ECFDF3', borderColor: '#22C55E' },
  actionBtnText: { color: '#111827', fontSize: 12, marginTop: 4, fontWeight: '700' },
  actionBtnTextActive: { color: '#166534' },
  rescanBtn: { backgroundColor: '#ECFDF3', borderColor: '#22C55E' },

  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#F7F8FA',
  },
  permissionTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 24, marginBottom: 12 },
  permissionText: { fontSize: 16, color: '#6B7280', textAlign: 'center', marginBottom: 32 },
  permissionButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  manualButton: { flexDirection: 'row', alignItems: 'center', marginTop: 24, padding: 12, gap: 8 },
  manualButtonText: { color: '#22c55e', fontSize: 16, fontWeight: '600' },
});
