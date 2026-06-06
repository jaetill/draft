// ESLint flat config per platform ADR-0005.

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import promise from 'eslint-plugin-promise';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'site/',
      'coverage/',
      'spike/',
      '.claude/worktrees/',
      'public/',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: { import: importPlugin, 'unused-imports': unusedImports, promise },
    rules: {
      'unused-imports/no-unused-imports': 'warn',
      'promise/always-return': 'warn',
      complexity: ['warn', 10],
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      'no-console': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
  },
  {
    files: ['lambda/**/*.js'],
    ignores: ['lambda/node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: { 'no-console': 'off' },
  },
];
