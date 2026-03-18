import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLanguageStore } from '../store/languageStore';

export default function ScanScreen() {
  const router = useRouter();
  const { t } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  // Navigate-first : navigation immédiate sans attendre le lookup API.
  // Le lookup est effectué dans add-product.tsx (avec cache mémoire).
  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    router.push({ pathname: '/add-product', params: { barcode: data } });
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
            placeholder="Code-barres (EAN)"
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
          <Ionicons name={showManualInput ? 'camera' : 'keypad'} size={24} color={showManualInput ? '#22c55e' : '#fff'} />
          <Text style={[styles.actionBtnText, showManualInput && styles.actionBtnTextActive]}>
            {showManualInput ? 'Scanner' : t('manualEntry')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleManualAdd}>
          <Ionicons name="add-circle-outline" size={24} color="#fff" />
          <Text style={styles.actionBtnText}>{t('addManually')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/scan-receipt' as any)}>
          <Ionicons name="receipt-outline" size={24} color="#fff" />
          <Text style={styles.actionBtnText}>Ticket</Text>
        </TouchableOpacity>

        {scanned && (
          <TouchableOpacity style={[styles.actionBtn, styles.rescanBtn]} onPress={() => setScanned(false)}>
            <Ionicons name="refresh" size={24} color="#22c55e" />
            <Text style={[styles.actionBtnText, { color: '#22c55e' }]}>Rescanner</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  backButton: {
    padding: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },

  cameraContainer: { flex: 1, overflow: 'hidden' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: { width: 280, height: 150, position: 'relative' },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: '#22c55e' },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },

  instructions: { padding: 20, alignItems: 'center' },
  instructionsText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },

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
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    minWidth: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  actionBtnActive: { backgroundColor: '#F0FDF4', borderColor: '#22c55e' },
  actionBtnText: { color: '#6B7280', fontSize: 12, marginTop: 4, fontWeight: '600' },
  actionBtnTextActive: { color: '#22c55e' },
  rescanBtn: { backgroundColor: '#F0FDF4', borderColor: '#22c55e' },

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
