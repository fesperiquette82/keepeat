import assert from 'node:assert/strict';
import test from 'node:test';

import { DARK_COLORS, LIGHT_COLORS, getThemeColors, resolveThemeMode } from './theme';

test('theme clair par défaut', () => {
  assert.equal(resolveThemeMode(undefined), 'light');
  assert.deepEqual(getThemeColors('light'), LIGHT_COLORS);
});

test('palette sombre retournée en mode dark', () => {
  assert.deepEqual(getThemeColors('dark'), DARK_COLORS);
  assert.notEqual(DARK_COLORS.bg, LIGHT_COLORS.bg);
});

test('régression scan: le mode clair ne force pas un fond noir', () => {
  assert.notEqual(LIGHT_COLORS.bg, '#000');
});
