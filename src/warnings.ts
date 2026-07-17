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

/** Result of evaluating one warning heuristic. */
export interface ThresholdWarning {
    /** Stable key used to de-duplicate notifications within a session. */
    key: string;
    /** Human-readable message (may contain Markdown). */
    message: string;
    /** Severity for logging; UI shows all as warnings. */
    severity: 'info' | 'warning';
}

// ── Context fill ─────────────────────────────────────────────────────

/** Default context-fill warning threshold (80%). */
export const DEFAULT_CONTEXT_WARN_THRESHOLD = 0.8;
/** Only re-warn when usage grows by at least this much past the last warning. */
export const CONTEXT_WARN_STEP = 0.05;

/**
 * Compute the fraction of the context window a prompt occupies (0–1+).
 * `promptTokens` is the measured input tokens for the request;
 * `maxInputTokens` is the model's advertised input budget.
 */
export function contextFillRatio(promptTokens: number, maxInputTokens: number): number {
    if (maxInputTokens <= 0) return 0;
    return promptTokens / maxInputTokens;
}

/**
 * Decide whether to warn about context fill for this request.
 *
 * Returns a warning when `ratio >= threshold`, bucketed so we warn once per
 * 5%-step rather than on every single request. `null` means no warning.
 */
export function contextFillWarning(
    promptTokens: number,
    maxInputTokens: number,
    threshold: number = DEFAULT_CONTEXT_WARN_THRESHOLD,
    modelName?: string,
): ThresholdWarning | null {
    const ratio = contextFillRatio(promptTokens, maxInputTokens);
    if (ratio < threshold) return null;

    const pct = Math.round(ratio * 100);
    const bucket = Math.floor((ratio - threshold) / CONTEXT_WARN_STEP);
    const label = modelName ? ` for ${modelName}` : '';

    return {
        key: `context-fill:${bucket}`,
        severity: ratio >= 0.95 ? 'warning' : 'info',
        message:
            `Context is ${pct}% full${label} (${formatInt(promptTokens)} / ${formatInt(maxInputTokens)} tokens). ` +
            `Models degrade in long contexts — consider starting a fresh chat for better quality.`,
    };
}

// ── Cache-miss rate ──────────────────────────────────────────────────

/** Default cache-miss warning threshold (80% of prompt tokens uncached). */
export const DEFAULT_CACHE_MISS_THRESHOLD = 0.8;
/** Only warn once per this many prompt tokens processed. */
export const CACHE_WARN_TOKEN_STEP = 200_000;

/**
 * Decide whether to warn about a high cache-miss rate.
 *
 * Only meaningful once a model family that supports prefix caching has
 * processed a non-trivial number of prompt tokens; below that, a miss rate
 * is just cold-start noise. Returns `null` when no warning is warranted.
 */
export function cacheMissWarning(
    totalPromptTokens: number,
    totalCachedTokens: number,
    threshold: number = DEFAULT_CACHE_MISS_THRESHOLD,
): ThresholdWarning | null {
    // Ignore trivial volumes — cold-start always misses.
    if (totalPromptTokens < 10_000) return null;

    const missRatio = 1 - totalCachedTokens / totalPromptTokens;
    if (missRatio < threshold) return null;

    const pct = Math.round(missRatio * 100);
    const bucket = Math.floor(totalPromptTokens / CACHE_WARN_TOKEN_STEP);

    return {
        key: `cache-miss:${bucket}`,
        severity: 'warning',
        message:
            `Cache miss rate is ${pct}% — most prompt tokens are being re-processed at full cost. ` +
            `Keep the conversation prefix stable (avoid editing earlier messages/tools) to reuse Kimi's prefix cache.`,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatInt(n: number): string {
    return n.toLocaleString('en-US');
}
