import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';

export default function ScanScreen() {
  const router = useRouter();
  const { lookupProduct } = useStockStore();
  const { t } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned || isSearching) return;

    setScanned(true);
    setIsSearching(true);

    try {
      const result = await lookupProduct(data);

      if (result && result.product) {
        router.push({
          pathname: '/add-product',
          params: {
            barcode: data,
            name: result.product.name || '',
            brand: result.product.brand || '',
            image_url: result.product.image_url || '',
            category: result.product.category || '',
            quantity: result.product.quantity || '',
            found: 'true',
            shelf_life_category: result.shelf_life?.category_fr || '',
            shelf_life_fridge: result.shelf_life?.refrigerator_days?.toString() || '',
            shelf_life_freezer: result.shelf_life?.freezer_days?.toString() || '',
            shelf_life_pantry: result.shelf_life?.pantry_days?.toString() || '',
            shelf_life_tips: result.shelf_life?.tips_fr || '',
          },
        });
      } else {
        router.push({
          pathname: '/add-product',
          params: {
            barcode: data,
            found: 'false',
            shelf_life_category: result?.shelf_life?.category_fr || '',
            shelf_life_fridge: result?.shelf_life?.refrigerator_days?.toString() || '7',
            shelf_life_tips: result?.shelf_life?.tips_fr || '',
          },
        });
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de rechercher le produit');
      setScanned(false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualSearch = async () => {
    if (!manualBarcode.trim()) return;

    setIsSearching(true);
    try {
      const result = await lookupProduct(manualBarcode.trim());

      if (result && result.product) {
        router.push({
          pathname: '/add-product',
          params: {
            barcode: manualBarcode.trim(),
            name: result.product.name || '',
            brand: result.product.brand || '',
            image_url: result.product.image_url || '',
            category: result.product.category || '',
            quantity: result.product.quantity || '',
            found: 'true',
            shelf_life_category: result.shelf_life?.category_fr || '',
            shelf_life_fridge: result.shelf_life?.refrigerator_days?.toString() || '',
            shelf_life_freezer: result.shelf_life?.freezer_days?.toString() || '',
            shelf_life_pantry: result.shelf_life?.pantry_days?.toString() || '',
            shelf_life_tips: result.shelf_life?.tips_fr || '',
          },
        });
      } else {
        router.push({
          pathname: '/add-product',
          params: {
            barcode: manualBarcode.trim(),
            found: 'false',
            shelf_life_category: result?.shelf_life?.category_fr || '',
            shelf_life_fridge: result?.shelf_life?.refrigerator_days?.toString() || '7',
            shelf_life_tips: result?.shelf_life?.tips_fr || '',
          },
        });
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de rechercher le produit');
    } finally {
      setIsSearching(false);
    }
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

            {isSearching && (
              <View style={styles.searchingOverlay}>
                <ActivityIndicator size="large" color="#22c55e" />
                <Text style={styles.searchingText}>{t('searching')}</Text>
              </View>
            )}
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
            disabled={!manualBarcode.trim() || isSearching}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.searchButtonText}>{t('searching').replace('...', '')}</Text>
            )}
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

        {scanned && !isSearching && (
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { padding: 8, backgroundColor: '#1a1a1a', borderRadius: 10 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },

  cameraContainer: { flex: 1, overflow: 'hidden' },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: { width: 280, height: 150, position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#22c55e' },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  searchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchingText: { color: '#fff', fontSize: 16, marginTop: 12 },

  instructions: { padding: 20, alignItems: 'center' },
  instructionsText: { color: '#888', fontSize: 14, textAlign: 'center' },

  manualInputContainer: { flex: 1, padding: 20, justifyContent: 'center' },
  barcodeInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    fontSize: 20,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  searchButton: { backgroundColor: '#22c55e', borderRadius: 12, padding: 16, alignItems: 'center' },
  searchButtonDisabled: { backgroundColor: '#333' },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#0a0a0a',
  },
  actionBtn: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    minWidth: 100,
  },
  actionBtnActive: { backgroundColor: '#22c55e20' },
  actionBtnText: { color: '#fff', fontSize: 12, marginTop: 4 },
  actionBtnTextActive: { color: '#22c55e' },
  rescanBtn: { backgroundColor: '#22c55e15' },

  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginTop: 24, marginBottom: 12 },
  permissionText: { fontSize: 16, color: '#888', textAlign: 'center', marginBottom: 32 },
  permissionButton: { backgroundColor: '#22c55e', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12 },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  manualButton: { flexDirection: 'row', alignItems: 'center', marginTop: 24, padding: 12, gap: 8 },
  manualButtonText: { color: '#22c55e', fontSize: 16 },
});
