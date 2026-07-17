import * as vscode from 'vscode';
import type { ModelConfigOverride } from './types';
import { K3_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from './models';

// ═══════════════════════════════════════════════════════════════════════
// Configuration helpers — read extension settings at runtime.
// Includes secure API key storage via SecretStorage.
// ═══════════════════════════════════════════════════════════════════════

const CONFIG_SECTION = 'kimi3Copilot';
const API_KEY_SECRET_KEY = 'kimi3Copilot.apiKey';
const K3_API_KEY_SECRET_KEY = 'kimi3Copilot.k3ApiKey';

const DEFAULT_BASE_URL = 'https://api.moonshot.ai';
const DEFAULT_ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';

export class ConfigurationManager {
	constructor(private readonly secretStorage: vscode.SecretStorage) {}

	get config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration(CONFIG_SECTION);
	}

	/** Returns the main API key from SecretStorage. */
	async getApiKey(): Promise<string | undefined> {
		return this.secretStorage.get(API_KEY_SECRET_KEY);
	}

	/** Stores the main API key securely in VS Code SecretStorage. */
	async setApiKey(value: string): Promise<void> {
		await this.secretStorage.store(API_KEY_SECRET_KEY, value);
	}

	/** Removes the stored main API key. */
	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(API_KEY_SECRET_KEY);
	}

	/** Returns the K3-specific API key from SecretStorage. */
	async getK3ApiKey(): Promise<string | undefined> {
		return this.secretStorage.get(K3_API_KEY_SECRET_KEY);
	}

	/** Stores the K3-specific API key. */
	async setK3ApiKey(value: string): Promise<void> {
		await this.secretStorage.store(K3_API_KEY_SECRET_KEY, value);
	}

	/** Removes the stored K3 API key. */
	async deleteK3ApiKey(): Promise<void> {
		await this.secretStorage.delete(K3_API_KEY_SECRET_KEY);
	}

	/**
	 * Returns the effective API key for a given model.
	 * For K3 models: K3-specific key takes priority, falls back to main key.
	 * For all others: main key.
	 */
	async getEffectiveApiKey(modelId?: string): Promise<string | undefined> {
		if (modelId?.startsWith('kimi-k3')) {
			const k3Key = await this.getK3ApiKey();
			if (k3Key) {
				return k3Key;
			}
		}
		return this.getApiKey();
	}

	getBaseUrl(): string {
		return this.config.get<string>('baseUrl', DEFAULT_BASE_URL).replace(/\/+$/, '');
	}

	getEndpoint(): string {
		const endpoint = this.config.get<string>('endpoint', DEFAULT_ENDPOINT);
		const candidate = endpoint.trim().length > 0 ? endpoint : DEFAULT_ENDPOINT;
		try {
			new URL(candidate);
			return candidate;
		} catch {
			return DEFAULT_ENDPOINT;
		}
	}

	/** Returns the K3-specific endpoint override, or falls back to getEndpoint(). */
	getK3Endpoint(): string {
		const k3Endpoint = this.config.get<string>('k3Endpoint', '');
		if (k3Endpoint.trim().length > 0) {
			try {
				new URL(k3Endpoint);
				return k3Endpoint;
			} catch {
				// Invalid URL → fall through to default
			}
		}
		return this.getEndpoint();
	}

	/** Per-model overrides. */
	getModelConfig(vscodeModelId: string): ModelConfigOverride {
		const configs = this.config.get<Record<string, ModelConfigOverride>>('modelConfigs', {});
		return configs?.[vscodeModelId] ?? {};
	}

	/** Resolves the effective API model ID for a picker model. */
	getApiModelId(vscodeModelId: string): string {
		const modelConfig = this.getModelConfig(vscodeModelId);
		if (modelConfig.overrideModelId) {
			return modelConfig.overrideModelId;
		}

		const overrides = this.config.get<Record<string, string>>('modelIdOverrides', {});
		return overrides?.[vscodeModelId] ?? vscodeModelId;
	}

	getModel(): string {
		return this.config.get<string>('model', 'kimi-k2.7-code');
	}

	/** Effective temperature for a picker model: model config > global default. */
	getTemperature(modelId?: string): number {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.temperature !== undefined) {
				return modelConfig.temperature;
			}
		}
		return this.config.get<number>('temperature', 1.0);
	}

	/** Effective max output tokens for a picker model: model config > global default. */
	getMaxTokens(modelId?: string): number {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.maxOutputTokens !== undefined) {
				return modelConfig.maxOutputTokens;
			}
		}
		return this.config.get<number>('maxTokens', 0);
	}

	getTopP(modelId?: string): number {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.topP !== undefined) {
				return modelConfig.topP;
			}
		}
		return this.config.get<number>('topP', 0.95);
	}

	getPresencePenalty(modelId?: string): number | undefined {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.presencePenalty !== undefined) {
				return modelConfig.presencePenalty;
			}
		}
		return this.config.get<number | undefined>('presencePenalty', undefined);
	}

	getFrequencyPenalty(modelId?: string): number | undefined {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.frequencyPenalty !== undefined) {
				return modelConfig.frequencyPenalty;
			}
		}
		return this.config.get<number | undefined>('frequencyPenalty', undefined);
	}

	getThinking(modelId?: string): { type: 'enabled' | 'disabled' } | undefined {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.thinking) {
				return modelConfig.thinking;
			}
		}
		return undefined;
	}

	getTimeout(): number {
		return this.config.get<number>('timeout', 60000);
	}

	getEnableStreaming(): boolean {
		return this.config.get<boolean>('enableStreaming', true);
	}

	/** Context-fill fraction (0–1) at which to warn. Default 0.8 (80%). */
	getContextWarnThreshold(): number {
		return this.config.get<number>('contextWarnThreshold', 0.8);
	}

	/** Whether to show context-window-fill warnings. Default true. */
	getWarnOnContextFill(): boolean {
		return this.config.get<boolean>('warnOnContextFill', true);
	}

	/** Cache-miss fraction (0–1) at which to warn. Default 0.8 (80%). */
	getCacheMissWarnThreshold(): number {
		return this.config.get<number>('cacheMissWarnThreshold', 0.8);
	}

	/** Whether to show high cache-miss warnings. Default true. */
	getWarnOnCacheMiss(): boolean {
		return this.config.get<boolean>('warnOnCacheMiss', true);
	}

	getSystemPrompt(modelId?: string): string {
		if (modelId) {
			const modelConfig = this.getModelConfig(modelId);
			if (modelConfig.systemPrompt !== undefined && modelConfig.systemPrompt.trim().length > 0) {
				return modelConfig.systemPrompt;
			}
			// K3 gets a constraining prompt by default to counteract excessive proactiveness.
			if (modelId.startsWith('kimi-k3')) {
				return this.config.get<string>('systemPrompt', K3_SYSTEM_PROMPT);
			}
		}
		return this.config.get<string>('systemPrompt', DEFAULT_SYSTEM_PROMPT);
	}

	/** Subscribe to configuration changes in our section. */
	onDidChange(callback: () => void): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(CONFIG_SECTION)) {
				callback();
			}
		});
	}
}
