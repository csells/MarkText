import { describe, expect, it, vi } from 'vitest';
import { ExcludedRanges } from '../excludedRanges';
import {
    authenticateCriticMarkupScanResult,
    findNextCriticMarkupOffset,
    parseCriticMarkupAt,
    prepareCriticMarkupCandidateIdentity,
    prepareCriticMarkupNoCandidateScanResult,
    scanCriticMarkup,
    scanCriticMarkupCandidate,
} from '../parser';

describe('criticMarkup grammar', () => {
    it('requires a source-bound prefilter identity for candidate scans', () => {
        const source = '{++new++}';
        const excludedRanges = ExcludedRanges.empty(source.length);
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);

        const scanResult = scanCriticMarkupCandidate(
            source,
            excludedRanges,
            candidateIdentity,
        );

        expect(scanResult.roots).toEqual(
            scanCriticMarkup(source, excludedRanges),
        );
        expect(authenticateCriticMarkupScanResult(scanResult)).toMatchObject({
            source,
            excludedRanges,
            candidateIdentity,
            roots: scanResult.roots,
        });
        expect(Object.isFrozen(scanResult)).toBe(true);
        expect(Object.isFrozen(scanResult.roots)).toBe(true);
        expect(Object.isFrozen(scanResult.roots[0])).toBe(true);
        expect(() => scanCriticMarkupCandidate(
            source,
            excludedRanges,
            { hasCandidateOpener: true },
        )).toThrow(/candidate identity/);
    });

    it('authenticates a no-candidate result without running the grammar', () => {
        const source = 'ordinary Markdown';
        const excludedRanges = ExcludedRanges.from(source.length, [{
            start: 0,
            end: 8,
        }]);
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
        const result = prepareCriticMarkupNoCandidateScanResult(
            source,
            excludedRanges,
            candidateIdentity,
        );

        expect(authenticateCriticMarkupScanResult(result)).toMatchObject({
            source,
            excludedRanges,
            candidateIdentity,
            roots: [],
        });
        expect(() => authenticateCriticMarkupScanResult({ roots: [] }))
            .toThrow(/authenticated scanner result/i);
    });

    it('parses an addition at the requested source offset', () => {
        const source = 'Before {++new++} after';

        expect(parseCriticMarkupAt(source, 7)).toEqual({
            type: 'addition',
            raw: '{++new++}',
            content: 'new',
            range: {
                start: 7,
                end: 16,
            },
            contentRange: {
                start: 10,
                end: 13,
            },
            markers: {
                open: {
                    raw: '{++',
                    range: { start: 7, end: 10 },
                },
                close: {
                    raw: '++}',
                    range: { start: 13, end: 16 },
                },
            },
        });
    });

    it('leaves an unterminated addition as literal Markdown', () => {
        expect(parseCriticMarkupAt('{++unfinished', 0)).toBeNull();
    });

    it.each([
        {
            source: '{--old--}',
            expected: {
                type: 'deletion',
                raw: '{--old--}',
                content: 'old',
                range: { start: 0, end: 9 },
                contentRange: { start: 3, end: 6 },
                markers: {
                    open: { raw: '{--', range: { start: 0, end: 3 } },
                    close: { raw: '--}', range: { start: 6, end: 9 } },
                },
            },
        },
        {
            source: 'x {==focus==}',
            offset: 2,
            expected: {
                type: 'highlight',
                raw: '{==focus==}',
                content: 'focus',
                range: { start: 2, end: 13 },
                contentRange: { start: 5, end: 10 },
                markers: {
                    open: { raw: '{==', range: { start: 2, end: 5 } },
                    close: { raw: '==}', range: { start: 10, end: 13 } },
                },
            },
        },
        {
            source: '{>>note<<}',
            expected: {
                type: 'comment',
                raw: '{>>note<<}',
                content: 'note',
                range: { start: 0, end: 10 },
                contentRange: { start: 3, end: 7 },
                markers: {
                    open: { raw: '{>>', range: { start: 0, end: 3 } },
                    close: { raw: '<<}', range: { start: 7, end: 10 } },
                },
            },
        },
    ])('parses $expected.type', ({ source, offset = 0, expected }) => {
        expect(parseCriticMarkupAt(source, offset)).toEqual(expected);
    });

    it('parses a substitution as one semantic construct', () => {
        expect(parseCriticMarkupAt('{~~old~>new~~}', 0)).toEqual({
            type: 'substitution',
            raw: '{~~old~>new~~}',
            oldContent: 'old',
            newContent: 'new',
            range: { start: 0, end: 14 },
            oldRange: { start: 3, end: 6 },
            newRange: { start: 8, end: 11 },
            markers: {
                open: { raw: '{~~', range: { start: 0, end: 3 } },
                separator: { raw: '~>', range: { start: 6, end: 8 } },
                close: { raw: '~~}', range: { start: 11, end: 14 } },
            },
        });
    });

    it('does not reinterpret a substitution without its separator', () => {
        expect(parseCriticMarkupAt('{~~old and new~~}', 0)).toBeNull();
    });

    it.each([
        ['{++outer {++inner++} tail++}', 'addition'],
        ['{--outer {--inner--} tail--}', 'deletion'],
        ['{==outer {==inner==} tail==}', 'highlight'],
        ['{>>outer {>>inner<<} tail<<}', 'comment'],
        ['{~~A {~~B~>C~~}~>D~~}', 'substitution'],
    ])('balances nested CriticMarkup in %s', (source, type) => {
        const token = parseCriticMarkupAt(source, 0);

        expect(token).toMatchObject({
            type,
            raw: source,
            range: { start: 0, end: source.length },
        });
        expect(scanCriticMarkup(source)).toHaveLength(1);
    });

    it('ignores closing delimiters inside a Markdown code span', () => {
        const source = '{++before `literal ++}` after++}';
        const start = source.indexOf('`');
        const excluded = ExcludedRanges.from(source.length, [{
            start,
            end: source.indexOf('`', start + 1) + 1,
        }]);

        expect(parseCriticMarkupAt(source, 0, excluded)).toMatchObject({
            type: 'addition',
            raw: source,
            content: 'before `literal ++}` after',
        });
    });

    it('ignores substitution separators inside a Markdown code span', () => {
        const source = '{~~old `a~>b` rest~>new~~}';
        const start = source.indexOf('`');
        const excluded = ExcludedRanges.from(source.length, [{
            start,
            end: source.indexOf('`', start + 1) + 1,
        }]);

        expect(parseCriticMarkupAt(source, 0, excluded)).toMatchObject({
            type: 'substitution',
            oldContent: 'old `a~>b` rest',
            newContent: 'new',
        });
    });

    it('requires exactly one unescaped top-level substitution separator', () => {
        expect(parseCriticMarkupAt('{~~a~>b~>c~~}', 0)).toBeNull();
        expect(parseCriticMarkupAt('{~~a\\~>b~>c~~}', 0)).toMatchObject({
            type: 'substitution',
            oldContent: String.raw`a\~>b`,
            newContent: 'c',
        });
    });

    it('recovers a complete inner item from an unterminated outer item', () => {
        const source = '{++unfinished {--complete--}';

        expect(scanCriticMarkup(source)).toMatchObject([
            {
                type: 'deletion',
                raw: '{--complete--}',
                range: { start: 14, end: source.length },
            },
        ]);
    });

    it('promotes completed descendants through invalid and unclosed frames in source order', () => {
        const source = '{++outer {==kept {--nested--}==} {++inner {~~bad {>>recovered<<}~~}';

        expect(scanCriticMarkup(source)).toMatchObject([
            {
                type: 'highlight',
                range: { start: 9, end: 32 },
                nested: [{
                    type: 'deletion',
                    range: { start: 17, end: 29 },
                }],
            },
            {
                type: 'comment',
                range: { start: 49, end: 64 },
            },
        ]);
    });

    it('recovers deep malformed frames with bounded token placement and no sorting', () => {
        const depth = 128;
        const recoveredItemCount = 129;
        const complete = '{--x--}';
        const source = '{++'.repeat(depth) + complete.repeat(recoveredItemCount);
        const excludedRanges = ExcludedRanges.empty(source.length);
        const originalPush = Array.prototype.push;
        const originalSort = Array.prototype.sort;
        let tokenPlacements = 0;
        let maximumPlacements = 0;
        const placements = new WeakMap<object, number>();
        let recovered: ReturnType<typeof scanCriticMarkup>;
        let sortCalls = 0;

        // eslint-disable-next-line no-extend-native -- Intentional instrumentation verifies bounded token placement.
        Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
            for (const item of items) {
                if (
                    item !== null
                    && typeof item === 'object'
                    && 'type' in item
                    && 'raw' in item
                    && 'range' in item
                ) {
                    const count = (placements.get(item) ?? 0) + 1;
                    placements.set(item, count);
                    maximumPlacements = Math.max(maximumPlacements, count);
                    tokenPlacements++;
                }
            }
            return Reflect.apply(originalPush, this, items) as number;
        };
        // eslint-disable-next-line no-extend-native -- Intentional instrumentation proves recovery never sorts.
        Array.prototype.sort = function (
            this: unknown[],
            compare?: (left: unknown, right: unknown) => number,
        ) {
            sortCalls++;
            return Reflect.apply(originalSort, this, [compare]) as unknown[];
        };
        try {
            recovered = scanCriticMarkup(source, excludedRanges);
        }
        finally {
            // eslint-disable-next-line no-extend-native -- Restore the instrumented native exactly.
            Array.prototype.push = originalPush;
            // eslint-disable-next-line no-extend-native -- Restore the instrumented native exactly.
            Array.prototype.sort = originalSort;
        }

        expect(recovered).toHaveLength(recoveredItemCount);
        expect(recovered[0].range).toEqual({
            start: depth * 3,
            end: depth * 3 + complete.length,
        });
        expect(recovered.at(-1)?.range.end).toBe(source.length);
        expect(tokenPlacements).toBeLessThanOrEqual(recoveredItemCount * 4);
        expect(maximumPlacements).toBeLessThanOrEqual(4);
        expect(sortCalls).toBe(0);
    });

    it('does not rescan the remaining suffix for every malformed opener', () => {
        const source = '{++x '.repeat(16_000);
        const indexOf = vi.spyOn(String.prototype, 'indexOf');
        let calls: number;

        try {
            scanCriticMarkup(source);
            calls = indexOf.mock.calls.length;
        }
        finally {
            indexOf.mockRestore();
        }

        // The grammar makes one linear pass and never rescans a malformed
        // suffix for each opener.
        expect(calls).toBeLessThan(5);
    });

    it('recovers a wider malformed frame without variadic argument expansion', () => {
        const recoveredItemCount = 200_000;
        const complete = '{--x--}';
        const source = `{++${complete.repeat(recoveredItemCount)}`;

        const recovered = scanCriticMarkup(source);

        expect(recovered).toHaveLength(recoveredItemCount);
        expect(recovered[0]).toMatchObject({
            type: 'deletion',
            range: { start: 3, end: 3 + complete.length },
        });
        expect(recovered.at(-1)).toMatchObject({
            type: 'deletion',
            range: {
                start: 3 + complete.length * (recoveredItemCount - 1),
                end: source.length,
            },
        });
    }, 60_000);

    it('recovers a wider closed invalid substitution without variadic expansion', () => {
        const recoveredItemCount = 200_000;
        const complete = '{--x--}';
        const source = `{~~${complete.repeat(recoveredItemCount)}~~}`;

        const recovered = scanCriticMarkup(source);

        expect(recovered).toHaveLength(recoveredItemCount);
        expect(recovered[0].range.start).toBe(3);
        expect(recovered.at(-1)?.range.end).toBe(source.length - 3);
    }, 60_000);

    it('allows empty payloads so partially-authored review items stay semantic', () => {
        expect(parseCriticMarkupAt('{++++}', 0)).toMatchObject({
            type: 'addition',
            content: '',
            contentRange: { start: 3, end: 3 },
        });
        expect(parseCriticMarkupAt('{~~old~>~~}', 0)).toMatchObject({
            type: 'substitution',
            oldContent: 'old',
            newContent: '',
            newRange: { start: 8, end: 8 },
        });
    });

    it('does not recognize a CommonMark-escaped opener', () => {
        const source = String.raw`\{++literal++}`;

        expect(parseCriticMarkupAt(source, 1)).toBeNull();
    });

    it('finds the next complete, unescaped construct for parser start hooks', () => {
        const source = String.raw`\{++literal++} then {--real--}`;

        expect(findNextCriticMarkupOffset(source))
            .toBe(source.indexOf('{--real--}'));
        expect(findNextCriticMarkupOffset('plain Markdown')).toBe(-1);
    });

    it('rejects offsets outside the source coordinate space', () => {
        expect(() => parseCriticMarkupAt('text', -1)).toThrow(RangeError);
        expect(() => parseCriticMarkupAt('text', 5)).toThrow(RangeError);
        expect(() => findNextCriticMarkupOffset('text', 5)).toThrow(RangeError);
    });
});
