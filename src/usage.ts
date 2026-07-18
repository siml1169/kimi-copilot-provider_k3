             import * as vscode from 'vscode';
import {
	calculateCost,
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
	calculateCost,
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
	private balanceFetchedAt: number | undefined;
	private outputChannel: vscode.OutputChannel | undefined;
	private contextStats: { tokens: number; limit: number; ratio: number; status: string } | undefined;

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
		// Click → open output channel (matches DeepSeek V4 behaviour).
		this.statusBarItem.command = 'kimi3-copilot.showLog';
		this.updateStatusBar();
		this.statusBarItem.show();
	}

	/** Set the output channel so "show log" can reveal it. */
	setOutputChannel(channel: vscode.OutputChannel): void {
		this.outputChannel = channel;
	}

	/** 24-hour HH:MM:SS, padded. */
	private formatTime24(ts: number): string {
		const d = new Date(ts);
		const hh = d.getHours().toString().padStart(2, '0');
		const mm = d.getMinutes().toString().padStart(2, '0');
		const ss = d.getSeconds().toString().padStart(2, '0');
		return `${hh}:${mm}:${ss}`;
	}

	private updateStatusBar(): void {
		if (!this.statusBarItem) return;
		const d = this.daily;
		const balanceStr = this.balance !== undefined
			? `$${this.balance.toFixed(2)}`
			: `~${formatCost(d.totalCost)}`;

		// Show context percentage when available (matches upstream pattern).
		const ctxStr = this.contextStats
			? ` · ${Math.round(this.contextStats.ratio * 100)}% ctx`
			: '';

		this.statusBarItem.text = `K₃ ${balanceStr}${ctxStr}`;

		const md = new vscode.MarkdownString();
		// Narrow `isTrusted` to exactly the commands this tooltip renders.
		// Using `true` (full trust) would allow ANY command:URI to execute —
		// defense-in-depth (matches DeepSeek V4 pattern).
		md.isTrusted = {
			enabledCommands: [
				'kimi3-copilot.refreshBalance',
				'kimi3-copilot.showLog',
				'kimi3-copilot.showUsageStats',
			],
		};
		md.supportThemeIcons = true;

		md.appendMarkdown('### Kimi Copilot\n\n');

		// Context row — when available.
		if (this.contextStats) {
			const pct = Math.round(this.contextStats.ratio * 100);
			const icon = this.contextStats.status === 'critical' || this.contextStats.status === 'exceeded'
				? '$(error)' : this.contextStats.status === 'warning' ? '$(warning)' : '$(info)';
			md.appendMarkdown(
				`${icon} **Context** &nbsp; ~${this.contextStats.tokens.toLocaleString('en-US')} / ${this.contextStats.limit.toLocaleString('en-US')} (${pct}%)\n\n`,
			);
		}

		// Balance row — refresh link inline (matches DeepSeek V4 pattern).
		md.appendMarkdown(
			this.balance !== undefined
				? '**Balance** &nbsp; [$(refresh) refresh](command:kimi3-copilot.refreshBalance)\n\n'
				: '**Balance** &nbsp; [$(refresh) click to fetch](command:kimi3-copilot.refreshBalance)\n\n',
		);

		if (this.balance !== undefined) {
			const time = this.balanceFetchedAt
				? this.formatTime24(this.balanceFetchedAt)
				: '--:--:--';
			md.appendMarkdown(`$${this.balance.toFixed(4)} &nbsp;·&nbsp; ${time}\n\n`);
		} else {
			md.appendMarkdown(`_showing calculated cost from API tokens_\n\n`);
		}

		md.appendMarkdown(
			[
				`---`,
				``,
				`**Today** &nbsp;·&nbsp; ${d.totalRequests} request${d.totalRequests === 1 ? '' : 's'}`,
				``,
				`| | |`,
				`|---|---|`,
				`| Input | ${formatTokens(d.totalPromptTokens)} |`,
				`| Output | ${formatTokens(d.totalCompletionTokens)} |`,
				`| Cached | ${formatTokens(d.totalCachedTokens)} |`,
				`| Cache hits | ${d.cacheHitRate.toFixed(1)}% |`,
				`| **Cost** | **${formatCost(d.totalCost)}** |`,
				``,
				`---`,
				``,
				`[$(output) Show Log](command:kimi3-copilot.showLog) &nbsp;·&nbsp; [$(list-tree) Usage Stats](command:kimi3-copilot.showUsageStats)`,
			].join('\n'),
		);

		this.statusBarItem.tooltip = md;
	}

	/** Set the current API balance (called after each successful request). */
	setBalance(availableBalance: number): void {
		this.balance = availableBalance;
		this.balanceFetchedAt = Date.now();
		this.updateStatusBar();
	}

	/** Set the latest context estimate (shown in status bar). */
	setContextStats(estimate: { tokens: number; limit: number; ratio: number; status: string }): void {
		this.contextStats = estimate;
		this.updateStatusBar();
	}

	/** Record a completed API request. */
	record(usage: UsageRecord): void {
		const today = new Date().toISOString().slice(0, 10);
		if (this.daily.date !== today) {
			this.daily = this.freshDaily(today);
		}

		const cost = calculateCost(
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
