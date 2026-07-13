import { describe, expect, it } from 'vitest';
import { replaceArrayRange } from '../arrayMutation';

describe('replaceArrayRange', () => {
    it('inserts a 200k pasted range without variadic arguments', () => {
        const pasted = Array.from({ length: 200_000 }, (_, index) => index);
        const target: Array<number | string> = ['before', 'after'];

        replaceArrayRange(target, 1, 0, pasted);

        expect(target).toHaveLength(pasted.length + 2);
        expect(target.slice(0, 3)).toEqual(['before', 0, 1]);
        expect(target.at(-2)).toBe(199_999);
        expect(target.at(-1)).toBe('after');
    }, 60_000);

    it('replaces one format wrapper with 200k child tokens in order', () => {
        const children = Array.from({ length: 200_000 }, (_, index) => index);
        const target: Array<number | string> = ['before', 'wrapper', 'after'];

        replaceArrayRange(target, 1, 1, children);

        expect(target).toHaveLength(children.length + 2);
        expect(target[0]).toBe('before');
        expect(target[1]).toBe(0);
        expect(target.at(-2)).toBe(199_999);
        expect(target.at(-1)).toBe('after');
    }, 60_000);

    it('does not publish a partial array when replacement materialization fails', () => {
        const target = ['before', 'wrapper', 'after'];
        const replacements = new Proxy(['one', 'two'], {
            get(source, property, receiver) {
                if (property === '1')
                    throw new Error('replacement read failed');
                return Reflect.get(source, property, receiver);
            },
        });

        expect(() => replaceArrayRange(target, 1, 1, replacements))
            .toThrow('replacement read failed');
        expect(target).toEqual(['before', 'wrapper', 'after']);
    });
});
