import test from 'node:test';
import assert from 'node:assert/strict';
import { debugSwipeLogger } from './debugSwipeLogger';

test('debugSwipeLogger exports logs as JSON', () => {
  debugSwipeLogger.info('test', 'test action', { detail: 'test' });
  const json = debugSwipeLogger.exportLogs();
  assert(typeof json === 'string', 'exportLogs should return a string');
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed), 'exported JSON should be an array');
  assert(parsed.length > 0, 'should have at least one log entry');
});

test('debugSwipeLogger exports text format', () => {
  const text = debugSwipeLogger.exportLogsAsText();
  assert(typeof text === 'string', 'exportLogsAsText should return a string');
  assert(text.includes('test'), 'text export should contain log entries');
});

test('debugSwipeLogger getLogs returns array', () => {
  const logs = debugSwipeLogger.getLogs();
  assert(Array.isArray(logs), 'getLogs should return an array');
});

test('debugSwipeLogger clear empties buffer', () => {
  const beforeClear = debugSwipeLogger.getLogs().length;
  debugSwipeLogger.clear();
  const afterClear = debugSwipeLogger.getLogs().length;
  assert(afterClear <= beforeClear, 'clear should not increase log count');
});

test('debugSwipeLogger info method adds entry with INFO level', () => {
  debugSwipeLogger.clear();
  debugSwipeLogger.info('testModule', 'testAction', { test: 'data' });
  const logs = debugSwipeLogger.getLogs();
  assert(logs.length > 0, 'should have at least one log');
  assert(logs[0].level === 'INFO', 'should have INFO level');
  assert(logs[0].module === 'testModule', 'should capture module');
  assert(logs[0].action === 'testAction', 'should capture action');
});

test('debugSwipeLogger warn method adds entry with WARN level', () => {
  debugSwipeLogger.clear();
  debugSwipeLogger.warn('testModule', 'warningAction');
  const logs = debugSwipeLogger.getLogs();
  assert(logs.length > 0, 'should have at least one log');
  assert(logs[0].level === 'WARN', 'should have WARN level');
});

test('debugSwipeLogger error method adds entry with ERROR level', () => {
  debugSwipeLogger.clear();
  debugSwipeLogger.error('testModule', 'errorAction');
  const logs = debugSwipeLogger.getLogs();
  assert(logs.length > 0, 'should have at least one log');
  assert(logs[0].level === 'ERROR', 'should have ERROR level');
});
