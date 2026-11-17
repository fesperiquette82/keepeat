#!/usr/bin/env node
// BUG-099 : contrôle du bundle web après `expo export`.
//
// Le bundle web est chargé par un <script> classique. Une seule construction
// réservée aux modules (`import.meta`, par exemple) est une erreur de syntaxe
// qui fait rejeter le bundle entier : le build réussit, le site se déploie,
// et l'application ne démarre pas. Ce script compile chaque bundle comme le
// fera le navigateur (sans l'exécuter) et fait échouer le build sinon.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function findWebBundles(distDir) {
  const bundleDir = path.join(distDir, '_expo', 'static', 'js', 'web');
  if (!fs.existsSync(bundleDir)) return [];
  return fs
    .readdirSync(bundleDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(bundleDir, name));
}

function checkWebBundle(distDir) {
  const bundles = findWebBundles(distDir);
  if (bundles.length === 0) {
    return { ok: false, bundles, problems: [`aucun bundle web trouvé sous ${distDir}`] };
  }
  const problems = [];
  for (const bundle of bundles) {
    try {
      // Compilation seule : rien n'est exécuté.
      new vm.Script(fs.readFileSync(bundle, 'utf8'), { filename: path.basename(bundle) });
    } catch (error) {
      problems.push(`${path.basename(bundle)} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: problems.length === 0, bundles, problems };
}

if (require.main === module) {
  const distDir = path.resolve(process.argv[2] || 'dist');
  const result = checkWebBundle(distDir);
  if (!result.ok) {
    console.error('[check-web-bundle] Le bundle web ne peut pas être exécuté par un navigateur :');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.error('[check-web-bundle] Voir scripts/metro-web-resolver.js (BUG-099).');
    process.exit(1);
  }
  console.log(`[check-web-bundle] ${result.bundles.length} bundle(s) web valide(s).`);
}

module.exports = { checkWebBundle, findWebBundles };
