// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Selection on the engine.
 *
 * The caret is a document position, not a DOM position. Keeping it in model
 * offsets means an edit elsewhere cannot leave the caret pointing at stale DOM,
 * and it is what lets the engine place the caret correctly after re-rendering
 * from a new revision.
 *
 * It also decides a CriticMarkup question the DOM cannot answer on its own: at
 * the boundary of a tracked change the same visual spot is two document
 * positions, and which one the caret takes determines whether typing extends the
 * change or the text beside it.
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
      subscriptAndSuperscript: true
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('selection', () => {
    it('reports the caret as a model offset', async () => {
        const { view } = await mount('Hello world.\n');
        expect(view.getSelection()).toEqual({ start: 0, end: 0 });
    });

    it('moves the caret to a model offset', async () => {
        // The engine owns the position: session.select validates it, and the
        // view keeps no caret of its own.
        const { view } = await mount('Hello world.\n');
        view.setCursorByOffset(5);
        expect(view.getSelection()).toEqual({ start: 5, end: 5 });
    });

    it('refuses an offset outside the document', async () => {
        // Clamping would put the caret somewhere the caller did not ask for and
        // hide whatever produced the bad offset.
        const { view } = await mount('abc\n');
        expect(() => view.setCursorByOffset(99)).toThrow();
        expect(() => view.setCursorByOffset(-1)).toThrow();
    });

    it('types where the caret was placed', async () => {
        const { view } = await mount('Hello world.\n');
        view.setCursorByOffset(5);
        await view.typeText(view.getSelection().start, ' there');
        expect(await view.getMarkdown()).toBe('Hello there world.\n');
    });

    it('places the caret where an edit left it', async () => {
        const { view } = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        // The caret follows the inserted text, so the next keystroke continues
        // where the user was typing rather than jumping back.
        expect(view.getSelection().start).toBe(11);
    });

    it('tracks focus of the mounted element', async () => {
        const { host, view } = await mount('abc\n');
        expect(view.hasFocus()).toBe(false);
        host.setAttribute('tabindex', '0');
        host.focus();
        expect(view.hasFocus()).toBe(true);
        view.blur();
        expect(view.hasFocus()).toBe(false);
    });

    it('publishes one immutable parser-derived selection context', async () => {
        const { view } = await mount([
            '---',
            'title: Selection',
            '---',
            '',
            '- **one**',
            '  - [x] two',
            '',
        ].join('\n'));
        const source = view.getMarkdownSync();
        const start = source.indexOf('two');
        view.setSelection(start, start + 3);

        expect(view.getSelectionContext()).toEqual({
            anchor: {
                offset: start,
                path: [
                    expect.objectContaining({ kind: 'list' }),
                    expect.objectContaining({ kind: 'list-item' }),
                    expect.objectContaining({ kind: 'list' }),
                    expect.objectContaining({ kind: 'list-item' }),
                    expect.objectContaining({ kind: 'paragraph' }),
                    expect.objectContaining({ kind: 'text' }),
                ],
            },
            focus: {
                offset: start + 3,
                path: [
                    expect.objectContaining({ kind: 'list' }),
                    expect.objectContaining({ kind: 'list-item' }),
                    expect.objectContaining({ kind: 'list' }),
                    expect.objectContaining({ kind: 'list-item' }),
                    expect.objectContaining({ kind: 'paragraph' }),
                    expect.objectContaining({ kind: 'text' }),
                ],
            },
            selectedText: 'two',
            activeInlineFormats: [],
            blockPath: [
                expect.objectContaining({ kind: 'list' }),
                expect.objectContaining({ kind: 'list-item' }),
                expect.objectContaining({ kind: 'list' }),
                expect.objectContaining({ kind: 'list-item' }),
                expect.objectContaining({ kind: 'paragraph' }),
                expect.objectContaining({ kind: 'text' }),
            ],
            flags: {
                hasFrontMatter: true,
                isMultiblock: false,
                isCodeLike: false,
                isCodeBlock: false,
                isTable: false,
                isList: true,
                isTaskList: true,
                isLooseList: false,
            },
            cursor: {
                x: expect.any(Number),
                y: expect.any(Number),
            },
        });

        expect(Object.isFrozen(view.getSelectionContext())).toBe(true);
        expect(Object.isFrozen(view.getSelectionContext().anchor.path)).toBe(true);
    });

    it('subscribes to browser selections as parser-derived contexts', async () => {
        const { host, view } = await mount('a **bold** word\n');
        const seen: unknown[] = [];
        view.subscribeSelection(context => seen.push(context));
        const text = host.querySelector('strong')?.textContent;
        const node = host.querySelector('strong .document-view-run')?.firstChild;
        expect(text).toBe('bold');
        expect(node).toBeInstanceOf(Text);
        if (!(node instanceof Text))
            throw new TypeError('Expected the strong text carrier');

        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, node.data.length);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        await view.settled();

        expect(seen.at(-1)).toEqual(expect.objectContaining({
            selectedText: 'bold',
            activeInlineFormats: ['strong'],
        }));
    });
});

describe('deleting text', () => {
    it('removes a range and leaves the caret where it began', async () => {
        const { view } = await mount('Hello brave world.\n');
        await view.deleteRange(5, 11);
        expect(view.modelText()).toBe('Hello world.\n');
        expect(view.getSelection().start).toBe(5);
    });

    it('re-renders the document after a delete', async () => {
        const { host, view } = await mount('Hello brave world.\n');
        await view.deleteRange(5, 11);
        expect(host.textContent).toBe('Hello world.');
    });

    it('leaves a tracked change intact when deleting beside it', async () => {
        const { host, view } = await mount('Oh, Hello {++world++}.\n');
        await view.deleteRange(0, 4);
        expect(host.querySelector('ins')?.textContent).toBe('world');
        expect(await view.getMarkdown()).toBe('Hello {++world++}.\n');
    });
});
