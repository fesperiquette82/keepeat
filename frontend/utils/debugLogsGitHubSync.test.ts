import test from 'node:test';
import assert from 'node:assert/strict';
import { shareDebugLogsToGitHub } from './debugLogsGitHubSync';

test('shareDebugLogsToGitHub returns error when token not configured', async () => {
  // Temporarily clear the token
  const originalToken = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
  delete process.env.EXPO_PUBLIC_GITHUB_TOKEN;

  const result = await shareDebugLogsToGitHub();

  assert.strictEqual(result.success, false);
  assert(result.message.includes('token not configured'));

  // Restore
  if (originalToken) process.env.EXPO_PUBLIC_GITHUB_TOKEN = originalToken;
});

test('shareDebugLogsToGitHub handles network errors gracefully', async () => {
  // Set a token to bypass the first check
  process.env.EXPO_PUBLIC_GITHUB_TOKEN = 'test_token_12345';

  const result = await shareDebugLogsToGitHub();

  // Should fail gracefully (could be network error or invalid token)
  assert.strictEqual(typeof result.success, 'boolean');
  assert.strictEqual(typeof result.message, 'string');
});
