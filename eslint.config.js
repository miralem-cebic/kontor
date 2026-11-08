import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Application code: no unchecked assertions and no `any`. Tests keep the looser defaults.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Type-aware: a switch over a union must handle every case (or end with a `never` check)
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.*', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The e2e specs take `test` from helpers.ts, which switches the app into test mode; only testMode.spec.ts checks
    // that the app without it is not in test mode (#83)
    files: ['tests/e2e/**/*.spec.ts'],
    ignores: ['tests/e2e/testMode.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: '@playwright/test', importNames: ['test'], message: 'Import test from ./helpers: it runs the app in test mode.' }] }],
    },
  },
);
