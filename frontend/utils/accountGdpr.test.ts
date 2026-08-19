import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-036 — export et suppression de compte (RGPD).
//
// Avant correction, aucun moyen en libre-service n'existait dans l'app pour
// exporter ou supprimer ses données personnelles, alors que Google Play et
// Apple l'exigent. Ces tests verrouillent le câblage minimal :
//   - accountService.ts appelle les bons endpoints, avec la bonne méthode et
//     le header d'authentification ;
//   - delete-account.tsx exige le mot de passe et une confirmation explicite
//     avant tout appel réseau destructif ;
//   - settings.tsx expose les deux actions.
// ---------------------------------------------------------------------------

test('accountService.exportAccountData appelle GET /api/account/export avec le bearer token', () => {
  const src = readSource('utils/accountService.ts');
  const fnStart = src.indexOf('export async function exportAccountData');
  assert.ok(fnStart !== -1);
  const fnBody = src.slice(fnStart, fnStart + 500);

  assert.match(fnBody, /buildApiUrl\('\/api\/account\/export'\)/);
  assert.match(fnBody, /Authorization: `Bearer \$\{token\}`/);
});

test('accountService.deleteAccount appelle DELETE /api/account avec le mot de passe de confirmation', () => {
  const src = readSource('utils/accountService.ts');
  const fnStart = src.indexOf('export async function deleteAccount');
  assert.ok(fnStart !== -1);
  const fnBody = src.slice(fnStart, fnStart + 600);

  assert.match(fnBody, /buildApiUrl\('\/api\/account'\)/);
  assert.match(fnBody, /method: 'DELETE'/);
  assert.match(fnBody, /Authorization: `Bearer \$\{token\}`/);
  assert.match(fnBody, /confirm_password: confirmPassword/);
});

test('delete-account.tsx désactive la suppression tant que le mot de passe est vide', () => {
  const src = readSource('app/delete-account.tsx');
  assert.match(src, /disabled=\{isDeleting \|\| !password\}/);
});

test('delete-account.tsx affiche une confirmation Alert.alert avant tout appel destructif', () => {
  const src = readSource('app/delete-account.tsx');
  const handleStart = src.indexOf('const handleDelete = ()');
  assert.ok(handleStart !== -1);
  const handleBody = src.slice(handleStart, handleStart + 700);

  assert.match(handleBody, /Alert\.alert\(/);
  assert.match(handleBody, /style: 'destructive'/);
  // L'appel réseau (confirmDelete) ne doit être déclenché que depuis le bouton
  // de confirmation de l'Alert, pas directement au clic sur "Supprimer".
  assert.match(handleBody, /onPress: \(\) => void confirmDelete\(\)/);
});

test('delete-account.tsx nettoie la session locale (logout) après suppression réussie', () => {
  const src = readSource('app/delete-account.tsx');
  const confirmStart = src.indexOf('const confirmDelete = async');
  assert.ok(confirmStart !== -1);
  const confirmBody = src.slice(confirmStart, confirmStart + 500);

  assert.match(confirmBody, /await deleteAccount\(token, password\)/);
  assert.match(confirmBody, /await logout\(\)/);
});

test('settings.tsx expose "Exporter mes données" et "Supprimer mon compte"', () => {
  const src = readSource('app/settings.tsx');
  assert.match(src, /onPress=\{onPressExportData\}/);
  assert.match(src, /router\.push\('\/delete-account'\)/);
});
