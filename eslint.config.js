// ESLint flat config per platform ADR-0005.
// Three source trees, three environments:
//   src/**        browser ESM  — the draft app itself
//   scripts/**    Node ESM     — build/ETL helpers (.mjs)
//   lambda/**     Node CJS     — the feedback Lambda

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import promise from 'eslint-plugin-promise';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'lambda/node_modules/',
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
    // .mjs, not .js — every script in this tree is an ES module.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // The feedback Lambda is CommonJS on the Node runtime.
    files: ['lambda/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
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
];
