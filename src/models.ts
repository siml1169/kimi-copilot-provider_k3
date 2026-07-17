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
// The fields `isBYOK`, `isUserSelectable`, and `statusIcon` are NOT part
// of the stable `vscode.LanguageModelChatInformation` typings. They are the
// same shape currently consumed by GitHub Copilot Chat to render model
// picker metadata. Without them, the model simply won't appear in the picker.
//

interface ModelPickerChatInformation extends vscode.LanguageModelChatInformation {
	readonly isUserSelectable: boolean;
	readonly isBYOK: true;
	readonly statusIcon?: vscode.ThemeIcon;
}

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	overrides?: Partial<ModelConfigOverride>,
): ModelPickerChatInformation {
	const maxInputTokens = overrides?.maxInputTokens ?? m.maxInputTokens;
	const maxOutputTokens = overrides?.maxOutputTokens ?? m.maxOutputTokens;
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
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
	};
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
