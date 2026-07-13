// @vitest-environment happy-dom

import type {
    ICriticMarkupDocumentFragmentInput,
    Token,
} from '../types';
import { describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_RENDER_DEPTH_LIMIT } from '../../criticMarkup/renderPolicy';
import { localRange } from '../../mappedText';
import { mappedMarkdown, markdownStatePath } from '../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../../utils/marked/criticMarkupDocument';
import { generator, tokenizer } from '../lexer';

function tokenize(source: string) {
    const path = markdownStatePath([0, 'text']);
    const document = parseCriticMarkupDocument(mappedMarkdown(
        source,
        path,
        0,
    ));

    return tokenizer(source, {
        options: {
            criticMarkupDocumentFragments: document.fragmentsForPath(
                path,
            ),
            criticMarkupProjectLocalRange: (
                start,
                end,
                projection,
            ) => document.projectLocalRange(
                path,
                localRange(start, end),
                projection,
            ),
            footnote: false,
            superSubScript: true,
        },
    });
}

function criticTokens(source: string) {
    return tokenize(source).filter(token =>
        token.type === 'critic_document_fragment');
}

function armChildren(
    token: Extract<Token, { type: 'critic_document_fragment' }>,
    arm: 'content' | 'old' | 'new',
) {
    return token.segments.flatMap(segment =>
        segment.kind === 'content' && segment.arm === arm
            ? segment.children
            : []);
}

describe('inline lexer — CriticMarkup', () => {
    it.each([
        ['{++new++}', 'addition'],
        ['{--old--}', 'deletion'],
        ['{~~old~>new~~}', 'substitution'],
        ['{==focus==}', 'highlight'],
        ['{>>note<<}', 'comment'],
    ])('emits a native token for %s', (source, type) => {
        const tokens = criticTokens(source);

        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({
            type: 'critic_document_fragment',
            criticType: type,
            raw: source,
            range: { start: 0, end: source.length },
        });
    });

    it('keeps a substitution as one semantic token with two child groups', () => {
        const token = criticTokens('A {~~**old**~>_new_~~} B')[0] as Extract<
            Token,
            { type: 'critic_document_fragment' }
        >;

        expect(token.criticType).toBe('substitution');
        expect(armChildren(token, 'old').map(child => child.type))
            .toEqual(['strong']);
        expect(armChildren(token, 'new').map(child => child.type))
            .toEqual(['em']);
        expect(token.critic).toMatchObject({
            oldRange: { start: 5, end: 12 },
            newRange: { start: 14, end: 19 },
        });
    });

    it('parses Markdown inside a CriticMarkup payload', () => {
        const token = criticTokens('{++**bold**++}')[0] as Extract<
            Token,
            { type: 'critic_document_fragment' }
        >;

        expect(armChildren(token, 'content').map(child => child.type))
            .toEqual(['strong']);
    });

    it('balances same-type nesting into a native token tree', () => {
        const source = '{++outer {++inner++} tail++}';
        const [outer] = criticTokens(source) as Array<Extract<
            Token,
            { type: 'critic_document_fragment' }
        >>;

        expect(criticTokens(source)).toHaveLength(1);
        expect(outer.raw).toBe(source);
        expect(armChildren(outer, 'content').map(child => child.type)).toEqual([
            'text',
            'critic_document_fragment',
            'text',
        ]);
    });

    it('does not close a review item on delimiters inside inline code', () => {
        const source = '{++before `literal ++}` after++}';
        const [token] = criticTokens(source) as Array<Extract<
            Token,
            { type: 'critic_document_fragment' }
        >>;

        expect(token.raw).toBe(source);
        expect(armChildren(token, 'content').map(child => child.type)).toEqual([
            'text',
            'inline_code',
            'text',
        ]);
    });

    it('leaves CriticMarkup-looking text inside inline code literal', () => {
        const tokens = tokenize('`{++literal++}` and {++real++}');

        expect(tokens.filter(token => token.type === 'inline_code')).toHaveLength(1);
        expect(criticTokens('`{++literal++}` and {++real++}')).toHaveLength(1);
    });

    it('projects image alternative text through the canonical document', () => {
        const source = '![{++new++} {--old--}](img/{==path==}.png "{>>title<<}")';
        const tokens = tokenize(source);
        const image = tokens.find(token => token.type === 'image');

        expect(image).toMatchObject({
            type: 'image',
            alt: 'new ',
            attrs: {
                alt: 'new ',
                src: 'img/{==path==}.png',
                title: '{>>title<<}',
            },
        });
        expect(criticTokens(source)).toHaveLength(0);
    });

    it('keeps GFM strike distinct from a CriticMarkup substitution', () => {
        const tokens = tokenize('~~strike~~ and {~~old~>new~~}');

        expect(tokens.filter(token => token.type === 'del')).toHaveLength(1);
        expect(criticTokens('~~strike~~ and {~~old~>new~~}'))
            .toHaveLength(1);
    });

    it('leaves a CommonMark-escaped opener literal', () => {
        expect(criticTokens(String.raw`\{++literal++}`)).toHaveLength(0);
    });

    it('does not close an outer review item on bytes inside a link destination', () => {
        const source = '{++before [x](https://example.test/++}) after++}';
        const tokens = criticTokens(source);

        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({
            type: 'critic_document_fragment',
            criticType: 'addition',
            raw: source,
            range: { start: 0, end: source.length },
        });
    });

    it('does not close an outer review item on bytes inside an HTML attribute', () => {
        const source = '{++before <span data-value="++}">x</span> after++}';
        const tokens = criticTokens(source);

        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({
            type: 'critic_document_fragment',
            criticType: 'addition',
            raw: source,
            range: { start: 0, end: source.length },
        });
    });

    it('bounds semantic render depth and preserves the excess subtree literally', () => {
        const excessDepth = 512;
        const depth = CRITIC_MARKUP_RENDER_DEPTH_LIMIT + excessDepth;
        const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;
        const tokens = tokenize(source);
        const pending = [...tokens];
        let semanticCount = 0;
        const limits: Array<Extract<
            Token,
            { type: 'critic_markup_render_limit' }
        >> = [];

        while (pending.length) {
            const token = pending.pop()!;
            if (token.type === 'critic_document_fragment') {
                semanticCount++;
                for (const segment of token.segments) {
                    if (segment.kind === 'content')
                        pending.push(...segment.children);
                }
            }
            else if (token.type === 'critic_markup_render_limit') {
                limits.push(token);
            }
        }

        const literal = `${'{++'.repeat(excessDepth)}x${'++}'.repeat(excessDepth)}`;
        expect(semanticCount).toBe(CRITIC_MARKUP_RENDER_DEPTH_LIMIT);
        expect(limits).toHaveLength(1);
        expect(limits[0].raw).toBe(literal);
        expect(limits[0].content).toBe(literal);
        expect(limits[0].diagnostic).toMatchObject({
            code: 'critic-markup-render-depth-limit',
            depth: CRITIC_MARKUP_RENDER_DEPTH_LIMIT,
            limit: CRITIC_MARKUP_RENDER_DEPTH_LIMIT,
        });
        expect(generator(tokens, true)).toBe(source);
    });

    it('indexes dense siblings once instead of rereading every item per character', () => {
        const itemCount = 2_048;
        const source = '{++x++}'.repeat(itemCount);
        const document = parseCriticMarkupDocument(mappedMarkdown(
            source,
            markdownStatePath([0, 'text']),
            0,
        ));
        let itemReads = 0;
        const fragments = document.fragmentsForPath(
            markdownStatePath([0, 'text']),
        ).map(
            input => Object.defineProperty(
                { fragment: input.fragment },
                'item',
                {
                    enumerable: true,
                    get() {
                        itemReads++;
                        return input.item;
                    },
                },
            ) as ICriticMarkupDocumentFragmentInput,
        );

        const tokens = tokenizer(source, {
            options: {
                criticMarkupDocumentFragments: fragments,
                footnote: false,
                superSubScript: true,
            },
        });

        expect(tokens.filter(token =>
            token.type === 'critic_document_fragment')).toHaveLength(itemCount);
        expect(itemReads).toBeLessThanOrEqual(itemCount * 3);

        const firstPassReads = itemReads;
        tokenizer(source, {
            options: {
                criticMarkupDocumentFragments: fragments,
                footnote: false,
                superSubScript: true,
            },
        });
        expect(itemReads - firstPassReads).toBeLessThanOrEqual(itemCount * 2);
    });
});
