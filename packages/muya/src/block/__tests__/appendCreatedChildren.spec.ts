import { describe, expect, it } from 'vitest';
import { appendCreatedChildren } from '../appendCreatedChildren';

describe('appendCreatedChildren', () => {
    it('loads and appends 200k state-derived children in source order', () => {
        const count = 200_000;
        const states = Array.from({ length: count }, (_, index) => index);
        const appended: number[] = [];

        appendCreatedChildren(
            states,
            state => state + 1,
            child => appended.push(child),
        );

        expect(appended).toHaveLength(count);
        expect(appended[0]).toBe(1);
        expect(appended[99_999]).toBe(100_000);
        expect(appended.at(-1)).toBe(count);
    }, 60_000);

    it('creates the complete child set before publishing any append', () => {
        const appended: number[] = [];

        expect(() => appendCreatedChildren(
            [1, 2, 3],
            (state) => {
                if (state === 3)
                    throw new Error('invalid child state');
                return state;
            },
            child => appended.push(child),
        )).toThrow('invalid child state');
        expect(appended).toEqual([]);
    });
});
