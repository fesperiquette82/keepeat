import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyThemeSelection,
  getDefaultThemeMode,
  persistThemeModeIntoSettings,
  readThemeModeFromSettings,
} from './themePreference';

test('thème par défaut au premier lancement = clair', () => {
  assert.equal(getDefaultThemeMode(), 'light');
  assert.equal(readThemeModeFromSettings(null), 'light');
});

test('quand l’utilisateur choisit sombre, la préférence est persistée', () => {
  const next = persistThemeModeIntoSettings('{"householdSize":2}', 'dark');
  const parsed = JSON.parse(next) as { themeMode?: string; householdSize?: number };
  assert.equal(parsed.themeMode, 'dark');
  assert.equal(parsed.householdSize, 2);
});

test('au redémarrage, la préférence persistée est relue correctement', () => {
  assert.equal(readThemeModeFromSettings('{"themeMode":"dark"}'), 'dark');
});

test('le sélecteur de thème met à jour l’état global', () => {
  assert.equal(applyThemeSelection('light', 'dark'), 'dark');
});
