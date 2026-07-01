// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCommentMetadataInMarkdown } from '../comments';
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

function decode(dataUri: string): { status?: string } {
    return JSON.parse(Buffer.from(dataUri.replace('data:application/json;base64,', ''), 'base64').toString('utf8'));
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
                    preview: 'reviewed',
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
                    preview: 'reviewed',
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
        const selection = muya.getSelection();
        expect(selection?.anchor.offset).toBe(20);
        expect(selection?.focus.offset).toBe(28);
        expect(muya.getActiveComments()).toEqual(['cmt_test']);

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

    it('rejects invalid IDs and code-like selections', () => {
        const invalidId = boot('A reviewed span.\n');
        const invalidLeaf = invalidId.editor.scrollPage!.firstContentInDescendant() as Content;
        invalidLeaf.setCursor(2, 10, true);

        expect(invalidId.addComment({ id: 'bad.id' })).toBe(false);
        expect(invalidId.getMarkdown()).toBe('A reviewed span.\n');

        const code = boot('```js\nconst a = 1\n```\n');
        const codeLeaf = code.editor.scrollPage!.lastContentInDescendant() as Content;
        codeLeaf.setCursor(0, 5, true);

        expect(code.addComment({ id: 'code_comment' })).toBe(false);
        expect(code.getMarkdown()).not.toContain('<!--MC:code_comment-->');
    });

    it('rejects selections inside inline code without appending orphan metadata', () => {
        const muya = boot('A `reviewed` span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.setCursor(3, 11, true);

        expect(muya.addComment({ id: 'inline_code_comment' })).toBe(false);
        expect(muya.getMarkdown()).toBe('A `reviewed` span.\n');
        expect(muya.getComments()).toEqual({
            diagnostics: [],
            ranges: [],
            threads: [],
        });
    });

    it('treats orphan metadata IDs as reserved when adding comments', () => {
        const muya = boot([
            'A reviewed span.',
            '',
            `[MC:cmt_1]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(2, 10, true);
        expect(muya.addComment({ id: 'cmt_1' })).toBe(false);

        expect(muya.addComment()).toBe(true);
        expect(muya.getMarkdown()).toContain('A <!--MC:cmt_2-->reviewed<!--MC:~cmt_2--> span.');
        expect(muya.getComments().threads.map(thread => thread.id)).toEqual(['cmt_2']);
    });

    it('rejects selections that intersect existing hidden comment marker syntax', () => {
        const original = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');
        const muya = boot(original);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor('A <!--'.length, 'A <!--MC:a-->reviewed'.length, true);

        expect(muya.addComment({ id: 'bad_marker_overlap' })).toBe(false);
        expect(muya.getMarkdown()).toBe(original);
        expect(muya.getComments().diagnostics).toEqual([]);
    });

    it('wraps a cross-leaf selection with one range and one metadata definition', () => {
        const muya = boot('Alpha line.\n\nBeta line.\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const second = muya.editor.scrollPage!.lastContentInDescendant() as Content;
        const firstPath = [...first.path];
        const secondPath = [...second.path];
        muya.editor.selection.setSelection(
            { offset: 6, block: first, path: firstPath },
            { offset: 4, block: second, path: secondPath },
        );

        expect(muya.addComment({
            id: 'cross_leaf',
            author: 'Ada',
            body: 'Review both lines.',
            createdAt: '2026-06-30T12:00:00.000Z',
        })).toBe(true);

        expect(muya.getMarkdown()).toContain([
            'Alpha <!--MC:cross_leaf-->line.',
            '',
            'Beta<!--MC:~cross_leaf--> line.',
        ].join('\n'));
        expect(muya.getComments()).toMatchObject({
            diagnostics: [],
            ranges: [
                {
                    id: 'cross_leaf',
                    startPath: firstPath,
                    endPath: secondPath,
                    preview: 'line. Beta',
                },
            ],
            threads: [
                {
                    id: 'cross_leaf',
                    authors: ['Ada'],
                },
            ],
        });

        muya.undo();
        expect(muya.getMarkdown()).toBe('Alpha line.\n\nBeta line.\n');
    });

    it('rejects cross-leaf selections that pass through inline code in an intermediate leaf', () => {
        const markdown = 'Alpha line.\n\nMiddle `code` line.\n\nBeta line.\n';
        const muya = boot(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const last = muya.editor.scrollPage!.lastContentInDescendant() as Content;

        muya.editor.selection.setSelection(
            { offset: 6, block: first, path: [...first.path] },
            { offset: 4, block: last, path: [...last.path] },
        );

        expect(muya.addComment({ id: 'cross_inline_code' })).toBe(false);
        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.getComments()).toEqual({
            diagnostics: [],
            ranges: [],
            threads: [],
        });
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

    it('preserves optional display metadata while editing a thread', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                display: {
                    color: 'amber',
                    label: 'Design review',
                },
                replies: [],
            })}`,
            '',
        ].join('\n'));

        expect(muya.resolveComment('a', '2026-06-30T15:00:00.000Z')).toBe(true);

        expect(muya.getComments().threads[0]).toMatchObject({
            id: 'a',
            status: 'resolved',
            display: {
                color: 'amber',
                label: 'Design review',
            },
        });
    });

    it('preserves metadata definition spacing around WYSIWYG thread edits', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]:    ${metadata({ version: 1, status: 'open', replies: [] })}   `,
            '',
        ].join('\n'));

        expect(muya.resolveComment('a', '2026-06-30T15:00:00.000Z')).toBe(true);

        expect(muya.getMarkdown()).toMatch(
            /\[MC:a\]: {4}data:application\/json;base64,\S+ {3}\n/u,
        );
    });

    it('does not update metadata-looking definitions in non-commentable blocks', () => {
        const ignored = metadata({ version: 1, status: 'open', replies: [] });
        const canonical = metadata({ version: 1, status: 'open', replies: [] });
        const muya = boot([
            '---',
            `[MC:a]: ${ignored}`,
            '---',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${canonical}`,
            '',
        ].join('\n'));

        expect(muya.resolveComment('a', '2026-06-30T15:00:00.000Z')).toBe(true);

        const lines = muya.getMarkdown().split('\n').filter(line => line.startsWith('[MC:a]:'));
        expect(decode(lines[0].replace('[MC:a]: ', '')).status).toBe('open');
        expect(decode(lines[1].replace('[MC:a]: ', '')).status).toBe('resolved');
    });

    it('updates a later valid duplicate instead of throwing on an earlier invalid definition', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            '[MC:a]: data:application/json;base64,not-base64-json',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        expect(() => muya.resolveComment('a', '2026-06-30T15:00:00.000Z')).not.toThrow();
        expect(muya.getComments().threads[0]).toMatchObject({
            id: 'a',
            status: 'resolved',
        });
    });

    it('updates the parser-selected source metadata line without rewriting ignored definitions', () => {
        const ignored = metadata({ version: 1, status: 'open', replies: [] });
        const canonical = metadata({ version: 1, status: 'open', replies: [] });
        const invalid = '[MC:a]: data:application/json;base64,not-base64-json';
        const document = [
            '---',
            `[MC:a]: ${ignored}`,
            '---',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            invalid,
            `[MC:a]: ${canonical}  `,
        ].join('\n');

        const next = updateCommentMetadataInMarkdown(
            document,
            'a',
            current => ({ ...current, status: 'resolved', updatedAt: '2026-06-30T15:00:00.000Z' }),
        );

        expect(next).not.toBeNull();
        const lines = next!.split('\n').filter(line => line.trimStart().startsWith('[MC:a]: '));
        expect(decode(lines[0].replace('[MC:a]: ', '')).status).toBe('open');
        expect(lines[1]).toBe(invalid);
        expect(decode(lines[2].trim().replace('[MC:a]: ', '')).status).toBe('resolved');
        expect(lines[2].endsWith('  ')).toBe(true);
    });

    it('returns original markdown when the parser-selected metadata update is a no-op', () => {
        const document = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        expect(updateCommentMetadataInMarkdown(document, 'a', current => current)).toBe(document);
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
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const scrollIntoView = vi.fn();
        leaf.domNode!.scrollIntoView = scrollIntoView;

        expect(muya.focusComment('a')).toBe(true);

        const selection = muya.getSelection();
        expect(selection?.anchor.offset).toBe(13);
        expect(selection?.focus.offset).toBe(21);
        expect(muya.getActiveComments()).toEqual(['a']);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
        expect(muya.focusComment('missing')).toBe(false);
    });

    it('derives active comments for cross-leaf selections and focused cross-leaf ranges', () => {
        const muya = boot([
            'Alpha <!--MC:a-->line.',
            '',
            'Beta<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const first = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        const second = first.nextContentInContext() as Content;

        muya.editor.selection.setSelection(
            { offset: 11, block: first, path: first.path },
            { offset: 2, block: second, path: second.path },
        );
        expect(muya.getActiveComments()).toEqual(['a']);

        expect(muya.focusComment('a')).toBe(true);
        expect(muya.getActiveComments()).toEqual(['a']);
    });

    it('derives every active comment when ranges overlap at the cursor', () => {
        const muya = boot([
            'A <!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            `[MC:b]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(31, 31, true);

        expect(muya.getActiveComments()).toEqual(['a', 'b']);
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

describe('muya.getComments() resilience', () => {
    it('degrades to empty comments when derivation throws instead of breaking the pipeline', () => {
        const muya = boot('A <!--MC:a-->reviewed<!--MC:~a--> line.\n');
        (muya as unknown as { editor: { jsonState: { getState: () => unknown } } })
            .editor.jsonState.getState = () => {
            throw new Error('boom');
        };

        expect(muya.getComments()).toEqual({ threads: [], ranges: [], diagnostics: [] });
    });
});

describe('muya.focusComment() range-less navigation', () => {
    it('navigates to the metadata definition for a comment id with no derived range', () => {
        const muya = boot([
            'Text with no marker.',
            '',
            `[MC:orphan]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        // orphan metadata: a definition with no marker, so there is no range.
        expect(muya.getComments().ranges.some(range => range.id === 'orphan')).toBe(false);
        // The click still navigates instead of silently doing nothing.
        expect(muya.focusComment('orphan')).toBe(true);
        expect(muya.focusComment('nonexistent')).toBe(false);
    });
});
