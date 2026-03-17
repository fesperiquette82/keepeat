import React, { useState, useEffect } from 'react';
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
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { format, addDays, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { useOcrDatePicker } from '../utils/useOcrDatePicker';
import { DatePickerModal, CameraModal } from '../component/CameraDateModal';

type DateInputMode = 'duration' | 'date' | 'camera';

export default function EditProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { items, updateItem, fetchStock } = useStockStore();
  const { t, language } = useLanguageStore();
  const [permission, requestPermission] = useCameraPermissions();

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
        language === 'fr' ? 'Erreur' : 'Error',
        language === 'fr' ? 'Le nom du produit est requis' : 'Product name is required',
      );
      return;
    }

    setIsSaving(true);
    try {
      await updateItem(params.id!, {
        name: name.trim(),
        brand: brand.trim() || undefined,
        quantity: quantity.trim() || undefined,
        expiry_date: expiryDate ? format(expiryDate, 'yyyy-MM-dd') : undefined,
        notes: notes.trim() || undefined,
      });

      await fetchStock();

      Alert.alert(
        language === 'fr' ? 'Modifié !' : 'Updated!',
        '',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch {
      Alert.alert(
        language === 'fr' ? 'Erreur' : 'Error',
        language === 'fr' ? 'Impossible de modifier le produit' : 'Unable to update product',
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
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {language === 'fr' ? 'Modifier le produit' : 'Edit product'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('productName')} *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={language === 'fr' ? 'Nom du produit' : 'Product name'}
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('brand')}</Text>
            <TextInput
              style={styles.input}
              value={brand}
              onChangeText={setBrand}
              placeholder={language === 'fr' ? 'Marque' : 'Brand'}
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('quantity')}</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              placeholder="Ex: 1L, 500g"
              placeholderTextColor="#666"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('expiryDate')}</Text>

            <View style={styles.modeSelector}>
              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'duration' && styles.modeBtnActive]}
                onPress={() => setDateInputMode('duration')}
              >
                <Ionicons name="time-outline" size={18} color={dateInputMode === 'duration' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'duration' && styles.modeBtnTextActive]}>
                  {language === 'fr' ? 'Durée' : 'Duration'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'date' && styles.modeBtnActive]}
                onPress={() => setDateInputMode('date')}
              >
                <Ionicons name="calendar-outline" size={18} color={dateInputMode === 'date' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>
                  {language === 'fr' ? 'Date' : 'Date'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
                onPress={() => { setDateInputMode('camera'); setShowCameraModal(true); }}
              >
                <Ionicons name="camera-outline" size={18} color={dateInputMode === 'camera' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>
                  {language === 'fr' ? 'Scanner' : 'Scan'}
                </Text>
              </TouchableOpacity>
            </View>

            {dateInputMode === 'duration' && (
              <View style={styles.durationInput}>
                <TextInput
                  style={styles.durationField}
                  value={durationDays}
                  onChangeText={setDurationDays}
                  placeholder={language === 'fr' ? 'Nombre de jours' : 'Number of days'}
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={[styles.applyBtn, !durationDays && styles.applyBtnDisabled]}
                  onPress={handleDurationApply}
                  disabled={!durationDays}
                >
                  <Text style={styles.applyBtnText}>
                    {language === 'fr' ? 'Appliquer' : 'Apply'}
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
              placeholder={language === 'fr' ? 'Notes optionnelles...' : 'Optional notes...'}
              placeholderTextColor="#666"
              multiline
              numberOfLines={3}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
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
  },
  backButton: { padding: 8, backgroundColor: '#1a1a1a', borderRadius: 10 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },

  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  form: { gap: 20 },

  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: '#888' },
  input: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, fontSize: 16, color: '#fff' },
  notesInput: { height: 80, textAlignVertical: 'top' },

  modeSelector: {
    flexDirection: 'row', backgroundColor: '#1a1a1a',
    borderRadius: 10, padding: 4, marginBottom: 12,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, gap: 6,
  },
  modeBtnActive: { backgroundColor: '#22c55e' },
  modeBtnText: { fontSize: 13, color: '#888', fontWeight: '500' },
  modeBtnTextActive: { color: '#fff' },

  durationInput: { flexDirection: 'row', gap: 10 },
  durationField: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, fontSize: 16, color: '#fff' },
  applyBtn: { backgroundColor: '#22c55e', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  applyBtnDisabled: { backgroundColor: '#333' },
  applyBtnText: { color: '#fff', fontWeight: '600' },

  dateButton: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, gap: 10,
  },
  dateButtonText: { flex: 1, fontSize: 16, color: '#fff' },

  currentDateBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#22c55e15', borderRadius: 10, padding: 14, marginTop: 8,
  },
  currentDateContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currentDateText: { fontSize: 15, color: '#22c55e', fontWeight: '500' },

  footer: { padding: 20, paddingBottom: 30 },
  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#22c55e', borderRadius: 12, padding: 16, gap: 8,
  },
  saveButtonDisabled: { backgroundColor: '#333' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
