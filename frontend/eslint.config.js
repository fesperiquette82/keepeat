// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Enforce no console.log in production code (Rule 1.4 from core-rules.md)
      // Use logger from utils/logger.ts for debug logging
      // Allow console.error and console.warn for error handling
      'no-console': [
        'error',
        {
          allow: ['error', 'warn'],
        },
      ],
    },
  },
]);
