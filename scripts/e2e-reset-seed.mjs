#!/usr/bin/env node

const args = process.argv.slice(2);

function getArgValue(argName) {
  const withEquals = args.find((arg) => arg.startsWith(`${argName}=`));
  if (withEquals) {
    return withEquals.split('=')[1];
  }
  const idx = args.indexOf(argName);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

const mode = (getArgValue('--mode') || 'seeded').trim();
const baseUrl = (getArgValue('--base-url') || process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

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
