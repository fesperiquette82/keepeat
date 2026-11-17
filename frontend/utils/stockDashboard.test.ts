import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  findExpiringSoon,
  resolveHomeStockOverviewState,
  resolveStockItems,
  type DashboardStockItem,
} from './stockDashboard';

function stockItem(id: string, foodCategory: string, expiryDate?: string): DashboardStockItem {
  return {
    id,
    name: `Produit ${id}`,
    food_category: foodCategory,
    storageZone: 'placard',
    quantity: '1',
    expiry_date: expiryDate,
    added_date: '2026-03-01T00:00:00.000Z',
    status: 'active',
  } as DashboardStockItem;
}

// --- BUG-098 : un stock vide reste vide ----------------------------------------

test("BUG-098 : un stock vide ne devient jamais une liste de produits d'exemple", () => {
  assert.deepEqual(resolveStockItems([]), []);
});

test('resolveStockItems ne renvoie que les produits reçus, rangés par zone', () => {
  const resolved = resolveStockItems([
    stockItem('a', 'frais'),
    stockItem('b', 'epicerie'),
    stockItem('c', 'proteines'),
  ]);
  assert.deepEqual(resolved.map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(resolved.map((item) => item.storageZone), ['frigo', 'placard', 'frigo']);
});

test("BUG-098 : l'aperçu de l'accueil annonce un stock vide au lieu de le remplacer", () => {
  assert.equal(resolveHomeStockOverviewState({ itemCount: 0, expiringSoonCount: 0, isLoading: false }), 'empty');
});

test("l'aperçu de l'accueil attend la fin du chargement avant d'annoncer un stock vide", () => {
  assert.equal(resolveHomeStockOverviewState({ itemCount: 0, expiringSoonCount: 0, isLoading: true }), 'loading');
});

test("l'aperçu de l'accueil garde les produits affichés pendant un rafraîchissement", () => {
  assert.equal(resolveHomeStockOverviewState({ itemCount: 4, expiringSoonCount: 3, isLoading: true }), 'list');
  assert.equal(resolveHomeStockOverviewState({ itemCount: 4, expiringSoonCount: 3, isLoading: false }), 'list');
});

test("l'aperçu de l'accueil distingue un stock sans date d'un stock vide", () => {
  const withoutDates = resolveStockItems([stockItem('a', 'epicerie'), stockItem('b', 'frais')]);
  assert.equal(
    resolveHomeStockOverviewState({
      itemCount: withoutDates.length,
      expiringSoonCount: findExpiringSoon(withoutDates).length,
      isLoading: false,
    }),
    'no-urgent',
  );
});

// --- Garde-fous sur les sources -------------------------------------------------

const FRONTEND_ROOT = process.cwd();
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.test-dist', '.expo', 'dist', 'android', 'ios', 'assets']);

function productionSources(directory: string): string[] {
  const sources: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) sources.push(...productionSources(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      sources.push(fullPath);
    }
  }
  return sources;
}

test("BUG-098 : aucun code de l'application n'importe le fichier de données de démonstration", () => {
  const sources = productionSources(FRONTEND_ROOT);
  assert.ok(sources.length > 100, `parcours des sources incomplet (${sources.length} fichiers)`);
  const offenders = sources
    .filter((file) => path.relative(FRONTEND_ROOT, file) !== path.join('data', 'mockDashboardData.ts'))
    .filter((file) => /from\s+['"][^'"]*mockDashboardData['"]/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(FRONTEND_ROOT, file));
  assert.deepEqual(offenders, []);
});

test("BUG-098 : l'accueil affiche le stock réel et un état vide, sans mode démo", () => {
  const home = fs.readFileSync(path.join(FRONTEND_ROOT, 'app/(tabs)/index.tsx'), 'utf8');
  assert.doesNotMatch(home, /isMock|Mode démo|mockées/);
  assert.match(home, /resolveHomeStockOverviewState\(\{/);
  assert.match(home, /testID="home-stock-empty"/);
  assert.match(home, /Votre stock est vide/);

  const stockTab = fs.readFileSync(path.join(FRONTEND_ROOT, 'app/(tabs)/stock.tsx'), 'utf8');
  assert.doesNotMatch(stockTab, /isMock|Données de démonstration/);
});

test("BUG-098 : le jeu de faux produits n'existe plus", () => {
  const demo = fs.readFileSync(path.join(FRONTEND_ROOT, 'data/mockDashboardData.ts'), 'utf8');
  assert.doesNotMatch(demo, /MOCK_STOCK_ITEMS|useMockFallback/);
});
