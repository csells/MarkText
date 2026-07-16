// @vitest-environment happy-dom

import { MarkedSourceView } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { getHighlightHtml } from '../getHighlightHtml';

describe('criticMarkup parser provenance allocation contract', () => {
    it('does not repeatedly materialize decreasing root suffixes for a late opener', () => {
        const blockCount = 512;
        const source = `${Array.from(
            { length: blockCount },
            (_, index) => `ordinary paragraph ${index}\n\n`,
        ).join('')}{++late candidate++}\n`;
        const sliceSpy = vi.spyOn(MarkedSourceView.prototype, 'slice');
        let html = '';
        let decreasingSuffixLengths: number[] = [];

        try {
            html = getHighlightHtml(source, {
                criticMarkup: true,
                criticMarkupProjection: 'marked',
                footnote: false,
                frontMatter: false,
                isGitlabCompatibilityEnabled: false,
                math: false,
                superSubScript: false,
            });
            decreasingSuffixLengths = sliceSpy.mock.calls.flatMap((args, index) => {
                const context = sliceSpy.mock.contexts[index] as
                    | { readonly text?: string }
                    | undefined;
                if (!context || context.text !== source)
                    return [];

                const start = Number(args[0]);
                const end = Number(args[1] ?? context.text.length);
                return start > 0 && end === context.text.length
                    ? [end - start]
                    : [];
            });
        }
        finally {
            sliceSpy.mockRestore();
        }

        expect(html).toContain('critic-addition');
        expect(
            decreasingSuffixLengths.length,
            'Parser provenance must use one indexed invocation cursor, not one root suffix view per block.',
        ).toBeLessThanOrEqual(8);
        expect(
            decreasingSuffixLengths.reduce((total, length) => total + length, 0),
            'The cumulative logical size of root suffix views must remain linear in the source size.',
        ).toBeLessThanOrEqual(source.length * 4);
    });
});
