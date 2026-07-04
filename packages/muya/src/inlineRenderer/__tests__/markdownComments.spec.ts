// @vitest-environment happy-dom

import type { IParagraphState, TState } from '../../state/types';
import type { CommentMarkerToken, Token } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { encodeCommentMetadata } from '../../comments';
import InlineRenderer from '../index';
import { tokenizer } from '../lexer';

function flatten(tokens: Token[]): Token[] {
    return tokens.flatMap(token =>
        'children' in token && Array.isArray(token.children)
            ? [token, ...flatten(token.children)]
            : [token],
    );
}

function isCommentMarkerToken(token: Token): token is CommentMarkerToken {
    return token.type === 'comment_marker';
}

describe('markdown comments - inline marker tokenization', () => {
    it('emits dedicated tokens for MC open and close markers', () => {
        const tokens = flatten(tokenizer('A <!--MC:cmt_1-->text<!--MC:~cmt_1--> B'));
        const markers = tokens.filter(isCommentMarkerToken);

        expect(markers).toHaveLength(2);
        expect(markers.map(t => t.raw)).toEqual(['<!--MC:cmt_1-->', '<!--MC:~cmt_1-->']);
        expect(markers.map(t => t.markerId)).toEqual(['cmt_1', 'cmt_1']);
        expect(markers.map(t => t.markerKind)).toEqual(['open', 'close']);
    });

    it('leaves ordinary HTML comments on the generic HTML path', () => {
        const tokens = tokenizer('A <!--ordinary comment--> B');

        expect(tokens.some(t => t.type === 'comment_marker')).toBe(false);
        expect(tokens.some(t => t.type === 'html_tag')).toBe(true);
    });

    it('treats MC marker text inside inline code as literal code content', () => {
        const tokens = flatten(tokenizer('`<!--MC:cmt_1-->`'));

        expect(tokens.some(t => t.type === 'comment_marker')).toBe(false);
        expect(tokens).toContainEqual(
            expect.objectContaining({
                type: 'inline_code',
                content: '<!--MC:cmt_1-->',
            }),
        );
    });
});

describe('markdown comments - reference metadata labels', () => {
    const renderer = Object.create(InlineRenderer.prototype) as InlineRenderer;

    it('does not collect MC metadata definitions as normal reference labels', () => {
        const block: IParagraphState = {
            name: 'paragraph',
            text: '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
        };

        expect(renderer.getLabelInfo(block)).toEqual({ label: null, info: null });
    });

    it('does not collect malformed MC metadata definitions as normal reference labels', () => {
        const block: IParagraphState = {
            name: 'paragraph',
            text: '[MC:a]: https://example.com/not-comment-metadata',
        };

        expect(renderer.getLabelInfo(block)).toEqual({ label: null, info: null });
    });

    it('still collects ordinary reference definitions', () => {
        const block: IParagraphState = {
            name: 'paragraph',
            text: '[doc]: https://example.com "Example"',
        };

        expect(renderer.getLabelInfo(block)).toEqual({
            label: 'doc',
            info: {
                href: 'https://example.com',
                title: 'Example',
            },
        });
    });
});

describe('markdown comments - render caching', () => {
    it('reuses parsed comments for repeated content patches in the same json version', () => {
        const metadata = encodeCommentMetadata({
            version: 1,
            status: 'open',
            replies: [],
        });
        const states: TState[] = [
            {
                name: 'paragraph',
                text: 'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            },
            {
                name: 'paragraph',
                text: `[MC:a]: ${metadata}`,
            },
        ];
        const contentNodes = states.map((state, index) => ({
            isContent: () => true,
            path: [index, 'text'],
            text: 'text' in state ? state.text : '',
        }));
        const getState = vi.fn(() => states);
        const renderer = Object.create(InlineRenderer.prototype) as {
            _commentRenderCache: unknown;
            muya: unknown;
            _commentHighlights: (block: unknown) => unknown[];
        };
        renderer._commentRenderCache = null;
        renderer.muya = {
            editor: {
                jsonState: {
                    getState,
                    version: 1,
                },
                scrollPage: {
                    depthFirstTraverse(callback: (node: unknown) => void) {
                        contentNodes.forEach(callback);
                    },
                },
                selection: {
                    getSelection: () => null,
                },
            },
        } as never;

        renderer._commentHighlights(contentNodes[0]);
        renderer._commentHighlights(contentNodes[0]);

        expect(getState).toHaveBeenCalledTimes(1);
    });
});

describe('markdown comments - resolved highlights', () => {
    const buildRenderer = (status: 'open' | 'resolved') => {
        const metadata = encodeCommentMetadata({ version: 1, status, replies: [] });
        const states: TState[] = [
            { name: 'paragraph', text: 'A <!--MC:a-->reviewed<!--MC:~a--> line.' },
            { name: 'paragraph', text: `[MC:a]: ${metadata}` },
        ];
        const contentNodes = states.map((state, index) => ({
            isContent: () => true,
            path: [index, 'text'],
            text: 'text' in state ? state.text : '',
        }));
        const renderer = Object.create(InlineRenderer.prototype) as {
            _commentRenderCache: unknown;
            muya: unknown;
            _commentHighlights: (block: unknown) => unknown[];
        };
        renderer._commentRenderCache = null;
        renderer.muya = {
            editor: {
                jsonState: { getState: () => states, version: 1 },
                scrollPage: {
                    depthFirstTraverse(callback: (node: unknown) => void) {
                        contentNodes.forEach(callback);
                    },
                },
                selection: { getSelection: () => null },
            },
        } as never;
        return { renderer, contentNodes };
    };

    it('highlights an open comment range', () => {
        const { renderer, contentNodes } = buildRenderer('open');
        expect(renderer._commentHighlights(contentNodes[0]).length).toBeGreaterThan(0);
    });

    it('drops the highlight once the comment is resolved', () => {
        const { renderer, contentNodes } = buildRenderer('resolved');
        expect(renderer._commentHighlights(contentNodes[0])).toEqual([]);
    });
});
