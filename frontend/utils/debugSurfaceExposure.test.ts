/**
 * Non-régression BUG-067 — surface de diagnostic exposée dans l'app distribuée.
 *
 * Trois défauts relevés par la revue externe du 08/09/2026 :
 *  - la carte « Debug » de Réglages était rendue sans aucun contrôle d'accès,
 *    juste après la section admin pourtant protégée par `canAccessAdmin` ;
 *  - `debugConfig.ts` activait les journaux de swipe et leur recopie console
 *    par des constantes codées à `true` ;
 *  - un jeton GitHub était lu depuis `EXPO_PUBLIC_GITHUB_TOKEN`, or toute
 *    valeur `EXPO_PUBLIC_` est intégrée au bundle et lisible dans l'APK.
 *
 * Ces vérifications portent sur les sources car les écrans React Native ne sont
 * pas montables dans les tests Node de ce dépôt (convention : tests sur les
 * fonctions pures). Elles restent probantes : elles échoueraient si le contrôle
 * d'accès ou l'interdiction du secret disparaissaient.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('[REGRESSION] BUG-067 — la section Debug est réservée aux administrateurs', () => {
  const src = read('app/settings.tsx');
  const debugCardIndex = src.indexOf("<Text style={styles.sectionTitle}>Debug</Text>");
  assert.ok(debugCardIndex > 0, 'section Debug introuvable');

  // La carte doit être englobée par une garde `canAccessAdmin &&` la précédant
  // immédiatement (dernière occurrence avant le titre).
  const before = src.slice(0, debugCardIndex);
  const lastGuard = before.lastIndexOf('canAccessAdmin && (');
  const lastCardOpen = before.lastIndexOf('<View style={styles.card}>');
  assert.ok(
    lastGuard > -1 && lastGuard < lastCardOpen,
    'la carte Debug doit être placée derrière le contrôle canAccessAdmin',
  );
});

test('[REGRESSION] BUG-067 — aucun jeton GitHub n’est lu côté application', () => {
  const utilsDir = path.join(repoRoot, 'utils');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        // Ce fichier de test cite volontairement le nom de la variable.
        if (full.endsWith('debugSurfaceExposure.test.ts')) continue;
        // On cherche une LECTURE réelle de la variable, pas une simple mention
        // (les commentaires expliquant pourquoi c'est interdit sont légitimes).
        if (/process\.env\.EXPO_PUBLIC_GITHUB_TOKEN/.test(read(path.relative(repoRoot, full)))) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    }
  };
  walk(utilsDir);
  walk(path.join(repoRoot, 'app'));

  assert.deepEqual(
    offenders,
    [],
    `un secret ne peut pas vivre dans une variable EXPO_PUBLIC_ (lisible dans l'APK) : ${offenders.join(', ')}`,
  );
});

test('[REGRESSION] BUG-067 — les journaux de debug sont désactivés par défaut', () => {
  const src = read('utils/debugConfig.ts');
  assert.doesNotMatch(
    src,
    /export const DEBUG_SWIPE_ACTIONS\s*=\s*true/,
    'DEBUG_SWIPE_ACTIONS ne doit plus être activé en dur',
  );
  assert.doesNotMatch(
    src,
    /export const DEBUG_LOG_TO_CONSOLE\s*=\s*true/,
    'DEBUG_LOG_TO_CONSOLE ne doit plus être activé en dur',
  );
  // …et doit dépendre de l'environnement de build.
  assert.match(src, /__DEV__/);
});

test('l’envoi des journaux passe uniquement par le backend authentifié', () => {
  const src = read('app/settings.tsx');
  assert.match(src, /uploadDebugLogsToBackend/);
  assert.doesNotMatch(src, /shareDebugLogsToGitHub/);
});
