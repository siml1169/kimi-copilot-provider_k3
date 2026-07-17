"use strict";
/**
 * Pure pricing / cost / formatting math for Kimi usage.
 *
 * This module has NO dependency on the `vscode` API so it can be unit-tested
 * in plain Node.js (fast) without the Extension Host. `usage.ts` re-exports
 * these symbols and adds the `vscode`-dependent `UsageTracker` on top.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRICING = exports.PRICING = void 0;
exports.estimateCost = estimateCost;
exports.cacheHitRate = cacheHitRate;
exports.formatTokens = formatTokens;
exports.formatCost = formatCost;
exports.formatUsageSummary = formatUsageSummary;
// ── Pricing (platform.kimi.ai/docs/pricing) ─────────────────────────
// K2.x models use the Kimi platform pricing.
// K3 uses Moonshot platform pricing — official rates from platform.kimi.ai/docs/pricing/chat-k3.
exports.PRICING = {
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
exports.DEFAULT_PRICING = {
    inputPricePer1M: 0.5,
    outputPricePer1M: 1.0,
    cachedInputPricePer1M: 0.25,
};
// ── Cost Calculation ─────────────────────────────────────────────────
/** Calculate the estimated cost for a single request. */
function estimateCost(promptTokens, completionTokens, cachedTokens, modelId) {
    const pricing = exports.PRICING[modelId] ?? exports.DEFAULT_PRICING;
    const cachedPrice = pricing.cachedInputPricePer1M ?? pricing.inputPricePer1M;
    // Cached tokens cost less for input
    const uncachedPrompt = Math.max(0, promptTokens - cachedTokens);
    const inputCost = (uncachedPrompt / 1_000_000) * pricing.inputPricePer1M +
        (cachedTokens / 1_000_000) * cachedPrice;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPricePer1M;
    return inputCost + outputCost;
}
/** Calculate cache hit rate percentage (0–100). */
function cacheHitRate(cachedTokens, promptTokens) {
    if (promptTokens === 0)
        return 0;
    return Math.min(100, (cachedTokens / promptTokens) * 100);
}
// ── Formatting ───────────────────────────────────────────────────────
function formatTokens(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
function formatCost(usd) {
    if (usd >= 0.01)
        return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(6)}`;
}
function formatUsageSummary(record) {
    const cost = estimateCost(record.promptTokens, record.completionTokens, record.cachedTokens ?? 0, record.model);
    const cacheRate = cacheHitRate(record.cachedTokens ?? 0, record.promptTokens);
    const parts = [
        `🔢 ${formatTokens(record.promptTokens)}→${formatTokens(record.completionTokens)}`,
        `💰 ${formatCost(cost)}`,
    ];
    if (record.cachedTokens && record.cachedTokens > 0) {
        parts.push(`⚡ cache ${cacheRate.toFixed(0)}%`);
    }
    return parts.join('  ');
}
//# sourceMappingURL=usageMath.js.map