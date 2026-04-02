/**
 * Hook partagé pour la logique OCR de dates de péremption.
 * Utilisé par add-product.tsx et edit-product.tsx.
 */
import React, { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { CameraView } from 'expo-camera';
import { format, parseISO } from 'date-fns';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import * as ImageManipulator from 'expo-image-manipulator';
import { parseExpiryDate, DATE_FORMAT_EXAMPLES, getBestDateFromOCR } from './dateParser';
import { addOcrCorrection, findOcrMatch } from './ocrLearning';
import { getGalleryErrorMessage, pickImageFromGallery } from './galleryPicker';
import type { ParsedDateInfo } from '../component/CameraDateModal';

export interface UseOcrDatePickerResult {
  cameraRef: React.RefObject<CameraView | null>;
  scannedDateText: string;
  isOcrProcessing: boolean;
  ocrError: string | null;
  ocrDebug: string | null;
  parsedDateInfo: ParsedDateInfo | null;
  handleCaptureAndScan: () => Promise<void>;
  handleImportAndScan: () => Promise<void>;
  handleScannedDateChange: (text: string) => void;
  handleScannedDateConfirm: () => void;
  handleCameraLayout: (dims: { width: number; height: number }) => void;
  resetOcr: () => void;
}

export function useOcrDatePicker(
  language: string,
  permissionGranted: boolean,
  onDateConfirmed: (date: Date) => void,
): UseOcrDatePickerResult {
  const cameraRef = useRef<CameraView | null>(null);
  const cameraViewDimsRef = useRef({ width: 0, height: 0 });

  const [scannedDateText, setScannedDateText] = useState('');
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrDebug, setOcrDebug] = useState<string | null>(null);
  const [lastOcrRawText, setLastOcrRawText] = useState<string | null>(null);
  const [ocrFailed, setOcrFailed] = useState(false);
  const [parsedDateInfo, setParsedDateInfo] = useState<ParsedDateInfo | null>(null);

  const resetOcr = () => {
    setScannedDateText('');
    setParsedDateInfo(null);
    setOcrError(null);
    setOcrDebug(null);
    setOcrFailed(false);
    setLastOcrRawText(null);
  };

  const handleScannedDateChange = (text: string) => {
    setScannedDateText(text);
    if (text.trim().length === 0) {
      setParsedDateInfo(null);
      return;
    }
    const result = parseExpiryDate(text);
    setParsedDateInfo({ date: result.date, confidence: result.confidence, format: result.format });
  };

  const handleCaptureAndScan = async () => {
    if (!permissionGranted) {
      Alert.alert(
        language === 'fr' ? 'Autorisation requise' : 'Permission required',
        language === 'fr' ? 'Veuillez autoriser la caméra.' : 'Please allow camera access.',
      );
      return;
    }
    if (!cameraRef.current) {
      Alert.alert(language === 'fr' ? 'Erreur caméra' : 'Camera error');
      return;
    }
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
    if (!photo?.uri) throw new Error('No URI returned by camera');
    await processImageUri(photo.uri, photo);
  };

  const processImageUri = async (
    sourceUri: string,
    sourceMeta?: { width?: number; height?: number },
  ) => {
    setOcrError(null);
    setOcrDebug(null);
    setOcrFailed(false);
    setLastOcrRawText(null);
    setIsOcrProcessing(true);

    try {
      // Recadrer sur la zone de scan (90% largeur, 160dp de haut, centrée)
      let uriToScan = sourceUri;
      try {
        const { width: viewW, height: viewH } = cameraViewDimsRef.current;
        if (viewW > 0 && viewH > 0 && (sourceMeta?.width ?? 0) > 0 && (sourceMeta?.height ?? 0) > 0) {
          const zoneH = 160;
          const zoneY = Math.max(0, (viewH - zoneH) / 2);
          const sourceW = sourceMeta?.width ?? 0;
          const sourceH = sourceMeta?.height ?? 0;
          const imgW = sourceW > sourceH ? sourceH : sourceW;
          const imgH = sourceW > sourceH ? sourceW : sourceH;
          const sx = imgW / viewW;
          const sy = imgH / viewH;
          const cropX = Math.floor(viewW * 0.05 * sx);
          const cropY = Math.floor(zoneY * sy);
          const cropW = Math.min(imgW - cropX, Math.floor(viewW * 0.9 * sx));
          const cropH = Math.min(imgH - cropY, Math.floor(zoneH * sy));
          if (cropW > 0 && cropH > 0) {
            const cropped = await ImageManipulator.manipulateAsync(
              sourceUri,
              [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
              { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
            );
            uriToScan = cropped.uri;
          }
        }
      } catch (_e) {
        // crop échoué → on utilise l'image complète
      }

      const mlResult = await TextRecognition.recognize(uriToScan);
      const allLines = mlResult.blocks.flatMap(b => b.lines.map(l => l.text));
      if (allLines.length > 0) setOcrDebug(allLines.join(' | '));

      const combinedText = mlResult.text;
      setLastOcrRawText(combinedText);

      // Priorité 0 : corrections apprises
      const learnedDate = await findOcrMatch(combinedText);
      if (learnedDate) {
        const learned = parseISO(learnedDate);
        setParsedDateInfo({ date: learned, confidence: 'high', format: language === 'fr' ? 'appris' : 'learned' });
        setScannedDateText(learnedDate);
        return;
      }

      // Priorité 1 : texte combiné
      const best = getBestDateFromOCR(combinedText);
      if (best.date) {
        setParsedDateInfo({ date: best.date, confidence: best.confidence, format: best.format });
        setScannedDateText(format(best.date, 'dd/MM/yyyy'));
        return;
      }

      // Priorité 2 : ligne par ligne (fallback)
      for (const line of allLines) {
        const r = parseExpiryDate(line);
        if (r.date) {
          setParsedDateInfo({ date: r.date, confidence: r.confidence, format: r.format });
          setScannedDateText(line);
          return;
        }
      }

      setOcrFailed(true);
      setOcrError(
        language === 'fr'
          ? 'Date non détectée. Saisissez-la manuellement pour améliorer la reconnaissance.'
          : 'No date detected. Enter it manually to improve future recognition.',
      );
    } catch {
      setOcrError(language === 'fr' ? 'Échec du scan. Réessayez.' : 'Scan failed. Please try again.');
    } finally {
      setIsOcrProcessing(false);
    }
  };

  const handleImportAndScan = async () => {
    const picked = await pickImageFromGallery({ includeBase64: false, quality: 0.85 });
    if (picked.status === 'cancelled') return;
    const galleryError = getGalleryErrorMessage(picked, {
      permissionDenied: language === 'fr'
        ? "Autorisez l'accès à la galerie pour importer une photo."
        : 'Allow photo library access to import an image.',
      unavailable: language === 'fr'
        ? "L'import galerie n'est pas prêt dans ce build. Recompilez l'application après installation de expo-image-picker."
        : 'Gallery import is not available in this build. Rebuild the app after installing expo-image-picker.',
      invalidImage: language === 'fr' ? "Impossible d'analyser cette image." : 'Unable to analyse this image.',
    });
    if (galleryError) {
      Alert.alert(
        language === 'fr' ? 'Erreur' : 'Error',
        galleryError,
      );
      return;
    }
    if (picked.status !== 'success') return;
    await processImageUri(picked.asset.uri, {
      width: picked.asset.width,
      height: picked.asset.height,
    });
  };

  const handleScannedDateConfirm = () => {
    const result = parseExpiryDate(scannedDateText);
    if (result.date) {
      if (ocrFailed && lastOcrRawText) {
        addOcrCorrection(lastOcrRawText, format(result.date, 'yyyy-MM-dd'));
      }
      onDateConfirmed(result.date);
      resetOcr();
    } else {
      const examples = DATE_FORMAT_EXAMPLES[language === 'fr' ? 'fr' : 'en'];
      Alert.alert(
        language === 'fr' ? 'Format non reconnu' : 'Unrecognized format',
        language === 'fr'
          ? `Essayez un de ces formats :\n${examples.slice(0, 4).join('\n')}`
          : `Try one of these formats:\n${examples.slice(0, 4).join('\n')}`,
      );
    }
  };

  const handleCameraLayout = (dims: { width: number; height: number }) => {
    cameraViewDimsRef.current = dims;
  };

  return {
    cameraRef,
    scannedDateText,
    isOcrProcessing,
    ocrError,
    ocrDebug,
    parsedDateInfo,
    handleCaptureAndScan,
    handleImportAndScan,
    handleScannedDateChange,
    handleScannedDateConfirm,
    handleCameraLayout,
    resetOcr,
  };
}
