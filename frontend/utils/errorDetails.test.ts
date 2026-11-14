import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getApiErrorDetail, getErrorMessage, getHttpResponseData, getHttpStatus } from './errorDetails';

// BUG-085 : les `catch (e: any)` lisaient `e.message` / `e.response.data.detail`
// sans aucune vérification. Ces helpers doivent rendre la même information pour
// les formes usuelles et ne jamais lever sur une forme inattendue.

const axiosLike = {
  message: 'Request failed with status code 422',
  response: { status: 422, data: { detail: 'WEAK_PASSWORD: 8 caractères minimum' } },
};

test('getErrorMessage lit Error, objet porteur de message et chaîne', () => {
  assert.equal(getErrorMessage(new Error('EMAIL_NOT_VERIFIED')), 'EMAIL_NOT_VERIFIED');
  assert.equal(getErrorMessage(axiosLike), 'Request failed with status code 422');
  assert.equal(getErrorMessage('texte levé tel quel'), 'texte levé tel quel');
});

test('getErrorMessage rend undefined sans lever pour les formes inattendues', () => {
  for (const value of [null, undefined, 42, {}, { message: 12 }, []]) {
    assert.equal(getErrorMessage(value), undefined);
  }
});

test('getHttpStatus lit le statut d’une erreur axios, sinon null', () => {
  assert.equal(getHttpStatus(axiosLike), 422);
  assert.equal(getHttpStatus(new Error('réseau')), null);
  assert.equal(getHttpStatus({ response: { status: '500' } }), null);
  assert.equal(getHttpStatus(null), null);
});

test('getApiErrorDetail lit le detail texte de FastAPI, sinon undefined', () => {
  assert.equal(getApiErrorDetail(axiosLike), 'WEAK_PASSWORD: 8 caractères minimum');
  assert.equal(getApiErrorDetail({ response: { data: { detail: { code: 'PREMIUM_REQUIRED' } } } }), undefined);
  assert.equal(getApiErrorDetail({ response: {} }), undefined);
  assert.equal(getApiErrorDetail('boom'), undefined);
});

test('getHttpResponseData rend le corps brut de la réponse, sinon null', () => {
  assert.deepEqual(getHttpResponseData(axiosLike), { detail: 'WEAK_PASSWORD: 8 caractères minimum' });
  assert.equal(getHttpResponseData(new Error('réseau')), null);
  assert.equal(getHttpResponseData(undefined), null);
});

// Garde-fou : plus aucun `catch (x: any)` dans le code applicatif — la valeur
// interceptée est `unknown` et se lit par les helpers ci-dessus.

const FRONTEND_ROOT = join(__dirname, '..', '..');

function listAppSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listAppSources(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test('[REGRESSION BUG-085] aucun catch (x: any) dans le code applicatif', () => {
  const offenders: string[] = [];
  for (const dir of ['app', 'component', 'store', 'utils', 'data']) {
    for (const file of listAppSources(join(FRONTEND_ROOT, dir))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/catch\s*\(\s*\w+\s*:\s*any\s*\)/.test(line)) {
          offenders.push(`${file.replace(FRONTEND_ROOT + '/', '')}:${index + 1}`);
        }
      });
    }
  }
  assert.deepEqual(offenders, []);
});
