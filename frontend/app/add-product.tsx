import React, { useMemo, useRef, useState } from 'react';
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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { format, addDays } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';

import { useStockStore } from '../store/stockStore';
import { useLanguageStore } from '../store/languageStore';
import { parseExpiryDate, DATE_FORMAT_EXAMPLES, getBestDateFromOCR, getExpiryDetectionPastYears } from '../utils/dateParser';

type DateInputMode = 'auto' | 'duration' | 'date' | 'camera';

type OCRResponse = {
  date?: string | null;
  confidence?: number;
  raw?: string | null;
  format?: string | null;
  raw_lines?: string[];
  combined_text?: string | null;
};

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
  const cameraRef = useRef<CameraView | null>(null);

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

  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrDebug, setOcrDebug] = useState<string | null>(null);

  const [parsedDateInfo, setParsedDateInfo] = useState<{
    date: Date | null;
    confidence: string;
    format: string;
  } | null>(null);

  const productFound = params.found === 'true';

  const shelfLifeCategory = params.shelf_life_category || '';
  const shelfLifeFridge = params.shelf_life_fridge ? parseInt(params.shelf_life_fridge, 10) : null;
  const shelfLifeFreezer = params.shelf_life_freezer ? parseInt(params.shelf_life_freezer, 10) : null;
  const shelfLifePantry = params.shelf_life_pantry ? parseInt(params.shelf_life_pantry, 10) : null;
  const shelfLifeTips = params.shelf_life_tips || '';
  const hasAutoSuggestions = !!(shelfLifeFridge || shelfLifeFreezer || shelfLifePantry);

  const autoSuggestions = useMemo(() => {
    const out: { label: string; days: number; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [];

    if (shelfLifeFridge) {
      out.push({
        label: language === 'fr' ? `Réfrigérateur (${shelfLifeFridge}j)` : `Refrigerator (${shelfLifeFridge}d)`,
        days: shelfLifeFridge,
        icon: 'snow-outline',
        color: '#3b82f6',
      });
    }
    if (shelfLifePantry) {
      out.push({
        label: language === 'fr' ? `Placard (${shelfLifePantry}j)` : `Pantry (${shelfLifePantry}d)`,
        days: shelfLifePantry,
        icon: 'cube-outline',
        color: '#f59e0b',
      });
    }
    if (shelfLifeFreezer) {
      out.push({
        label: language === 'fr' ? `Congélateur (${shelfLifeFreezer}j)` : `Freezer (${shelfLifeFreezer}d)`,
        days: shelfLifeFreezer,
        icon: 'thermometer-outline',
        color: '#8b5cf6',
      });
    }

    return out;
  }, [shelfLifeFridge, shelfLifePantry, shelfLifeFreezer, language]);

  const formatDisplayDate = (date: Date) => {
    return format(date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS });
  };

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

  const performOCR = async (imageBase64: string): Promise<OCRResponse | null> => {
    try {
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || 'https://keepeat-backend.onrender.com';
      const response = await fetch(`${API_URL}/api/ocr/date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64, maxPastYears: getExpiryDetectionPastYears() }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OCR API ${response.status}: ${text}`);
      }

      return (await response.json()) as OCRResponse;
    } catch (error) {
      console.error('OCR error:', error);
      return null;
    }
  };

  const handleScannedDateChange = (text: string) => {
    setScannedDateText(text);
    if (text.trim().length === 0) {
      setParsedDateInfo(null);
      return;
    }

    const result = parseExpiryDate(text);
    setParsedDateInfo({
      date: result.date,
      confidence: result.confidence,
      format: result.format,
    });
  };

  const applyParsedDate = (date: Date, sourceText: string, confidence: string, formatLabel: string) => {
    setExpiryDate(date);
    setScannedDateText(sourceText);
    setParsedDateInfo({
      date,
      confidence,
      format: formatLabel,
    });
  };

  const tryApplyBackendDate = (dateStr?: string | null, fmt?: string | null, conf?: number) => {
    if (!dateStr) return false;
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return false;

    applyParsedDate(
      parsed,
      dateStr,
      typeof conf === 'number' ? `${Math.round(conf * 100)}%` : 'high',
      fmt || 'YYYY-MM-DD (backend)'
    );
    return true;
  };

  const handleCaptureAndScan = async () => {
    if (!permission?.granted) {
      Alert.alert(
        language === 'fr' ? 'Autorisation requise' : 'Permission required',
        language === 'fr' ? 'Veuillez autoriser la caméra.' : 'Please allow camera access.'
      );
      return;
    }

    if (!cameraRef.current) {
      Alert.alert(language === 'fr' ? 'Erreur caméra' : 'Camera error');
      return;
    }

    setOcrError(null);
    setOcrDebug(null);
    setIsOcrProcessing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.6,
        skipProcessing: true,
      });

      if (!photo?.base64) {
        throw new Error('No base64 image returned by camera');
      }

      const ocr = await performOCR(photo.base64);

      if (!ocr) {
        setOcrError(language === 'fr' ? 'OCR indisponible pour le moment.' : 'OCR unavailable right now.');
        return;
      }

      const sourceText =
        (ocr.raw && ocr.raw.trim().length > 0 ? ocr.raw : '') ||
        (ocr.combined_text && ocr.combined_text.trim().length > 0 ? ocr.combined_text : '') ||
        '';

      if (ocr.raw_lines?.length) {
        setOcrDebug(ocr.raw_lines.join(' | '));
      }

      if (sourceText) {
        const best = getBestDateFromOCR(sourceText);
        if (best.date) {
          applyParsedDate(best.date, sourceText, best.confidence, ocr.format || best.format);
          return;
        }

        const plain = parseExpiryDate(sourceText);
        if (plain.date) {
          applyParsedDate(plain.date, sourceText, plain.confidence, ocr.format || plain.format);
          return;
        }
      }

      if (tryApplyBackendDate(ocr.date, ocr.format, ocr.confidence)) {
        return;
      }

      setOcrError(
        language === 'fr'
          ? 'Date non détectée automatiquement. Essayez la saisie manuelle.'
          : 'No date detected automatically. Please use manual input.'
      );
    } catch (error) {
      console.error('Capture OCR error:', error);
      setOcrError(
        language === 'fr'
          ? 'Échec du scan OCR. Vérifiez la connexion et réessayez.'
          : 'OCR scan failed. Check your connection and try again.'
      );
    } finally {
      setIsOcrProcessing(false);
    }
  };

  const handleScannedDateConfirm = () => {
    const result = parseExpiryDate(scannedDateText);
    if (result.date) {
      setExpiryDate(result.date);
      setShowCameraModal(false);
      setScannedDateText('');
      setParsedDateInfo(null);
      setOcrError(null);
      setOcrDebug(null);
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
        Alert.alert(t('productAdded'), '', [{ text: 'OK', onPress: () => router.replace('/') }]);
      }
    } catch (error) {
      Alert.alert(language === 'fr' ? 'Erreur' : 'Error', language === 'fr' ? "Impossible d'ajouter le produit" : 'Unable to add product');
    } finally {
      setIsSaving(false);
    }
  };

  const DatePickerModal = () => {
    const [day, setDay] = useState(expiryDate ? format(expiryDate, 'dd') : '');
    const [month, setMonth] = useState(expiryDate ? format(expiryDate, 'MM') : '');
    const [year, setYear] = useState(expiryDate ? format(expiryDate, 'yyyy') : new Date().getFullYear().toString());

    const handleConfirm = () => {
      const d = parseInt(day, 10);
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);

      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024) {
        const newDate = new Date(y, m - 1, d);
        setExpiryDate(newDate);
        setShowDatePicker(false);
      } else {
        Alert.alert(language === 'fr' ? 'Erreur' : 'Error', language === 'fr' ? 'Date invalide' : 'Invalid date');
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
              <TouchableOpacity style={styles.datePickerCancel} onPress={() => setShowDatePicker(false)}>
                <Text style={styles.datePickerCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.datePickerConfirm} onPress={handleConfirm}>
                <Text style={styles.datePickerConfirmText}>{t('confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const CameraModal = () => {
    return (
      <Modal visible={showCameraModal} animationType="slide">
        <SafeAreaView style={styles.cameraContainer}>
          <View style={styles.cameraHeader}>
            <TouchableOpacity
              onPress={() => {
                setShowCameraModal(false);
                setOcrError(null);
                setOcrDebug(null);
              }}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>

            <Text style={styles.cameraTitle}>{language === 'fr' ? 'Scanner la date' : 'Scan date'}</Text>
            <View style={{ width: 28 }} />
          </View>

          {permission?.granted ? (
            <View style={styles.cameraView}>
              <CameraView ref={cameraRef} style={styles.camera} />
              <View style={styles.cameraOverlay}>
                <View style={styles.scanZone}>
                  <Text style={styles.scanZoneText}>{language === 'fr' ? 'Placez la date ici' : 'Place date here'}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.permissionBox}>
              <Ionicons name="camera-outline" size={48} color="#666" />
              <Text style={styles.permissionText}>{language === 'fr' ? 'Autorisation caméra requise' : 'Camera permission required'}</Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                <Text style={styles.permissionBtnText}>{language === 'fr' ? 'Autoriser' : 'Allow'}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.ocrActions}>
            <TouchableOpacity
              style={[styles.captureBtn, (!permission?.granted || isOcrProcessing) && styles.captureBtnDisabled]}
              onPress={handleCaptureAndScan}
              disabled={!permission?.granted || isOcrProcessing}
            >
              {isOcrProcessing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="scan-outline" size={18} color="#fff" />
                  <Text style={styles.captureBtnText}>{language === 'fr' ? 'Capturer & analyser' : 'Capture & scan'}</Text>
                </>
              )}
            </TouchableOpacity>

            {ocrError ? <Text style={styles.ocrErrorText}>{ocrError}</Text> : null}
            {ocrDebug ? <Text style={styles.ocrDebugText}>{ocrDebug}</Text> : null}
          </View>

          <View style={styles.manualInputSection}>
            <Text style={styles.manualInputLabel}>
              {language === 'fr' ? "Saisissez la date vue sur l'emballage :" : 'Enter the date seen on packaging:'}
            </Text>

            <TextInput
              style={styles.manualDateInput}
              value={scannedDateText}
              onChangeText={handleScannedDateChange}
              placeholder={language === 'fr' ? 'Ex: 15/03/2025, 15 mars 25, mars 2025...' : 'Ex: 15/03/2025, 15 Mar 25, March 2025...'}
              placeholderTextColor="#666"
              autoCapitalize="none"
            />

            {parsedDateInfo && (
              <View style={[styles.parseFeedback, parsedDateInfo.date ? styles.parseFeedbackSuccess : styles.parseFeedbackErrorBox]}>
                {parsedDateInfo.date ? (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                    <View style={styles.parseFeedbackContent}>
                      <Text style={styles.parseFeedbackDate}>
                        {format(parsedDateInfo.date, 'EEEE d MMMM yyyy', { locale: language === 'fr' ? fr : enUS })}
                      </Text>
                      <Text style={styles.parseFeedbackFormat}>
                        {language === 'fr' ? 'Format détecté: ' : 'Detected format: '}
                        {parsedDateInfo.format} · {parsedDateInfo.confidence}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Ionicons name="help-circle" size={18} color="#f97316" />
                    <Text style={styles.parseFeedbackErrorText}>{language === 'fr' ? 'Format non reconnu' : 'Unrecognized format'}</Text>
                  </>
                )}
              </View>
            )}

            <View style={styles.formatExamples}>
              <Text style={styles.formatExamplesTitle}>{language === 'fr' ? 'Formats acceptés :' : 'Accepted formats:'}</Text>
              <Text style={styles.formatExamplesText}>
                15/03/2025 • 15-03-25 • 15.03.25{'\n'}
                15 mars 2025 • 15 MAR 25{'\n'}
                mars 2025 • 03/2025 • 150325
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.confirmDateBtn, (!scannedDateText || !parsedDateInfo?.date) && styles.confirmDateBtnDisabled]}
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
            <Ionicons name={productFound ? 'checkmark-circle' : 'alert-circle'} size={20} color={productFound ? '#22c55e' : '#f97316'} />
            <Text style={[styles.foundBadgeText, { color: productFound ? '#22c55e' : '#f97316' }]}>
              {productFound ? t('productFound') : t('productNotFound')}
            </Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('name')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={language === 'fr' ? 'Ex: Lait demi-écrémé' : 'Ex: Semi-skimmed milk'}
            placeholderTextColor="#666"
            autoFocus={!productFound}
          />
        </View>

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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('expiryDate')}</Text>

          <View style={styles.modeSelector}>
            {hasAutoSuggestions && (
              <TouchableOpacity style={[styles.modeBtn, dateInputMode === 'auto' && styles.modeBtnActive]} onPress={() => setDateInputMode('auto')}>
                <Ionicons name="flash" size={16} color={dateInputMode === 'auto' ? '#fff' : '#888'} />
                <Text style={[styles.modeBtnText, dateInputMode === 'auto' && styles.modeBtnTextActive]}>Auto</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.modeBtn, dateInputMode === 'duration' && styles.modeBtnActive]} onPress={() => setDateInputMode('duration')}>
              <Ionicons name="time-outline" size={16} color={dateInputMode === 'duration' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, dateInputMode === 'duration' && styles.modeBtnTextActive]}>
                {language === 'fr' ? 'Durée' : 'Duration'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.modeBtn, dateInputMode === 'date' && styles.modeBtnActive]} onPress={() => setDateInputMode('date')}>
              <Ionicons name="calendar-outline" size={16} color={dateInputMode === 'date' ? '#fff' : '#888'} />
              <Text style={[styles.modeBtnText, dateInputMode === 'date' && styles.modeBtnTextActive]}>Date</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, dateInputMode === 'camera' && styles.modeBtnActive]}
              onPress={() => {
                setDateInputMode('camera');
                setShowCameraModal(true);
              }}
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
                    {language === 'fr' ? 'Catégorie: ' : 'Category: '}
                    {shelfLifeCategory}
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

              {shelfLifeTips ? <Text style={styles.tipText}>💡 {shelfLifeTips}</Text> : null}
            </View>
          )}

          {dateInputMode === 'duration' && (
            <View style={styles.durationSection}>
              <View style={styles.durationInputRow}>
                <TextInput
                  style={styles.durationInput}
                  value={durationDays}
                  onChangeText={setDurationDays}
                  placeholder={language === 'fr' ? 'Nombre de jours' : 'Number of days'}
                  placeholderTextColor="#666"
                  keyboardType="numeric"
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
              <Text style={styles.datePickerBtnText}>{language === 'fr' ? 'Ouvrir le scanner OCR' : 'Open OCR scanner'}</Text>
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
            value={notes}
            onChangeText={setNotes}
            placeholder={language === 'fr' ? 'Infos complémentaires...' : 'Additional notes...'}
            placeholderTextColor="#666"
            multiline
          />
        </View>

        <TouchableOpacity style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]} onPress={handleSave} disabled={isSaving}>
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

      <DatePickerModal />
      <CameraModal />
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
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },

  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  foundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  foundBadgeSuccess: { borderColor: '#22c55e55', backgroundColor: '#22c55e10' },
  foundBadgeWarning: { borderColor: '#f9731655', backgroundColor: '#f9731610' },
  foundBadgeText: { fontSize: 14, fontWeight: '600' },

  inputGroup: { marginBottom: 18 },
  label: { color: '#ddd', marginBottom: 8, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#111',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  notesInput: { minHeight: 90, textAlignVertical: 'top' },

  modeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  modeBtnActive: { borderColor: '#22c55e', backgroundColor: '#22c55e20' },
  modeBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff' },

  autoSection: { gap: 10 },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0f2617',
    borderColor: '#1f5f3a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  categoryText: { color: '#89f0b6', fontSize: 13, fontWeight: '500' },
  autoSuggestions: { gap: 8 },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  suggestionIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionContent: { flex: 1 },
  suggestionLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  suggestionDate: { color: '#aaa', fontSize: 12, marginTop: 2 },
  tipText: { color: '#aaa', fontSize: 12, lineHeight: 18 },

  durationSection: { marginTop: 4 },
  durationInputRow: { flexDirection: 'row', gap: 8 },
  durationInput: {
    flex: 1,
    backgroundColor: '#111',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  applyBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: { color: '#fff', fontWeight: '700' },

  datePickerBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  datePickerBtnText: { color: '#e6e6e6', fontSize: 14 },

  selectedDateBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#22c55e55',
    backgroundColor: '#22c55e15',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  selectedDateText: { color: '#9bf2bd', fontSize: 13, fontWeight: '600' },

  saveBtn: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000090',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  datePickerModal: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 16,
  },
  datePickerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 14 },
  dateInputRow: { flexDirection: 'row', gap: 10 },
  dateInputGroup: { flex: 1 },
  dateInputLabel: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  dateInput: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    backgroundColor: '#0c0c0c',
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    textAlign: 'center',
  },
  datePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  datePickerCancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  datePickerCancelText: { color: '#aaa', fontWeight: '600' },
  datePickerConfirm: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#22c55e' },
  datePickerConfirmText: { color: '#fff', fontWeight: '700' },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: '#1a1a1a',
    borderBottomWidth: 1,
  },
  cameraTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cameraView: { flex: 1, minHeight: 240, maxHeight: 360, margin: 12, borderRadius: 14, overflow: 'hidden' },
  camera: { flex: 1 },
  cameraOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanZone: {
    borderWidth: 2,
    borderColor: '#22c55e',
    borderRadius: 12,
    width: '85%',
    height: '40%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e10',
  },
  scanZoneText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  permissionBox: {
    flex: 1,
    margin: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  permissionText: { color: '#aaa' },
  permissionBtn: {
    borderRadius: 10,
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  permissionBtnText: { color: '#fff', fontWeight: '700' },

  ocrActions: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  captureBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  captureBtnDisabled: { opacity: 0.6 },
  captureBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ocrErrorText: { marginTop: 8, color: '#f97316', fontSize: 12 },
  ocrDebugText: { marginTop: 6, color: '#888', fontSize: 11 },

  manualInputSection: { padding: 16, paddingTop: 8 },
  manualInputLabel: { color: '#ddd', marginBottom: 8, fontSize: 13, fontWeight: '600' },
  manualDateInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  parseFeedback: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  parseFeedbackSuccess: { borderColor: '#22c55e55', backgroundColor: '#22c55e12' },
  parseFeedbackErrorBox: { borderColor: '#f9731655', backgroundColor: '#f9731612' },
  parseFeedbackContent: { flex: 1 },
  parseFeedbackDate: { color: '#d8ffe8', fontSize: 13, fontWeight: '700' },
  parseFeedbackFormat: { color: '#9fd6b2', fontSize: 12, marginTop: 2 },
  parseFeedbackErrorText: { color: '#ffc4a2', fontSize: 12, fontWeight: '600' },

  formatExamples: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0f0f0f',
    padding: 10,
  },
  formatExamplesTitle: { color: '#cfcfcf', fontSize: 12, marginBottom: 4, fontWeight: '600' },
  formatExamplesText: { color: '#9a9a9a', fontSize: 12, lineHeight: 18 },

  confirmDateBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDateBtnDisabled: { opacity: 0.5 },
  confirmDateBtnText: { color: '#fff', fontWeight: '700' },
});
