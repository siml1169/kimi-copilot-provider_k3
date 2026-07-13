import { defineConfig } from '@vscode/test-cli';
import * as path from 'path';

const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');

export default defineConfig({
    label: 'unit',
    files: '**/*.test.js',
    version: 'insiders',
    workspaceFolder: extensionDevelopmentPath,
    mocha: {
        ui: 'tdd',
        timeout: 20000,
    },
    extensionDevelopmentPath,
});
