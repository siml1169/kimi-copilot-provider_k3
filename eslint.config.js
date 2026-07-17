// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                // Use the project service so each file is linted against the
                // tsconfig that actually includes it (tsconfig.json for the
                // extension, tsconfig.unit.json for the plain-Node tests).
                projectService: true,
                tsconfigRootDir: __dirname,
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
