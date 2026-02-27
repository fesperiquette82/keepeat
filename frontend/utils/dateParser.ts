// Advanced date parser for food expiry dates with multilingual support
// Supports OCR output with keyword detection
// ===== EXPIRY DETECTION WINDOW (CONFIGURABLE) =====
// How many years in the past we still accept as a "reasonable" detected expiry date.
// Default: 2 years (current behavior)
// You can change this from the app by calling setExpiryDetectionPastYears(years).

let expiryDetectionPastYears = 2;

export function getExpiryDetectionPastYears(): number {
  return expiryDetectionPastYears;
}

export function setExpiryDetectionPastYears(years: number): void {
  if (Number.isFinite(years) && years >= 1 && years <= 50) {
    expiryDetectionPastYears = Math.floor(years);
  }
}


// ===== MULTILINGUAL KEYWORDS =====
// Keywords that typically precede expiry dates on packaging

const EXPIRY_KEYWORDS: { [lang: string]: string[] } = {
  // French
  fr: [
    'a consommer de preference avant',
    'a consommer avant',
    'a consommer jusqu',
    'date limite de consommation',
    'date limite',
    'dlc',
    'ddm',
    'date de durabilite minimale',
    'peremption',
    'exp',
    'valable jusqu',
    'fin',
  ],
  // English
  en: [
    'best before',
    'best by',
    'use by',
    'use before',
    'sell by',
    'expiry date',
    'expiry',
    'exp date',
    'exp',
    'expires',
    'consume by',
    'consume before',
    'bb',
    'bbe',
  ],
  // German
  de: [
    'mindestens haltbar bis',
    'mhd',
    'verbrauchsdatum',
    'haltbar bis',
    'zu verbrauchen bis',
    'ablaufdatum',
  ],
  // Spanish
  es: [
    'consumir preferentemente antes',
    'fecha de caducidad',
    'caducidad',
    'consumir antes de',
    'fch cad',
    'vence',
    'vencimiento',
  ],
  // Italian
  it: [
    'da consumarsi preferibilmente entro',
    'da consumare entro',
    'scadenza',
    'scad',
  ],
  // Portuguese
  pt: [
    'consumir de preferencia antes de',
    'validade',
    'val',
    'consumir ate',
  ],
  // Dutch
  nl: [
    'ten minste houdbaar tot',
    'tht',
    'te gebruiken tot',
    'tgt',
    'houdbaar tot',
  ],
  // Polish
  pl: [
    'najlepiej spozyc przed',
    'termin przydatnosci',
    'data waznosci',
  ],
};

// Flatten all keywords for detection
const ALL_KEYWORDS = Object.values(EXPIRY_KEYWORDS).flat();

// ===== MONTH NAMES IN MULTIPLE LANGUAGES =====

const MONTHS_BY_LANGUAGE: { [lang: string]: { [name: string]: number } } = {
  fr: {
    'janvier': 1, 'janv': 1, 'jan': 1,
    'février': 2, 'fevrier': 2, 'fév': 2, 'fev': 2, 'fevr': 2,
    'mars': 3, 'mar': 3,
    'avril': 4, 'avr': 4,
    'mai': 5,
    'juin': 6, 'jun': 6,
    'juillet': 7, 'juil': 7, 'jul': 7,
    'août': 8, 'aout': 8, 'aou': 8,
    'septembre': 9, 'sept': 9, 'sep': 9,
    'octobre': 10, 'oct': 10,
    'novembre': 11, 'nov': 11,
    'décembre': 12, 'decembre': 12, 'déc': 12, 'dec': 12,
  },
  en: {
    'january': 1, 'jan': 1,
    'february': 2, 'feb': 2,
    'march': 3, 'mar': 3,
    'april': 4, 'apr': 4,
    'may': 5,
    'june': 6, 'jun': 6,
    'july': 7, 'jul': 7,
    'august': 8, 'aug': 8,
    'september': 9, 'sept': 9, 'sep': 9,
    'october': 10, 'oct': 10,
    'november': 11, 'nov': 11,
    'december': 12, 'dec': 12,
  },
  de: {
    'januar': 1, 'jan': 1, 'jän': 1,
    'februar': 2, 'feb': 2,
    'märz': 3, 'marz': 3, 'mrz': 3,
    'april': 4, 'apr': 4,
    'mai': 5,
    'juni': 6, 'jun': 6,
    'juli': 7, 'jul': 7,
    'august': 8, 'aug': 8,
    'september': 9, 'sept': 9, 'sep': 9,
    'oktober': 10, 'okt': 10,
    'november': 11, 'nov': 11,
    'dezember': 12, 'dez': 12,
  },
  es: {
    'enero': 1, 'ene': 1,
    'febrero': 2, 'feb': 2,
    'marzo': 3, 'mar': 3,
    'abril': 4, 'abr': 4,
    'mayo': 5, 'may': 5,
    'junio': 6, 'jun': 6,
    'julio': 7, 'jul': 7,
    'agosto': 8, 'ago': 8,
    'septiembre': 9, 'sept': 9, 'sep': 9,
    'octubre': 10, 'oct': 10,
    'noviembre': 11, 'nov': 11,
    'diciembre': 12, 'dic': 12,
  },
  it: {
    'gennaio': 1, 'gen': 1,
    'febbraio': 2, 'feb': 2,
    'marzo': 3, 'mar': 3,
    'aprile': 4, 'apr': 4,
    'maggio': 5, 'mag': 5,
    'giugno': 6, 'giu': 6,
    'luglio': 7, 'lug': 7,
    'agosto': 8, 'ago': 8,
    'settembre': 9, 'set': 9,
    'ottobre': 10, 'ott': 10,
    'novembre': 11, 'nov': 11,
    'dicembre': 12, 'dic': 12,
  },
  pt: {
    'janeiro': 1, 'jan': 1,
    'fevereiro': 2, 'fev': 2,
    'março': 3, 'marco': 3, 'mar': 3,
    'abril': 4, 'abr': 4,
    'maio': 5, 'mai': 5,
    'junho': 6, 'jun': 6,
    'julho': 7, 'jul': 7,
    'agosto': 8, 'ago': 8,
    'setembro': 9, 'set': 9,
    'outubro': 10, 'out': 10,
    'novembro': 11, 'nov': 11,
    'dezembro': 12, 'dez': 12,
  },
  nl: {
    'januari': 1, 'jan': 1,
    'februari': 2, 'feb': 2,
    'maart': 3, 'mrt': 3,
    'april': 4, 'apr': 4,
    'mei': 5,
    'juni': 6, 'jun': 6,
    'juli': 7, 'jul': 7,
    'augustus': 8, 'aug': 8,
    'september': 9, 'sept': 9, 'sep': 9,
    'oktober': 10, 'okt': 10,
    'november': 11, 'nov': 11,
    'december': 12, 'dec': 12,
  },
  pl: {
    'styczeń': 1, 'styczen': 1, 'sty': 1,
    'luty': 2, 'lut': 2,
    'marzec': 3, 'mar': 3,
    'kwiecień': 4, 'kwiecien': 4, 'kwi': 4,
    'maj': 5,
    'czerwiec': 6, 'cze': 6,
    'lipiec': 7, 'lip': 7,
    'sierpień': 8, 'sierpien': 8, 'sie': 8,
    'wrzesień': 9, 'wrzesien': 9, 'wrz': 9,
    'październik': 10, 'pazdziernik': 10, 'paź': 10,
    'listopad': 11, 'lis': 11,
    'grudzień': 12, 'grudzien': 12, 'gru': 12,
  },
};

// Flatten all month names
const ALL_MONTHS: { [name: string]: number } = {};
Object.values(MONTHS_BY_LANGUAGE).forEach(monthMap => {
  Object.entries(monthMap).forEach(([name, num]) => {
    ALL_MONTHS[name] = num;
  });
});

// ===== UTILITY FUNCTIONS =====

// Normalize text: remove accents, lowercase, clean whitespace
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[àáâãäå]/gi, 'a')
    .replace(/[èéêë]/gi, 'e')
    .replace(/[ìíîï]/gi, 'i')
    .replace(/[òóôõö]/gi, 'o')
    .replace(/[ùúûü]/gi, 'u')
    .replace(/[ç]/gi, 'c')
    .replace(/[ñ]/gi, 'n')
    .replace(/[ß]/gi, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove expiry keywords from text to isolate the date
function removeKeywords(text: string): string {
  let result = normalizeText(text);
  
  for (const keyword of ALL_KEYWORDS) {
    const normalizedKeyword = normalizeText(keyword);
    result = result.replace(new RegExp(normalizedKeyword + '[:\\s]*', 'gi'), ' ');
  }
  
  // Also remove common prefixes/suffixes
  result = result.replace(/^[:\s\-\/\.]+/, '').replace(/[:\s\-\/\.]+$/, '');
  
  return result.trim();
}

// Parse month from text (supports all languages)
function parseMonth(text: string): number | null {
  const normalized = normalizeText(text);
  
  // Try numeric
  const num = parseInt(normalized);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return num;
  }
  
  // Try month names
  for (const [name, month] of Object.entries(ALL_MONTHS)) {
    if (normalized === normalizeText(name) || normalized.startsWith(normalizeText(name))) {
      return month;
    }
  }
  
  return null;
}

// Convert 2-digit year to 4-digit
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year > 50 ? 1900 + year : 2000 + year;
}

// Validate date is reasonable (not too far past/future)
function isReasonableDate(date: Date): boolean {
  const now = new Date();
  const pastYears = getExpiryDetectionPastYears();
  const twoYearsAgo = new Date(now.getFullYear() - pastYears, now.getMonth(), now.getDate());
  const tenYearsFromNow = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
  return date >= twoYearsAgo && date <= tenYearsFromNow;
}

// ===== PARSING RESULT =====

export interface ParsedDate {
  date: Date | null;
  confidence: 'high' | 'medium' | 'low';
  format: string;
  detectedKeyword?: string;
  detectedLanguage?: string;
}

// ===== DATE PATTERN MATCHERS =====

// DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (European format - most common)
function tryDMY(text: string): ParsedDate | null {
  const patterns = [
    /(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{4})/,  // DD/MM/YYYY
    /(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2})(?!\d)/,  // DD/MM/YY
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]);
      const year = expandYear(parseInt(match[3]));
      
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const date = new Date(year, month - 1, day);
        if (date.getDate() === day && isReasonableDate(date)) {
          return { date, confidence: 'high', format: 'DD/MM/YYYY' };
        }
      }
    }
  }
  return null;
}

// YYYY-MM-DD (ISO format)
function tryISO(text: string): ParsedDate | null {
  const pattern = /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/;
  const match = text.match(pattern);
  
  if (match) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'high', format: 'YYYY-MM-DD' };
      }
    }
  }
  return null;
}

// MM/DD/YYYY (American format)
function tryMDY(text: string): ParsedDate | null {
  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const month = parseInt(match[1]);
      const day = parseInt(match[2]);
      const year = expandYear(parseInt(match[3]));
      
      // Only accept if first number could be month (1-12) and second is valid day
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && month !== day) {
        const date = new Date(year, month - 1, day);
        if (date.getDate() === day && isReasonableDate(date)) {
          return { date, confidence: 'medium', format: 'MM/DD/YYYY (US)' };
        }
      }
    }
  }
  return null;
}

// DD MMM YYYY, DD MMM YY (e.g., "15 MAR 2025", "15 MARS 25")
function tryDayMonthYear(text: string): ParsedDate | null {
  // Pattern: 1-2 digits, optional space, 3+ letters, optional space, 2-4 digits
  const pattern = /(\d{1,2})\s*([a-zàâäéèêëïîôùûüçñß]{3,})\s*(\d{2,4})/i;
  const match = text.match(pattern);
  
  if (match) {
    const day = parseInt(match[1]);
    const monthText = match[2];
    const year = expandYear(parseInt(match[3]));
    
    const month = parseMonth(monthText);
    
    if (month && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'high', format: 'DD MMM YYYY' };
      }
    }
  }
  return null;
}

// MMM DD YYYY, MMM DD, YY (e.g., "MAR 15 2025")
function tryMonthDayYear(text: string): ParsedDate | null {
  const pattern = /([a-zàâäéèêëïîôùûüçñß]{3,})\s*(\d{1,2})\s*[,\s]*(\d{2,4})/i;
  const match = text.match(pattern);
  
  if (match) {
    const monthText = match[1];
    const day = parseInt(match[2]);
    const year = expandYear(parseInt(match[3]));
    
    const month = parseMonth(monthText);
    
    if (month && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'high', format: 'MMM DD YYYY' };
      }
    }
  }
  return null;
}

// MMM YYYY or MMM YY (e.g., "MARS 2025", "MAR 25") - end of month
function tryMonthYear(text: string): ParsedDate | null {
  // Month name followed by year — séparateur obligatoire (évite les faux positifs type "lot25")
  const pattern1 = /([a-zàâäéèêëïîôùûüçñß]{3,})[\s\/\-\.]+(\d{2,4})(?!\d)/i;
  // Or MM/YYYY, MM/YY
  const pattern2 = /(\d{1,2})[\/\-\.\s]+(\d{4})/;
  const pattern3 = /(\d{1,2})[\/\-\.\s]+(\d{2})(?!\d)/;
  
  let month: number | null = null;
  let year: number | null = null;
  
  const match1 = text.match(pattern1);
  if (match1) {
    month = parseMonth(match1[1]);
    year = expandYear(parseInt(match1[2]));
  }
  
  if (!month || !year) {
    const match2 = text.match(pattern2) || text.match(pattern3);
    if (match2) {
      const m = parseInt(match2[1]);
      if (m >= 1 && m <= 12) {
        month = m;
        year = expandYear(parseInt(match2[2]));
      }
    }
  }
  
  if (month && year && isReasonableDate(new Date(year, month - 1, 1))) {
    // Use last day of month
    const date = new Date(year, month, 0);
    return { date, confidence: 'medium', format: 'MMM YYYY (fin de mois)' };
  }
  
  return null;
}

// Pure numeric: DDMMYYYY, DDMMYY, YYYYMMDD
function tryNumeric(text: string): ParsedDate | null {
  const digits = text.replace(/\D/g, '');
  
  // DDMMYYYY (8 digits)
  if (digits.length === 8) {
    // Try DDMMYYYY first
    let day = parseInt(digits.substring(0, 2));
    let month = parseInt(digits.substring(2, 4));
    let year = parseInt(digits.substring(4, 8));
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'high', format: 'DDMMYYYY' };
      }
    }
    
    // Try YYYYMMDD
    year = parseInt(digits.substring(0, 4));
    month = parseInt(digits.substring(4, 6));
    day = parseInt(digits.substring(6, 8));
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'high', format: 'YYYYMMDD' };
      }
    }
  }
  
  // DDMMYY (6 digits)
  if (digits.length === 6) {
    const day = parseInt(digits.substring(0, 2));
    const month = parseInt(digits.substring(2, 4));
    const year = expandYear(parseInt(digits.substring(4, 6)));
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(year, month - 1, day);
      if (date.getDate() === day && isReasonableDate(date)) {
        return { date, confidence: 'medium', format: 'DDMMYY' };
      }
    }
  }
  
  // MMYY or YYMM (4 digits) - assume end of month
  if (digits.length === 4) {
    // Try MMYY
    let month = parseInt(digits.substring(0, 2));
    let year = expandYear(parseInt(digits.substring(2, 4)));
    
    if (month >= 1 && month <= 12) {
      const date = new Date(year, month, 0);
      if (isReasonableDate(date)) {
        return { date, confidence: 'low', format: 'MMYY (fin de mois)' };
      }
    }
  }
  
  return null;
}

// Try to detect and parse date near a keyword
function tryKeywordProximity(text: string): ParsedDate | null {
  const normalized = normalizeText(text);
  
  for (const keyword of ALL_KEYWORDS) {
    const normalizedKeyword = normalizeText(keyword);
    const keywordIndex = normalized.indexOf(normalizedKeyword);
    
    if (keywordIndex !== -1) {
      // Extract text after keyword
      const afterKeyword = normalized.substring(keywordIndex + normalizedKeyword.length);
      const cleaned = afterKeyword.replace(/^[:\s\-\/\.]+/, '').trim();
      
      // Try all parsers on the extracted text
      const parsers = [tryDMY, tryISO, tryDayMonthYear, tryMonthDayYear, tryMonthYear, tryNumeric];
      
      for (const parser of parsers) {
        const result = parser(cleaned);
        if (result && result.date) {
          return {
            ...result,
            detectedKeyword: keyword,
          };
        }
      }
    }
  }
  
  return null;
}

// ===== MAIN PARSER =====

export function parseExpiryDate(text: string): ParsedDate {
  if (!text || text.trim().length === 0) {
    return { date: null, confidence: 'low', format: 'empty' };
  }
  
  const originalText = text;
  const normalized = normalizeText(text);
  
  // First, try to find date near known keywords
  const keywordResult = tryKeywordProximity(originalText);
  if (keywordResult && keywordResult.date) {
    return keywordResult;
  }
  
  // Remove keywords and try parsing what remains
  const cleanedText = removeKeywords(normalized);
  
  // Try all parsers in order of reliability
  const parsers = [
    tryDMY,
    tryISO,
    tryDayMonthYear,
    tryMonthDayYear,
    tryNumeric,
    tryMonthYear,
    tryMDY, // US format last (less common in Europe)
  ];
  
  // Try on cleaned text first
  for (const parser of parsers) {
    const result = parser(cleanedText);
    if (result && result.date) {
      return result;
    }
  }
  
  // Try on original normalized text
  for (const parser of parsers) {
    const result = parser(normalized);
    if (result && result.date) {
      return result;
    }
  }
  
  return { date: null, confidence: 'low', format: 'unrecognized' };
}

// ===== OCR TEXT PROCESSING =====

// Process OCR output: find all potential dates in a block of text
export function findDatesInOCRText(ocrText: string): ParsedDate[] {
  const results: ParsedDate[] = [];
  const lines = ocrText.split(/[\n\r]+/);
  
  for (const line of lines) {
    const result = parseExpiryDate(line);
    if (result.date) {
      results.push(result);
    }
  }
  
  // Sort by confidence (high first)
  results.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });
  
  return results;
}

// Get best date from OCR text
export function getBestDateFromOCR(ocrText: string): ParsedDate {
  const results = findDatesInOCRText(ocrText);
  
  // Prefer dates found near keywords
  const withKeyword = results.find(r => r.detectedKeyword);
  if (withKeyword) {
    return withKeyword;
  }
  
  // Return highest confidence result
  if (results.length > 0) {
    return results[0];
  }
  
  return { date: null, confidence: 'low', format: 'no_date_found' };
}

// ===== EXPORT HELPERS =====

export const SUPPORTED_KEYWORDS = ALL_KEYWORDS;
export const SUPPORTED_LANGUAGES = Object.keys(EXPIRY_KEYWORDS);

export const DATE_FORMAT_EXAMPLES = {
  fr: [
    '15/03/2025',
    '15-03-25',
    '15.03.25',
    '15 mars 2025',
    '15 MAR 25',
    'mars 2025',
    '03/2025',
    '15032025',
    '150325',
    'A consommer avant le 15/03/25',
    'DLC: 15 mars 2025',
  ],
  en: [
    '15/03/2025',
    '03/15/2025',
    '15-03-25',
    '15 March 2025',
    '15 MAR 25',
    'March 2025',
    '15032025',
    'Best before 15/03/25',
    'Use by: March 15, 2025',
    'EXP: 03/2025',
  ],
};

export default parseExpiryDate;
