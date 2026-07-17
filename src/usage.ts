import * as vscode from 'vscode';

// ═══════════════════════════════════════════════════════════════════════
// Usage Tracking — tokens, cost, cache hits, and daily aggregation
// ═══════════════════════════════════════════════════════════════════════

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

/** Daily aggregated usage statistics. */
export interface DailyUsage {
	date: string; // ISO date (YYYY-MM-DD)
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalCachedTokens: number;
	totalRequests: number;
	totalCost: number;
	cacheHitRate: number;
	lastUpdated: number;
}

// ── Pricing (platform.kimi.ai/docs/pricing) ─────────────────────────

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
	'kimi-k3': {
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.0,
		cachedInputPricePer1M: 0.25,
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

// ── State Persistence ────────────────────────────────────────────────

const USAGE_STATE_KEY = 'kimiCopilot.dailyUsage';

export class UsageTracker {
	private daily: DailyUsage;
	private statusBarItem: vscode.StatusBarItem | undefined;

	constructor(private readonly state: vscode.Memento) {
		const today = new Date().toISOString().slice(0, 10);
		const stored = state.get<DailyUsage>(USAGE_STATE_KEY);

		if (stored && stored.date === today) {
			this.daily = stored;
		} else {
			this.daily = this.freshDaily(today);
		}

		this.createStatusBar();
	}

	private freshDaily(date: string): DailyUsage {
		return {
			date,
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalCachedTokens: 0,
			totalRequests: 0,
			totalCost: 0,
			cacheHitRate: 0,
			lastUpdated: Date.now(),
		};
	}

	private createStatusBar(): void {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100,
		);
		this.statusBarItem.command = 'kimi-copilot.showUsageStats';
		this.updateStatusBar();
		this.statusBarItem.show();
	}

	private updateStatusBar(): void {
		if (!this.statusBarItem) return;
		const d = this.daily;
		this.statusBarItem.text = `$(zap) Kimi: ${formatCost(d.totalCost)}`;
		this.statusBarItem.tooltip = new vscode.MarkdownString(
			[
				`**Kimi Usage Today** (${d.date})`,
				``,
				`Requests: ${d.totalRequests}`,
				`Tokens: ${formatTokens(d.totalPromptTokens)} in → ${formatTokens(d.totalCompletionTokens)} out`,
				`Cost: ${formatCost(d.totalCost)}`,
				`Cache hits: ${d.cacheHitRate.toFixed(1)}%`,
			].join('\n\n'),
		);
	}

	/** Record a completed API request. */
	record(usage: UsageRecord): void {
		const today = new Date().toISOString().slice(0, 10);
		if (this.daily.date !== today) {
			this.daily = this.freshDaily(today);
		}

		const cost = estimateCost(
			usage.promptTokens,
			usage.completionTokens,
			usage.cachedTokens ?? 0,
			usage.model,
		);

		this.daily.totalPromptTokens += usage.promptTokens;
		this.daily.totalCompletionTokens += usage.completionTokens;
		this.daily.totalCachedTokens += usage.cachedTokens ?? 0;
		this.daily.totalRequests += 1;
		this.daily.totalCost += cost;
		this.daily.cacheHitRate = cacheHitRate(
			this.daily.totalCachedTokens,
			this.daily.totalPromptTokens,
		);
		this.daily.lastUpdated = Date.now();

		this.state.update(USAGE_STATE_KEY, this.daily);
		this.updateStatusBar();
	}

	/** Get today's aggregated stats. */
	getStats(): DailyUsage {
		return { ...this.daily };
	}

	/** Reset daily counters. */
	reset(): void {
		const today = new Date().toISOString().slice(0, 10);
		this.daily = this.freshDaily(today);
		this.state.update(USAGE_STATE_KEY, this.daily);
		this.updateStatusBar();
	}

	dispose(): void {
		this.statusBarItem?.dispose();
	}
}
