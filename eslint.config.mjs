import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/generated/**',
      'mobile/assets/player/**',
      'mobile/android/**',
      'mobile/ios/**',
      'playwright-report/**',
      'test-results/**',
      '.agents/caveman/**',
      '.agents/ultracave/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
