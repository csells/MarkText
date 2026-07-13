import type { Token, Tokens } from 'marked';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { plainMarkdown } from '../../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../criticMarkupDocument';
import {
    criticMarkupParserProfile,
    snapshotCriticMarkupParserOptions,
} from '../criticMarkupSourceContext';
import criticMarkupDocumentExtension from '../extensions/criticMarkupDocument';
import { lexBlock } from '../lexBlock';

function tokenTypes(source: string, options: Parameters<typeof lexBlock>[1]) {
    return (lexBlock(source, options) as Token[]).map(token => token.type);
}

function inlineTokenTypes(
    source: string,
    options: Parameters<typeof lexBlock>[1],
) {
    const first = lexBlock(source, options)[0] as Tokens.Paragraph;
    return first.tokens.map(token => token.type);
}

describe('criticMarkup native Marked parser options', () => {
    it('snapshots every native option that changes lexer semantics', () => {
        expect(snapshotCriticMarkupParserOptions({})).toMatchObject({
            gfm: true,
            pedantic: false,
            breaks: false,
        });

        expect(criticMarkupParserProfile({ gfm: false }).key)
            .not
            .toBe(criticMarkupParserProfile({ gfm: true }).key);
        expect(criticMarkupParserProfile({ pedantic: false }).key)
            .not
            .toBe(criticMarkupParserProfile({ pedantic: true }).key);
        expect(criticMarkupParserProfile({ breaks: false }).key)
            .not
            .toBe(criticMarkupParserProfile({ breaks: true }).key);
    });

    it('applies gfm, pedantic, and breaks to Muya block lexing', () => {
        const table = 'a | b\n--- | ---\nc | d';

        expect(tokenTypes(table, { gfm: true })).toEqual(['table']);
        expect(tokenTypes(table, { gfm: false })).toEqual(['paragraph']);
        expect(tokenTypes('#heading', { pedantic: true }))
            .toEqual(['heading']);
        expect(tokenTypes('#heading', { pedantic: false }))
            .toEqual(['paragraph']);
        expect(inlineTokenTypes('first\nsecond', {
            gfm: true,
            breaks: true,
        })).toEqual(['text', 'br', 'text']);
        expect(inlineTokenTypes('first\nsecond', {
            gfm: true,
            breaks: false,
        })).toEqual(['text']);
    });

    it('applies the prepared native profile to the final Marked parse', () => {
        const table = 'a {++new++} | b\n--- | ---\nc | d';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(table, {
            parserOptions: { gfm: false },
        }));

        const html = marked.parse(table) as string;

        expect(html).not.toContain('<table>');
        expect(html).toContain('data-critic-type="addition"');
    });

    it('cannot reuse GFM-derived context under a non-GFM parser profile', () => {
        const source = 'https://example.test/{++x++}';
        const gfm = parseCriticMarkupDocument(
            plainMarkdown(source),
            { gfm: true },
        );
        const plain = parseCriticMarkupDocument(
            plainMarkdown(source),
            { gfm: false },
        );

        expect(gfm.items).toEqual([]);
        expect(plain.items).toHaveLength(1);
        expect(gfm.analysis.parserProfile).not.toEqual(
            plain.analysis.parserProfile,
        );
        expect(() => criticMarkupDocumentExtension(source, {
            parserOptions: { gfm: false },
            analysis: gfm.analysis,
        })).toThrow(/parser profile/);
    });

    it('rejects parse-time native options that relabel the prepared lexer', () => {
        const source = 'before {++new++} after';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { gfm: false },
        }));

        expect(() => marked.parse(source, { gfm: true }))
            .toThrow(/parser options.*prepared parser profile/i);
    });

    it('retains explicit Muya parser flags absent from native Marked options', () => {
        const source = '$x {++inside++}$';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { math: false },
        }));

        expect(marked.parse(source)).toContain(
            'data-critic-type="addition"',
        );
    });
});
