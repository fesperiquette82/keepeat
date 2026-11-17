import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { expiryColor } from './expiryLabels';
import { DARK_COLORS, LIGHT_COLORS, screenBackdropColor } from './theme';

// BUG-100 : en thème sombre, le texte du thème (clair) était posé sur des
// surfaces claires codées en dur ou sur l'image d'arrière-plan, claire elle
// aussi : noms de produits, titres et sections étaient illisibles.

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `couleur attendue au format #RRGGBB : ${hex}`);
  const value = parseInt(match[1], 16);
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

/** Rapport de contraste WCAG 2 entre deux couleurs (1 à 21). */
function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const READABLE = 4.5; // seuil WCAG AA pour du texte courant

test('BUG-100 : chaque texte du thème sombre est lisible sur chaque surface du thème sombre', () => {
  const surfaces = { card: DARK_COLORS.card, bg: DARK_COLORS.bg, surfaceMuted: DARK_COLORS.surfaceMuted };
  const texts = { text: DARK_COLORS.text, textMid: DARK_COLORS.textMid, primaryText: DARK_COLORS.primaryText };
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    for (const [textName, color] of Object.entries(texts)) {
      const ratio = contrast(color, surface);
      assert.ok(ratio >= READABLE, `${textName} sur ${surfaceName} : contraste ${ratio.toFixed(2)}`);
    }
  }
});

test('BUG-100 : le texte du thème sombre est illisible sur une surface claire, d’où l’interdiction des fonds en dur', () => {
  // Ce que voyait l'utilisateur : le texte du thème sombre sur une carte blanche.
  assert.ok(contrast(DARK_COLORS.text, '#FFFFFF') < 1.2);
  assert.ok(contrast(DARK_COLORS.textMid, '#F3F4F6') < 2);
});

test('le thème clair garde ses couleurs : le vert des liens est celui d’avant', () => {
  assert.equal(LIGHT_COLORS.primaryText, '#166534');
  assert.equal(LIGHT_COLORS.card, '#FFFFFF');
  assert.equal(LIGHT_COLORS.surfaceMuted, '#F3F4F6');
  assert.equal(LIGHT_COLORS.border, '#E5E7EB');
  assert.ok(contrast(LIGHT_COLORS.primaryText, LIGHT_COLORS.card) >= READABLE);
  assert.deepEqual(Object.keys(DARK_COLORS).sort(), Object.keys(LIGHT_COLORS).sort());
});

test("BUG-100 : en sombre, l'écran recouvre l'image d'arrière-plan claire ; en clair, elle reste visible", () => {
  assert.equal(screenBackdropColor('dark'), DARK_COLORS.bg);
  assert.equal(screenBackdropColor('light'), 'transparent');
});

test('BUG-100 : la couleur des échéances reste lisible sur une carte sombre', () => {
  for (const days of [null, -2, 0, 2, 5, 25]) {
    const ratio = contrast(expiryColor(days, 'dark'), DARK_COLORS.card);
    assert.ok(ratio >= READABLE, `échéance ${days} : contraste ${ratio.toFixed(2)}`);
  }
  // L'échéance lointaine était en vert foncé sur carte sombre.
  assert.ok(contrast(expiryColor(25, 'light'), DARK_COLORS.card) < 3);
});

test('la couleur des échéances est inchangée en thème clair', () => {
  assert.deepEqual(
    [null, -1, 0, 3, 7, 8].map((days) => expiryColor(days)),
    ['#6B7280', '#EF4444', '#EF4444', '#F97316', '#EAB308', '#166534'],
  );
  assert.equal(expiryColor(30, 'light'), expiryColor(30));
});

// --- Garde-fous sur les écrans corrigés --------------------------------------

const FRONTEND_ROOT = process.cwd();
const THEMED_SCREENS = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/stock.tsx',
  'app/(tabs)/recipes.tsx',
  'app/(tabs)/stats.tsx',
  'app/stock/[id].tsx',
  'app/recipes/[id].tsx',
  'app/settings.tsx',
  'app/delete-account.tsx',
];
const TAB_SCREENS = THEMED_SCREENS.slice(0, 4);

function source(file: string): string {
  return fs.readFileSync(path.join(FRONTEND_ROOT, file), 'utf8');
}

test('BUG-100 : aucune surface neutre claire codée en dur sur les écrans qui affichent du texte du thème', () => {
  const hardCodedSurface = /backgroundColor:\s*'#(?:fff|ffffff|f3f4f6)'/i;
  const offenders = THEMED_SCREENS.filter((file) => hardCodedSurface.test(source(file)));
  assert.deepEqual(offenders, []);
});

test("BUG-100 : les quatre onglets posent leur fond selon le thème, au-dessus de l'image d'arrière-plan", () => {
  for (const file of TAB_SCREENS) {
    const src = source(file);
    assert.match(src, /container: \{ flex: 1, backgroundColor: screenBackdropColor\(themeMode\) \}/, file);
    assert.doesNotMatch(src, /container: \{ flex: 1, backgroundColor: 'transparent' \}/, file);
  }
});

test('BUG-100 : les écrans passent le thème à la couleur des échéances', () => {
  for (const file of THEMED_SCREENS) {
    const calls = source(file).match(/expiryColor\([^;\n]*/g) ?? [];
    for (const call of calls) {
      assert.match(call, /, themeMode\)/, `${file} : ${call}`);
    }
  }
});
