// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

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
    liveHtmlSafetyProfile: 'live-html-safety-profile-1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
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
            end: 'Hello world.\n'.length,
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

    it('inserts a paragraph break', async () => {
        const { host, view } = await mount('one two\n');
        await view.insertParagraph(3);
        expect([...host.children].map(child => child.tagName)).toEqual([
            'P',
            'P',
        ]);
        expect(await view.getMarkdown()).toBe('one\n\n two\n');
    });

    it('pastes plain text at the caret', async () => {
        const { view } = await mount('Hello .\n');
        await view.pasteAsPlainText(6, 'world');
        expect(await view.getMarkdown()).toBe('Hello world.\n');
    });

    it('replaces the word around an offset', async () => {
        const { view } = await mount('say helo world\n');
        await view.replaceWordAt(8, 'hello');
        expect(await view.getMarkdown()).toBe('say hello world\n');
    });

    it('finds every match as model ranges', async () => {
        const { view } = await mount('one two one three one\n');
        expect(view.search('one')).toEqual([
            { start: 0, end: 3 },
            { start: 8, end: 11 },
            { start: 18, end: 21 },
        ]);
    });

    it('searches what the reader sees, not the markers', async () => {
        // The reader sees 'a new b'; the source says 'a{++new++}b'. Searching
        // the source would match marker text the user cannot see and miss text
        // they can.
        const { view } = await mount('a {++new++} b\n');
        expect(view.search('new')).toEqual([{ start: 2, end: 5 }]);
        expect(view.search('++')).toEqual([]);
    });
});
