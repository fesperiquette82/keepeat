#!/usr/bin/env node

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'seeded').trim();
const baseUrlArg = args.find((arg) => arg.startsWith('--base-url='));
const baseUrl = (baseUrlArg ? baseUrlArg.split('=')[1] : process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

if (!['empty', 'seeded'].includes(mode)) {
  console.error(`[e2e-reset-seed] Unsupported mode: ${mode}`);
  process.exit(2);
}

async function call(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function waitForBackend(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend is unreachable at ${baseUrl}`);
}

async function main() {
  await waitForBackend();
  const resetPayload = await call('/api/test/reset');
  if (!resetPayload?.ok) {
    throw new Error('Reset payload does not include ok=true');
  }

  if (mode === 'seeded') {
    const seedPayload = await call('/api/test/seed');
    if (!seedPayload?.ok) {
      throw new Error('Seed payload does not include ok=true');
    }
    console.log(`[e2e-reset-seed] mode=seeded fixtures=${Object.keys(seedPayload.fixtures || {}).join(',')}`);
    return;
  }

  console.log('[e2e-reset-seed] mode=empty done');
}

main().catch((error) => {
  console.error('[e2e-reset-seed] failed:', error.message);
  process.exit(1);
});
