import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  formatApiErrorDetail,
  getApiErrorDetail,
  getErrorMessage,
  getHttpResponseData,
  getHttpStatus,
} from './errorDetails';

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

// BUG-093 : `new Error(detail)` sur une liste d'erreurs de validation FastAPI
// (422) affichait « [object Object] » à l'utilisateur, à la connexion comme à
// l'export ou à la suppression du compte.

test('[REGRESSION BUG-093] formatApiErrorDetail rend lisible une erreur de validation 422', () => {
  const detail = [
    {
      type: 'value_error',
      loc: ['body', 'email'],
      msg: 'value is not a valid email address: The part after the @-sign is a special-use or reserved name that cannot be used with email.',
      input: 'e2e.free@keepeat.test',
    },
  ];
  const message = formatApiErrorDetail(detail);
  assert.ok(message && message.startsWith('value is not a valid email address'));
  assert.notEqual(new Error(message).message, '[object Object]');
});

test('formatApiErrorDetail joint plusieurs erreurs de validation', () => {
  assert.equal(formatApiErrorDetail([{ msg: 'champ requis' }, { msg: 'trop court' }]), 'champ requis ; trop court');
});

test('formatApiErrorDetail garde une chaîne et lit message puis code d’un objet', () => {
  assert.equal(formatApiErrorDetail('EMAIL_NOT_VERIFIED'), 'EMAIL_NOT_VERIFIED');
  assert.equal(formatApiErrorDetail({ message: 'Mot de passe incorrect', code: 'X' }), 'Mot de passe incorrect');
  assert.equal(formatApiErrorDetail({ code: 'INVALID_PASSWORD' }), 'INVALID_PASSWORD');
});

test('formatApiErrorDetail rend undefined quand rien n’est lisible, pour laisser le repli', () => {
  for (const value of [undefined, null, '', 42, {}, [], [{ loc: ['body'] }]]) {
    assert.equal(formatApiErrorDetail(value), undefined);
  }
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
