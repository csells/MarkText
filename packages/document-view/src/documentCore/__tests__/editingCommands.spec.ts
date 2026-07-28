// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import {
    createDocumentSearchQuery,
    createSourceSnapshot,
} from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Editing commands the editor issues on top of typing and deleting.
 *
 * Each is expressed as engine intents rather than DOM manipulation, so they
 * commit revisions, undo as one step, and keep the exact source authoritative.
 * They only became implementable once the engine could delete: replacing a word
 * is a removal and an insertion, and there was no way to remove.
 */

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: false,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('editing commands', () => {
    it('selects the whole document', async () => {
        const { view } = await mount('Hello world.\n');
        view.selectAll();
        expect(view.getSelection()).toEqual({
            start: 0,
            end: view.modelText().length,
        });
    });

    it('replaces the selection when text is typed over it', async () => {
        const { view } = await mount('Hello brave world.\n');
        await view.replaceRange(6, 12, 'kind ');
        expect(await view.getMarkdown()).toBe('Hello kind world.\n');
    });

    it('undoes a replacement as one step', async () => {
        // One user gesture, one undo: the engine replaces a range in a single
        // edit, so reversing it does not take two.
        const { view } = await mount('Hello brave world.\n');
        await view.replaceRange(6, 12, 'kind ');
        await view.undo();
        expect(await view.getMarkdown()).toBe('Hello brave world.\n');
    });

    it('redoes the exact committed replacement', async () => {
        const { view } = await mount('Hello brave world.\n');
        await view.replaceRange(6, 12, 'kind ');
        await view.undo();
        await view.redo();
        expect(await view.getMarkdown()).toBe('Hello kind world.\n');
    });

    it('commits a source-surface gesture as one undoable history entry', async () => {
        const { view } = await mount('{++before++}\r\n');
        await view.editSource(
            0,
            '{++before++}'.length,
            '{--after--}',
            {
                anchor: { offset: '{--after--}'.length, affinity: 'next' },
                focus: { offset: '{--after--}'.length, affinity: 'next' },
            },
        );
        expect(await view.getMarkdown()).toBe('{--after--}\r\n');
        await view.undo();
        expect(await view.getMarkdown()).toBe('{++before++}\r\n');
    });

    it('inserts a paragraph through the semantic block command', async () => {
        const source = 'one two\n';
        const { view } = await mount(source);
        view.setCursorByOffset(3);
        await view.executeCommand({
            kind: 'insert-paragraph',
            location: 'after',
        });
        expect(await view.getMarkdown()).toBe('one two\n\n');
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });

    it('pastes plain text through paste policy with Track Changes and one undo', async () => {
        const source = 'Hello .\n';
        const { view } = await mount(source);
        view.setCursorByOffset(6);
        await view.settled();
        await view.dispatchIntent({
            kind: 'set-track-changes',
            enabled: true,
        });
        await view.executeCommand({
            kind: 'paste-text',
            text: 'world',
            source: 'external-text',
        });
        expect(await view.getMarkdown()).toBe('Hello {++world++}.\n');
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });

    it('replaces the word around an offset', async () => {
        const { view } = await mount('say helo world\n');
        await view.replaceWordAt(8, 'hello');
        expect(await view.getMarkdown()).toBe('say hello world\n');
    });

    it('finds every match as model ranges', async () => {
        const { view } = await mount('one two one three one\n');
        expect(view.search(createDocumentSearchQuery('one'))).toEqual([
            { start: 0, end: 3 },
            { start: 8, end: 11 },
            { start: 18, end: 21 },
        ]);
    });

    it('uses the closed case, whole-word, and regexp query options', async () => {
        const { view } = await mount(
            'Apple apple cat category apricot\n',
        );

        expect(view.search(createDocumentSearchQuery('apple'))).toHaveLength(2);
        expect(view.search(createDocumentSearchQuery('apple', {
            caseSensitive: true,
        }))).toHaveLength(1);
        expect(view.search(createDocumentSearchQuery('cat', {
            wholeWord: true,
        }))).toHaveLength(1);
        expect(view.search(createDocumentSearchQuery('ap(ple|ricot)', {
            syntax: 'regexp',
        }))).toHaveLength(3);
    });

    it('searches what the reader sees, not the markers', async () => {
        // The reader sees 'a new b'; the source says 'a{++new++}b'. Searching
        // the source would match marker text the user cannot see and miss text
        // they can.
        const { view } = await mount('a {++new++} b\n');
        expect(view.search(createDocumentSearchQuery('new'))).toEqual([
            { start: 2, end: 5 },
        ]);
        expect(view.search(createDocumentSearchQuery('++'))).toEqual([]);
    });

    it('settles one atomic replace-all revision before returning matches', async () => {
        const source = 'one two one three one\n';
        const { view } = await mount(source);

        const matches = await view.replaceCurrentMatches(
            createDocumentSearchQuery('one'),
            'many',
        );

        expect(matches).toEqual([]);
        expect(await view.getMarkdown()).toBe('many two many three many\n');
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });

    it('searches and atomically replaces reader-visible text across inline nodes', async () => {
        const source = '**o**ne and o**ne**\n';
        const { view } = await mount(source);

        expect(view.search(createDocumentSearchQuery('one'))).toEqual([
            { start: 2, end: 7 },
            { start: 12, end: 17 },
        ]);
        await view.replaceCurrentMatches(
            createDocumentSearchQuery('one'),
            'many',
        );

        expect(await view.getMarkdown()).toBe('**many** and many\n');
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });

    it('mounts Original and Revised as read-only parser-owned views', async () => {
        const source = 'A {++new++} {--old--} {~~before~>after~~}\n';
        const { host, view } = await mount(source);
        view.setSelection(2, 5);

        await view.setProjection('original');
        expect(host.textContent).toBe('A  old before');
        expect(host.getAttribute('contenteditable')).toBe('false');
        expect(await view.getMarkdown()).toBe(source);
        await expect(view.typeText(0, 'x')).rejects.toThrow(
            /read-only-projection/,
        );

        await view.setProjection('revised');
        expect(host.textContent).toBe('A new  after');

        await view.setProjection('marked');
        expect(view.getSelection()).toEqual({ start: 2, end: 5 });
        expect(host.getAttribute('contenteditable')).toBe('true');
    });
});
