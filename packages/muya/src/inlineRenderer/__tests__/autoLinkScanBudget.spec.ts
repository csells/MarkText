// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { generator, tokenizer } from '../lexer';
import { inlineRules } from '../rules';

describe('extended autolink scan budget', () => {
    it('keeps long ordinary words within a linear candidate-scan budget', () => {
        const source = `Editing ${'x'.repeat(4096)} next`;
        const scan = vi.spyOn(inlineRules.auto_link_extension, 'exec');
        try {
            expect(generator(tokenizer(source))).toBe(source);
            const inspectedUnits = scan.mock.calls.reduce((sum, [suffix]) => sum + suffix.length, 0);
            expect(inspectedUnits).toBeLessThanOrEqual(source.length * 4);
        }
        finally {
            scan.mockRestore();
        }
    });

    it.each(['', 'prefix ', '(', '*', '_', '~'])(
        'retains eligible autolinks after %j',
        (prefix) => {
            const source = `${prefix}https://example.com/path`;
            const tokens = tokenizer(source);
            expect(generator(tokens)).toBe(source);
            expect(tokens.some(token => token.type === 'auto_link_extension')).toBe(true);
        },
    );
});
