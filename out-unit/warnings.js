"use strict";
/**
 * Pure threshold-warning logic — no `vscode` dependency, plain-Node testable.
 *
 * Two heuristics guard output quality and cost:
 *
 * 1. Context-window fill. Long-context models degrade (lost-in-the-middle,
 *    higher latency/cost) well before the hard token limit. Kimi does not
 *    publish an official degradation threshold, so we default to the widely
 *    used 80% mark, configurable per user.
 *
 * 2. Cache-miss rate. Kimi's prefix cache makes repeated system/tool context
 *    cheap. A high miss rate usually means the conversation prefix keeps
 *    changing (e.g. tool churn), which inflates cost. We warn when it climbs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_WARN_TOKEN_STEP = exports.DEFAULT_CACHE_MISS_THRESHOLD = exports.CONTEXT_WARN_STEP = exports.DEFAULT_CONTEXT_WARN_THRESHOLD = void 0;
exports.contextFillRatio = contextFillRatio;
exports.contextFillWarning = contextFillWarning;
exports.cacheMissWarning = cacheMissWarning;
// ── Context fill ─────────────────────────────────────────────────────
/** Default context-fill warning threshold (80%). */
exports.DEFAULT_CONTEXT_WARN_THRESHOLD = 0.8;
/** Only re-warn when usage grows by at least this much past the last warning. */
exports.CONTEXT_WARN_STEP = 0.05;
/**
 * Compute the fraction of the context window a prompt occupies (0–1+).
 * `promptTokens` is the measured input tokens for the request;
 * `maxInputTokens` is the model's advertised input budget.
 */
function contextFillRatio(promptTokens, maxInputTokens) {
    if (maxInputTokens <= 0)
        return 0;
    return promptTokens / maxInputTokens;
}
/**
 * Decide whether to warn about context fill for this request.
 *
 * Returns a warning when `ratio >= threshold`, bucketed so we warn once per
 * 5%-step rather than on every single request. `null` means no warning.
 */
function contextFillWarning(promptTokens, maxInputTokens, threshold = exports.DEFAULT_CONTEXT_WARN_THRESHOLD, modelName) {
    const ratio = contextFillRatio(promptTokens, maxInputTokens);
    if (ratio < threshold)
        return null;
    const pct = Math.round(ratio * 100);
    const bucket = Math.floor((ratio - threshold) / exports.CONTEXT_WARN_STEP);
    const label = modelName ? ` for ${modelName}` : '';
    return {
        key: `context-fill:${bucket}`,
        severity: ratio >= 0.95 ? 'warning' : 'info',
        message: `Context is ${pct}% full${label} (${formatInt(promptTokens)} / ${formatInt(maxInputTokens)} tokens). ` +
            `Models degrade in long contexts — consider starting a fresh chat for better quality.`,
    };
}
// ── Cache-miss rate ──────────────────────────────────────────────────
/** Default cache-miss warning threshold (80% of prompt tokens uncached). */
exports.DEFAULT_CACHE_MISS_THRESHOLD = 0.8;
/** Only warn once per this many prompt tokens processed. */
exports.CACHE_WARN_TOKEN_STEP = 200_000;
/**
 * Decide whether to warn about a high cache-miss rate.
 *
 * Only meaningful once a model family that supports prefix caching has
 * processed a non-trivial number of prompt tokens; below that, a miss rate
 * is just cold-start noise. Returns `null` when no warning is warranted.
 */
function cacheMissWarning(totalPromptTokens, totalCachedTokens, threshold = exports.DEFAULT_CACHE_MISS_THRESHOLD) {
    // Ignore trivial volumes — cold-start always misses.
    if (totalPromptTokens < 10_000)
        return null;
    const missRatio = 1 - totalCachedTokens / totalPromptTokens;
    if (missRatio < threshold)
        return null;
    const pct = Math.round(missRatio * 100);
    const bucket = Math.floor(totalPromptTokens / exports.CACHE_WARN_TOKEN_STEP);
    return {
        key: `cache-miss:${bucket}`,
        severity: 'warning',
        message: `Cache miss rate is ${pct}% — most prompt tokens are being re-processed at full cost. ` +
            `Keep the conversation prefix stable (avoid editing earlier messages/tools) to reuse Kimi's prefix cache.`,
    };
}
// ── Helpers ──────────────────────────────────────────────────────────
function formatInt(n) {
    return n.toLocaleString('en-US');
}
//# sourceMappingURL=warnings.js.map