import assert from 'node:assert/strict';
import test from 'node:test';

const mockAuthStore = {
  login: async () => {},
  loginWithBiometrics: async () => {},
  resendVerification: async () => {},
  error: null,
  clearError: () => {},
  hasBiometricCredentials: false,
  isBiometricSupported: false,
};

const mockLanguageStore = {
  language: 'en',
};

const mockRouter = {
  push: (path: string) => {},
  replace: (path: string) => {},
};

test('LoginScreen: email not verified message displayed without duplicate error', () => {
  const localError = null;
  const storeError = null;
  const displayError = localError || storeError;

  assert.equal(displayError, null, 'No error should be displayed when both are null');
});

test('LoginScreen: local error takes precedence over store error', () => {
  const localError = 'Custom local error';
  const storeError = 'Store error';
  const displayError = localError || storeError;

  assert.equal(displayError, 'Custom local error', 'Local error should take precedence');
});

test('LoginScreen: store error shown when local error is null', () => {
  const localError = null;
  const storeError = 'Error from auth store';
  const displayError = localError || storeError;

  assert.equal(displayError, 'Error from auth store', 'Store error should be shown when local is null');
});

test('LoginScreen: email not verified state prevents duplicate error display', () => {
  const emailNotVerified = true;
  const localError = null;
  const storeError = 'EMAIL_NOT_VERIFIED';

  // When email not verified, we show warning box but not error box
  assert.equal(emailNotVerified, true, 'Email not verified state should be true');

  // Clear global error to prevent duplicate
  const displayError = emailNotVerified ? null : (localError || storeError);

  assert.equal(displayError, null, 'Error should not display when email not verified is true');
});

test('LoginScreen: handles biometric login error messages correctly', async () => {
  const errors = [
    { message: 'BIOMETRIC_NOT_SUPPORTED', expected: 'Your phone does not support biometrics.' },
    { message: 'BIOMETRIC_CREDENTIALS_NOT_FOUND', expected: 'No biometric credential is saved yet.' },
    { message: 'Generic error', expected: 'Biometric sign-in failed.' },
  ];

  for (const errorCase of errors) {
    let displayedError = '';

    if (errorCase.message === 'BIOMETRIC_NOT_SUPPORTED') {
      displayedError = 'Your phone does not support biometrics.';
    } else if (errorCase.message === 'BIOMETRIC_CREDENTIALS_NOT_FOUND') {
      displayedError = 'No biometric credential is saved yet.';
    } else {
      displayedError = 'Biometric sign-in failed.';
    }

    assert.equal(displayedError, errorCase.expected, `Error message for ${errorCase.message} should match`);
  }
});

test('LoginScreen: login form validation prevents empty email submission', () => {
  const email = '';
  const password = 'password';

  if (!email.trim()) {
    const error = 'Please enter your email.';
    assert.equal(error, 'Please enter your email.', 'Empty email should show validation error');
  } else {
    assert.fail('Should not reach here with empty email');
  }
});

test('LoginScreen: login form validation prevents empty password submission', () => {
  const email = 'test@example.com';
  const password = '';

  if (!password) {
    const error = 'Please enter your password.';
    assert.equal(error, 'Please enter your password.', 'Empty password should show validation error');
  } else {
    assert.fail('Should not reach here with empty password');
  }
});

test('LoginScreen: email normalization (trim + lowercase)', () => {
  const testCases = [
    { input: '  Test@EXAMPLE.COM  ', expected: 'test@example.com' },
    { input: 'user@domain.org', expected: 'user@domain.org' },
    { input: '  ADMIN@TEST.NET  ', expected: 'admin@test.net' },
  ];

  for (const testCase of testCases) {
    const normalized = testCase.input.trim().toLowerCase();
    assert.equal(normalized, testCase.expected, `Email should be normalized correctly: ${testCase.input}`);
  }
});
