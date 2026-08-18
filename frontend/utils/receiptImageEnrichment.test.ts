import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// TODO.md — implémentation end-to-end des images pour les articles issus de
// l'OCR ticket de caisse. Ces tests verrouillent le câblage frontend (le
// backend a sa propre couverture dans backend/tests/test_receipt_ocr_image_enrichment.py).
// ---------------------------------------------------------------------------

test('scan-receipt.tsx : ReceiptProduct expose image_url', () => {
  const src = readSource('app/scan-receipt.tsx');
  assert.match(src, /interface ReceiptProduct[\s\S]*?image_url\?:\s*string\s*\|\s*null/);
});

test('scan-receipt.tsx : handleAdd transmet image_url à addItem', () => {
  const src = readSource('app/scan-receipt.tsx');
  const handleAddStart = src.indexOf('const handleAdd = async ()');
  assert.ok(handleAddStart !== -1);
  const handleAddBody = src.slice(handleAddStart, handleAddStart + 700);
  assert.match(handleAddBody, /image_url:\s*p\.image_url\s*\?\?\s*undefined/);
});

test('scan-receipt.tsx : la liste de confirmation affiche la vignette produit si image_url est présent', () => {
  const src = readSource('app/scan-receipt.tsx');
  assert.match(src, /p\.image_url\s*\?\s*\(\s*\n?\s*<Image/);
});
