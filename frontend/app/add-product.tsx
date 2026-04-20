import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCameraPermissions } from 'expo-camera';
import { format, addDays } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';

import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { useOcrDatePicker } from '../utils/useOcrDatePicker';
import { DatePickerModal, CameraModal } from '../component/CameraDateModal';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { getThemeColors } from '../utils/theme';

type DateInputMode = 'auto' | 'duration' | 'date' | 'camera';

function paramToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parseOptionalInt(value: string | string[] | undefined): number | null {
  const parsed = parseInt(paramToString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

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

  const { addItem, lookupProduct } = useStockStore();
  const { t, language } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const styles = useMemo(() => createStyles(C), [C]);

  // Form fields
  const [name, setName] = useState(paramToString(params.name));
  const [brand, setBrand] = useState(paramToString(params.brand));
  const [quantity, setQuantity] = useState(paramToString(params.quantity));
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dateInputMode, setDateInputMode] = useState<DateInputMode>('auto');
  const [durationDays, setDurationDays] = useState('');

  // Product metadata — initially from params, updated after async lookup
  const [productFound, setProductFound] = useState(paramToString(params.found) !== 'false');
  const [imageUrl, setImageUrl] = useState(paramToString(params.image_url));
  const [foodCategory, setFoodCategory] = useState(paramToString(params.category));
  const [shelfLifeCategory, setShelfLifeCategory] = useState(paramToString(params.shelf_life_category));
  const [shelfLifeFridge, setShelfLifeFridge] = useState<number | null>(parseOptionalInt(params.shelf_life_fridge));
  const [shelfLifeFreezer, setShelfLifeFreezer] = useState<number | null>(parseOptionalInt(params.shelf_life_freezer));
  const [shelfLifePantry, setShelfLifePantry] = useState<number | null>(parseOptionalInt(params.shelf_life_pantry));
  const [shelfLifeTips, setShelfLifeTips] = useState(paramToString(params.shelf_life_tips));
  const [hasPrefilledFromLookup, setHasPrefilledFromLookup] = useState(false);
  const lastAppliedParamKeyRef = useRef<string>('');

  // Async barcode lookup — fires when barcode is provided but product name is absent (navigate-first)
  const normalizedBarcode = paramToString(params.barcode).trim();
  const normalizedParamName = paramToString(params.name).trim();
  const normalizedParamFound = paramToString(params.found);
  const [lookupLoading, setLookupLoading] = useState(() => !!normalizedBarcode && !normalizedParamName);

  useEffect(() => {
    const paramKey = JSON.stringify({
      barcode: normalizedBarcode,
      name: normalizedParamName,
      brand: paramToString(params.brand),
      quantity: paramToString(params.quantity),
      image_url: paramToString(params.image_url),
      category: paramToString(params.category),
      found: normalizedParamFound,
      shelf_life_category: paramToString(params.shelf_life_category),
      shelf_life_fridge: paramToString(params.shelf_life_fridge),
      shelf_life_freezer: paramToString(params.shelf_life_freezer),
      shelf_life_pantry: paramToString(params.shelf_life_pantry),
      shelf_life_tips: paramToString(params.shelf_life_tips),
    });
    if (lastAppliedParamKeyRef.current === paramKey) return;
    lastAppliedParamKeyRef.current = paramKey;

    setName(normalizedParamName);
    setBrand(paramToString(params.brand));
    setQuantity(paramToString(params.quantity));
    setImageUrl(paramToString(params.image_url));
    setFoodCategory(paramToString(params.category));
    setProductFound(normalizedParamFound !== 'false');
    setShelfLifeCategory(paramToString(params.shelf_life_category));
    setShelfLifeFridge(parseOptionalInt(params.shelf_life_fridge));
    setShelfLifeFreezer(parseOptionalInt(params.shelf_life_freezer));
    setShelfLifePantry(parseOptionalInt(params.shelf_life_pantry));
    setShelfLifeTips(paramToString(params.shelf_life_tips));
    setHasPrefilledFromLookup(false);
    setLookupLoading(Boolean(normalizedBarcode) && !normalizedParamName);
  }, [
    normalizedBarcode,
    normalizedParamFound,
    normalizedParamName,
    params.brand,
    params.category,
    params.image_url,
    params.quantity,
    params.shelf_life_category,
    params.shelf_life_freezer,
    params.shelf_life_fridge,
    params.shelf_life_pantry,
    params.shelf_life_tips,
  ]);

  useEffect(() => {
    if (!normalizedBarcode || normalizedParamName || hasPrefilledFromLookup) return;
    setLookupLoading(true);
    lookupProduct(normalizedBarcode).then((response) => {
      if (response?.found) {
        const apiProduct = response.product ?? {};
        const shelfLife = response.shelf_life ?? {};
        const fallbackName = apiProduct.name || apiProduct.brand || t('scannedProductFallback');
        setProductFound(true);
        setName(String(fallbackName || ''));
        setBrand(String(apiProduct.brand || ''));
        setQuantity(String(apiProduct.quantity || ''));
        setImageUrl(String(apiProduct.image_url || ''));
        setFoodCategory(String(apiProduct.category || ''));
        setShelfLifeCategory(String(shelfLife.category_fr || ''));
        setShelfLifeFridge(shelfLife.refrigerator_days ?? null);
        setShelfLifeFreezer(shelfLife.freezer_days ?? null);
        setShelfLifePantry(shelfLife.pantry_days ?? null);
        setShelfLifeTips(String(shelfLife.tips_fr || ''));
      } else {
        setProductFound(false);
      }
      setHasPrefilledFromLookup(true);
    }).finally(() => setLookupLoading(false));
  }, [hasPrefilledFromLookup, lookupProduct, normalizedBarcode, normalizedParamName, t]);

  const ocr = useOcrDatePicker(language, !!permission?.granted, (date) => {
    setExpiryDate(date);
    setShowCameraModal(false);
  });

  const hasAutoSuggestions = !!(shelfLifeFridge || shelfLifeFreezer || shelfLifePantry);

  const autoSuggestions = useMemo(() => {
    const out: { label: string; days: number; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [];
    if (shelfLifeFridge) out.push({
      label: t('suggestionRefrigerator', { days: shelfLifeFridge }),
      days: shelfLifeFridge, icon: 'snow-outline', color: '#3b82f6',
    });
    if (shelfLifePantry) out.push({
      label: t('suggestionPantry', { days: shelfLifePantry }),
      days: shelfLifePantry, icon: 'cube-outline', color: '#f59e0b',
    });
    if (shelfLifeFreezer) out.push({
      label: t('suggestionFreezer', { days: shelfLifeFreezer }),
      days: shelfLifeFreezer, icon: 'thermometer-outline', color: '#8b5cf6',
    });
    return out;
  }, [shelfLifeFridge, shelfLifePantry, shelfLifeFreezer, t]);

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

  // Quick save — no expiry date, navigate immediately
  const handleQuickSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await addItem({
        barcode:   normalizedBarcode || undefined,
        name:      name.trim(),
        brand:     brand.trim()    || undefined,
        image_url: imageUrl        || undefined,
        category:  foodCategory    || undefined,
        quantity:  quantity.trim() || undefined,
      }, { source: normalizedBarcode ? 'barcode' : 'manual' });
      router.replace('/');
    } catch {
      // silent — user can retry with full save
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(
        t('errorTitle'),
        t('productNameRequired'),
      );
      return;
    }
    setIsSaving(true);
    try {
      await addItem({
        barcode:     normalizedBarcode || undefined,
        name:        name.trim(),
        brand:       brand.trim()    || undefined,
        image_url:   imageUrl        || undefined,
        category:    foodCategory    || undefined,
        quantity:    quantity.trim() || undefined,
        expiry_date: expiryDate ? format(expiryDate, 'yyyy-MM-dd') : undefined,
        notes:       notes.trim()    || undefined,
      }, { source: normalizedBarcode ? 'barcode' : 'manual' });
      router.replace('/');
    } catch {
      Alert.alert(
        t('errorTitle'),
        t('addProductError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('addProduct')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {normalizedBarcode && (
          <View style={[styles.foundBadge, productFound ? styles.foundBadgeSuccess : styles.foundBadgeWarning]}>
            {lookupLoading ? (
              <ActivityIndicator size="small" color="#22c55e" />
            ) : (
              <Ionicons name={productFound ? 'checkmark-circle' : 'alert-circle'} size={20}
                color={productFound ? '#22c55e' : '#f97316'} />
            )}
            <Text style={[styles.foundBadgeText, { color: productFound ? '#22c55e' : '#f97316' }]}>
              {lookupLoading
                ? t('searchProductLoading')
                : productFound ? t('productFound') : t('productNotFound')}
            </Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('name')}</Text>
          {lookupLoading ? (
            <View style={[styles.input, styles.inputLoading]}>
              <ActivityIndicator size="small" color="#555" />
            </View>
          ) : (
            <TextInput
              style={styles.input} value={name} onChangeText={setName}
              placeholder={t('exampleProductName')}
              placeholderTextColor={C.textMid} autoFocus={!productFound && !lookupLoading}
            />
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('brand')}</Text>
          <TextInput
            style={styles.input} value={brand} onChangeText={setBrand}
            placeholder={t('exampleBrand')}
            placeholderTextColor={C.textMid}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('quantity')}</Text>
          <TextInput
            style={styles.input} value={quantity} onChangeText={setQuantity}
            placeholder={t('exampleQuantity')} placeholderTextColor={C.textMid}
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
                <Ionicons name="flash" size={16} color={dateInputMode === 'auto' ? C.primary : C.textMid} />
                <Text style={[styles.modeBtnText, dateInputMode === 'auto' && styles.modeBtnTextActive]}>{t('dateModeAuto')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'duration' && styles.modeBtnActive]}
              onPress={() => setDateInputMode('duration')}
            >
              <Ionicons name="time-outline" size={16} color={dateInputMode === 'duration' ? C.primary : C.textMid} />
              <Text style={[styles.modeBtnText, dateInputMode === 'duration' && styles.modeBtnTextActive]}>
                {t('dateModeDuration')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'date' && styles.modeBtnActive]}
              onPress={() => setDateInputMode('date')}
            >
              <Ionicons name="calendar-outline" size={16} color={dateInputMode === 'date' ? C.primary : C.textMid} />
              <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>{t('dateModeDate')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
              onPress={() => { setDateInputMode('camera'); setShowCameraModal(true); }}
            >
              <Ionicons name="camera-outline" size={16} color={dateInputMode === 'camera' ? C.primary : C.textMid} />
              <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>{t('dateModeScan')}</Text>
            </TouchableOpacity>
          </View>

          {dateInputMode === 'auto' && hasAutoSuggestions && (
            <View style={styles.autoSection}>
              {shelfLifeCategory && (
                <View style={styles.categoryBadge}>
                  <Ionicons name="information-circle" size={16} color="#22c55e" />
                  <Text style={styles.categoryText}>
                    {t('categoryLabel', { name: shelfLifeCategory })}
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
                    <Ionicons name="chevron-forward" size={20} color={C.textMid} />
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
                  placeholder={t('durationPlaceholder')}
                  placeholderTextColor={C.textMid} keyboardType="numeric"
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
                {expiryDate ? formatDisplayDate(expiryDate) : t('chooseDate')}
              </Text>
            </TouchableOpacity>
          )}

          {dateInputMode === 'camera' && (
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowCameraModal(true)}>
              <Ionicons name="scan-outline" size={18} color="#22c55e" />
              <Text style={styles.datePickerBtnText}>
                {t('openOcrScanner')}
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
            placeholder={t('additionalNotesPlaceholder')}
            placeholderTextColor={C.textMid} multiline
          />
        </View>

        {/* Quick save — no expiry date required */}
        {name.trim() && !expiryDate && (
          <TouchableOpacity
            style={[styles.quickSaveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleQuickSave} disabled={isSaving}
          >
            <Ionicons name="flash" size={18} color="#f59e0b" />
            <Text style={styles.quickSaveBtnText}>
              {t('quickAddNoDate')}
            </Text>
          </TouchableOpacity>
        )}

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
        onImportAndScan={ocr.handleImportAndScan}
        onScannedDateChange={ocr.handleScannedDateChange}
        onConfirm={ocr.handleScannedDateConfirm}
        onCameraLayout={ocr.handleCameraLayout}
      />
    </SafeAreaView>
  );
}

const createStyles = (C: ReturnType<typeof getThemeColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: '700' },

  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  foundBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16,
  },
  foundBadgeSuccess: { borderColor: C.primary + '55', backgroundColor: C.primary + '10' },
  foundBadgeWarning: { borderColor: C.orange + '55', backgroundColor: C.orange + '10' },
  foundBadgeText: { fontSize: 14, fontWeight: '600' },

  inputGroup: { marginBottom: 18 },
  label: { color: C.text, marginBottom: 8, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: C.surfaceMuted, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, color: C.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  inputLoading: {
    alignItems: 'center', justifyContent: 'center', height: 48,
  },
  notesInput: { minHeight: 90, textAlignVertical: 'top' },

  modeSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surfaceMuted,
  },
  modeBtnActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  modeBtnText: { color: C.textMid, fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: C.primary },

  autoSection: { gap: 10 },
  categoryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryLight, borderColor: C.primary + '40', borderWidth: 1,
    borderRadius: 10, padding: 10,
  },
  categoryText: { color: C.primary, fontSize: 13, fontWeight: '500' },
  autoSuggestions: { gap: 8 },
  suggestionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 12,
  },
  suggestionIcon: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  suggestionContent: { flex: 1 },
  suggestionLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  suggestionDate: { color: C.textMid, fontSize: 12, marginTop: 2 },
  tipText: { color: C.textMid, fontSize: 12, lineHeight: 18 },

  durationSection: { marginTop: 4 },
  durationInputRow: { flexDirection: 'row', gap: 8 },
  durationInput: {
    flex: 1, backgroundColor: C.surfaceMuted, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, color: C.text, paddingHorizontal: 14, paddingVertical: 12,
  },
  applyBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
  },
  applyBtnText: { color: '#fff', fontWeight: '700' },

  datePickerBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surfaceMuted, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  datePickerBtnText: { color: C.text, fontSize: 14 },

  selectedDateBadge: {
    marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: C.primary + '55', backgroundColor: C.primaryLight,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  selectedDateText: { color: C.primary, fontSize: 13, fontWeight: '600' },

  quickSaveBtn: {
    marginTop: 4, marginBottom: 10, borderRadius: 12,
    borderWidth: 1, borderColor: C.yellow + '55', backgroundColor: C.yellowLight,
    height: 46, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  quickSaveBtnText: { color: C.yellow, fontWeight: '700', fontSize: 14 },

  saveBtn: {
    marginTop: 10, borderRadius: 12, backgroundColor: C.primary,
    height: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
