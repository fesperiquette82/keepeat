import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'keepeat_ocr_corrections';
const MAX_ENTRIES = 100;

interface OcrCorrection {
  ocrText: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
}

async function loadCorrections(): Promise<OcrCorrection[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Sauvegarde une paire (texte OCR brut → date confirmée par l'utilisateur).
 * Appelé quand l'OCR a échoué et que l'utilisateur a saisi la date manuellement.
 */
export async function addOcrCorrection(ocrText: string, date: string): Promise<void> {
  if (!ocrText.trim() || !date) return;
  try {
    const corrections = await loadCorrections();
    corrections.push({ ocrText: ocrText.trim(), date, timestamp: Date.now() });
    // Garder les MAX_ENTRIES entrées les plus récentes
    const trimmed = corrections.slice(-MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[OcrLearning] addOcrCorrection error:', err);
  }
}

/**
 * Cherche une correspondance dans les corrections apprises.
 * Retourne la date ISO (YYYY-MM-DD) si une correction similaire est trouvée, sinon null.
 */
export async function findOcrMatch(ocrText: string): Promise<string | null> {
  if (!ocrText.trim()) return null;
  try {
    const corrections = await loadCorrections();
    if (corrections.length === 0) return null;

    const normalized = ocrText.trim().toLowerCase();
    let bestDate: string | null = null;
    let bestScore = 0;

    for (const correction of corrections) {
      const score = jaccardSimilarity(normalized, correction.ocrText.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestDate = correction.date;
      }
    }

    // Seuil de confiance : 60% de similarité
    return bestScore >= 0.6 ? bestDate : null;
  } catch {
    return null;
  }
}

/**
 * Similarité de Jaccard sur les tokens (mots et nombres).
 * Ex: "DLC 15 03 2025" vs "DLC 15 03 2025" → 1.0
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.match(/\b\w+\b/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach(token => { if (setB.has(token)) intersection++; });
  const union = setA.size + setB.size - intersection;

  return intersection / union;
}
