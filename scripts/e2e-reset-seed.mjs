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

async function waitForBackend(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // First check: /health endpoint (responds early)
      const healthResponse = await fetch(`${baseUrl}/health`);
      if (!healthResponse.ok) {
        if (attempt % 10 === 0) console.log(`[e2e-reset-seed] health check attempt ${attempt}/${maxAttempts} (status ${healthResponse.status})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Second check: POST /api/test/reset (only works when backend is truly ready)
      // This ensures the backend has completed its full startup sequence
      try {
        const testResponse = await fetch(`${baseUrl}/api/test/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        // If POST works, backend is fully ready
        if (testResponse.ok) return;
        if (attempt % 10 === 0) console.log(`[e2e-reset-seed] reset test attempt ${attempt}/${maxAttempts} (status ${testResponse.status})`);
      } catch (postError) {
        // POST call failed, backend not ready yet
        if (attempt % 10 === 0) console.log(`[e2e-reset-seed] reset test attempt ${attempt}/${maxAttempts} (error: ${postError.message})`);
      }
    } catch {
      // fetch itself failed, retry
      if (attempt % 10 === 0) console.log(`[e2e-reset-seed] health check attempt ${attempt}/${maxAttempts} (fetch error)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend is unreachable or not ready at ${baseUrl} after ${maxAttempts} attempts`);
}

async function main() {
  await waitForBackend();

  console.log('[e2e-reset-seed] backend is reachable');

  const resetPayload = await call('/api/test/reset');
  if (!resetPayload?.ok) {
    throw new Error('Reset payload does not include ok=true');
  }
  console.log('[e2e-reset-seed] reset completed');

  if (mode === 'seeded') {
    const seedPayload = await call('/api/test/seed');
    if (!seedPayload?.ok) {
      throw new Error('Seed payload does not include ok=true');
    }
    console.log(`[e2e-reset-seed] seed completed with fixtures: ${Object.keys(seedPayload.fixtures || {}).join(',')}`);
    console.log('[e2e-reset-seed] test user e2e.free@keepeat.test is now available for login');
    return;
  }

  console.log('[e2e-reset-seed] mode=empty done');
}

main().catch((error) => {
  console.error('[e2e-reset-seed] failed:', error.message);
  process.exit(1);
});
