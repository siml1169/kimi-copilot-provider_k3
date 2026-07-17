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
/** Default context-fill warning threshold (80%). */
export declare const DEFAULT_CONTEXT_WARN_THRESHOLD = 0.8;
/** Only re-warn when usage grows by at least this much past the last warning. */
export declare const CONTEXT_WARN_STEP = 0.05;
/**
 * Compute the fraction of the context window a prompt occupies (0–1+).
 * `promptTokens` is the measured input tokens for the request;
 * `maxInputTokens` is the model's advertised input budget.
 */
export declare function contextFillRatio(promptTokens: number, maxInputTokens: number): number;
/**
 * Decide whether to warn about context fill for this request.
 *
 * Returns a warning when `ratio >= threshold`, bucketed so we warn once per
 * 5%-step rather than on every single request. `null` means no warning.
 */
export declare function contextFillWarning(promptTokens: number, maxInputTokens: number, threshold?: number, modelName?: string): ThresholdWarning | null;
/** Default cache-miss warning threshold (80% of prompt tokens uncached). */
export declare const DEFAULT_CACHE_MISS_THRESHOLD = 0.8;
/** Only warn once per this many prompt tokens processed. */
export declare const CACHE_WARN_TOKEN_STEP = 200000;
/**
 * Decide whether to warn about a high cache-miss rate.
 *
 * Only meaningful once a model family that supports prefix caching has
 * processed a non-trivial number of prompt tokens; below that, a miss rate
 * is just cold-start noise. Returns `null` when no warning is warranted.
 */
export declare function cacheMissWarning(totalPromptTokens: number, totalCachedTokens: number, threshold?: number): ThresholdWarning | null;
