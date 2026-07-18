"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Plain-Node unit tests for pure logic that has NO `vscode` dependency.
 *
 * Run with:  npm run test:unit
 * (mocha over the compiled out/test-unit output -- no Extension Host needed.)
 *
 * These cover the highest-risk logic: pricing math, token estimation, and
 * retry backoff. vscode-dependent behaviour (message conversion, request
 * building) is covered separately by the Extension-Host suite.
 */
const assert = __importStar(require("node:assert/strict"));
const mocha_1 = require("mocha");
const usageMath_1 = require("../usageMath");
const tokenize_1 = require("../tokenize");
const retry_1 = require("../retry");
const warnings_1 = require("../warnings");
(0, mocha_1.suite)('usageMath.calculateCost', () => {
    (0, mocha_1.test)('zero tokens cost zero', () => {
        assert.equal((0, usageMath_1.calculateCost)(0, 0, 0, 'kimi-k3'), 0);
    });
    (0, mocha_1.test)('K3 uncached input + output', () => {
        // 1M uncached input @ $3 + 1M output @ $15 = $18
        const cost = (0, usageMath_1.calculateCost)(1_000_000, 1_000_000, 0, 'kimi-k3');
        assert.ok(Math.abs(cost - 18) < 1e-9, `expected ~18, got ${cost}`);
    });
    (0, mocha_1.test)('K3 cached tokens are charged at cached rate', () => {
        // 1M cached input @ $0.30 = $0.30, no output
        const cost = (0, usageMath_1.calculateCost)(1_000_000, 0, 1_000_000, 'kimi-k3');
        assert.ok(Math.abs(cost - 0.3) < 1e-9, `expected ~0.3, got ${cost}`);
    });
    (0, mocha_1.test)('unknown model falls back to default pricing', () => {
        const cost = (0, usageMath_1.calculateCost)(1_000_000, 0, 0, 'no-such-model');
        assert.ok(Math.abs(cost - usageMath_1.DEFAULT_PRICING.inputPricePer1M) < 1e-9);
    });
    (0, mocha_1.test)('K2.7 pricing present', () => {
        assert.deepEqual(usageMath_1.PRICING['kimi-k2.7-code'], {
            inputPricePer1M: 0.5,
            outputPricePer1M: 1.0,
            cachedInputPricePer1M: 0.25,
        });
    });
});
(0, mocha_1.suite)('usageMath.cacheHitRate', () => {
    (0, mocha_1.test)('zero prompt tokens â†’ 0', () => {
        assert.equal((0, usageMath_1.cacheHitRate)(0, 0), 0);
    });
    (0, mocha_1.test)('full hit â†’ 100', () => {
        assert.equal((0, usageMath_1.cacheHitRate)(500, 500), 100);
    });
    (0, mocha_1.test)('caps at 100 for pathological input', () => {
        assert.equal((0, usageMath_1.cacheHitRate)(2000, 1000), 100);
    });
});
(0, mocha_1.suite)('usageMath.formatTokens / formatCost', () => {
    (0, mocha_1.test)('formats thousands', () => assert.equal((0, usageMath_1.formatTokens)(1500), '1.5K'));
    (0, mocha_1.test)('formats millions', () => assert.equal((0, usageMath_1.formatTokens)(2_500_000), '2.50M'));
    (0, mocha_1.test)('formats small numbers raw', () => assert.equal((0, usageMath_1.formatTokens)(42), '42'));
    (0, mocha_1.test)('formatCost uses 4 decimals >= $0.01', () => assert.equal((0, usageMath_1.formatCost)(0.5), '$0.5000'));
    (0, mocha_1.test)('formatCost uses 6 decimals < $0.01', () => assert.equal((0, usageMath_1.formatCost)(0.001), '$0.001000'));
});
(0, mocha_1.suite)('tokenize.estimateTokens', () => {
    (0, mocha_1.test)('empty-ish string still returns >= 1', () => {
        assert.ok((0, tokenize_1.estimateTokens)('') >= 1);
        assert.ok((0, tokenize_1.estimateTokens)('   ') >= 1);
    });
    (0, mocha_1.test)('plain ASCII â‰ˆ length/4', () => {
        const text = 'a'.repeat(400);
        const est = (0, tokenize_1.estimateTokens)(text);
        assert.ok(Math.abs(est - 100) <= 2, `expected ~100, got ${est}`);
    });
    (0, mocha_1.test)('CJK characters are weighted higher than Latin', () => {
        const latin = (0, tokenize_1.estimateTokens)('aaaa'); // 4 latin chars
        const cjk = (0, tokenize_1.estimateTokens)('ä½ å¥½ä¸–ç•Œ'); // 4 CJK chars
        assert.ok(cjk > latin, `CJK (${cjk}) should exceed Latin (${latin})`);
    });
    (0, mocha_1.test)('whitespace is not counted as content tokens', () => {
        const withSpaces = (0, tokenize_1.estimateTokens)('a b c d');
        const noSpaces = (0, tokenize_1.estimateTokens)('abcd');
        assert.equal(withSpaces, noSpaces);
    });
});
(0, mocha_1.suite)('retry.jitteredBackoff', () => {
    (0, mocha_1.test)('never exceeds base cap', () => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            const v = (0, retry_1.jitteredBackoff)(attempt, 8000, () => 0.999);
            const base = Math.min(1000 * 2 ** attempt, 8000);
            assert.ok(v <= base, `attempt ${attempt}: ${v} > ${base}`);
        }
    });
    (0, mocha_1.test)('is at least 50% of base (jitter lower bound)', () => {
        for (let attempt = 1; attempt <= 8; attempt++) {
            const v = (0, retry_1.jitteredBackoff)(attempt, 8000, () => 0);
            const base = Math.min(1000 * 2 ** attempt, 8000);
            assert.ok(v >= base * 0.5, `attempt ${attempt}: ${v} < ${base * 0.5}`);
        }
    });
    (0, mocha_1.test)('grows exponentially with attempt', () => {
        const a1 = (0, retry_1.jitteredBackoff)(1, 8000, () => 0.5);
        const a3 = (0, retry_1.jitteredBackoff)(3, 8000, () => 0.5);
        assert.ok(a3 > a1);
    });
});
(0, mocha_1.suite)('retry classifiers', () => {
    (0, mocha_1.test)('isRetryableNetworkError matches transient errors', () => {
        assert.ok((0, retry_1.isRetryableNetworkError)('request timed out'));
        assert.ok((0, retry_1.isRetryableNetworkError)('fetch failed'));
        assert.ok((0, retry_1.isRetryableNetworkError)('getaddrinfo ENOTFOUND x'));
        assert.ok((0, retry_1.isRetryableNetworkError)('connect ECONNREFUSED'));
        assert.ok((0, retry_1.isRetryableNetworkError)('read ECONNRESET'));
        assert.ok(!(0, retry_1.isRetryableNetworkError)('HTTP 401 Unauthorized'));
    });
    (0, mocha_1.test)('isRetryableStatus for 429 and 5xx only', () => {
        assert.ok((0, retry_1.isRetryableStatus)(429));
        assert.ok((0, retry_1.isRetryableStatus)(500));
        assert.ok((0, retry_1.isRetryableStatus)(503));
        assert.ok(!(0, retry_1.isRetryableStatus)(400));
        assert.ok(!(0, retry_1.isRetryableStatus)(401));
        assert.ok(!(0, retry_1.isRetryableStatus)(200));
    });
});
(0, mocha_1.suite)('warnings.contextFillRatio', () => {
    (0, mocha_1.test)('computes fraction of window used', () => {
        assert.equal((0, warnings_1.contextFillRatio)(128_000, 256_000), 0.5);
        assert.equal((0, warnings_1.contextFillRatio)(0, 256_000), 0);
    });
    (0, mocha_1.test)('zero max tokens → 0 (avoid divide-by-zero)', () => {
        assert.equal((0, warnings_1.contextFillRatio)(1000, 0), 0);
    });
});
(0, mocha_1.suite)('warnings.contextFillWarning', () => {
    (0, mocha_1.test)('no warning below threshold', () => {
        assert.equal((0, warnings_1.contextFillWarning)(100_000, 256_000, 0.8), null); // 39%
    });
    (0, mocha_1.test)('warns at/above default 80% threshold', () => {
        const w = (0, warnings_1.contextFillWarning)(210_000, 256_000, warnings_1.DEFAULT_CONTEXT_WARN_THRESHOLD, 'kimi-k3'); // ~82%
        assert.ok(w, 'expected a warning');
        assert.match(w.message, /8[0-9]%/);
        assert.match(w.message, /kimi-k3/);
        assert.match(w.message, /fresh chat/);
    });
    (0, mocha_1.test)('escalates severity near the hard limit', () => {
        const w = (0, warnings_1.contextFillWarning)(250_000, 256_000, 0.8); // ~98%
        assert.equal(w.severity, 'warning');
    });
    (0, mocha_1.test)('buckets warnings into 5% steps to avoid spam', () => {
        const w1 = (0, warnings_1.contextFillWarning)(210_000, 256_000, 0.8);
        const w2 = (0, warnings_1.contextFillWarning)(213_000, 256_000, 0.8);
        assert.equal(w1.key, w2.key);
    });
});
(0, mocha_1.suite)('warnings.cacheMissWarning', () => {
    (0, mocha_1.test)('ignores trivial volumes (cold start)', () => {
        assert.equal((0, warnings_1.cacheMissWarning)(5_000, 0, 0.8), null);
    });
    (0, mocha_1.test)('no warning when cache hit rate is healthy', () => {
        // 90% cached → 10% miss, well below 0.8 threshold
        assert.equal((0, warnings_1.cacheMissWarning)(100_000, 90_000, 0.8), null);
    });
    (0, mocha_1.test)('warns when miss rate is high', () => {
        const w = (0, warnings_1.cacheMissWarning)(100_000, 5_000, 0.8); // 95% miss
        assert.ok(w, 'expected a warning');
        assert.match(w.message, /9[0-9]%/);
        assert.match(w.message, /prefix cache/);
        assert.equal(w.severity, 'warning');
    });
    (0, mocha_1.test)('buckets by prompt-token volume', () => {
        const w1 = (0, warnings_1.cacheMissWarning)(100_000, 0, 0.8);
        const w2 = (0, warnings_1.cacheMissWarning)(150_000, 0, 0.8);
        assert.equal(w1.key, w2.key);
    });
});
//# sourceMappingURL=pure.test.js.map