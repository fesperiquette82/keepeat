import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// BUG-099 : le bundle web contenait `import.meta` (zustand, résolu en ESM sur
// le web) et ne démarrait pas. Ces tests couvrent la résolution forcée en
// CommonJS pour le web, et le contrôle du bundle branché dans le build.

type Resolution = { type: string; filePath: string };
type ResolveRequest = (context: { resolveRequest: ResolveRequest }, moduleName: string, platform: string | null) => Resolution;
type BundleCheck = { ok: boolean; bundles: string[]; problems: string[] };

const FRONTEND_ROOT = process.cwd();
const requireFromFrontend = createRequire(path.join(FRONTEND_ROOT, 'package.json'));
const { createWebSafeResolveRequest } = requireFromFrontend('./scripts/metro-web-resolver.js') as {
  createWebSafeResolveRequest: (upstream?: ResolveRequest) => ResolveRequest;
};
const { checkWebBundle } = requireFromFrontend('./scripts/check-web-bundle.js') as {
  checkWebBundle: (distDir: string) => BundleCheck;
};

function delegatingContext(calls: string[]): { resolveRequest: ResolveRequest } {
  return {
    resolveRequest: (_context, moduleName, platform) => {
      calls.push(`${platform}:${moduleName}`);
      return { type: 'sourceFile', filePath: `/par-defaut/${moduleName}` };
    },
  };
}

test('BUG-099 : sur le web, zustand est résolu vers ses fichiers CommonJS, sans import.meta', () => {
  const calls: string[] = [];
  const resolveRequest = createWebSafeResolveRequest();

  for (const moduleName of ['zustand', 'zustand/middleware']) {
    const resolution = resolveRequest(delegatingContext(calls), moduleName, 'web');
    assert.equal(resolution.type, 'sourceFile');
    assert.match(resolution.filePath, /node_modules[\\/]zustand[\\/][a-z]+\.js$/);
    assert.doesNotMatch(fs.readFileSync(resolution.filePath, 'utf8'), /import\.meta/);
  }
  assert.deepEqual(calls, [], 'la résolution par défaut ne doit pas être consultée pour zustand sur le web');
});

test("BUG-099 : la résolution d'Android et d'iOS n'est pas modifiée", () => {
  const calls: string[] = [];
  const resolveRequest = createWebSafeResolveRequest();

  for (const platform of ['android', 'ios']) {
    const resolution = resolveRequest(delegatingContext(calls), 'zustand/middleware', platform);
    assert.equal(resolution.filePath, '/par-defaut/zustand/middleware');
  }
  assert.deepEqual(calls, ['android:zustand/middleware', 'ios:zustand/middleware']);
});

test('BUG-099 : sur le web, les autres paquets gardent la résolution par défaut', () => {
  const calls: string[] = [];
  const resolveRequest = createWebSafeResolveRequest();

  assert.equal(resolveRequest(delegatingContext(calls), 'react', 'web').filePath, '/par-defaut/react');
  assert.equal(resolveRequest(delegatingContext(calls), 'zustand-autre-paquet', 'web').filePath, '/par-defaut/zustand-autre-paquet');
  assert.deepEqual(calls, ['web:react', 'web:zustand-autre-paquet']);
});

test('un résolveur déjà configuré reste consulté pour tout le reste', () => {
  const upstreamCalls: string[] = [];
  const upstream: ResolveRequest = (_context, moduleName, platform) => {
    upstreamCalls.push(`${platform}:${moduleName}`);
    return { type: 'sourceFile', filePath: '/amont' };
  };
  const resolveRequest = createWebSafeResolveRequest(upstream);

  assert.equal(resolveRequest(delegatingContext([]), 'react', 'web').filePath, '/amont');
  assert.match(resolveRequest(delegatingContext([]), 'zustand', 'web').filePath, /zustand/);
  assert.deepEqual(upstreamCalls, ['web:react']);
});

test('BUG-099 : la configuration Metro branche le résolveur web', () => {
  const metroConfig = fs.readFileSync(path.join(FRONTEND_ROOT, 'metro.config.js'), 'utf8');
  assert.match(metroConfig, /require\('\.\/scripts\/metro-web-resolver'\)/);
  assert.match(metroConfig, /config\.resolver\.resolveRequest = createWebSafeResolveRequest\(config\.resolver\.resolveRequest\);/);
});

function writeBundle(source: string): string {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keepeat-web-bundle-'));
  const bundleDir = path.join(distDir, '_expo', 'static', 'js', 'web');
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'entry-abc123.js'), source);
  return distDir;
}

test('BUG-099 : le contrôle refuse un bundle web que le navigateur rejetterait', () => {
  const distDir = writeBundle('var mode = import.meta.env ? import.meta.env.MODE : void 0;');
  const result = checkWebBundle(distDir);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /entry-abc123\.js/);
  assert.match(result.problems[0], /import\.meta/);
});

test('le contrôle accepte un bundle valide, même si un texte y cite import.meta', () => {
  const distDir = writeBundle('var message = "import.meta est réservé aux modules"; function start() { return message; }');
  assert.deepEqual(checkWebBundle(distDir).problems, []);
  assert.equal(checkWebBundle(distDir).ok, true);
});

test("le contrôle échoue quand l'export n'a produit aucun bundle web", () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keepeat-web-bundle-vide-'));
  const result = checkWebBundle(distDir);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /aucun bundle web/);
});

test('BUG-099 : le build web lance le contrôle du bundle après l’export', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
  assert.match(scripts.build, /expo export --platform web && node \.\/scripts\/check-web-bundle\.js dist$/);
  const vercel = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'vercel.json'), 'utf8')) as { buildCommand: string; outputDirectory: string };
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
});
