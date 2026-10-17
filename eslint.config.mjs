import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';

export default defineConfig([
    {
        extends: [js.configs.recommended],

        languageOptions: {
            globals: { ...globals.es2024 },
            ecmaVersion: 'latest',
            sourceType: 'module',

            parserOptions: {
                allowImportExportEverywhere: true,
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },

        rules: {
            quotes: [
                'error',
                'single',
                {
                    avoidEscape: true,
                },
            ],
            'no-undef': 'error',
            strict: 'off',
            semi: 'error',
            'no-extra-semi': 'error',
            'no-underscore-dangle': 'off',
            'no-mixed-spaces-and-tabs': 'off',
            'no-console': 'warn',
            'no-unused-vars': 'error',
            'no-trailing-spaces': ['warn', { skipBlankLines: true }],
            'no-unreachable': 'warn',
            'no-alert': 'warn',
            'brace-style': ['error', '1tbs', { allowSingleLine: true }],

            'no-var': 'error',
            'prefer-const': 'warn',
            'prefer-template': 'warn',
            'object-shorthand': 'warn',
            'no-const-assign': 'error',
            'no-duplicate-imports': 'warn',
            'no-useless-rename': 'warn',
        },

        ignores: ['**/dist/**/*', '**/node_modules/**', '**/coverage/**/*'],
    },
    {
        // The webapp's pages and UI helpers run in the browser.
        files: ['webapp/src/**/*.js'],
        ignores: ['webapp/src/core/**'],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },
    {
        // The pure modules: no DOM, no Node (only the language's own globals, set above), no UI imports, so
        // the webapp, scripts and tests share them.
        files: ['webapp/src/core/**/*.js'],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: [{ group: ['../*', '!../core/*'], message: 'core/ modules may only import core/.' }] },
            ],
        },
    },
    {
        // Command-line tools, tests and config files run in Node; the tools and tests report on the console.
        files: ['scripts/**/*.js', 'test/**/*.js', '*.{js,mjs}', 'webapp/*.js'],
        languageOptions: {
            globals: { ...globals.node },
        },
        rules: {
            'no-console': 'off',
        },
    },
]);
