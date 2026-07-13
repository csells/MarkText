import { describe, expect, it } from 'vitest';
import { ExcludedRanges } from '../excludedRanges';
import { scanCriticMarkup } from '../parser';

describe('criticMarkup excluded ranges', () => {
    it.each([
        {
            name: 'negative start',
            sourceLength: 8,
            range: { start: -1, end: 2 },
        },
        {
            name: 'end beyond the source',
            sourceLength: 8,
            range: { start: 2, end: 9 },
        },
        {
            name: 'reversed range',
            sourceLength: 8,
            range: { start: 6, end: 4 },
        },
        {
            name: 'fractional offset',
            sourceLength: 8,
            range: { start: 1.5, end: 4 },
        },
    ])('rejects $name at the validation boundary', ({ sourceLength, range }) => {
        expect(() => ExcludedRanges.from(sourceLength, [range]))
            .toThrow(RangeError);
    });

    it('drops empty ranges, sorts input, and merges every overlap', () => {
        const excluded = ExcludedRanges.from(16, [
            { start: 10, end: 14 },
            { start: 0, end: 0 },
            { start: 3, end: 8 },
            { start: 1, end: 5 },
            { start: 12, end: 15 },
            { start: 16, end: 16 },
            { start: 9, end: 9 },
        ]);

        expect(excluded.ranges).toEqual([
            { start: 1, end: 8 },
            { start: 10, end: 15 },
        ]);
    });

    it('only gives scanner consumers forward-moving skip targets', () => {
        const sourceLength = 24;
        const excluded = ExcludedRanges.from(sourceLength, [
            { start: 0, end: 0 },
            { start: 1, end: 8 },
            { start: 3, end: 5 },
            { start: 12, end: 12 },
            { start: 14, end: 20 },
            { start: 24, end: 24 },
        ]);
        let cursor = 0;
        let steps = 0;

        while (cursor < sourceLength) {
            const excludedEnd = excluded.endAt(cursor);
            const next = excludedEnd ?? cursor + 1;

            expect(next).toBeGreaterThan(cursor);
            cursor = next;
            steps++;
            expect(steps).toBeLessThanOrEqual(sourceLength);
        }

        expect(cursor).toBe(sourceLength);
    });

    it('makes the parser consume the validated type instead of raw ranges', () => {
        const source = '{++hidden++} and {++visible++}';
        const hiddenEnd = source.indexOf(' and ');
        const excluded = ExcludedRanges.from(source.length, [{
            start: 0,
            end: hiddenEnd,
        }]);

        expect(scanCriticMarkup(source, excluded).map(token => token.raw))
            .toEqual(['{++visible++}']);

        const unvalidatedCallMustNotCompile = () => {
            // @ts-expect-error — raw ranges must not cross the parser boundary.
            return scanCriticMarkup(source, [{ start: 0, end: hiddenEnd }]);
        };
        expect(unvalidatedCallMustNotCompile).toBeTypeOf('function');
    });

    it('rejects validated ranges bound to a different source revision', () => {
        const excluded = ExcludedRanges.from(4, [{ start: 0, end: 1 }]);

        expect(() => scanCriticMarkup('{++x++}', excluded))
            .toThrow(/source length/i);
    });
});
