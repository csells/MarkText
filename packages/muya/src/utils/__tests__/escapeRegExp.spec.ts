import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../index';

describe('escapeRegExp', () => {
    it('escapes every regexp metacharacter', () => {
        expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('leaves ordinary characters untouched', () => {
        expect(escapeRegExp('cmt_1')).toBe('cmt_1');
    });

    it('produces a pattern that matches the original string literally', () => {
        const literal = 'a.b(c)*d';
        expect(new RegExp(`^${escapeRegExp(literal)}$`).test(literal)).toBe(true);
        expect(new RegExp(`^${escapeRegExp(literal)}$`).test('aXb(c)*d')).toBe(false);
    });
});
