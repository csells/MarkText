import type { Token, Tokens } from 'marked';
import type {
    ICriticMarkupParseSession,
} from '../criticMarkupParseSession';
import type { ILexOption } from '../types';
import { describe, expect, it } from 'vitest';
import {
    analyzeCriticMarkupContext as analyzePreparedCriticMarkupContext,
} from '../criticMarkupContext';
import { analyzeMarkdownBlockSource } from '../lexBlock';
import {
    withTestCriticMarkupParseSession,
} from './helpers/criticMarkupParseSession';

const SESSIONS = new WeakMap<object, ICriticMarkupParseSession>();

function lex(
    source: string,
    options: ILexOption = { criticMarkup: false },
    level: 'block' | 'inline' = 'block',
): Token[] {
    return withTestCriticMarkupParseSession(
        source,
        options,
        level === 'block',
        (session, tokens) => {
            SESSIONS.set(tokens, session);
            return tokens;
        },
    );
}

function analyzeCriticMarkupContext(
    _source: string,
    tokens: Token[],
    level: 'block' | 'inline' = 'block',
    sourceBinding?: Parameters<typeof analyzePreparedCriticMarkupContext>[2],
) {
    const session = SESSIONS.get(tokens);
    if (!session)
        throw new TypeError('Test tokens have no parser session.');
    return analyzePreparedCriticMarkupContext(
        session,
        level,
        sourceBinding,
    );
}

describe('criticMarkup parser context analysis', () => {
    it('rejects a source binding that leaves an unparsed canonical suffix', () => {
        const parserSource = 'body';
        const canonicalSource = 'prefixbody suffix';
        const { session } = withTestCriticMarkupParseSession(
            parserSource,
            {},
            true,
            (session, tokens) => ({ session, tokens }),
            undefined,
            canonicalSource,
        );

        expect(() => analyzePreparedCriticMarkupContext(
            session,
            'block',
            {
                source: canonicalSource,
                parserOffset: 6,
                literalRanges: [{ start: 0, end: 6 }],
            },
        )).toThrow(/declared canonical offset/);
    });

    it('rejects 200k invalid parser mappings with a domain error, not argument overflow', () => {
        const parserSource = 'x';
        const repeatedMapping = {
            parserStart: 0,
            parserEnd: 1,
            sourceStart: 0,
            sourceEnd: 1,
        };

        expect(() => analyzeCriticMarkupContext(
            parserSource,
            lex(parserSource),
            'block',
            {
                source: parserSource,
                parserMappings: Array.from({ length: 200_000 })
                    .fill(repeatedMapping) as Array<typeof repeatedMapping>,
                literalRanges: [],
            },
        )).toThrow(/mapping is invalid for its canonical source/);
    });

    it('returns source-ordered inline leaves with deterministic synthetic paths', () => {
        const source = [
            '# heading',
            '',
            '> quote',
            '',
            '- item',
            '',
            '| header |',
            '| --- |',
            String.raw`| a\|b |`,
        ].join('\n');

        const first = analyzeCriticMarkupContext(source, lex(source));
        const second = analyzeCriticMarkupContext(source, lex(source));

        expect(first.inlineLeaves.map(leaf => leaf.text)).toEqual([
            'heading',
            'quote',
            'item',
            'header',
            'a|b',
        ]);
        expect(first.inlineLeaves.map(leaf => leaf.path)).toEqual(
            second.inlineLeaves.map(leaf => leaf.path),
        );
        expect(first.inlineLeaves.every(leaf => leaf.path[0] === 'marked'))
            .toBe(true);

        for (const leaf of first.inlineLeaves) {
            const local = leaf.pieces
                .map(piece => leaf.text.slice(piece.localStart, piece.localEnd))
                .join('');
            const original = leaf.pieces
                .map(piece => source.slice(piece.sourceStart, piece.sourceEnd))
                .join('');
            expect(original).toBe(local);
        }

        expect(first.inlineLeaves.at(-1)?.pieces).toEqual([
            expect.objectContaining({ localStart: 0, localEnd: 1 }),
            expect.objectContaining({ localStart: 1, localEnd: 3 }),
        ]);
    });

    it('replaces both the exposed and owning Marked inline-token array', () => {
        const source = '# heading';
        const tokens = lex(source);
        const analysis = analyzeCriticMarkupContext(source, tokens);
        const replacement: Token[] = [{
            type: 'text',
            raw: 'replacement',
            text: 'replacement',
        }];

        analysis.inlineLeaves[0].replaceTokens(replacement);

        expect(analysis.inlineLeaves[0].tokens).toBe(replacement);
        expect((tokens[0] as Tokens.Heading).tokens).toBe(replacement);
    });

    it('derives literal ranges and the compatibility wrapper from one traversal', () => {
        const source = [
            'visible `{++code++}`',
            '',
            '[link](https://example.test/{--destination--})',
        ].join('\n');
        const tokens = lex(source);
        const analysis = analyzeCriticMarkupContext(source, tokens);

        expect(analysis.literalRanges.map(range =>
            source.slice(range.start, range.end),
        )).toEqual([
            '`{++code++}`',
            '[',
            '](https://example.test/{--destination--})',
        ]);
        expect(analyzeMarkdownBlockSource(source, {
            criticMarkup: false,
        }).literalRanges)
            .toEqual(analysis.literalRanges);
    });

    it('keeps image alternatives visible while destinations and titles stay literal', () => {
        const source = String.raw`before ![a \[nested\] {++alt++}](img/{--path--}.png "{>>title<<}") after`;
        const analysis = analyzeCriticMarkupContext(source, lex(source));
        const leaf = analysis.inlineLeaves[0];

        expect(analysis.literalRanges.map(range =>
            source.slice(range.start, range.end),
        )).toEqual([
            '![',
            '\\',
            '\\',
            String.raw`](img/{--path--}.png "{>>title<<}")`,
        ]);
        expect(leaf.plainTextProjections).toEqual([{
            localRange: {
                start: source.indexOf('a \\['),
                end: source.indexOf(']('),
            },
            sourceRange: {
                start: source.indexOf('a \\['),
                end: source.indexOf(']('),
            },
        }]);
    });

    it('analyzes an inline-token root without treating links as block containers', () => {
        const source = 'before [x](https://example.test/++}) after';
        const tokens = lex(source, {}, 'inline');
        const analysis = analyzeCriticMarkupContext(
            source,
            tokens,
            'inline',
        );

        expect(analysis.literalRanges.map(range =>
            source.slice(range.start, range.end),
        )).toEqual(['[', '](https://example.test/++})']);
        expect(analysis.inlineLeaves).toHaveLength(1);
        expect(analysis.inlineLeaves[0].text).toBe(source);
        expect(analysis.inlineLeaves[0].tokens).toEqual(tokens);
    });

    it('treats a bare GFM autolink as one literal Marked link token', () => {
        const source = 'before https://example.com after';
        const analysis = analyzeCriticMarkupContext(source, lex(source));

        expect(analysis.literalRanges.map(range =>
            source.slice(range.start, range.end),
        )).toEqual(['https://example.com']);
    });

    it('maps normalized footnote children back to their exact definition source', () => {
        const source = [
            'text[^n]',
            '',
            '[^n]: intro {++lead++}',
            '',
            '    - nested {--old--}',
        ].join('\n');
        const options = {
            criticMarkup: false,
            footnote: true,
        };
        const tokens = lex(source, options);
        const analysis = analyzeCriticMarkupContext(source, tokens);

        expect(analysis.inlineLeaves.map(leaf => leaf.text)).toEqual([
            'text[^n]',
            'intro {++lead++}',
            'nested {--old--}',
        ]);
        for (const leaf of analysis.inlineLeaves) {
            const parserText = leaf.pieces
                .map(piece => leaf.text.slice(piece.localStart, piece.localEnd))
                .join('');
            const originalText = leaf.pieces
                .map(piece => source.slice(piece.sourceStart, piece.sourceEnd))
                .join('');
            expect(originalText).toBe(parserText);
        }
    });
});
