/**
 * Shared types for the Kimi Copilot extension.
 */

// ---- API request/response types ----

export interface KimiMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: KimiToolCall[];
}

export interface KimiToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface KimiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface KimiUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface KimiRequest {
	model: string;
	messages: KimiMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	thinking?: { type: 'enabled' | 'disabled' };
	tools?: KimiTool[];
	tool_choice?: 'none' | 'auto' | 'required';
}

export interface KimiStreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: KimiUsage;
}

// ---- Model definitions ----

export interface ModelCapabilities {
	/** Whether the model supports function/tool calling. */
	toolCalling: boolean;
	/** Whether the model supports image input natively. */
	imageInput: boolean;
	/** Whether the model supports reasoning/thinking content. */
	thinking: boolean;
}

export interface ModelDefaults {
	/** Sampling temperature the API expects (K2.7 requires 1.0). */
	temperature?: number;
	/** Top-p sampling the API expects (K2.7 requires 0.95). */
	topP?: number;
	/** Thinking mode default (K2.7 requires enabled). */
	thinking?: { type: 'enabled' | 'disabled' };
}

export interface ModelConfigOverride {
	/** Override API model ID sent for this picker model. */
	overrideModelId?: string;
	/** Override max input tokens reported to Copilot Chat. */
	maxInputTokens?: number;
	/** Override max output tokens reported to Copilot Chat and sent as max_tokens. */
	maxOutputTokens?: number;
	/** Sampling temperature (use model default when omitted). */
	temperature?: number;
	/** Top-p sampling (use model default when omitted). */
	topP?: number;
	/** Presence penalty (K2.7 requires 0.0). */
	presencePenalty?: number;
	/** Frequency penalty (K2.7 requires 0.0). */
	frequencyPenalty?: number;
	/** Thinking mode override. */
	thinking?: { type: 'enabled' | 'disabled' };
	/** Per-model system prompt. */
	systemPrompt?: string;
	/** Whether tool calling is enabled for this model. */
	toolCalling?: boolean;
}

export interface ModelDefinition {
	/** Unique model identifier used in the model picker. */
	id: string;
	/** Human-readable model name. */
	name: string;
	/** Model family name. */
	family: string;
	/** Model version string. */
	version: string;
	/** Short description shown in the picker detail. */
	detail: string;
	/** Max input tokens the model accepts. */
	maxInputTokens: number;
	/** Max output tokens the model can produce. */
	maxOutputTokens: number;
	/** Capability flags. */
	capabilities: ModelCapabilities;
	/** Hard-coded API defaults for this model. */
	defaults?: ModelDefaults;
}

export interface KimiModelsResponse {
	data: Array<{
		id: string;
		object: string;
	}>;
}
