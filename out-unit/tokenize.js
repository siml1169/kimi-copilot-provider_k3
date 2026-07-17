"use strict";
/**
 * Pure token-estimation helpers — no `vscode` dependency, plain-Node testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
/**
 * Approximate token count. CJK characters are ~1–1.5 tokens each; Latin text
 * averages ~4 characters per token. This is intentionally conservative (aims
 * slightly high) so Copilot Chat truncates before the API hard limit rather
 * than after. Kimi does not expose a public tokenizer, so this is a heuristic.
 */
function estimateTokens(text) {
    let cjk = 0;
    let other = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        // CJK Unified Ideographs, Hiragana, Katakana, Hangul, CJK symbols.
        if ((cp >= 0x4e00 && cp <= 0x9fff) ||
            (cp >= 0x3400 && cp <= 0x4dbf) ||
            (cp >= 0x3040 && cp <= 0x30ff) ||
            (cp >= 0xac00 && cp <= 0xd7af) ||
            (cp >= 0x3000 && cp <= 0x303f) ||
            (cp >= 0xff00 && cp <= 0xffef)) {
            cjk++;
        }
        else if (!/\s/.test(ch)) {
            other++;
        }
    }
    return Math.max(1, Math.ceil(cjk * 1.5 + other / 4));
}
//# sourceMappingURL=tokenize.js.map