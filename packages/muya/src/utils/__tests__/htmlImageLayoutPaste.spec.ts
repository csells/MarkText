// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import HtmlToMarkdown from '../../state/htmlToMarkdown';
import { normalizePastedHTML } from '../paste';

describe('rich clipboard image layout', () => {
    it.each([
        '<img src="beach.jpg" alt="A sunny beach" width="320">',
        '<img src="beach.jpg" alt="A sandy beach" height="50%" data-align="right">',
        '<img src="beach.jpg" alt="A &quot;sunny&quot; beach" width="320" height="200" data-align="center">',
    ])('preserves image attributes through the shared HTML importer: %s', async (html) => {
        const normalized = await normalizePastedHTML(html);
        const markdown = new HtmlToMarkdown().generate(normalized);
        expect(markdown).toBe(html);
    });

    it('retains ordinary Markdown conversion for an image without layout', async () => {
        const normalized = await normalizePastedHTML('<img src="beach.jpg" alt="beach" title="summer">');
        expect(new HtmlToMarkdown().generate(normalized)).toBe('![beach](beach.jpg "summer")');
    });

    it('keeps layout while removing event handlers and unrelated data attributes', async () => {
        const normalized = await normalizePastedHTML('<img src="beach.jpg" width="320" data-align="center" data-document-source="hidden" onerror="alert(1)">');
        expect(new HtmlToMarkdown().generate(normalized)).toBe('<img src="beach.jpg" width="320" data-align="center">');
    });
});
