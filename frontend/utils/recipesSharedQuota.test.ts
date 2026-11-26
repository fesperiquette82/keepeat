import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// BUG-048 — le quota "recettes suggérées" (backend/entitlements.py::FEATURE_AI)
// couvre désormais le catalogue local ET le repli IA, plus seulement l'IA.
// Le rafraîchissement en arrière-plan des associations recette/stock (jusqu'à
// 4 appels parallèles par mutation de stock) NE doit PAS consommer ce quota —
// seul l'appel direct depuis l'écran Recettes doit compter. Une régression ici
// viderait le quota gratuit (8/mois) en une ou deux actions de stock.
// ---------------------------------------------------------------------------

const src = readSource('store/recipesStore.ts');

test('fetchSuggestions ajoute count_usage=false uniquement quand countUsage est false', () => {
  assert.match(src, /countUsage\s*\?\s*''\s*:\s*'&count_usage=false'/);
});

test('refreshRecipeAssociationsForStockMutation (rafraîchissement en arrière-plan) passe countUsage=false', () => {
  assert.match(src, /fetchSuggestions\(filter,\s*false\)/);
});

test("ensureRecipeAssociationsFromCache (bootstrap au démarrage) passe countUsage=false", () => {
  assert.match(src, /fetchSuggestions\('stock',\s*false\)/);
});

test('fetchSuggestions déclenche le paywall sur une erreur premium/quota (429/403)', () => {
  assert.match(src, /import \{ extractPremiumErrorDetail \} from '\.\.\/utils\/premiumErrors';/);
  assert.match(src, /import \{ usePremiumUiStore \} from '\.\/premiumUiStore';/);
  assert.match(src, /extractPremiumErrorDetail\(error\)/);
  assert.match(src, /usePremiumUiStore\.getState\(\)\.openPaywall\(premiumError\)/);
});

// ---------------------------------------------------------------------------
// BUG-106 — l'accueil appelait fetchSuggestions('expiryDay') sans countUsage :
// chaque ouverture de l'app consommait le quota gratuit (8/mois). Une fois le
// quota épuisé, le 429 ouvrait l'écran Premium à chaque lancement, sans que
// l'utilisateur ait jamais ouvert l'onglet Recettes. Seul cet écran compte.
// ---------------------------------------------------------------------------

function listSources(relativeDir: string): string[] {
  const dir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...listSources(relative));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

test("l'accueil affiche ses recettes sans consommer le quota (BUG-106)", () => {
  const home = readSource('app/(tabs)/index.tsx');
  assert.match(home, /fetchSuggestions\('expiryDay',\s*false\)/);
});

test("seul l'écran Recettes consomme le quota en appelant fetchSuggestions (BUG-106)", () => {
  const counting: string[] = [];
  for (const file of ['app', 'component', 'data', 'store', 'utils'].flatMap(listSources)) {
    const source = readSource(file);
    const calls = /fetchSuggestions\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = calls.exec(source)) !== null) {
      const args = match[1].split(',').map((arg) => arg.trim());
      if (args[1] !== 'false') counting.push(`${file.split(path.sep).join('/')}: ${match[0]}`);
    }
  }
  assert.deepEqual(counting, ['app/(tabs)/recipes.tsx: fetchSuggestions(activeFilter)']);
});
