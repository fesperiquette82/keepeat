// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // BUG-076 : `expo lint` sans argument ne lint que src/, app/ et components/ ;
    // le code de KeepEat vit aussi dans component/ (singulier), store/, utils/,
    // data/, integration/ et smoke/. Le script `npm run lint` lance désormais
    // `eslint .` : tout est couvert, et on exclut seulement ce qui est généré.
    ignores: ['dist/*', '.expo/*', '.test-dist/*', 'android/*', 'node_modules/*'],
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
  {
    // Scripts Node de build : la console est leur sortie normale.
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
]);
