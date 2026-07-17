import * as vscode from 'vscode';
import { ConfigurationManager } from './config';
import { KimiChatProvider } from './provider';
import { UsageTracker, formatTokens, formatCost } from './usage';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configManager = new ConfigurationManager(context.secrets);
    const provider = new KimiChatProvider(configManager);

    // Wire up usage tracking
    const usageTracker = new UsageTracker(context.workspaceState);
    provider.setUsageTracker(usageTracker);
    context.subscriptions.push(usageTracker);

    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('kimi3-copilot', provider),
        provider,
    );

    registerCommands(context, configManager, provider, usageTracker);

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
    usageTracker: UsageTracker,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('kimi3-copilot.setApiKey', async () => {
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

        vscode.commands.registerCommand('kimi3-copilot.setK3ApiKey', async () => {
            const current = await configManager.getK3ApiKey();
            const value = await vscode.window.showInputBox({
                prompt: 'Enter your K3 API key (separate Moonshot key for kimi-k3)',
                value: current,
                password: true,
                ignoreFocusOut: true,
                placeHolder: current ? '(stored)' : 'sk-...',
            });

            if (value !== undefined) {
                if (value.trim().length === 0) {
                    await configManager.deleteK3ApiKey();
                    vscode.window.showInformationMessage('K3 API key cleared. Will fall back to main key.');
                } else {
                    await configManager.setK3ApiKey(value);
                    vscode.window.showInformationMessage('K3 API key saved securely.');
                }
                provider.refreshModelPicker();
            }
        }),

        vscode.commands.registerCommand('kimi3-copilot.selectModel', async () => {
            const { MODELS } = await import('./models.js');
            const current = configManager.getModel();

            const items: vscode.QuickPickItem[] = MODELS.map((m) => ({
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

        vscode.commands.registerCommand('kimi3-copilot.editModelConfig', async () => {
            const { MODELS } = await import('./models.js');

            const selected = await vscode.window.showQuickPick(
                MODELS.map((m): vscode.QuickPickItem => ({
                    label: m.name,
                    description: m.id,
                    detail: m.detail,
                })),
                { placeHolder: 'Select model to configure', ignoreFocusOut: true },
            );

            if (!selected) {
                return;
            }

            const modelId = selected.description ?? '';
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

        vscode.commands.registerCommand('kimi3-copilot.testConnection', async () => {
            const apiKey = await configManager.getApiKey();
            if (!apiKey) {
                vscode.window.showErrorMessage('Kimi API key is not set. Run "Kimi3 Copilot: Set API Key".');
                return;
            }

            const modelId = configManager.getModel();
            const isK3 = modelId.startsWith('kimi-k3');
            const endpoint = isK3 ? configManager.getK3Endpoint() : configManager.getEndpoint();
            const k3Key = isK3 ? await configManager.getK3ApiKey() : undefined;
            const keySource = isK3 && k3Key ? 'K3 key' : 'main key';

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Testing Kimi connection...`,
                    cancellable: true,
                },
                async (progress, token) => {
                    progress.report({ message: `${modelId} → ${endpoint} (${keySource})` });

                    try {
                        await provider.testConnection(modelId, token);
                        vscode.window.showInformationMessage(
                            `✅ Kimi connection OK — ${modelId} @ ${endpoint} (${keySource})`,
                        );
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        const detail = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
                        vscode.window
                            .showErrorMessage(
                                `❌ Kimi connection failed: ${detail}`,
                                'Show Details',
                                'Open Settings',
                            )
                            .then((choice) => {
                                if (choice === 'Show Details') {
                                    const output = vscode.window.createOutputChannel('Kimi3 Copilot');
                                    output.appendLine(`Test connection failed at ${new Date().toISOString()}`);
                                    output.appendLine(`Endpoint: ${endpoint}`);
                                    output.appendLine(`Model: ${modelId}`);
                                    output.appendLine(`Error: ${msg}`);
                                    output.show();
                                } else if (choice === 'Open Settings') {
                                    vscode.commands.executeCommand(
                                        'workbench.action.openSettings',
                                        'kimi3Copilot',
                                    );
                                }
                            });
                    }
                },
            );
        }),

        vscode.commands.registerCommand('kimi3-copilot.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'kimi3Copilot');
        }),

        vscode.commands.registerCommand('kimi3-copilot.showUsageStats', async () => {
            const stats = usageTracker.getStats();
            const content = [
                `# Kimi Usage Today`,
                ``,
                `**Date:** ${stats.date}`,
                ``,
                `| Metric | Value |`,
                `|---|---|`,
                `| Requests | ${stats.totalRequests} |`,
                `| Input tokens | ${formatTokens(stats.totalPromptTokens)} |`,
                `| Output tokens | ${formatTokens(stats.totalCompletionTokens)} |`,
                `| Cached tokens | ${formatTokens(stats.totalCachedTokens)} |`,
                `| Cache hit rate | ${stats.cacheHitRate.toFixed(1)}% |`,
                `| **Total cost** | **${formatCost(stats.totalCost)}** |`,
                ``,
                `_Costs are estimated based on published Kimi pricing._`,
            ].join('\n');

            const doc = await vscode.workspace.openTextDocument({
                content,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        }),

        vscode.commands.registerCommand('kimi3-copilot.resetUsageStats', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Reset today\'s usage statistics?',
                { modal: true },
                'Reset',
            );
            if (confirm === 'Reset') {
                usageTracker.reset();
                vscode.window.showInformationMessage('Kimi usage stats reset.');
            }
        }),
    );
}

export async function deactivate(): Promise<void> {
    // Nothing to clean up; VS Code disposes subscriptions automatically.
}
