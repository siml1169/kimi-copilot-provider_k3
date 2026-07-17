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
export declare const PRICING: Record<string, PricingConfig>;
export declare const DEFAULT_PRICING: PricingConfig;
/** Calculate the estimated cost for a single request. */
export declare function estimateCost(promptTokens: number, completionTokens: number, cachedTokens: number, modelId: string): number;
/** Calculate cache hit rate percentage (0–100). */
export declare function cacheHitRate(cachedTokens: number, promptTokens: number): number;
export declare function formatTokens(n: number): string;
export declare function formatCost(usd: number): string;
export declare function formatUsageSummary(record: UsageRecord): string;
