import React, { useState, useEffect, useMemo } from 'react';
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
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { format, addDays, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { useOcrDatePicker } from '../utils/useOcrDatePicker';
import { DatePickerModal, CameraModal } from '../component/CameraDateModal';
import { useAppSettingsStore } from '../store/appSettingsStore';
import { getThemeColors } from '../utils/theme';
import { persistProductEdit, toApiExpiryDate } from '../utils/productEditFlow';

type DateInputMode = 'duration' | 'date' | 'camera';

export default function EditProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { items, updateItem, fetchStock } = useStockStore();
  const { t, language } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();
  const themeMode = useAppSettingsStore((state) => state.themeMode);
  const C = getThemeColors(themeMode);
  const styles = useMemo(() => createStyles(C), [C]);

  const [item, setItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [dateInputMode, setDateInputMode] = useState<DateInputMode>('date');
  const [durationDays, setDurationDays] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);

  const ocr = useOcrDatePicker(language, !!permission?.granted, (date) => {
    setExpiryDate(date);
    setShowCameraModal(false);
  });

  useEffect(() => {
    const foundItem = items.find(i => i.id === params.id);
    if (foundItem) {
      setItem(foundItem);
      setName(foundItem.name || '');
      setBrand(foundItem.brand || '');
      setQuantity(foundItem.quantity || '');
      setNotes(foundItem.notes || '');
      if (foundItem.expiry_date) {
        try {
          setExpiryDate(parseISO(foundItem.expiry_date));
        } catch {
          setExpiryDate(null);
        }
      }
    }
  }, [params.id, items]);

  const handleDurationApply = () => {
    const days = parseInt(durationDays);
    if (days > 0) {
      setExpiryDate(addDays(new Date(), days));
      setDurationDays('');
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
      const didPersist = await persistProductEdit({
        itemId: params.id!,
        updateItem,
        fetchStock,
        updates: {
        name: name.trim(),
        brand: brand.trim() || undefined,
        quantity: quantity.trim() || undefined,
        expiry_date: toApiExpiryDate(expiryDate),
        notes: notes.trim() || undefined,
        },
      });
      if (!didPersist) {
        throw new Error('update_failed');
      }

      Alert.alert(
        t('updateProductSuccessTitle'),
        '',
        [{ text: t('confirm'), onPress: () => router.back() }],
      );
    } catch {
      Alert.alert(
        t('errorTitle'),
        t('updateProductError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const formatDisplayDate = (date: Date) =>
    format(date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS });

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#22c55e" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('editProduct')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('productName')} *</Text>
            <TextInput
              testID="edit-product-name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('productName')}
              placeholderTextColor={C.textMid}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('brand')}</Text>
            <TextInput
              style={styles.input}
              value={brand}
              onChangeText={setBrand}
              placeholder={t('brand')}
              placeholderTextColor={C.textMid}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('quantity')}</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              placeholder={t('exampleQuantity')}
              placeholderTextColor={C.textMid}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('expiryDate')}</Text>

            <View style={styles.modeSelector}>
              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'duration' && styles.modeBtnActive]}
                onPress={() => setDateInputMode('duration')}
              >
                <Ionicons name="time-outline" size={18} color={dateInputMode === 'duration' ? '#fff' : C.textMid} />
                <Text style={[styles.modeBtnText, dateInputMode === 'duration' && styles.modeBtnTextActive]}>
                  {t('dateModeDuration')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'date' && styles.modeBtnActive]}
                onPress={() => setDateInputMode('date')}
              >
                <Ionicons name="calendar-outline" size={18} color={dateInputMode === 'date' ? '#fff' : C.textMid} />
                <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>
                  {t('dateModeDate')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
                onPress={() => { setDateInputMode('camera'); setShowCameraModal(true); }}
              >
                <Ionicons name="camera-outline" size={18} color={dateInputMode === 'camera' ? '#fff' : C.textMid} />
                <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>
                  {t('dateModeScan')}
                </Text>
              </TouchableOpacity>
            </View>

            {dateInputMode === 'duration' && (
              <View style={styles.durationInput}>
                <TextInput
                  style={styles.durationField}
                  value={durationDays}
                  onChangeText={setDurationDays}
                  placeholder={t('durationPlaceholder')}
                  placeholderTextColor={C.textMid}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={[styles.applyBtn, !durationDays && styles.applyBtnDisabled]}
                  onPress={handleDurationApply}
                  disabled={!durationDays}
                >
                  <Text style={styles.applyBtnText}>
                    {t('apply')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {dateInputMode === 'date' && (
              <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar" size={20} color="#22c55e" />
                <Text style={styles.dateButtonText}>
                  {expiryDate ? formatDisplayDate(expiryDate) : t('selectDate')}
                </Text>
              </TouchableOpacity>
            )}

            {expiryDate && (
              <View style={styles.currentDateBox}>
                <View style={styles.currentDateContent}>
                  <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                  <Text style={styles.currentDateText}>{formatDisplayDate(expiryDate)}</Text>
                </View>
                <TouchableOpacity onPress={() => setExpiryDate(null)}>
                  <Ionicons name="close-circle" size={24} color="#ef4444" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('notes')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('optionalNotesPlaceholder')}
              placeholderTextColor={C.textMid}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          testID="edit-product-save-button"
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={24} color="#fff" />
              <Text style={styles.saveButtonText}>{t('save')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

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
  },
  backButton: { padding: 8, backgroundColor: C.surfaceMuted, borderRadius: 10 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: C.text },

  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  form: { gap: 20 },

  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: C.textMid },
  input: { backgroundColor: C.surfaceMuted, borderRadius: 10, padding: 14, fontSize: 16, color: C.text },
  notesInput: { height: 80, textAlignVertical: 'top' },

  modeSelector: {
    flexDirection: 'row', backgroundColor: C.surfaceMuted,
    borderRadius: 10, padding: 4, marginBottom: 12,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, gap: 6,
  },
  modeBtnActive: { backgroundColor: C.primary },
  modeBtnText: { fontSize: 13, color: C.textMid, fontWeight: '500' },
  modeBtnTextActive: { color: '#fff' },

  durationInput: { flexDirection: 'row', gap: 10 },
  durationField: { flex: 1, backgroundColor: C.surfaceMuted, borderRadius: 10, padding: 14, fontSize: 16, color: C.text },
  applyBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  applyBtnDisabled: { backgroundColor: C.border },
  applyBtnText: { color: '#fff', fontWeight: '600' },

  dateButton: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surfaceMuted, borderRadius: 10, padding: 14, gap: 10,
  },
  dateButtonText: { flex: 1, fontSize: 16, color: C.text },

  currentDateBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.primaryLight, borderRadius: 10, padding: 14, marginTop: 8,
  },
  currentDateContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currentDateText: { fontSize: 15, color: C.primary, fontWeight: '500' },

  footer: { padding: 20, paddingBottom: 30 },
  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary, borderRadius: 12, padding: 16, gap: 8,
  },
  saveButtonDisabled: { backgroundColor: C.border },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
