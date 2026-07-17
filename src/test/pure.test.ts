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
import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import { estimateCost, cacheHitRate, formatTokens, formatCost, PRICING, DEFAULT_PRICING } from '../usageMath';
import { estimateTokens } from '../tokenize';
import { jitteredBackoff, isRetryableNetworkError, isRetryableStatus } from '../retry';
import { contextFillRatio, contextFillWarning, cacheMissWarning, DEFAULT_CONTEXT_WARN_THRESHOLD } from '../warnings';

suite('usageMath.estimateCost', () => {
    test('zero tokens cost zero', () => {
        assert.equal(estimateCost(0, 0, 0, 'kimi-k3'), 0);
    });

    test('K3 uncached input + output', () => {
        // 1M uncached input @ $3 + 1M output @ $15 = $18
        const cost = estimateCost(1_000_000, 1_000_000, 0, 'kimi-k3');
        assert.ok(Math.abs(cost - 18) < 1e-9, `expected ~18, got ${cost}`);
    });

    test('K3 cached tokens are charged at cached rate', () => {
        // 1M cached input @ $0.30 = $0.30, no output
        const cost = estimateCost(1_000_000, 0, 1_000_000, 'kimi-k3');
        assert.ok(Math.abs(cost - 0.3) < 1e-9, `expected ~0.3, got ${cost}`);
    });

    test('unknown model falls back to default pricing', () => {
        const cost = estimateCost(1_000_000, 0, 0, 'no-such-model');
        assert.ok(Math.abs(cost - DEFAULT_PRICING.inputPricePer1M) < 1e-9);
    });

    test('K2.7 pricing present', () => {
        assert.deepEqual(PRICING['kimi-k2.7-code'], {
            inputPricePer1M: 0.5,
            outputPricePer1M: 1.0,
            cachedInputPricePer1M: 0.25,
        });
    });
});

suite('usageMath.cacheHitRate', () => {
    test('zero prompt tokens â†’ 0', () => {
        assert.equal(cacheHitRate(0, 0), 0);
    });
    test('full hit â†’ 100', () => {
        assert.equal(cacheHitRate(500, 500), 100);
    });
    test('caps at 100 for pathological input', () => {
        assert.equal(cacheHitRate(2000, 1000), 100);
    });
});

suite('usageMath.formatTokens / formatCost', () => {
    test('formats thousands', () => assert.equal(formatTokens(1500), '1.5K'));
    test('formats millions', () => assert.equal(formatTokens(2_500_000), '2.50M'));
    test('formats small numbers raw', () => assert.equal(formatTokens(42), '42'));
    test('formatCost uses 4 decimals >= $0.01', () => assert.equal(formatCost(0.5), '$0.5000'));
    test('formatCost uses 6 decimals < $0.01', () => assert.equal(formatCost(0.001), '$0.001000'));
});

suite('tokenize.estimateTokens', () => {
    test('empty-ish string still returns >= 1', () => {
        assert.ok(estimateTokens('') >= 1);
        assert.ok(estimateTokens('   ') >= 1);
    });

    test('plain ASCII â‰ˆ length/4', () => {
        const text = 'a'.repeat(400);
        const est = estimateTokens(text);
        assert.ok(Math.abs(est - 100) <= 2, `expected ~100, got ${est}`);
    });

    test('CJK characters are weighted higher than Latin', () => {
        const latin = estimateTokens('aaaa'); // 4 latin chars
        const cjk = estimateTokens('ä½ å¥½ä¸–ç•Œ'); // 4 CJK chars
        assert.ok(cjk > latin, `CJK (${cjk}) should exceed Latin (${latin})`);
    });

    test('whitespace is not counted as content tokens', () => {
        const withSpaces = estimateTokens('a b c d');
        const noSpaces = estimateTokens('abcd');
        assert.equal(withSpaces, noSpaces);
    });
});

suite('retry.jitteredBackoff', () => {
    test('never exceeds base cap', () => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            const v = jitteredBackoff(attempt, 8000, () => 0.999);
            const base = Math.min(1000 * 2 ** attempt, 8000);
            assert.ok(v <= base, `attempt ${attempt}: ${v} > ${base}`);
        }
    });

    test('is at least 50% of base (jitter lower bound)', () => {
        for (let attempt = 1; attempt <= 8; attempt++) {
            const v = jitteredBackoff(attempt, 8000, () => 0);
            const base = Math.min(1000 * 2 ** attempt, 8000);
            assert.ok(v >= base * 0.5, `attempt ${attempt}: ${v} < ${base * 0.5}`);
        }
    });

    test('grows exponentially with attempt', () => {
        const a1 = jitteredBackoff(1, 8000, () => 0.5);
        const a3 = jitteredBackoff(3, 8000, () => 0.5);
        assert.ok(a3 > a1);
    });
});

suite('retry classifiers', () => {
    test('isRetryableNetworkError matches transient errors', () => {
        assert.ok(isRetryableNetworkError('request timed out'));
        assert.ok(isRetryableNetworkError('fetch failed'));
        assert.ok(isRetryableNetworkError('getaddrinfo ENOTFOUND x'));
        assert.ok(isRetryableNetworkError('connect ECONNREFUSED'));
        assert.ok(isRetryableNetworkError('read ECONNRESET'));
        assert.ok(!isRetryableNetworkError('HTTP 401 Unauthorized'));
    });

    test('isRetryableStatus for 429 and 5xx only', () => {
        assert.ok(isRetryableStatus(429));
        assert.ok(isRetryableStatus(500));
        assert.ok(isRetryableStatus(503));
        assert.ok(!isRetryableStatus(400));
        assert.ok(!isRetryableStatus(401));
        assert.ok(!isRetryableStatus(200));
    });
});

suite('warnings.contextFillRatio', () => {
    test('computes fraction of window used', () => {
        assert.equal(contextFillRatio(128_000, 256_000), 0.5);
        assert.equal(contextFillRatio(0, 256_000), 0);
    });
    test('zero max tokens → 0 (avoid divide-by-zero)', () => {
        assert.equal(contextFillRatio(1000, 0), 0);
    });
});

suite('warnings.contextFillWarning', () => {
    test('no warning below threshold', () => {
        assert.equal(contextFillWarning(100_000, 256_000, 0.8), null); // 39%
    });
    test('warns at/above default 80% threshold', () => {
        const w = contextFillWarning(210_000, 256_000, DEFAULT_CONTEXT_WARN_THRESHOLD, 'kimi-k3'); // ~82%
        assert.ok(w, 'expected a warning');
        assert.match(w!.message, /8[0-9]%/);
        assert.match(w!.message, /kimi-k3/);
        assert.match(w!.message, /fresh chat/);
    });
    test('escalates severity near the hard limit', () => {
        const w = contextFillWarning(250_000, 256_000, 0.8); // ~98%
        assert.equal(w!.severity, 'warning');
    });
    test('buckets warnings into 5% steps to avoid spam', () => {
        const w1 = contextFillWarning(210_000, 256_000, 0.8);
        const w2 = contextFillWarning(213_000, 256_000, 0.8);
        assert.equal(w1!.key, w2!.key);
    });
});

suite('warnings.cacheMissWarning', () => {
    test('ignores trivial volumes (cold start)', () => {
        assert.equal(cacheMissWarning(5_000, 0, 0.8), null);
    });
    test('no warning when cache hit rate is healthy', () => {
        // 90% cached → 10% miss, well below 0.8 threshold
        assert.equal(cacheMissWarning(100_000, 90_000, 0.8), null);
    });
    test('warns when miss rate is high', () => {
        const w = cacheMissWarning(100_000, 5_000, 0.8); // 95% miss
        assert.ok(w, 'expected a warning');
        assert.match(w!.message, /9[0-9]%/);
        assert.match(w!.message, /prefix cache/);
        assert.equal(w!.severity, 'warning');
    });
    test('buckets by prompt-token volume', () => {
        const w1 = cacheMissWarning(100_000, 0, 0.8);
        const w2 = cacheMissWarning(150_000, 0, 0.8);
        assert.equal(w1!.key, w2!.key);
    });
});
