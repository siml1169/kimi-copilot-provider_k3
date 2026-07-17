             import * as vscode from 'vscode';
import {
	estimateCost,
	cacheHitRate,
	formatTokens,
	formatCost,
	type UsageRecord,
} from './usageMath';

// ═══════════════════════════════════════════════════════════════════════
// Usage Tracking — tokens, cost, cache hits, and daily aggregation
//
// Pure pricing / cost / formatting math lives in `usageMath.ts` (no vscode
// dependency) so it can be unit-tested in plain Node. This module re-exports
// it and adds the vscode-dependent `UsageTracker` on top.
// ═══════════════════════════════════════════════════════════════════════

export {
	estimateCost,
	cacheHitRate,
	formatTokens,
	formatCost,
	formatUsageSummary,
	PRICING,
	DEFAULT_PRICING,
	type UsageRecord,
	type PricingConfig,
} from './usageMath';

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

// ── State Persistence ────────────────────────────────────────────────

const USAGE_STATE_KEY = 'kimi3Copilot.dailyUsage';

export class UsageTracker {
	private daily: DailyUsage;
	private statusBarItem: vscode.StatusBarItem | undefined;
	private balance: number | undefined;

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
		this.statusBarItem.command = 'kimi3-copilot.showUsageStats';
		this.updateStatusBar();
		this.statusBarItem.show();
	}

	private updateStatusBar(): void {
		if (!this.statusBarItem) return;
		const d = this.daily;
		const balanceStr = this.balance !== undefined
			? `$${this.balance.toFixed(2)}`
			: `~${formatCost(d.totalCost)}`;
		this.statusBarItem.text = `$(zap) Kimi: ${balanceStr}`;
		this.statusBarItem.tooltip = new vscode.MarkdownString(
			[
				`**Kimi Usage Today** (${d.date})`,
				``,
				`Balance: ${this.balance !== undefined ? `$${this.balance.toFixed(4)}` : 'unknown'}`,
				`Requests: ${d.totalRequests}`,
				`Tokens: ${formatTokens(d.totalPromptTokens)} in → ${formatTokens(d.totalCompletionTokens)} out`,
				`Cost: ${formatCost(d.totalCost)}`,
				`Cache hits: ${d.cacheHitRate.toFixed(1)}%`,
			].join('\n\n'),
		);
	}

	/** Set the current API balance (called after each successful request). */
	setBalance(availableBalance: number): void {
		this.balance = availableBalance;
		this.updateStatusBar();
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
