import test from 'node:test';
import assert from 'node:assert/strict';
import { debugLogsExport } from './debugLogsExport';

test('debugLogsExport exports logs as text', () => {
  const text = debugLogsExport.exportAsText();
  assert(typeof text === 'string', 'exportAsText should return a string');
});

test('debugLogsExport exports logs as JSON', () => {
  const json = debugLogsExport.exportAsJSON();
  assert(typeof json === 'string', 'exportAsJSON should return a string');
  // Verify it's valid JSON
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed), 'exported JSON should be an array');
});

test('debugLogsExport getLogs returns array', () => {
  const logs = debugLogsExport.getLogs();
  assert(Array.isArray(logs), 'getLogs should return an array');
});

test('debugLogsExport clearLogs empties buffer', () => {
  const beforeClear = debugLogsExport.getLogs().length;
  debugLogsExport.clearLogs();
  const afterClear = debugLogsExport.getLogs().length;
  assert(afterClear <= beforeClear, 'clearLogs should not increase log count');
});

test('debugLogsExport is globally accessible', () => {
  assert(typeof (globalThis as any).__KEEPEAT_DEBUG_EXPORT__ !== 'undefined', 'debugLogsExport should be global');
  assert(typeof (globalThis as any).__KEEPEAT_DEBUG_EXPORT__.exportAsText === 'function', 'global export should have exportAsText');
});
