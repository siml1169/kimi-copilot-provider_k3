import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = path.resolve(__dirname, '.');

export default defineConfig({
    label: 'unit',
    files: 'out/test/**/*.test.js',
    version: 'stable',
    workspaceFolder: extensionDevelopmentPath,
    mocha: {
        ui: 'tdd',
        timeout: 20000,
    },
    extensionDevelopmentPath,
});
