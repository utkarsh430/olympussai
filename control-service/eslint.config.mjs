// Flat ESLint config for control-service. This is a standalone Node/TS
// service (not part of the Next.js app), so it uses typescript-eslint
// directly rather than eslint-config-next. Mirrors the strictness of the
// root app's config (typescript-eslint recommended + type-checked rules).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Plain JS/TS config files at the package root aren't part of the
    // src/test tsconfig program, so they can't use type-aware rules -
    // lint them with syntax-only rules instead of failing to find a
    // parser project for them.
    files: ['*.config.mjs', '*.config.ts', 'eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Standalone maintainer scripts. Plain ESM, run with bare `node`, and
    // deliberately outside the src/test tsconfig program - so, like the config
    // files above, they get syntax-only rules rather than type-aware ones.
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // Test files assert against loosely-typed fixtures (e.g. supertest's
    // `res.body: any`) - relax the unsafe-* rules here rather than force
    // a response-body type cast in every assertion. Covers both the
    // application-runtime suite (`test/`) and the state-estimation suite
    // (`tests/`).
    files: ['test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  }
);
