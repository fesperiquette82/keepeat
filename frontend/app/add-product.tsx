import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { format, addDays } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';

import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { useOcrDatePicker } from '../utils/useOcrDatePicker';
import { DatePickerModal, CameraModal } from '../component/CameraDateModal';

type DateInputMode = 'auto' | 'duration' | 'date' | 'camera';

// ─── AddProductScreen ──────────────────────────────────────────────────────────

export default function AddProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    barcode?: string;
    name?: string;
    brand?: string;
    image_url?: string;
    category?: string;
    quantity?: string;
    found?: string;
    shelf_life_category?: string;
    shelf_life_fridge?: string;
    shelf_life_freezer?: string;
    shelf_life_pantry?: string;
    shelf_life_tips?: string;
  }>();

  const { addItem } = useStockStore();
  const { t, language } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();

  const [name, setName] = useState(params.name || '');
  const [brand, setBrand] = useState(params.brand || '');
  const [quantity, setQuantity] = useState(params.quantity || '');
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dateInputMode, setDateInputMode] = useState<DateInputMode>('auto');
  const [durationDays, setDurationDays] = useState('');

  const ocr = useOcrDatePicker(language, !!permission?.granted, (date) => {
    setExpiryDate(date);
    setShowCameraModal(false);
  });

  const productFound = params.found === 'true';

  const shelfLifeCategory = params.shelf_life_category || '';
  const shelfLifeFridge  = params.shelf_life_fridge  ? parseInt(params.shelf_life_fridge,  10) : null;
  const shelfLifeFreezer = params.shelf_life_freezer ? parseInt(params.shelf_life_freezer, 10) : null;
  const shelfLifePantry  = params.shelf_life_pantry  ? parseInt(params.shelf_life_pantry,  10) : null;
  const shelfLifeTips = params.shelf_life_tips || '';
  const hasAutoSuggestions = !!(shelfLifeFridge || shelfLifeFreezer || shelfLifePantry);

  const autoSuggestions = useMemo(() => {
    const out: { label: string; days: number; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [];
    if (shelfLifeFridge) out.push({
      label: language === 'fr' ? `Réfrigérateur (${shelfLifeFridge}j)` : `Refrigerator (${shelfLifeFridge}d)`,
      days: shelfLifeFridge, icon: 'snow-outline', color: '#3b82f6',
    });
    if (shelfLifePantry) out.push({
      label: language === 'fr' ? `Placard (${shelfLifePantry}j)` : `Pantry (${shelfLifePantry}d)`,
      days: shelfLifePantry, icon: 'cube-outline', color: '#f59e0b',
    });
    if (shelfLifeFreezer) out.push({
      label: language === 'fr' ? `Congélateur (${shelfLifeFreezer}j)` : `Freezer (${shelfLifeFreezer}d)`,
      days: shelfLifeFreezer, icon: 'thermometer-outline', color: '#8b5cf6',
    });
    return out;
  }, [shelfLifeFridge, shelfLifePantry, shelfLifeFreezer, language]);

  const formatDisplayDate = (date: Date) =>
    format(date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS });

  const handleDurationApply = () => {
    const days = parseInt(durationDays, 10);
    if (days > 0) {
      setExpiryDate(addDays(new Date(), days));
      setDurationDays('');
    }
  };

  const handleAutoSuggestion = (days: number) => {
    setExpiryDate(addDays(new Date(), days));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(
        language === 'fr' ? 'Erreur' : 'Error',
        language === 'fr' ? 'Le nom du produit est requis' : 'Product name is required',
      );
      return;
    }
    setIsSaving(true);
    try {
      const newItem = await addItem({
        barcode:    params.barcode    || undefined,
        name:       name.trim(),
        brand:      brand.trim()      || undefined,
        image_url:  params.image_url  || undefined,
        category:   params.category   || undefined,
        quantity:   quantity.trim()   || undefined,
        expiry_date: expiryDate ? format(expiryDate, 'yyyy-MM-dd') : undefined,
        notes:      notes.trim()      || undefined,
      });
      if (newItem) {
        Alert.alert(t('productAdded'), '', [{ text: 'OK', onPress: () => router.replace('/') }]);
      }
    } catch {
      Alert.alert(
        language === 'fr' ? 'Erreur' : 'Error',
        language === 'fr' ? "Impossible d'ajouter le produit" : 'Unable to add product',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('addProduct')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {params.barcode && (
          <View style={[styles.foundBadge, productFound ? styles.foundBadgeSuccess : styles.foundBadgeWarning]}>
            <Ionicons name={productFound ? 'checkmark-circle' : 'alert-circle'} size={20}
              color={productFound ? '#22c55e' : '#f97316'} />
            <Text style={[styles.foundBadgeText, { color: productFound ? '#22c55e' : '#f97316' }]}>
              {productFound ? t('productFound') : t('productNotFound')}
            </Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('name')}</Text>
          <TextInput
            style={styles.input} value={name} onChangeText={setName}
            placeholder={language === 'fr' ? 'Ex: Lait demi-écrémé' : 'Ex: Semi-skimmed milk'}
            placeholderTextColor="#666" autoFocus={!productFound}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('brand')}</Text>
          <TextInput
            style={styles.input} value={brand} onChangeText={setBrand}
            placeholder={language === 'fr' ? 'Ex: Lactel' : 'Ex: Brand name'}
            placeholderTextColor="#666"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('quantity')}</Text>
          <TextInput
            style={styles.input} value={quantity} onChangeText={setQuantity}
            placeholder="Ex: 1L, 500g" placeholderTextColor="#666"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('expiryDate')}</Text>

          <View style={styles.modeSelector}>
            {hasAutoSuggestions && (
              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'auto' && styles.modeBtnActive]}
                onPress={() => setDateInputMode('auto')}
              >
                <Ionicons name="flash" size={16} color={dateInputMode === 'auto' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'auto' && styles.modeBtnTextActive]}>Auto</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'duration' && styles.modeBtnActive]}
              onPress={() => setDateInputMode('duration')}
            >
              <Ionicons name="time-outline" size={16} color={dateInputMode === 'duration' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, dateInputMode === 'duration' && styles.modeBtnTextActive]}>
                {language === 'fr' ? 'Durée' : 'Duration'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'date' && styles.modeBtnActive]}
              onPress={() => setDateInputMode('date')}
            >
              <Ionicons name="calendar-outline" size={16} color={dateInputMode === 'date' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>Date</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
              onPress={() => { setDateInputMode('camera'); setShowCameraModal(true); }}
            >
              <Ionicons name="camera-outline" size={16} color={dateInputMode === 'camera' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>Scan</Text>
            </TouchableOpacity>
          </View>

          {dateInputMode === 'auto' && hasAutoSuggestions && (
            <View style={styles.autoSection}>
              {shelfLifeCategory && (
                <View style={styles.categoryBadge}>
                  <Ionicons name="information-circle" size={16} color="#22c55e" />
                  <Text style={styles.categoryText}>
                    {language === 'fr' ? 'Catégorie: ' : 'Category: '}{shelfLifeCategory}
                  </Text>
                </View>
              )}
              <View style={styles.autoSuggestions}>
                {autoSuggestions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.suggestionCard, { borderColor: s.color }]}
                    onPress={() => handleAutoSuggestion(s.days)}
                  >
                    <View style={[styles.suggestionIcon, { backgroundColor: s.color + '20' }]}>
                      <Ionicons name={s.icon} size={24} color={s.color} />
                    </View>
                    <View style={styles.suggestionContent}>
                      <Text style={styles.suggestionLabel}>{s.label}</Text>
                      <Text style={styles.suggestionDate}>
                        → {format(addDays(new Date(), s.days), 'dd MMM yyyy', { locale: language === 'fr' ? fr : enUS })}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#666" />
                  </TouchableOpacity>
                ))}
              </View>
              {shelfLifeTips ? <Text style={styles.tipText}>💡 {shelfLifeTips}</Text> : null}
            </View>
          )}

          {dateInputMode === 'duration' && (
            <View style={styles.durationSection}>
              <View style={styles.durationInputRow}>
                <TextInput
                  style={styles.durationInput}
                  value={durationDays} onChangeText={setDurationDays}
                  placeholder={language === 'fr' ? 'Nombre de jours' : 'Number of days'}
                  placeholderTextColor="#666" keyboardType="numeric"
                />
                <TouchableOpacity style={styles.applyBtn} onPress={handleDurationApply}>
                  <Text style={styles.applyBtnText}>{t('apply')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {dateInputMode === 'date' && (
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar" size={18} color="#22c55e" />
              <Text style={styles.datePickerBtnText}>
                {expiryDate ? formatDisplayDate(expiryDate) : language === 'fr' ? 'Choisir une date' : 'Choose a date'}
              </Text>
            </TouchableOpacity>
          )}

          {dateInputMode === 'camera' && (
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowCameraModal(true)}>
              <Ionicons name="scan-outline" size={18} color="#22c55e" />
              <Text style={styles.datePickerBtnText}>
                {language === 'fr' ? 'Ouvrir le scanner OCR' : 'Open OCR scanner'}
              </Text>
            </TouchableOpacity>
          )}

          {expiryDate && (
            <View style={styles.selectedDateBadge}>
              <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
              <Text style={styles.selectedDateText}>{formatDisplayDate(expiryDate)}</Text>
            </View>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('notes')}</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes} onChangeText={setNotes}
            placeholder={language === 'fr' ? 'Infos complémentaires...' : 'Additional notes...'}
            placeholderTextColor="#666" multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
          onPress={handleSave} disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>{t('save')}</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>

      <DatePickerModal
        visible={showDatePicker}
        expiryDate={expiryDate}
        language={language}
        t={t}
        onConfirm={(date) => { setExpiryDate(date); setShowDatePicker(false); }}
        onCancel={() => setShowDatePicker(false)}
      />

      <CameraModal
        visible={showCameraModal}
        onClose={() => { setShowCameraModal(false); ocr.resetOcr(); }}
        permissionGranted={!!permission?.granted}
        requestPermission={requestPermission}
        cameraRef={ocr.cameraRef}
        isOcrProcessing={ocr.isOcrProcessing}
        ocrError={ocr.ocrError}
        ocrDebug={ocr.ocrDebug}
        scannedDateText={ocr.scannedDateText}
        parsedDateInfo={ocr.parsedDateInfo}
        language={language}
        t={t}
        onCaptureAndScan={ocr.handleCaptureAndScan}
        onScannedDateChange={ocr.handleScannedDateChange}
        onConfirm={ocr.handleScannedDateConfirm}
        onCameraLayout={ocr.handleCameraLayout}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1f1f1f',
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },

  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  foundBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16,
  },
  foundBadgeSuccess: { borderColor: '#22c55e55', backgroundColor: '#22c55e10' },
  foundBadgeWarning: { borderColor: '#f9731655', backgroundColor: '#f9731610' },
  foundBadgeText: { fontSize: 14, fontWeight: '600' },

  inputGroup: { marginBottom: 18 },
  label: { color: '#ddd', marginBottom: 8, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#111', borderColor: '#2a2a2a', borderWidth: 1,
    borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  notesInput: { minHeight: 90, textAlignVertical: 'top' },

  modeSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#333', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#111',
  },
  modeBtnActive: { borderColor: '#22c55e', backgroundColor: '#22c55e20' },
  modeBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },

  autoSection: { gap: 10 },
  categoryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0f2617', borderColor: '#1f5f3a', borderWidth: 1,
    borderRadius: 10, padding: 10,
  },
  categoryText: { color: '#89f0b6', fontSize: 13, fontWeight: '500' },
  autoSuggestions: { gap: 8 },
  suggestionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, backgroundColor: '#111', borderRadius: 12, padding: 12, gap: 12,
  },
  suggestionIcon: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  suggestionContent: { flex: 1 },
  suggestionLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  suggestionDate: { color: '#aaa', fontSize: 12, marginTop: 2 },
  tipText: { color: '#aaa', fontSize: 12, lineHeight: 18 },

  durationSection: { marginTop: 4 },
  durationInputRow: { flexDirection: 'row', gap: 8 },
  durationInput: {
    flex: 1, backgroundColor: '#111', borderColor: '#2a2a2a', borderWidth: 1,
    borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 12,
  },
  applyBtn: {
    backgroundColor: '#22c55e', borderRadius: 12,
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
  },
  applyBtnText: { color: '#fff', fontWeight: '700' },

  datePickerBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a',
    backgroundColor: '#111', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  datePickerBtnText: { color: '#e6e6e6', fontSize: 14 },

  selectedDateBadge: {
    marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#22c55e55', backgroundColor: '#22c55e15',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  selectedDateText: { color: '#9bf2bd', fontSize: 13, fontWeight: '600' },

  saveBtn: {
    marginTop: 10, borderRadius: 12, backgroundColor: '#22c55e',
    height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
