import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { format, addDays, parse, isValid } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { parseExpiryDate, DATE_FORMAT_EXAMPLES, getBestDateFromOCR } from '../utils/dateParser';

type DateInputMode = 'duration' | 'date' | 'camera';

export default function EditProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { items, updateItem, fetchStock } = useStockStore();
  const { t, language } = useLanguageStore();
  
  const [item, setItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Date input modes
  const [dateInputMode, setDateInputMode] = useState<DateInputMode>('date');
  const [durationDays, setDurationDays] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedDateText, setScannedDateText] = useState('');

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
          setExpiryDate(new Date(foundItem.expiry_date));
        } catch (e) {
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
        language === 'fr' ? 'Le nom du produit est requis' : 'Product name is required'
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
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de modifier le produit');
    } finally {
      setIsSaving(false);
    }
  };

  const formatDisplayDate = (date: Date) => {
    return format(date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS });
  };

  // Parse scanned date text
  const parseScannedDate = (text: string) => {
    // Common date formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DDMMYYYY
    const cleanText = text.replace(/[^0-9]/g, '');
    
    if (cleanText.length >= 6) {
      let day, month, year;
      
      if (cleanText.length === 6) {
        // DDMMYY
        day = cleanText.substring(0, 2);
        month = cleanText.substring(2, 4);
        year = '20' + cleanText.substring(4, 6);
      } else if (cleanText.length >= 8) {
        // DDMMYYYY
        day = cleanText.substring(0, 2);
        month = cleanText.substring(2, 4);
        year = cleanText.substring(4, 8);
      } else {
        return null;
      }
      
      const dateStr = `${year}-${month}-${day}`;
      const parsedDate = new Date(dateStr);
      
      if (isValid(parsedDate) && parsedDate > new Date('2020-01-01')) {
        return parsedDate;
      }
    }
    return null;
  };

  // State for parsed date feedback
  const [parsedDateInfo, setParsedDateInfo] = useState<{
    date: Date | null;
    confidence: string;
    format: string;
  } | null>(null);

  // Handle scanned date text change with real-time parsing
  const handleScannedDateChange = (text: string) => {
    setScannedDateText(text);
    if (text.trim().length > 0) {
      const result = parseExpiryDate(text);
      setParsedDateInfo({
        date: result.date,
        confidence: result.confidence,
        format: result.format,
      });
    } else {
      setParsedDateInfo(null);
    }
  };

  const handleScannedDateConfirm = () => {
    const result = parseExpiryDate(scannedDateText);
    if (result.date) {
      setExpiryDate(result.date);
      setShowCameraModal(false);
      setScannedDateText('');
      setParsedDateInfo(null);
    } else {
      const examples = DATE_FORMAT_EXAMPLES[language === 'fr' ? 'fr' : 'en'];
      Alert.alert(
        language === 'fr' ? 'Format non reconnu' : 'Unrecognized format',
        language === 'fr' 
          ? `Essayez un de ces formats :\n${examples.slice(0, 4).join('\n')}`
          : `Try one of these formats:\n${examples.slice(0, 4).join('\n')}`
      );
    }
  };

  // Date Picker Modal
  const DatePickerModal = () => {
    const [day, setDay] = useState(expiryDate ? format(expiryDate, 'dd') : '');
    const [month, setMonth] = useState(expiryDate ? format(expiryDate, 'MM') : '');
    const [year, setYear] = useState(expiryDate ? format(expiryDate, 'yyyy') : new Date().getFullYear().toString());

    const handleConfirm = () => {
      const d = parseInt(day);
      const m = parseInt(month);
      const y = parseInt(year);

      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024) {
        const newDate = new Date(y, m - 1, d);
        setExpiryDate(newDate);
        setShowDatePicker(false);
      } else {
        Alert.alert('Erreur', 'Date invalide');
      }
    };

    return (
      <Modal visible={showDatePicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.datePickerModal}>
            <Text style={styles.datePickerTitle}>{t('selectDate')}</Text>
            
            <View style={styles.dateInputRow}>
              <View style={styles.dateInputGroup}>
                <Text style={styles.dateInputLabel}>{language === 'fr' ? 'Jour' : 'Day'}</Text>
                <TextInput
                  style={styles.dateInput}
                  value={day}
                  onChangeText={setDay}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="DD"
                  placeholderTextColor="#666"
                />
              </View>
              
              <View style={styles.dateInputGroup}>
                <Text style={styles.dateInputLabel}>{language === 'fr' ? 'Mois' : 'Month'}</Text>
                <TextInput
                  style={styles.dateInput}
                  value={month}
                  onChangeText={setMonth}
                  keyboardType="numeric"
                  maxLength={2}
                  placeholder="MM"
                  placeholderTextColor="#666"
                />
              </View>
              
              <View style={styles.dateInputGroup}>
                <Text style={styles.dateInputLabel}>{language === 'fr' ? 'Année' : 'Year'}</Text>
                <TextInput
                  style={styles.dateInput}
                  value={year}
                  onChangeText={setYear}
                  keyboardType="numeric"
                  maxLength={4}
                  placeholder="YYYY"
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            <View style={styles.datePickerActions}>
              <TouchableOpacity
                style={styles.datePickerCancel}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.datePickerCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.datePickerConfirm}
                onPress={handleConfirm}
              >
                <Text style={styles.datePickerConfirmText}>{t('confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // Camera Modal for OCR
  const CameraModal = () => {
    return (
      <Modal visible={showCameraModal} animationType="slide">
        <SafeAreaView style={styles.cameraContainer}>
          <View style={styles.cameraHeader}>
            <TouchableOpacity onPress={() => setShowCameraModal(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>
              {language === 'fr' ? 'Scanner la date' : 'Scan date'}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          {permission?.granted ? (
            <View style={styles.cameraView}>
              <CameraView style={styles.camera} />
              <View style={styles.cameraOverlay}>
                <View style={styles.scanZone}>
                  <Text style={styles.scanZoneText}>
                    {language === 'fr' ? 'Placez la date ici' : 'Place date here'}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.permissionBox}>
              <Ionicons name="camera-outline" size={48} color="#666" />
              <Text style={styles.permissionText}>
                {language === 'fr' ? 'Autorisation caméra requise' : 'Camera permission required'}
              </Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                <Text style={styles.permissionBtnText}>
                  {language === 'fr' ? 'Autoriser' : 'Allow'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.manualInputSection}>
            <Text style={styles.manualInputLabel}>
              {language === 'fr' ? 'Saisissez la date vue sur l\'emballage :' : 'Enter the date seen on packaging:'}
            </Text>
            <TextInput
              style={styles.manualDateInput}
              value={scannedDateText}
              onChangeText={handleScannedDateChange}
              placeholder={language === 'fr' ? 'Ex: 15/03/2025, 15 mars 25, mars 2025...' : 'Ex: 15/03/2025, 15 Mar 25, March 2025...'}
              placeholderTextColor="#666"
              autoCapitalize="none"
            />
            
            {/* Real-time parsing feedback */}
            {parsedDateInfo && (
              <View style={[
                styles.parseFeedback,
                parsedDateInfo.date ? styles.parseFeedbackSuccess : styles.parseFeedbackError
              ]}>
                {parsedDateInfo.date ? (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                    <View style={styles.parseFeedbackContent}>
                      <Text style={styles.parseFeedbackDate}>
                        {format(parsedDateInfo.date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS })}
                      </Text>
                      <Text style={styles.parseFeedbackFormat}>
                        {language === 'fr' ? 'Format détecté: ' : 'Detected format: '}{parsedDateInfo.format}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Ionicons name="help-circle" size={18} color="#f97316" />
                    <Text style={styles.parseFeedbackErrorText}>
                      {language === 'fr' ? 'Format non reconnu' : 'Unrecognized format'}
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Format examples */}
            <View style={styles.formatExamples}>
              <Text style={styles.formatExamplesTitle}>
                {language === 'fr' ? 'Formats acceptés :' : 'Accepted formats:'}
              </Text>
              <Text style={styles.formatExamplesText}>
                15/03/2025 • 15-03-25 • 15.03.25{'\n'}
                15 mars 2025 • 15 MAR 25{'\n'}
                mars 2025 • 03/2025 • 150325
              </Text>
            </View>
            
            <TouchableOpacity
              style={[
                styles.confirmDateBtn, 
                (!scannedDateText || !parsedDateInfo?.date) && styles.confirmDateBtnDisabled
              ]}
              onPress={handleScannedDateConfirm}
              disabled={!scannedDateText || !parsedDateInfo?.date}
            >
              <Text style={styles.confirmDateBtnText}>{t('confirm')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  };

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#22c55e" />
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
        <Text style={styles.headerTitle}>
          {language === 'fr' ? 'Modifier le produit' : 'Edit product'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Form */}
        <View style={styles.form}>
          {/* Product Name */}
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

          {/* Brand */}
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

          {/* Quantity */}
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

          {/* Expiry Date Section */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('expiryDate')}</Text>
            
            {/* Mode Selector */}
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
                onPress={() => {
                  setDateInputMode('camera');
                  setShowCameraModal(true);
                }}
              >
                <Ionicons name="camera-outline" size={18} color={dateInputMode === 'camera' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>
                  {language === 'fr' ? 'Scanner' : 'Scan'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Duration Input */}
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

            {/* Date Input */}
            {dateInputMode === 'date' && (
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar" size={20} color="#22c55e" />
                <Text style={styles.dateButtonText}>
                  {expiryDate ? formatDisplayDate(expiryDate) : t('selectDate')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Current Date Display */}
            {expiryDate && (
              <View style={styles.currentDateBox}>
                <View style={styles.currentDateContent}>
                  <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                  <Text style={styles.currentDateText}>
                    {formatDisplayDate(expiryDate)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setExpiryDate(null)}>
                  <Ionicons name="close-circle" size={24} color="#ef4444" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Notes */}
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

      {/* Save Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          <Ionicons name="checkmark" size={24} color="#fff" />
          <Text style={styles.saveButtonText}>{t('save')}</Text>
        </TouchableOpacity>
      </View>

      <DatePickerModal />
      <CameraModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#888',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  modeBtnActive: {
    backgroundColor: '#22c55e',
  },
  modeBtnText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  durationInput: {
    flexDirection: 'row',
    gap: 10,
  },
  durationField: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
  },
  applyBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  applyBtnDisabled: {
    backgroundColor: '#333',
  },
  applyBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  dateButtonText: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
  },
  currentDateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#22c55e15',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  currentDateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  currentDateText: {
    fontSize: 15,
    color: '#22c55e',
    fontWeight: '500',
  },
  footer: {
    padding: 20,
    paddingBottom: 30,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#333',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  datePickerModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 360,
  },
  datePickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
  },
  dateInputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  dateInputGroup: {
    flex: 1,
  },
  dateInputLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
    textAlign: 'center',
  },
  dateInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: '#fff',
    textAlign: 'center',
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  datePickerCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  datePickerCancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '500',
  },
  datePickerConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#22c55e',
    alignItems: 'center',
  },
  datePickerConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Camera Modal Styles
  cameraContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  cameraView: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  scanZone: {
    width: '80%',
    height: 80,
    borderWidth: 2,
    borderColor: '#22c55e',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  scanZoneText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '500',
  },
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  permissionText: {
    color: '#888',
    fontSize: 16,
  },
  permissionBtn: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permissionBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  manualInputSection: {
    padding: 20,
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  manualInputLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 12,
  },
  manualDateInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  parseFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    gap: 10,
  },
  parseFeedbackSuccess: {
    backgroundColor: '#22c55e15',
  },
  parseFeedbackError: {
    backgroundColor: '#f9731615',
  },
  parseFeedbackContent: {
    flex: 1,
  },
  parseFeedbackDate: {
    fontSize: 15,
    color: '#22c55e',
    fontWeight: '600',
  },
  parseFeedbackFormat: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  parseFeedbackErrorText: {
    fontSize: 14,
    color: '#f97316',
  },
  formatExamples: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  formatExamplesTitle: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  formatExamplesText: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
  },
  confirmDateBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  confirmDateBtnDisabled: {
    backgroundColor: '#333',
  },
  confirmDateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
