// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCommentMetadataInMarkdown } from '../comments';
import { Muya } from '../muya';
import { MarkdownToState } from '../state/markdownToState';

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

    it('preserves resolved zero-reply comment syntax through source-mode replacement', () => {
        const original = 'Before source mode.\n';
        const metadataUri = metadata({
            version: 1,
            status: 'resolved',
            authors: ['Ada'],
            replies: [],
        });
        const nextMarkdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> persisted span.',
            '',
            `[MC:a]: ${metadataUri}`,
            '',
        ].join('\n');
        const muya = boot(original);

        expect(muya.replaceContent(nextMarkdown)).toBe(true);

        expect(muya.getMarkdown()).toBe(nextMarkdown);
        expect(muya.getComments().threads).toMatchObject([
            {
                id: 'a',
                status: 'resolved',
                replies: [],
            },
        ]);
    });
});

describe('muya.addComment()', () => {
    it('exposes the same commentability decision used by addComment', () => {
        const muya = boot('A reviewed span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(2, 10, true);
        expect(muya.canAddComment()).toBe(true);

        leaf.setCursor(2, 2, true);
        expect(muya.canAddComment()).toBe(false);
    });

    it('rejects whitespace-only selections', () => {
        const muya = boot('A   span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor(1, 4, true);

        expect(muya.canAddComment({ id: 'whitespace_only' })).toBe(false);
        expect(muya.addComment({ id: 'whitespace_only' })).toBeNull();
    });

    it('reports marker-overlap selections as not commentable', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.setCursor('A <!--'.length, 'A <!--MC:a-->reviewed'.length, true);

        expect(muya.canAddComment({ id: 'bad_marker_overlap' })).toBe(false);
        expect(muya.addComment({ id: 'bad_marker_overlap' })).toBeNull();
    });

    it('wraps a same-leaf selection, appends metadata, and records one undo boundary', () => {
        const muya = boot('A reviewed span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.setCursor(2, 10, true);

        expect(muya.addComment({
            id: 'cmt_test',
            author: 'Ada',
            body: 'Please check this.',
            createdAt: '2026-06-30T12:00:00.000Z',
        })).toBe('cmt_test');

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
        expect(muya.addComment({ id: 'new_comment' })).toBeNull();

        leaf.setCursor(2, 10, true);
        expect(muya.addComment({ id: 'existing' })).toBeNull();
    });

    it('rejects invalid IDs and code-like selections', () => {
        const invalidId = boot('A reviewed span.\n');
        const invalidLeaf = invalidId.editor.scrollPage!.firstContentInDescendant() as Content;
        invalidLeaf.setCursor(2, 10, true);

        expect(invalidId.addComment({ id: 'bad.id' })).toBeNull();
        expect(invalidId.getMarkdown()).toBe('A reviewed span.\n');

        const code = boot('```js\nconst a = 1\n```\n');
        const codeLeaf = code.editor.scrollPage!.lastContentInDescendant() as Content;
        codeLeaf.setCursor(0, 5, true);

        expect(code.addComment({ id: 'code_comment' })).toBeNull();
        expect(code.getMarkdown()).not.toContain('<!--MC:code_comment-->');
    });

    it('rejects selections inside inline code without appending orphan metadata', () => {
        const muya = boot('A `reviewed` span.\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.setCursor(3, 11, true);

        expect(muya.addComment({ id: 'inline_code_comment' })).toBeNull();
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
        expect(muya.addComment({ id: 'cmt_1' })).toBeNull();

        expect(muya.addComment()).toBeTruthy();
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

        expect(muya.addComment({ id: 'bad_marker_overlap' })).toBeNull();
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
        })).toBe('cross_leaf');

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

        expect(muya.addComment({ id: 'cross_inline_code' })).toBeNull();
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

    it('does not parse and export the whole document when no source metadata update is possible', () => {
        const generate = vi.spyOn(MarkdownToState.prototype, 'generate');
        const document = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            '[MC:a]: data:application/json;base64,not-base64-json',
            '',
        ].join('\n');

        expect(() => updateCommentMetadataInMarkdown(
            document,
            'a',
            current => ({ ...current, status: 'resolved' }),
        )).toThrow(/corrupt/);
        expect(generate).not.toHaveBeenCalled();
    });

    it('edits a definition whose base64 payload contains internal whitespace', () => {
        // Forgiving-base64 (atob) ignores ASCII whitespace, so the parser
        // surfaces this thread; the edit-line matcher must accept it too or the
        // visible thread would be silently un-editable.
        const raw = metadata({ version: 1, status: 'open', replies: [] });
        // Splice a space into the base64 payload tail.
        const mid = Math.floor((raw.length + 'data:application/json;base64,'.length) / 2);
        const withSpace = `${raw.slice(0, mid)} ${raw.slice(mid)}`;
        const document = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${withSpace}`,
            '',
        ].join('\n');

        const next = updateCommentMetadataInMarkdown(
            document,
            'a',
            current => ({ ...current, status: 'resolved', updatedAt: '2026-06-30T15:00:00.000Z' }),
        );

        expect(next).not.toBeNull();
        const line = next!.split('\n').find(l => l.startsWith('[MC:a]: '))!;
        expect(decode(line.replace('[MC:a]: ', '')).status).toBe('resolved');
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

    it('removes a comment thread without deleting the reviewed text', () => {
        const original = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');
        const muya = boot(original);

        expect(muya.removeComment('a')).toBe(true);

        expect(muya.getMarkdown()).toBe('A reviewed span.\n');
        expect(muya.getComments()).toEqual({
            diagnostics: [],
            ranges: [],
            threads: [],
        });

        muya.undo();
        expect(muya.getMarkdown()).toBe(original);
    });

    it('preserves valid open zero-reply comment threads across content replacement', () => {
        const original = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');
        const muya = boot('Before source handoff.\n');

        expect(muya.replaceContent(original)).toBe(true);

        expect(muya.getMarkdown()).toBe(original);
        expect(muya.getComments().threads).toEqual([
            expect.objectContaining({
                id: 'a',
                status: 'open',
                replies: [],
            }),
        ]);
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
        expect(muya.addComment({ id: 'event_comment' })).toBe('event_comment');

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
    it('surfaces a parser diagnostic when derivation throws instead of hiding the review layer', () => {
        const muya = boot('A <!--MC:a-->reviewed<!--MC:~a--> line.\n');
        const jsonState = (muya as unknown as { editor: { jsonState: { peekState: () => unknown } } })
            .editor
            .jsonState;
        jsonState.peekState = () => {
            throw new Error('boom');
        };

        expect(muya.getComments()).toEqual({
            threads: [],
            ranges: [],
            diagnostics: [
                {
                    code: 'parse-error',
                    id: '__parser__',
                    message: 'muya.getComments failed: boom',
                },
            ],
        });
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

    it('places the selection on the located syntax, not just scrolls', () => {
        const muya = boot([
            'Text with an orphan <!--MC:~o--> close marker.',
            '',
        ].join('\n'));

        // Orphan close marker: diagnostic, no derived range → fallback path.
        expect(muya.getComments().ranges.some(range => range.id === 'o')).toBe(false);
        expect(muya.focusComment('o')).toBe(true);

        // The fallback must actually select the marker (a content-leaf cursor),
        // which requires the located path to end in 'text'.
        const selection = muya.editor.selection.getSelection();
        expect(selection).not.toBeNull();
        expect(selection!.isCollapsed).toBe(false);
        const marker = '<!--MC:~o-->';
        const start = 'Text with an orphan '.length;
        expect(selection!.anchor.offset).toBe(start);
        expect(selection!.focus.offset).toBe(start + marker.length);
    });
});

describe('comment mutations flush rAF-batched edits (#2938 lost-edit class)', () => {
    it('a keystroke edit still pending its animation-frame flush survives resolveComment', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        // Queue a text op exactly like a keystroke does: the Content.text
        // setter batches it for the next animation frame.
        leaf.text = `${leaf.text} EDITED`;

        expect(muya.resolveComment('a')).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).toContain('EDITED');
        const definition = /\[MC:a\]: (\S+)/.exec(markdown);
        expect(definition).not.toBeNull();
        expect(decode(definition![1]).status).toBe('resolved');
    });

    it('a pending edit survives removeComment and addComment snapshots', () => {
        const muya = boot([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = `${leaf.text} EDITED`;

        expect(muya.removeComment('a')).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).toContain('EDITED');
        expect(markdown).not.toContain('MC:a');
    });
});

// Container-context mutation soundness: the byte index used by removeComment
// and metadata updates must agree with the parser about container-nested
// syntax, or first-class flows silently corrupt documents (stranded hidden
// markers, byte deletion inside quoted fences, refused healthy threads).
describe('muya comment mutations in container context', () => {
    const META = metadata({ version: 1, status: 'open', replies: [] });

    it('removeComment on a loose-list continuation removes markers AND metadata', () => {
        const muya = boot(`- item\n\n    text <!--MC:a-->hello<!--MC:~a--> tail\n\n[MC:a]: ${META}\n`);

        expect(muya.removeComment('a')).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).not.toContain('MC:a');
        expect(markdown).toContain('text hello tail');
    });

    it('removeComment never deletes marker-shaped bytes inside a blockquoted fence', () => {
        const muya = boot([
            '> ```',
            '> <!--MC:a-->literal<!--MC:~a-->',
            '> ```',
            '',
            'live <!--MC:a-->y<!--MC:~a-->',
            '',
            `[MC:a]: ${META}`,
            '',
        ].join('\n'));

        expect(muya.removeComment('a')).toBe(true);

        const markdown = muya.getMarkdown();
        // The live markers and the definition are gone; the quoted fence's
        // literal marker bytes are untouched.
        expect(markdown).toContain('> <!--MC:a-->literal<!--MC:~a-->');
        expect(markdown).toContain('live y');
        expect(markdown).not.toContain(`[MC:a]:`);
    });

    it('resolves a thread whose definition lives inside a blockquote', () => {
        const muya = boot(`<!--MC:a-->x<!--MC:~a-->\n\n> [MC:a]: ${META}\n`);

        expect(muya.resolveComment('a')).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).toMatch(/^> \[MC:a\]: data:application\/json;base64,/mu);
        expect(muya.getComments().threads[0]).toMatchObject({ id: 'a', status: 'resolved' });
    });
});

describe('addComment guard — nested inline code', () => {
    it('rejects a selection inside inline code nested under emphasis', () => {
        const muya = boot('plain *em `co de` em* tail\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const start = 'plain *em `'.length;
        muya.editor.selection.setSelection(
            { offset: start, block: first, path: first.path },
            { offset: start + 'co d'.length, block: first, path: first.path },
        );

        expect(muya.canAddComment({ id: 'nested_code' })).toBe(false);
        expect(muya.addComment({ id: 'nested_code' })).toBeNull();
        expect(muya.getMarkdown()).toBe('plain *em `co de` em* tail\n');
    });

    it('rejects a selection inside inline code nested under a link label', () => {
        const muya = boot('see [a `code` label](https://example.com) end\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const start = 'see [a `'.length;
        muya.editor.selection.setSelection(
            { offset: start, block: first, path: first.path },
            { offset: start + 'cod'.length, block: first, path: first.path },
        );

        expect(muya.addComment({ id: 'nested_link_code' })).toBeNull();
    });
});

describe('addComment across astral-plane text', () => {
    it('wraps a selection beginning after emoji without splitting surrogate pairs', () => {
        const muya = boot('🚀 launch the 😀 rocket now\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const start = '🚀 launch the 😀 '.length;
        const end = start + 'rocket'.length;
        muya.editor.selection.setSelection(
            { offset: start, block: first, path: first.path },
            { offset: end, block: first, path: first.path },
        );

        expect(muya.addComment({ id: 'astral' })).toBe('astral');

        const markdown = muya.getMarkdown();
        expect(markdown).toContain('🚀 launch the 😀 <!--MC:astral-->rocket<!--MC:~astral--> now');
        // The whole document is still well-formed UTF-16 (encoding round-trips).
        expect(new TextDecoder().decode(new TextEncoder().encode(markdown))).toBe(markdown);
        expect(muya.getComments().ranges[0].preview).toBe('rocket');
    });
});
