import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// BUG-077 : Expo n'inline dans le bundle que les accès STATIQUES à
// `process.env.EXPO_PUBLIC_*`. Un accès par clé calculée (`process.env[name]`,
// `process.env[\`PREFIX_${x}\`]`) vaut toujours `undefined` dans un build publié :
// les flags de debug et la surcharge d'URL backend par environnement ne
// pouvaient jamais s'activer hors développement. Ce test interdit le motif dans
// le code applicatif (les tests, eux, tournent sous Node et peuvent y recourir).

const ROOT = join(__dirname, '..', '..');
const SOURCE_DIRS = ['app', 'component', 'store', 'utils', 'data'];
const DYNAMIC_ACCESS = /process\.env\s*\[/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

test('aucun accès dynamique à process.env dans le code applicatif', () => {
  const offenders: string[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of listSourceFiles(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        // Les commentaires peuvent citer le motif interdit pour l'expliquer.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (DYNAMIC_ACCESS.test(line)) offenders.push(`${file.replace(ROOT + '/', '')}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `accès dynamiques à process.env : ${offenders.join(', ')}`);
});
