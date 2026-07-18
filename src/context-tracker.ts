import { estimateTokens } from './tokenize';
import type { KimiMessage } from './types';

// ═══════════════════════════════════════════════════════════════════════
// Session context tracker — estimates the token size of the current
// conversation BEFORE sending a request, so we can warn or block when
// the context is about to overflow.
// ═══════════════════════════════════════════════════════════════════════

export interface ContextTrackerOptions {
	/** Maximum input tokens the model accepts (context window). */
	maxInputTokens: number;
	/** Fraction of context at which to log a warning (default 0.8). */
	warningThreshold: number;
	/** Fraction of context at which to block the request (default 0.95). */
	errorThreshold: number;
}

export interface ContextEstimate {
	tokens: number;
	limit: number;
	ratio: number;
	status: 'ok' | 'warning' | 'critical' | 'exceeded';
}

/**
 * Estimate the token count for a single KimiMessage.
 * - text parts: use `estimateTokens` (CJK-aware heuristic)
 * - image parts: fixed conservative estimate (~85 tokens for a typical image URL)
 * - tool calls / tool results: use `estimateTokens` on serialised content
 */
function estimateMessageTokens(message: KimiMessage): number {
	if (typeof message.content === 'string') {
		return estimateTokens(message.content);
	}

	// Content is a ContentPart[]
	let tokens = 0;
	for (const part of message.content) {
		if (part.type === 'text' && part.text) {
			tokens += estimateTokens(part.text);
		} else if (part.type === 'image_url') {
			// Base64 data URLs are large — conservative fixed estimate.
			tokens += 85;
		}
	}

	// Tool calls: serialise to JSON and estimate
	if (message.tool_calls) {
		for (const tc of message.tool_calls) {
			tokens += estimateTokens(
				JSON.stringify(tc.function),
			);
		}
	}

	// Tool result (tool_call_id content)
	if (message.tool_call_id && message.content) {
		// Already counted above in content parts.
	}

	return Math.max(1, tokens);
}

export class SessionContextTracker {
	constructor(private readonly options: ContextTrackerOptions) {}

	/**
	 * Estimates the context usage for the upcoming request.
	 */
	estimate(messages: KimiMessage[]): ContextEstimate {
		const tokens = messages.reduce(
			(sum, m) => sum + estimateMessageTokens(m),
			0,
		);
		const limit = this.options.maxInputTokens;
		const ratio = limit > 0 ? Math.min(1, tokens / limit) : 0;

		let status: ContextEstimate['status'] = 'ok';
		if (tokens >= limit) {
			status = 'exceeded';
		} else if (ratio >= this.options.errorThreshold) {
			status = 'critical';
		} else if (ratio >= this.options.warningThreshold) {
			status = 'warning';
		}

		return { tokens, limit, ratio, status };
	}

	/**
	 * Checks the estimate and throws if the context is exceeded / critically full.
	 * Returns the estimate for informational use otherwise.
	 */
	check(messages: KimiMessage[]): ContextEstimate {
		const estimate = this.estimate(messages);

		if (estimate.status === 'exceeded' || estimate.status === 'critical') {
			const guidance =
				estimate.status === 'exceeded'
					? 'Start a new chat session, run "/compact", or remove files from the context.'
					: 'The context is almost full. Consider starting a new chat session or running "/compact" soon.';

			const e = new Error(
				`Kimi context ${estimate.status}: ~${estimate.tokens.toLocaleString('en-US')} / ${estimate.limit.toLocaleString('en-US')} tokens (${Math.round(estimate.ratio * 100)}%).\n\n${guidance}`,
			);
			(e as any).contextEstimate = estimate;
			throw e;
		}

		return estimate;
	}

	/**
	 * Formats a short status string for the status bar (e.g. "Ctx 45%").
	 */
	formatStatus(estimate: ContextEstimate): string {
		const percent = Math.round(estimate.ratio * 100);
		if (estimate.status === 'exceeded' || estimate.status === 'critical') {
			return `$(error) Ctx ${percent}%`;
		}
		if (estimate.status === 'warning') {
			return `$(warning) Ctx ${percent}%`;
		}
		return `Ctx ${percent}%`;
	}
}
