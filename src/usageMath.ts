/**
 * Pure pricing / cost / formatting math for Kimi usage.
 *
 * This module has NO dependency on the `vscode` API so it can be unit-tested
 * in plain Node.js (fast) without the Extension Host. `usage.ts` re-exports
 * these symbols and adds the `vscode`-dependent `UsageTracker` on top.
 */

/** Token usage from a single API response. */
export interface UsageRecord {
	promptTokens: number;
	completionTokens: number;
	cachedTokens?: number;
	totalTokens: number;
	model: string;
	timestamp: number;
}

/** Pricing configuration per model (USD per 1M tokens). */
export interface PricingConfig {
	inputPricePer1M: number;
	outputPricePer1M: number;
	cachedInputPricePer1M?: number;
}

// ── Pricing (platform.kimi.ai/docs/pricing) ─────────────────────────
// K2.x models use the Kimi platform pricing.
// K3 uses Moonshot platform pricing — official rates from platform.kimi.ai/docs/pricing/chat-k3.

export const PRICING: Record<string, PricingConfig> = {
	'kimi-k2.7-code': {
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.0,
		cachedInputPricePer1M: 0.25,
	},
	'kimi-k2.7-code-highspeed': {
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.0,
		cachedInputPricePer1M: 0.25,
	},
	'kimi-k2.6': {
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.0,
		cachedInputPricePer1M: 0.25,
	},
	'kimi-k2.5': {
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.0,
		cachedInputPricePer1M: 0.25,
	},
	// Kimi K3 official pricing (platform.kimi.ai/docs/pricing/chat-k3):
	//   Input (cache hit):  $0.30 / 1M tokens
	//   Input (cache miss): $3.00 / 1M tokens
	//   Output:             $15.00 / 1M tokens
	'kimi-k3': {
		inputPricePer1M: 3.00,
		outputPricePer1M: 15.00,
		cachedInputPricePer1M: 0.30,
	},
};

export const DEFAULT_PRICING: PricingConfig = {
	inputPricePer1M: 0.5,
	outputPricePer1M: 1.0,
	cachedInputPricePer1M: 0.25,
};

// ── Cost Calculation ─────────────────────────────────────────────────

/** Calculate the estimated cost for a single request. */
export function estimateCost(
	promptTokens: number,
	completionTokens: number,
	cachedTokens: number,
	modelId: string,
): number {
	const pricing = PRICING[modelId] ?? DEFAULT_PRICING;
	const cachedPrice = pricing.cachedInputPricePer1M ?? pricing.inputPricePer1M;

	// Cached tokens cost less for input
	const uncachedPrompt = Math.max(0, promptTokens - cachedTokens);
	const inputCost =
		(uncachedPrompt / 1_000_000) * pricing.inputPricePer1M +
		(cachedTokens / 1_000_000) * cachedPrice;
	const outputCost = (completionTokens / 1_000_000) * pricing.outputPricePer1M;

	return inputCost + outputCost;
}

/** Calculate cache hit rate percentage (0–100). */
export function cacheHitRate(cachedTokens: number, promptTokens: number): number {
	if (promptTokens === 0) return 0;
	return Math.min(100, (cachedTokens / promptTokens) * 100);
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function formatCost(usd: number): string {
	if (usd >= 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(6)}`;
}

export function formatUsageSummary(record: UsageRecord): string {
	const cost = estimateCost(
		record.promptTokens,
		record.completionTokens,
		record.cachedTokens ?? 0,
		record.model,
	);
	const cacheRate = cacheHitRate(record.cachedTokens ?? 0, record.promptTokens);
	const parts: string[] = [
		`🔢 ${formatTokens(record.promptTokens)}→${formatTokens(record.completionTokens)}`,
		`💰 ${formatCost(cost)}`,
	];
	if (record.cachedTokens && record.cachedTokens > 0) {
		parts.push(`⚡ cache ${cacheRate.toFixed(0)}%`);
	}
	return parts.join('  ');
}
