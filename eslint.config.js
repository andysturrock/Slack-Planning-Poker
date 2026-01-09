import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: ['./tsconfig.json', './cdk/tsconfig.json', './lambda-src/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Disable type-aware linting on JS files
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['**/dist/**', '**/cdk.out/**', 'node_modules/**', '**/package-lock.json'],
  }
];
