import { describe, expect, it } from 'vitest';
import { statesEqual } from '../stateEquality';

describe('statesEqual', () => {
    it('ignores plain-object property order but keeps array order strict', () => {
        expect(statesEqual(
            [{ name: 'paragraph', sourceTrivia: { a: 1, b: 2 } }],
            [{ sourceTrivia: { b: 2, a: 1 }, name: 'paragraph' }],
        )).toBe(true);
        expect(statesEqual([1, 2], [2, 1])).toBe(false);
    });

    it('distinguishes missing, undefined, sparse, and changed values', () => {
        expect(statesEqual({ value: undefined }, {})).toBe(false);
        expect(statesEqual([undefined], new Array(1))).toBe(false);
        expect(statesEqual({ nested: { value: 1 } }, { nested: { value: 2 } }))
            .toBe(false);
    });
});
