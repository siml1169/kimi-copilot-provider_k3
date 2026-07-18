import * as vscode from 'vscode';
import type { ModelDefinition, ModelCapabilities, ModelDefaults, ModelConfigOverride } from './types';

// ═══════════════════════════════════════════════════════════════════════
// Model Registry
// ═══════════════════════════════════════════════════════════════════════

export const MODELS: ModelDefinition[] = [
	{
		id: 'kimi-k2.7-code',
		name: 'Kimi K2.7 Code',
		family: 'kimi',
		version: 'kimi-k2.7-code',
		detail: 'Most capable coding model (256K context, thinking always on)',
		maxInputTokens: 256000,
		maxOutputTokens: 32768,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		defaults: {
			temperature: 1.0,
			topP: 0.95,
			thinking: { type: 'enabled', keep: 'all' },
		},
	},
	{
		id: 'kimi-k2.7-code-highspeed',
		name: 'Kimi K2.7 Code (HighSpeed)',
		family: 'kimi',
		version: 'kimi-k2.7-code-highspeed',
		detail: 'HighSpeed version of K2.7 Code (~180 tokens/s, 256K context)',
		maxInputTokens: 256000,
		maxOutputTokens: 32768,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		defaults: {
			temperature: 1.0,
			topP: 0.95,
			thinking: { type: 'enabled', keep: 'all' },
		},
	},
	{
		id: 'kimi-k2.6',
		name: 'Kimi K2.6',
		family: 'kimi',
		version: 'kimi-k2.6',
		detail: 'Most intelligent versatile model (256K context, multimodal)',
		maxInputTokens: 256000,
		maxOutputTokens: 32768,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		defaults: {
			temperature: 1.0,
			topP: 0.95,
			thinking: { type: 'enabled' },
		},
	},
	{
		id: 'kimi-k2.5',
		name: 'Kimi K2.5',
		family: 'kimi',
		version: 'kimi-k2.5',
		detail: 'Versatile multimodal model (256K context, thinking capable)',
		maxInputTokens: 256000,
		maxOutputTokens: 32768,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		defaults: {
			temperature: 1.0,
			topP: 1.0,
			thinking: { type: 'enabled' },
		},
	},
	{
		id: 'kimi-k3',
		name: 'Kimi K3',
		family: 'kimi',
		version: 'kimi-k3',
		detail: 'Frontier MoE model (1M context, always-on reasoning, multimodal) — may require separate K3 API key',
		maxInputTokens: 1048576,
		maxOutputTokens: 32768,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		defaults: {
			temperature: 1.0,
			topP: 0.95,
			reasoning_effort: 'max',
		},
	},
];

// ── K3-specific system prompt — channel proactiveness with transparency ──
// K3 excels at long-horizon architectural reasoning. This prompt keeps that
// strength while requiring explicit user approval for significant changes.
export const K3_SYSTEM_PROMPT = `You are an AI coding assistant integrated into VS Code via GitHub Copilot Chat.

Architectural Changes:
- Before making structural changes (new files, refactored modules, added dependencies, renamed APIs), briefly explain your reasoning and ask for confirmation.
- Present trade-offs: why this approach over alternatives.
- Small, localized fixes within the scope of the request may proceed without asking.

Tool Usage:
- When using multiple tools, briefly state your plan before the first call.
- If you discover unexpected issues during execution, pause and surface them before proceeding.

Autonomy:
- It is fine to think deeply and explore context to give a high-quality answer.
- Do not silently expand scope. If you believe the task requires more than was asked, say so and let the user decide.`;

// Default system prompt for non-K3 models (matches upstream Kimi Copilot).
export const DEFAULT_SYSTEM_PROMPT =
	'You are Kimi, an AI assistant provided by Moonshot AI. You are proficient in Chinese and English conversations. You provide users with truthful, helpful, and accurate answers. Moonshot AI is a proper noun and should not be translated.';

// ═══════════════════════════════════════════════════════════════════════
// Model Picker Information (non-public API surface)
// ═══════════════════════════════════════════════════════════════════════
//
// The fields `isBYOK`, `isUserSelectable`, `statusIcon`, and
// `configurationSchema` are NOT part of the stable
// `vscode.LanguageModelChatInformation` typings. They are the same shape
// currently consumed by VS Code core / GitHub Copilot Chat to render model
// picker metadata and per-model configuration. Without them, the model
// simply won't appear in the picker.
//

/**
 * JSON-schema-ish shape for per-model configuration (duck-typed).
 * Mirrors `vscode.LanguageModelConfigurationSchema` from the proposed
 * chatProvider API; passes through the extension-host boundary unchanged.
 */
export interface ConfigurationSchemaProperty {
	type?: string;
	title?: string;
	description?: string;
	default?: unknown;
	enum?: unknown[];
	enumItemLabels?: string[];
	enumDescriptions?: string[];
	group?: string;
}

export interface LanguageModelConfigurationSchema {
	properties?: Record<string, ConfigurationSchemaProperty>;
}

interface ModelPickerChatInformation extends vscode.LanguageModelChatInformation {
	readonly isUserSelectable: boolean;
	readonly isBYOK: true;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: LanguageModelConfigurationSchema;
}

/** Format a token count the way the native picker does (1048576 → "1M"). */
function formatTierTokens(n: number): string {
	if (n >= 1_048_576 && n % 1_048_576 === 0) return `${n / 1_048_576}M`;
	if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
	return n.toLocaleString('en-US');
}

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	overrides?: Partial<ModelConfigOverride>,
	configuration?: Record<string, unknown>,
): ModelPickerChatInformation {
	const fullInputTokens = overrides?.maxInputTokens ?? m.maxInputTokens;
	const maxOutputTokens = overrides?.maxOutputTokens ?? m.maxOutputTokens;

	// Honor a user-selected Context Size tier: clamp the reported input budget
	// so Copilot's history trimming AND the Session Info gauge both follow it.
	const picked = configuration?.['contextSize'];
	const maxInputTokens =
		typeof picked === 'number' && picked > 0 && picked < fullInputTokens
			? Math.floor(picked)
			: fullInputTokens;

	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? m.detail : 'Please run "Kimi Copilot: Set API Key" to configure.',
		tooltip: hasApiKey ? undefined : 'API key not configured',
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens,
		maxOutputTokens,
		isBYOK: true,
		isUserSelectable: true,
		configurationSchema: buildConfigurationSchema(m, fullInputTokens),
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
	};
}

/**
 * Build the full per-model configuration schema (context size + thinking
 * effort picker for reasoning-capable models).
 */
function buildConfigurationSchema(
	m: ModelDefinition,
	fullInputTokens: number,
): LanguageModelConfigurationSchema {
	const props: Record<string, ConfigurationSchemaProperty> = {};

	// Context Size tier dropdown.
	const tiers = [fullInputTokens];
	const quarter = Math.floor(fullInputTokens / 4);
	if (quarter >= 65536 && quarter !== fullInputTokens) {
		tiers.push(quarter);
	}
	props.contextSize = {
		type: 'number',
		title: 'Context Size',
		description: 'Context window budget for this model.',
		enum: tiers,
		enumItemLabels: tiers.map(formatTierTokens),
		enumDescriptions: tiers.map((_, i) =>
			i === 0
				? 'Full context window (default)'
				: 'Smaller budget — trims history earlier, lower cost',
		),
		default: fullInputTokens,
		group: 'tokens',
	};

	// Thinking Effort picker — only for reasoning-capable models (K3, K2.6, etc.).
	if (m.defaults?.reasoning_effort) {
		const levels = ['low', 'high', 'max'] as const;
		const labels: Record<string, string> = { low: 'Low', high: 'High', max: 'Max' };
		const descriptions: Record<string, string> = {
			low: 'Faster responses with less reasoning',
			high: 'Greater reasoning depth but slower',
			max: 'Maximum reasoning — best for complex tasks (default)',
		};
		props.reasoningEffort = {
			type: 'string',
			title: 'Thinking Effort',
			description: 'Controls how deeply the model reasons before responding.',
			enum: [...levels],
			enumItemLabels: levels.map((l) => labels[l] ?? l),
			enumDescriptions: levels.map((l) => descriptions[l] ?? l),
			default: 'max',
			group: 'navigation',
		};
	}

	return { properties: props };
}

export function getModelCapabilities(modelId: string): ModelCapabilities | undefined {
	return MODELS.find((m) => m.id === modelId)?.capabilities;
}

export function getModelDefaults(modelId: string): ModelDefaults | undefined {
	return MODELS.find((m) => m.id === modelId)?.defaults;
}

export function getMaxOutputTokens(modelId: string): number {
	return MODELS.find((m) => m.id === modelId)?.maxOutputTokens ?? 32768;
}

export function findModelById(modelId: string): ModelDefinition | undefined {
	return MODELS.find((m) => m.id === modelId);
}
