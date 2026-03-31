/**
 * Composants modaux partagés pour la saisie de date de péremption.
 * Utilisés par add-product.tsx et edit-product.tsx.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView } from 'expo-camera';
import { format } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';

export type ParsedDateInfo = { date: Date | null; confidence: string; format: string };

// ─── DatePickerModal ──────────────────────────────────────────────────────────

export type DatePickerModalProps = {
  visible: boolean;
  expiryDate: Date | null;
  language: string;
  t: (key: string) => string;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
};

export const DatePickerModal = React.memo(function DatePickerModal({
  visible, expiryDate, language, t, onConfirm, onCancel,
}: DatePickerModalProps) {
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  useEffect(() => {
    if (visible) {
      setDay(expiryDate ? format(expiryDate, 'dd') : '');
      setMonth(expiryDate ? format(expiryDate, 'MM') : '');
      setYear(expiryDate ? format(expiryDate, 'yyyy') : new Date().getFullYear().toString());
    }
  }, [visible, expiryDate]);

  const handleConfirm = () => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const newDate = new Date(y, m - 1, d);
    // Vérifie le débordement (ex: 31/02 → 03/03) et l'année minimale
    if (
      newDate.getFullYear() === y &&
      newDate.getMonth() === m - 1 &&
      newDate.getDate() === d &&
      y >= new Date().getFullYear()
    ) {
      onConfirm(newDate);
    } else {
      Alert.alert(
        t('errorTitle'),
        t('invalidDate'),
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={dpStyles.overlay}>
        <View style={dpStyles.modal}>
          <Text style={dpStyles.title}>{t('selectDate')}</Text>
          <View style={dpStyles.row}>
            {[
              { label: t('day'),   value: day,   set: setDay,   max: 2, ph: 'DD'   },
              { label: t('month'), value: month, set: setMonth, max: 2, ph: 'MM'   },
              { label: t('year'), value: year,  set: setYear,  max: 4, ph: 'YYYY' },
            ].map(({ label, value, set, max, ph }) => (
              <View key={label} style={dpStyles.group}>
                <Text style={dpStyles.label}>{label}</Text>
                <TextInput
                  style={dpStyles.input}
                  value={value}
                  onChangeText={set}
                  keyboardType="numeric"
                  maxLength={max}
                  placeholder={ph}
                  placeholderTextColor="#666"
                />
              </View>
            ))}
          </View>
          <View style={dpStyles.actions}>
            <TouchableOpacity style={dpStyles.cancel} onPress={onCancel}>
              <Text style={dpStyles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dpStyles.confirm} onPress={handleConfirm}>
              <Text style={dpStyles.confirmText}>{t('confirm')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ─── CameraModal ──────────────────────────────────────────────────────────────

export type CameraModalProps = {
  visible: boolean;
  onClose: () => void;
  permissionGranted: boolean;
  requestPermission: () => void;
  cameraRef: React.RefObject<CameraView | null>;
  isOcrProcessing: boolean;
  ocrError: string | null;
  ocrDebug?: string | null;
  scannedDateText: string;
  parsedDateInfo: ParsedDateInfo | null;
  language: string;
  t: (key: string) => string;
  onCaptureAndScan: () => void;
  onScannedDateChange: (text: string) => void;
  onConfirm: () => void;
  onCameraLayout: (dims: { width: number; height: number }) => void;
};

export const CameraModal = React.memo(function CameraModal({
  visible, onClose, permissionGranted, requestPermission,
  cameraRef, isOcrProcessing, ocrError, ocrDebug,
  scannedDateText, parsedDateInfo, language, t,
  onCaptureAndScan, onScannedDateChange, onConfirm, onCameraLayout,
}: CameraModalProps) {
  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={cmStyles.container}>

        <View style={cmStyles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={cmStyles.title}>
            {t('scanDate')}
          </Text>
          <View style={{ width: 28 }} />
        </View>

        {permissionGranted ? (
          <View
            style={cmStyles.cameraView}
            onLayout={(e) => onCameraLayout({
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            })}
          >
            <CameraView ref={cameraRef} style={cmStyles.camera} />
            <View style={cmStyles.overlay}>
              <View style={cmStyles.scanZone}>
                <Text style={cmStyles.scanZoneText}>
                  {t('placeDateHere')}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={cmStyles.permissionBox}>
            <Ionicons name="camera-outline" size={48} color="#666" />
            <Text style={cmStyles.permissionText}>
              {t('cameraPermissionRequired')}
            </Text>
            <TouchableOpacity style={cmStyles.permissionBtn} onPress={requestPermission}>
              <Text style={cmStyles.permissionBtnText}>
                {t('allow')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={cmStyles.ocrActions}>
          <TouchableOpacity
            style={[cmStyles.captureBtn, (!permissionGranted || isOcrProcessing) && cmStyles.captureBtnDisabled]}
            onPress={onCaptureAndScan}
            disabled={!permissionGranted || isOcrProcessing}
          >
            {isOcrProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="scan-outline" size={18} color="#fff" />
                <Text style={cmStyles.captureBtnText}>
                  {t('captureAndScan')}
                </Text>
              </>
            )}
          </TouchableOpacity>
          {ocrError ? <Text style={cmStyles.ocrError}>{ocrError}</Text> : null}
          {__DEV__ && ocrDebug ? <Text style={cmStyles.ocrDebug}>{ocrDebug}</Text> : null}
        </View>

        <View style={cmStyles.manualSection}>
          <Text style={cmStyles.manualLabel}>
            {t('enterDateOnPackaging')}
          </Text>
          <TextInput
            style={cmStyles.manualInput}
            value={scannedDateText}
            onChangeText={onScannedDateChange}
            placeholder={t('dateInputExample')}
            placeholderTextColor="#666"
            autoCapitalize="none"
          />

          {parsedDateInfo && (
            <View style={[
              cmStyles.feedback,
              parsedDateInfo.date ? cmStyles.feedbackOk : cmStyles.feedbackErr,
            ]}>
              {parsedDateInfo.date ? (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <View style={cmStyles.feedbackContent}>
                    <Text style={cmStyles.feedbackDate}>
                      {format(parsedDateInfo.date, 'EEEE d MMMM yyyy', {
                        locale: language === 'fr' ? fr : enUS,
                      })}
                    </Text>
                    <Text style={cmStyles.feedbackFmt}>
                      {t('detectedFormat')}
                      {parsedDateInfo.format} · {parsedDateInfo.confidence}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Ionicons name="help-circle" size={18} color="#f97316" />
                  <Text style={cmStyles.feedbackErrText}>
                    {t('unrecognizedFormat')}
                  </Text>
                </>
              )}
            </View>
          )}

          {!parsedDateInfo?.date && (
            <View style={cmStyles.examples}>
              <Text style={cmStyles.examplesTitle}>
                {t('acceptedFormats')}
              </Text>
              <Text style={cmStyles.examplesText}>
                15/03/2025 • 15-03-25 • 15.03.25{'\n'}
                15 mars 2025 • 15 MAR 25{'\n'}
                mars 2025 • 03/2025 • 150325
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[cmStyles.confirmBtn, (!scannedDateText || !parsedDateInfo?.date) && cmStyles.confirmBtnDisabled]}
            onPress={onConfirm}
            disabled={!scannedDateText || !parsedDateInfo?.date}
          >
            <Text style={cmStyles.confirmBtnText}>{t('confirm')}</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </Modal>
  );
});

// ─── Styles DatePickerModal ───────────────────────────────────────────────────

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: '#00000090',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 500,
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a2a', padding: 16,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10 },
  group: { flex: 1 },
  label: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10,
    backgroundColor: '#0c0c0c', color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ ios: 10, android: 8, default: 8 }),
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  cancelText: { color: '#aaa', fontWeight: '600' },
  confirm: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#22c55e' },
  confirmText: { color: '#fff', fontWeight: '700' },
});

// ─── Styles CameraModal ───────────────────────────────────────────────────────

const cmStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomColor: '#1a1a1a', borderBottomWidth: 1,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cameraView: {
    flex: 1, minHeight: 240, maxHeight: 360,
    margin: 12, borderRadius: 14, overflow: 'hidden',
  },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  scanZone: {
    borderWidth: 2, borderColor: '#22c55e', borderRadius: 12,
    width: '85%', height: '40%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#22c55e10',
  },
  scanZoneText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  permissionBox: {
    flex: 1, margin: 12, borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  permissionText: { color: '#aaa' },
  permissionBtn: { borderRadius: 10, backgroundColor: '#22c55e', paddingHorizontal: 14, paddingVertical: 10 },
  permissionBtnText: { color: '#fff', fontWeight: '700' },

  ocrActions: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  captureBtn: {
    height: 46, borderRadius: 12, backgroundColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  captureBtnDisabled: { opacity: 0.6 },
  captureBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ocrError: { marginTop: 8, color: '#f97316', fontSize: 12 },
  ocrDebug: { marginTop: 6, color: '#888', fontSize: 11 },

  manualSection: { padding: 16, paddingTop: 8 },
  manualLabel: { color: '#ddd', marginBottom: 8, fontSize: 13, fontWeight: '600' },
  manualInput: {
    borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a',
    backgroundColor: '#111', color: '#fff',
    paddingHorizontal: 12, paddingVertical: 12,
  },

  feedback: {
    marginTop: 10, borderRadius: 10, borderWidth: 1,
    padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  feedbackOk:  { borderColor: '#22c55e55', backgroundColor: '#22c55e12' },
  feedbackErr: { borderColor: '#f9731655', backgroundColor: '#f9731612' },
  feedbackContent: { flex: 1 },
  feedbackDate: { color: '#d8ffe8', fontSize: 13, fontWeight: '700' },
  feedbackFmt:  { color: '#9fd6b2', fontSize: 12, marginTop: 2 },
  feedbackErrText: { color: '#ffc4a2', fontSize: 12, fontWeight: '600' },

  examples: {
    marginTop: 10, borderRadius: 10, borderWidth: 1,
    borderColor: '#2a2a2a', backgroundColor: '#0f0f0f', padding: 10,
  },
  examplesTitle: { color: '#cfcfcf', fontSize: 12, marginBottom: 4, fontWeight: '600' },
  examplesText:  { color: '#9a9a9a', fontSize: 12, lineHeight: 18 },

  confirmBtn: {
    marginTop: 12, height: 44, borderRadius: 10,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#fff', fontWeight: '700' },
});
