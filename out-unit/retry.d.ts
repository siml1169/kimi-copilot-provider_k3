/**
 * Pure retry/backoff helpers — no `vscode` dependency, plain-Node testable.
 */
/**
 * Exponential backoff with ±50% jitter to avoid thundering-herd on 429s.
 * Base delay is `1000 * 2^attempt` capped at `maxBaseMs`.
 */
export declare function jitteredBackoff(attempt: number, maxBaseMs?: number, random?: () => number): number;
/**
 * Decide whether a failed network request is worth retrying, based on its
 * error message. Mirrors the transient-error heuristics used by the provider.
 */
export declare function isRetryableNetworkError(message: string): boolean;
/** Should this HTTP status be retried? (429 rate-limit and 5xx server errors.) */
export declare function isRetryableStatus(status: number): boolean;
/** Promise-based sleep. */
export declare function sleep(ms: number): Promise<void>;
