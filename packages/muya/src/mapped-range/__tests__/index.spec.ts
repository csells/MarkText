import type { TMarkdownStatePath } from '../../state/markdownSourceMap';
import { describe, expect, it } from 'vitest';
import { markdownStatePath } from '../../state/markdownSourceMap';
import {
    HalfOpenIntervalIndex,
    lowerBound,
    MappedPathIndex,
    mappedTextPath,
    upperBound,
} from '../index';

describe('mapped-range indexes', () => {
    it('defines duplicate-edge lower and upper bounds once', () => {
        const values = [1, 3, 3, 3, 7];

        expect(lowerBound(values, 0, value => value)).toBe(0);
        expect(lowerBound(values, 3, value => value)).toBe(1);
        expect(upperBound(values, 3, value => value)).toBe(4);
        expect(lowerBound(values, 8, value => value)).toBe(values.length);
        expect(upperBound(values, 8, value => value)).toBe(values.length);
    });

    it('indexes half-open intervals at shared and empty boundaries', () => {
        const index = new HalfOpenIntervalIndex([
            { start: 0, end: 2, value: 'left' },
            { start: 2, end: 2, value: 'empty' },
            { start: 2, end: 5, value: 'right' },
            { start: 8, end: 10, value: 'tail' },
        ]);

        expect(index.containing(1)).toEqual(['left']);
        expect(index.containing(2)).toEqual(['right']);
        expect(index.containing(5)).toEqual([]);
        expect(index.overlapping(2, 8)).toEqual(['right']);
        expect(index.overlapping(5, 8)).toEqual([]);
        expect(index.startingAt(2)).toEqual(['empty', 'right']);
    });

    it('uses structural path identity without string serialization', () => {
        const index = new MappedPathIndex<TMarkdownStatePath, string[]>();
        const first = markdownStatePath([0, 'children', 1, 'text']);
        const equalButSeparate = markdownStatePath([0, 'children', 1, 'text']);
        const numeric = markdownStatePath([1]);
        const textual = markdownStatePath(['1']);

        index.set(first, ['leaf']);
        index.set(numeric, ['numeric']);
        index.set(textual, ['textual']);

        expect(index.get(equalButSeparate)).toEqual(['leaf']);
        expect(index.get(numeric)).toEqual(['numeric']);
        expect(index.get(textual)).toEqual(['textual']);
        expect(index.has(markdownStatePath([0, 'children', 2, 'text'])))
            .toBe(false);
        expect([...index.paths()]).toEqual([first, numeric, textual]);
    });

    it('snapshots and freezes caller-owned path identity', () => {
        const input: Array<string | number> = [0, 'children', 1, 'text'];
        const branded = mappedTextPath<'test-path'>(input);
        const index = new MappedPathIndex<readonly (string | number)[], string>();
        const mutableKey: Array<string | number> = [0, 'text'];

        index.set(mutableKey, 'leaf');
        input.push('caller-mutation');
        mutableKey[0] = 99;
        const [stored] = [...index.paths()];
        const mutationMustNotCompile = () => {
            // @ts-expect-error — branded paths are immutable values.
            branded.push('compile-time-corruption');
        };

        expect(branded).toEqual([0, 'children', 1, 'text']);
        expect(Object.isFrozen(branded)).toBe(true);
        expect(index.get([0, 'text'])).toBe('leaf');
        expect(stored).toEqual([0, 'text']);
        expect(Object.isFrozen(stored)).toBe(true);
        expect(() => (stored as Array<string | number>).push('corrupt'))
            .toThrow(TypeError);
        expect(mutationMustNotCompile).toBeTypeOf('function');
    });

    it('snapshots interval bounds and rejects invalid half-open records', () => {
        const callerOwned = { start: 2, end: 5, value: 'stable' };
        const index = new HalfOpenIntervalIndex([callerOwned]);

        callerOwned.start = 100;
        callerOwned.end = 101;

        expect(index.containing(3)).toEqual(['stable']);
        expect(index.containing(100)).toEqual([]);
        expect(() => new HalfOpenIntervalIndex([
            { start: 3, end: 2, value: 'reversed' },
        ])).toThrow('forward half-open ranges');
        expect(() => new HalfOpenIntervalIndex([
            { start: -1, end: 2, value: 'negative' },
        ])).toThrow('non-negative integer');
        expect(() => new HalfOpenIntervalIndex([
            { start: 0.5, end: 2, value: 'fractional' },
        ])).toThrow('non-negative integer');
    });
});
