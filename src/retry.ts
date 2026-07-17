/**
 * Pure retry/backoff helpers — no `vscode` dependency, plain-Node testable.
 */

/**
 * Exponential backoff with ±50% jitter to avoid thundering-herd on 429s.
 * Base delay is `1000 * 2^attempt` capped at `maxBaseMs`.
 */
export function jitteredBackoff(attempt: number, maxBaseMs = 8000, random: () => number = Math.random): number {
    const base = Math.min(1000 * 2 ** attempt, maxBaseMs);
    return Math.round(base * (0.5 + random() * 0.5));
}

/**
 * Decide whether a failed network request is worth retrying, based on its
 * error message. Mirrors the transient-error heuristics used by the provider.
 */
export function isRetryableNetworkError(message: string): boolean {
    return (
        message.includes('timed out') ||
        message.includes('fetch failed') ||
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET')
    );
}

/** Should this HTTP status be retried? (429 rate-limit and 5xx server errors.) */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

/** Promise-based sleep. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
