import * as vscode from 'vscode';
import { ConfigurationManager } from './config';
import { KimiChatProvider } from './provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configManager = new ConfigurationManager(context.secrets);
    const provider = new KimiChatProvider(configManager);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('kimi-copilot', provider),
    );

    registerCommands(context, configManager, provider);

    // Copilot Chat may serve cached model info. Activate it first so the
    // refresh reaches a live listener and re-queries the provider.
    try {
        await vscode.extensions.getExtension('github.copilot-chat')?.activate();
    } catch {
        // Best-effort; Copilot Chat may not be installed.
    }

    provider.refreshModelPicker();
}

function registerCommands(
    context: vscode.ExtensionContext,
    configManager: ConfigurationManager,
    provider: KimiChatProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('kimi-copilot.setApiKey', async () => {
            const current = await configManager.getApiKey();
            const value = await vscode.window.showInputBox({
                prompt: 'Enter your Kimi API key (sk-kimi-...)',
                value: current,
                password: true,
                ignoreFocusOut: true,
                validateInput: (input) => {
                    if (!input || input.trim().length === 0) {
                        return 'API key cannot be empty';
                    }
                    return undefined;
                },
            });

            if (value !== undefined) {
                await configManager.setApiKey(value);
                provider.refreshModelPicker();
                vscode.window.showInformationMessage('Kimi API key saved securely.');
            }
        }),

        vscode.commands.registerCommand('kimi-copilot.selectModel', async () => {
            const { MODELS } = await import('./models');
            const current = configManager.getModel();

            const items = MODELS.map((m) => ({
                label: m.name,
                description: m.id,
                detail: m.detail,
                picked: m.id === current,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select default Kimi model',
                ignoreFocusOut: true,
            });

            if (selected) {
                await configManager.config.update('model', selected.description, true);
                provider.refreshModelPicker();
                vscode.window.showInformationMessage(`Default Kimi model set to ${selected.label}`);
            }
        }),

        vscode.commands.registerCommand('kimi-copilot.editModelConfig', async () => {
            const { MODELS } = await import('./models');

            const selected = await vscode.window.showQuickPick(
                MODELS.map((m) => ({
                    label: m.name,
                    description: m.id,
                    detail: m.detail,
                })),
                { placeHolder: 'Select model to configure', ignoreFocusOut: true },
            );

            if (!selected) {
                return;
            }

            const modelId = selected.description;
            const currentConfig = configManager.getModelConfig(modelId);
            const model = MODELS.find((m) => m.id === modelId);

            const updated = await vscode.window.showInputBox({
                prompt: `Edit JSON overrides for ${modelId}`,
                value: JSON.stringify(currentConfig, null, 2),
                ignoreFocusOut: true,
                validateInput: (input) => {
                    try {
                        if (input.trim().length > 0) {
                            JSON.parse(input);
                        }
                        return undefined;
                    } catch (err) {
                        return `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
                    }
                },
            });

            if (updated === undefined) {
                return;
            }

            const parsed = updated.trim().length > 0 ? JSON.parse(updated) : {};
            const configs = configManager.config.get<Record<string, object>>('modelConfigs', {});
            configs[modelId] = parsed;

            await configManager.config.update('modelConfigs', configs, true);
            provider.refreshModelPicker();
            vscode.window.showInformationMessage(
                `Updated configuration for ${model?.name ?? modelId}.`,
            );
        }),

        vscode.commands.registerCommand('kimi-copilot.testConnection', async () => {
            const apiKey = await configManager.getApiKey();
            if (!apiKey) {
                vscode.window.showErrorMessage('Kimi API key is not set. Run "Kimi Copilot: Set API Key".');
                return;
            }

            try {
                const models = await provider.provideLanguageModelChatInformation(
                    {} as vscode.PrepareLanguageModelChatModelOptions,
                    new vscode.CancellationTokenSource().token,
                );
                vscode.window.showInformationMessage(`Connection OK. ${models.length} Kimi model(s) available.`);
            } catch (err) {
                vscode.window.showErrorMessage(`Kimi connection failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }),

        vscode.commands.registerCommand('kimi-copilot.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'kimiCopilot');
        }),
    );
}

export async function deactivate(): Promise<void> {
    // Nothing to clean up; VS Code disposes subscriptions automatically.
}
