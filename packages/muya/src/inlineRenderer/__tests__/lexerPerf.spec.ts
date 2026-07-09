import { describe, expect, it } from 'vitest';
import { tokenizer } from '../lexer';

// The inline tokenizer must scan in linear time. A long unbroken run of
// word characters — a pasted log line, minified JSON, a base64 blob — drove
// it O(n²): the GFM `auto_link_extension` rule scans a URL/email body forward
// from the cursor, so on a run with no whitespace it read O(remaining) at
// every position. This pins the scaling: 8× the input must cost well under
// the 64× an O(n²) scan would.

function buildLongToken(length: number): string {
    // A long run of email-local-part characters (`[A-Za-z0-9.+-]`) with NO
    // whitespace and NO autolink-boundary char (`* _ ~ (`). The GFM email
    // autolink body `[\w.+-]+@…` matches this whole run while scanning for an
    // `@` that never comes, so the unguarded rule read O(remaining) at every
    // offset → O(n²). `_` is deliberately excluded: it is BOTH an email char
    // and a boundary char, so it would let the guard pass and mask the fix.
    const word = 'abcdefghijABCDEFGHIJ0123456789.+-';
    let out = '';
    while (out.length < length)
        out += word;
    return out.slice(0, length);
}

function medianTokenizeMs(text: string, iterations = 5): number {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        tokenizer(text, {});
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
}

describe('inline tokenizer scales linearly with input length', () => {
    it('8× a long unbroken word-char run costs far less than the 64× an O(n²) scan would', () => {
        const small = buildLongToken(4000);
        const large = buildLongToken(32000); // 8× the small input

        // Warm up so JIT state does not skew the first timed run.
        tokenizer(small, {});
        tokenizer(large, {});

        const smallMs = medianTokenizeMs(small);
        const largeMs = medianTokenizeMs(large);

        const ratio = largeMs / smallMs;
        // Linear ⇒ ~8×; quadratic ⇒ ~64×. A ceiling of 24× fails the O(n²)
        // scan with wide margin while tolerating timer noise on slow CI.
        expect(
            ratio,
            `tokenizing 8× the long word-char run took ${ratio.toFixed(1)}× the time `
            + `(small=${smallMs.toFixed(2)}ms, large=${largeMs.toFixed(2)}ms) — expected sub-quadratic`,
        ).toBeLessThan(24);
    });

    it('produces the whole plain paragraph as a single text token regardless of length', () => {
        // Correctness guard for the pure-text path (already linear).
        const word = 'the quick brown fox jumps over a lazy dog ';
        let text = '';
        while (text.length < 5000)
            text += word;
        text = text.slice(0, 5000);
        const tokens = tokenizer(text, { hasBeginRules: false });
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('text');
        expect(tokens[0].raw).toBe(text);
        expect(tokens[0].range).toEqual({ start: 0, end: 5000 });
    });
});
