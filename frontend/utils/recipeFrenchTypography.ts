const RECIPE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\boeufs\b/gi, 'œufs'],
  [/\boeuf\b/gi, 'œuf'],
  [/\bbrouilles\b/gi, 'brouillés'],
  [/\bcremeuse\b/gi, 'crémeuse'],
  [/\bcremeux\b/gi, 'crémeux'],
  [/\bcreme\b/gi, 'crème'],
  [/\bemiette\b/gi, 'émiette'],
  [/\bpoele\b/gi, 'poêle'],
  [/\bsouhaite\b/gi, 'souhaité'],
  [/\bcote\b/gi, 'côté'],
  [/\ba\b/gi, 'à'],
];

function preserveCase(source: string, replacement: string): string {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export function formatFrenchRecipeText(value: string | null | undefined): string {
  const base = String(value ?? '').trim();
  if (!base) return '';

  let corrected = base;
  for (const [pattern, replacement] of RECIPE_TEXT_REPLACEMENTS) {
    corrected = corrected.replace(pattern, (token) => preserveCase(token, replacement));
  }

  corrected = corrected
    .replace(/(^|[\s([{"«“'-])([cdjlmnst])\s+([a-zà-ÿœ])/giu, (_, prefix: string, letter: string, next: string) => `${prefix}${letter}'${next}`)
    .replace(/\s+'/g, " '")
    .replace(/\s{2,}/g, ' ')
    .trim();

  return corrected;
}
