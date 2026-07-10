// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: './tsconfig.json',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        ignores: ['out/**', 'node_modules/**', '.vscode-test/**', '**/*.js'],
    }
);
