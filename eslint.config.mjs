import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';

export default defineConfig([
    {
        extends: [js.configs.recommended],

        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
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
]);
