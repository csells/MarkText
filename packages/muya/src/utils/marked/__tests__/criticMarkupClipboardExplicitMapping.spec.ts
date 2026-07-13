// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { sourceRange } from '../../../mappedText';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import { getClipBoardHtml } from '../getClipboardHtml';

describe('criticMarkup clipboard explicit source mapping', () => {
    it('binds the selected canonical occurrence when generated container bytes repeat it', () => {
        const canonical = '{++same++}';
        const leadingMarkdown = `> ${canonical}\n> `;
        const trailingMarkdown = '\n';
        const clipboardMarkdown
            = `${leadingMarkdown}${canonical}${trailingMarkdown}`;
        const options = {
            criticMarkup: true,
            criticMarkupProjection: 'marked' as const,
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            superSubScript: false,
        };
        const document = parseCriticMarkupDocument(
            plainMarkdown(canonical),
            options,
        );

        const html = getClipBoardHtml(clipboardMarkdown, options, {
            document,
            sourceRange: sourceRange(0, canonical.length),
            leadingMarkdown,
            trailingMarkdown,
        });
        const host = documentForHtml(html);

        expect(host.querySelectorAll('[data-critic-id]')).toHaveLength(1);
        expect(host.textContent).toContain(canonical);
        expect(host.textContent).toContain('same');
    });
});

function documentForHtml(html: string): HTMLDivElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
}
