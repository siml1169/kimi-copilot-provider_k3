"use strict";
/**
 * Pure retry/backoff helpers — no `vscode` dependency, plain-Node testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jitteredBackoff = jitteredBackoff;
exports.isRetryableNetworkError = isRetryableNetworkError;
exports.isRetryableStatus = isRetryableStatus;
exports.sleep = sleep;
/**
 * Exponential backoff with ±50% jitter to avoid thundering-herd on 429s.
 * Base delay is `1000 * 2^attempt` capped at `maxBaseMs`.
 */
function jitteredBackoff(attempt, maxBaseMs = 8000, random = Math.random) {
    const base = Math.min(1000 * 2 ** attempt, maxBaseMs);
    return Math.round(base * (0.5 + random() * 0.5));
}
/**
 * Decide whether a failed network request is worth retrying, based on its
 * error message. Mirrors the transient-error heuristics used by the provider.
 */
function isRetryableNetworkError(message) {
    return (message.includes('timed out') ||
        message.includes('fetch failed') ||
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET'));
}
/** Should this HTTP status be retried? (429 rate-limit and 5xx server errors.) */
function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}
/** Promise-based sleep. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=retry.js.map