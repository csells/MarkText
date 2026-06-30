// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function metadata(data: Record<string, unknown>) {
    return `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

describe('muya.getComments()', () => {
    it('returns decoded threads, ranges, and diagnostics from current state', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                authors: ['Ada'],
                replies: [],
            })}`,
            '',
        ].join('\n'));

        expect(muya.getComments()).toMatchObject({
            diagnostics: [],
            ranges: [
                {
                    id: 'a',
                    startOffset: 13,
                    endOffset: 21,
                },
            ],
            threads: [
                {
                    id: 'a',
                    status: 'open',
                    authors: ['Ada'],
                    replies: [],
                },
            ],
        });
    });

    it('reflects later document replacements', () => {
        const muya = boot('No comments.\n');

        expect(muya.getComments()).toEqual({
            diagnostics: [],
            ranges: [],
            threads: [],
        });

        muya.setContent([
            '<!--MC:b-->new<!--MC:~b-->',
            '',
            `[MC:b]: ${metadata({ version: 1, status: 'resolved', replies: [] })}`,
            '',
        ].join('\n'));

        expect(muya.getComments().threads).toEqual([
            {
                id: 'b',
                version: 1,
                status: 'resolved',
                replies: [],
            },
        ]);
    });
});

describe('muya.addComment()', () => {
    it('wraps a same-leaf selection, appends metadata, and records one undo boundary', () => {
        const muya = boot('A reviewed span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.setCursor(2, 10, true);

        expect(muya.addComment({
            id: 'cmt_test',
            author: 'Ada',
            body: 'Please check this.',
            createdAt: '2026-06-30T12:00:00.000Z',
        })).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).toContain('A <!--MC:cmt_test-->reviewed<!--MC:~cmt_test--> span.');
        expect(markdown).toContain('[MC:cmt_test]: data:application/json;base64,');
        expect(muya.getComments()).toMatchObject({
            diagnostics: [],
            ranges: [
                {
                    id: 'cmt_test',
                    startOffset: 20,
                    endOffset: 28,
                },
            ],
            threads: [
                {
                    id: 'cmt_test',
                    authors: ['Ada'],
                    replies: [
                        {
                            author: 'Ada',
                            createdAt: '2026-06-30T12:00:00.000Z',
                            body: 'Please check this.',
                        },
                    ],
                },
            ],
        });

        muya.undo();
        expect(muya.getMarkdown()).toBe('A reviewed span.\n');
        expect(muya.getComments()).toEqual({
            diagnostics: [],
            ranges: [],
            threads: [],
        });
    });

    it('rejects collapsed selections and duplicate requested IDs', () => {
        const muya = boot([
            'A <!--MC:existing-->reviewed<!--MC:~existing--> span.',
            '',
            `[MC:existing]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(2, 2, true);
        expect(muya.addComment({ id: 'new_comment' })).toBe(false);

        leaf.setCursor(2, 10, true);
        expect(muya.addComment({ id: 'existing' })).toBe(false);
    });
});

describe('muya comment metadata mutations', () => {
    it('updates thread metadata and records one undo boundary', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                authors: ['Ada'],
                createdAt: '2026-06-30T12:00:00.000Z',
                updatedAt: '2026-06-30T12:00:00.000Z',
                replies: [],
            })}`,
            '',
        ].join('\n'));

        expect(muya.updateCommentThread('a', {
            authors: ['Ada', 'Grace'],
            updatedAt: '2026-06-30T13:00:00.000Z',
        })).toBe(true);

        expect(muya.getComments().threads).toEqual([
            {
                id: 'a',
                version: 1,
                status: 'open',
                authors: ['Ada', 'Grace'],
                createdAt: '2026-06-30T12:00:00.000Z',
                updatedAt: '2026-06-30T13:00:00.000Z',
                replies: [],
            },
        ]);

        muya.undo();
        expect(muya.getComments().threads[0].authors).toEqual(['Ada']);
    });

    it('appends replies and includes the reply author in thread authors', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', authors: ['Ada'], replies: [] })}`,
            '',
        ].join('\n'));

        expect(muya.replyToComment('a', {
            author: 'Grace',
            body: 'Looks good.',
            createdAt: '2026-06-30T14:00:00.000Z',
        })).toBe(true);

        expect(muya.getComments().threads[0]).toMatchObject({
            authors: ['Ada', 'Grace'],
            updatedAt: '2026-06-30T14:00:00.000Z',
            replies: [
                {
                    author: 'Grace',
                    body: 'Looks good.',
                    createdAt: '2026-06-30T14:00:00.000Z',
                },
            ],
        });
    });

    it('resolves and reopens existing comments without touching markers', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        expect(muya.resolveComment('a', '2026-06-30T15:00:00.000Z')).toBe(true);
        expect(muya.getComments().threads[0].status).toBe('resolved');
        expect(muya.getMarkdown()).toContain('<!--MC:a-->reviewed<!--MC:~a-->');

        expect(muya.reopenComment('a', '2026-06-30T16:00:00.000Z')).toBe(true);
        expect(muya.getComments().threads[0].status).toBe('open');
        expect(muya.getComments().threads[0].updatedAt).toBe('2026-06-30T16:00:00.000Z');
    });

    it('returns false when metadata for the requested comment is missing', () => {
        const muya = boot('A <!--MC:a-->reviewed<!--MC:~a--> span.\n');

        expect(muya.replyToComment('a', {
            author: 'Grace',
            body: 'No metadata.',
            createdAt: '2026-06-30T14:00:00.000Z',
        })).toBe(false);
        expect(muya.resolveComment('a')).toBe(false);
        expect(muya.reopenComment('a')).toBe(false);
        expect(muya.updateCommentThread('a', { status: 'resolved' })).toBe(false);
    });
});

describe('muya active comment navigation', () => {
    it('derives active comments from the current same-leaf selection', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(15, 15, true);
        expect(muya.getActiveComments()).toEqual(['a']);

        leaf.setCursor(0, 1, true);
        expect(muya.getActiveComments()).toEqual([]);
    });

    it('focuses the first range for a comment thread', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        expect(muya.focusComment('a')).toBe(true);

        const selection = muya.getSelection();
        expect(selection?.anchor.offset).toBe(13);
        expect(selection?.focus.offset).toBe(21);
        expect(muya.getActiveComments()).toEqual(['a']);
        expect(muya.focusComment('missing')).toBe(false);
    });
});

describe('muya comment highlights', () => {
    it('renders comment ranges as visible highlights while marker syntax stays hidden', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight');
        expect(highlight?.textContent).toBe('reviewed');
        expect(muya.domNode.querySelector('.mu-comment-marker')?.textContent).toBe('<!--MC:a-->');
    });

    it('uses the active highlight class when the cursor is inside a comment range', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(15, 15, true);

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight-active');
        expect(highlight?.textContent).toBe('reviewed');
    });

    it('renders overlapping comment ranges without duplicating the overlapped text', () => {
        const muya = boot([
            'A <!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            `[MC:b]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        const highlightedText = Array.from(
            muya.domNode.querySelectorAll<HTMLElement>('.mu-comment-highlight'),
            el => el.textContent,
        ).join('');

        expect(highlightedText).toBe('alpha beta gamma');
    });

    it('combines comment and search highlight classes for the same text segment', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        muya.search('reviewed');

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight.mu-highlight');
        expect(highlight?.textContent).toBe('reviewed');
    });

    it('refreshes visible comment highlights after replacing the document', () => {
        const muya = boot('No comments.\n');

        muya.setContent([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight');
        expect(highlight?.textContent).toBe('reviewed');
    });
});

describe('muya comment events', () => {
    it('emits comments-change when a comment is added', () => {
        const muya = boot('A reviewed span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const events: string[][] = [];
        muya.on('comments-change', (comments: ReturnType<Muya['getComments']>) => {
            events.push(comments.threads.map(thread => thread.id));
        });

        leaf.setCursor(2, 10, true);
        expect(muya.addComment({ id: 'event_comment' })).toBe(true);

        expect(events.at(-1)).toEqual(['event_comment']);
    });

    it('emits comments-change when the document is replaced', () => {
        const muya = boot('No comments.\n');
        const events: string[][] = [];
        muya.on('comments-change', (comments: ReturnType<Muya['getComments']>) => {
            events.push(comments.threads.map(thread => thread.id));
        });

        muya.setContent([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        expect(events.at(-1)).toEqual(['a']);
    });

    it('emits active-comments-change when the selection enters and leaves a comment range', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const events: string[][] = [];
        muya.on('active-comments-change', (ids: string[]) => {
            events.push(ids);
        });

        leaf.setCursor(15, 15, true);
        leaf.setCursor(0, 1, true);

        expect(events).toEqual([['a'], []]);
    });
});
