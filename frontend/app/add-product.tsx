import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { format, addDays, isValid } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { parseExpiryDate, DATE_FORMAT_EXAMPLES, getBestDateFromOCR, SUPPORTED_LANGUAGES } from '../utils/dateParser';

type DateInputMode = 'auto' | 'duration' | 'date' | 'camera';

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
  const [scannedDateText, setScannedDateText] = useState('');
  
  const productFound = params.found === 'true';
  
  // Shelf life data from params
  const shelfLifeCategory = params.shelf_life_category || '';
  const shelfLifeFridge = params.shelf_life_fridge ? parseInt(params.shelf_life_fridge) : null;
  const shelfLifeFreezer = params.shelf_life_freezer ? parseInt(params.shelf_life_freezer) : null;
  const shelfLifePantry = params.shelf_life_pantry ? parseInt(params.shelf_life_pantry) : null;
  const shelfLifeTips = params.shelf_life_tips || '';

  // Check if we have auto suggestions
  const hasAutoSuggestions = shelfLifeFridge || shelfLifeFreezer || shelfLifePantry;

  // Auto-suggestions based on FoodKeeper data
  const autoSuggestions = [];
  if (shelfLifeFridge) {
    autoSuggestions.push({
      label: language === 'fr' ? `Réfrigérateur (${shelfLifeFridge}j)` : `Refrigerator (${shelfLifeFridge}d)`,
      days: shelfLifeFridge,
      icon: 'snow-outline' as const,
      color: '#3b82f6',
    });
  }
  if (shelfLifePantry) {
    autoSuggestions.push({
      label: language === 'fr' ? `Placard (${shelfLifePantry}j)` : `Pantry (${shelfLifePantry}d)`,
      days: shelfLifePantry,
      icon: 'cube-outline' as const,
      color: '#f59e0b',
    });
  }
  if (shelfLifeFreezer) {
    autoSuggestions.push({
      label: language === 'fr' ? `Congélateur (${shelfLifeFreezer}j)` : `Freezer (${shelfLifeFreezer}d)`,
      days: shelfLifeFreezer,
      icon: 'thermometer-outline' as const,
      color: '#8b5cf6',
    });
  }

  const handleDurationApply = () => {
    const days = parseInt(durationDays);
    if (days > 0) {
      setExpiryDate(addDays(new Date(), days));
      setDurationDays('');
    }
  };

  const handleAutoSuggestion = (days: number) => {
    setExpiryDate(addDays(new Date(), days));
  };

  // API OCR call
  const performOCR = async (imageBase64: string) => {
    try {
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';
      const response = await fetch(`${API_URL}/api/ocr/date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      
      if (response.ok) {
        const result = await response.json();
        return result;
      }
      return null;
    } catch (error) {
      console.error('OCR error:', error);
      return null;
    }
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
      const newItem = await addItem({
        barcode: params.barcode || undefined,
        name: name.trim(),
        brand: brand.trim() || undefined,
        image_url: params.image_url || undefined,
        category: params.category || undefined,
        quantity: quantity.trim() || undefined,
        expiry_date: expiryDate ? format(expiryDate, 'yyyy-MM-dd') : undefined,
        notes: notes.trim() || undefined,
      });

      if (newItem) {
        Alert.alert(
          t('productAdded'),
          '',
          [{ text: 'OK', onPress: () => router.replace('/') }]
        );
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'ajouter le produit');
    } finally {
      setIsSaving(false);
    }
  };

  const formatDisplayDate = (date: Date) => {
    return format(date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS });
  };

  // Custom date picker using manual input
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
                    <Text style={styles.parseFeedbackError}>
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('addProduct')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Product Found Badge */}
        {params.barcode && (
          <View style={[styles.foundBadge, productFound ? styles.foundBadgeSuccess : styles.foundBadgeWarning]}>
            <Ionicons
              name={productFound ? "checkmark-circle" : "alert-circle"}
              size={20}
              color={productFound ? "#22c55e" : "#f97316"}
            />
            <Text style={[styles.foundBadgeText, { color: productFound ? "#22c55e" : "#f97316" }]}>
              {productFound ? t('productFound') : t('productNotFound')}
            </Text>
            {params.barcode && (
              <Text style={styles.barcodeText}>EAN: {params.barcode}</Text>
            )}
          </View>
        )}

        {/* Form */}
        <View style={styles.form}>
          {/* Product Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('productName')} *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={language === 'fr' ? 'Ex: Lait demi-écrémé' : 'Ex: Semi-skimmed milk'}
              placeholderTextColor="#666"
              autoFocus={!productFound}
            />
          </View>

          {/* Brand */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('brand')}</Text>
            <TextInput
              style={styles.input}
              value={brand}
              onChangeText={setBrand}
              placeholder={language === 'fr' ? 'Ex: Lactel' : 'Ex: Brand name'}
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
              placeholder={language === 'fr' ? 'Ex: 1L, 500g' : 'Ex: 1L, 500g'}
              placeholderTextColor="#666"
            />
          </View>

          {/* Expiry Date Section */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('expiryDate')}</Text>
            
            {/* Mode Selector */}
            <View style={styles.modeSelector}>
              {hasAutoSuggestions && (
                <TouchableOpacity
                  style={[styles.modeBtn, dateInputMode === 'auto' && styles.modeBtnActive]}
                  onPress={() => setDateInputMode('auto')}
                >
                  <Ionicons name="flash" size={16} color={dateInputMode === 'auto' ? '#fff' : '#888'} />
                  <Text style={[styles.modeBtnText, dateInputMode === 'auto' && styles.modeBtnTextActive]}>
                    Auto
                  </Text>
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
                <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>
                  Date
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
                onPress={() => {
                  setDateInputMode('camera');
                  setShowCameraModal(true);
                }}
              >
                <Ionicons name="camera-outline" size={16} color={dateInputMode === 'camera' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'camera' && styles.modeBtnTextActive]}>
                  Scan
                </Text>
              </TouchableOpacity>
            </View>

            {/* Auto Mode - FoodKeeper Suggestions */}
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
                  {autoSuggestions.map((suggestion, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[styles.suggestionCard, { borderColor: suggestion.color }]}
                      onPress={() => handleAutoSuggestion(suggestion.days)}
                    >
                      <View style={[styles.suggestionIcon, { backgroundColor: suggestion.color + '20' }]}>
                        <Ionicons name={suggestion.icon} size={24} color={suggestion.color} />
                      </View>
                      <View style={styles.suggestionContent}>
                        <Text style={styles.suggestionLabel}>{suggestion.label}</Text>
                        <Text style={styles.suggestionDate}>
                          → {format(addDays(new Date(), suggestion.days), 'dd MMM yyyy', { locale: language === 'fr' ? fr : enUS })}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#666" />
                    </TouchableOpacity>
                  ))}
                </View>

                {shelfLifeTips && (
                  <View style={styles.tipsBox}>
                    <Ionicons name="bulb-outline" size={18} color="#eab308" />
                    <Text style={styles.tipsText}>{shelfLifeTips}</Text>
                  </View>
                )}
              </View>
            )}

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
  foundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 20,
    gap: 8,
  },
  foundBadgeSuccess: {
    backgroundColor: '#22c55e15',
  },
  foundBadgeWarning: {
    backgroundColor: '#f9731615',
  },
  foundBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  barcodeText: {
    fontSize: 12,
    color: '#666',
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
    gap: 4,
  },
  modeBtnActive: {
    backgroundColor: '#22c55e',
  },
  modeBtnText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  autoSection: {
    gap: 12,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#22c55e15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 13,
    color: '#22c55e',
    fontWeight: '500',
  },
  autoSuggestions: {
    gap: 10,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  suggestionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionLabel: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },
  suggestionDate: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  tipsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#eab30815',
    padding: 12,
    borderRadius: 10,
    gap: 10,
  },
  tipsText: {
    fontSize: 13,
    color: '#eab308',
    flex: 1,
    lineHeight: 18,
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
