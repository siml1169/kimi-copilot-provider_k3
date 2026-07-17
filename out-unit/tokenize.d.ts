/**
 * Pure token-estimation helpers — no `vscode` dependency, plain-Node testable.
 */
/**
 * Approximate token count. CJK characters are ~1–1.5 tokens each; Latin text
 * averages ~4 characters per token. This is intentionally conservative (aims
 * slightly high) so Copilot Chat truncates before the API hard limit rather
 * than after. Kimi does not expose a public tokenizer, so this is a heuristic.
 */
export declare function estimateTokens(text: string): number;
