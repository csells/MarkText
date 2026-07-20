// @vitest-environment happy-dom

import type Content from '../block/base/content';
import type Parent from '../block/base/parent';
import type { ITableState, TState } from '../state/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import { isTableState } from '../state/types';

// Coverage for the programmatic editing API added for the muyajs ->
// @muyajs/core desktop migration: createTable / insertImage / setCursor.
// These complete the block-editing surface the desktop drives (table insert,
// image insert from the image tool, and programmatic cursor placement).
//
// Tree/text mutations dispatch json1 ops that flush to the document state on
// the next animation frame (see JSONState._emitStateChange), so assertions on
// getState()/getMarkdown() are wrapped in vi.waitFor to await that flush.

const bootedMuyas: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedMuyas.push(muya);
    return muya;
}

// Place a collapsed caret on the first content block (and mark it active so the
// block-level ops resolve their target the same way the editor does after a
// click).
function placeCursorOnFirstBlock(muya: Muya, offset = 0): Content {
    const first = muya.editor.scrollPage!.firstContentInDescendant()!;
    first.setCursor(offset, offset, true);
    muya.editor.activeContentBlock = first;
    return first;
}

function firstBlock(muya: Muya): TState {
    return muya.getState()[0];
}

function firstTable(muya: Muya): ITableState {
    const b = firstBlock(muya);
    if (!isTableState(b))
        throw new Error(`expected a table, got ${b.name}`);
    return b;
}

function contentByText(muya: Muya, text: string): Content {
    let target: Content | null = null;
    muya.editor.scrollPage!.breadthFirstTraverse((block) => {
        if (block.isContent() && block.text === text)
            target = block;
    });
    if (!target)
        throw new TypeError(`Expected a content block containing ${text}.`);
    return target;
}

function expectNativeCaretOutsideHiddenCriticMarkup(): void {
    const selection = document.getSelection();
    if (!selection?.anchorNode || !selection.focusNode)
        throw new TypeError('Expected a native caret.');
    const hiddenSelector = [
        '.mu-critic-comment',
        '.mu-critic-comment .mu-hide',
        '.mu-critic-comment .mu-critic-marker',
        '.mu-critic-comment .mu-critic-comment-text',
        '[hidden][data-critic-type~="comment"]',
    ].join(', ');
    const hiddenAncestor = (node: Node) => {
        const element = node.nodeType === Node.ELEMENT_NODE
            ? node as Element
            : node.parentElement;
        return element?.closest(hiddenSelector) ?? null;
    };

    expect(hiddenAncestor(selection.anchorNode)).toBeNull();
    expect(hiddenAncestor(selection.focusNode)).toBeNull();
}

describe('muya.createTable()', () => {
    it('replaces the current block with a table of the requested dimensions', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        muya.createTable({ rows: 3, columns: 4 });
        await vi.waitFor(() => {
            const b = firstTable(muya);
            expect(b.children.length).toBe(3); // rows (header + 2 body)
            expect(b.children.every(row => row.children.length === 4)).toBe(true); // columns
        });
    });

    it('builds empty cells with align none', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        muya.createTable({ rows: 2, columns: 2 });
        await vi.waitFor(() => {
            const cells = firstTable(muya).children.flatMap(row => row.children);
            expect(cells.every(c => c.name === 'table.cell')).toBe(true);
            expect(cells.every(c => c.text === '')).toBe(true);
            expect(cells.every(c => c.meta.align === 'none')).toBe(true);
        });
    });

    it('places the cursor in the first cell of the new table', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        muya.createTable({ rows: 2, columns: 2 });
        await vi.waitFor(() => {
            expect(firstBlock(muya).name).toBe('table');
        });
        const sel = muya.editor.selection.getSelection();
        expect(sel).not.toBeNull();
        expect(sel!.anchor.block.blockName).toBe('table.cell.content');
    });

    it('is a no-op when there is no current block', () => {
        const muya = bootMuya('hello\n');
        muya.editor.activeContentBlock = null;
        muya.editor.selection.clear();
        expect(() => muya.createTable({ rows: 2, columns: 2 })).not.toThrow();
        expect(firstBlock(muya).name).toBe('paragraph');
    });

    it('clamps zero/negative dimensions to a valid table (rows >= 2, columns >= 1)', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        // rows = 0 would otherwise build a table with no rows and crash
        // `Table.columnCount` (which reads `firstChild.firstChild`).
        expect(() => muya.createTable({ rows: 0, columns: 0 })).not.toThrow();
        await vi.waitFor(() => {
            const b = firstTable(muya);
            expect(b.children.length).toBe(2); // header + one body row
            expect(b.children.every(row => row.children.length === 1)).toBe(true);
        });
    });

    it('coerces non-finite / fractional dimensions to integers', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        expect(() =>
            muya.createTable({ rows: Number.NaN, columns: Number.POSITIVE_INFINITY }),
        ).not.toThrow();
        await vi.waitFor(() => {
            const b = firstTable(muya);
            // NaN -> clamped to 2 rows; Infinity column count is not finite so it
            // also normalises to the minimum of 1 column rather than allocating
            // an array of non-integer length.
            expect(b.children.length).toBe(2);
            expect(b.children.every(row => row.children.length === 1)).toBe(true);
        });
    });

    it('floors fractional dimensions instead of building a ragged table', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya);
        muya.createTable({ rows: 3.9, columns: 2.9 });
        await vi.waitFor(() => {
            const b = firstTable(muya);
            expect(b.children.length).toBe(3); // floor(3.9)
            expect(b.children.every(row => row.children.length === 2)).toBe(true); // floor(2.9)
        });
    });

    it('inserts the table BELOW a non-empty heading instead of replacing it', async () => {
        const muya = bootMuya('# Title\n');
        placeCursorOnFirstBlock(muya, 4); // caret inside the heading text
        muya.createTable({ rows: 2, columns: 2 });
        await vi.waitFor(() => {
            const s = muya.getState();
            expect(s.length).toBe(2);
            expect(s[0].name).toBe('atx-heading'); // heading kept
            expect(s[1].name).toBe('table'); // table directly below
        });
        // the new table gets focus (caret in its first cell)
        const sel = muya.editor.selection.getSelection();
        expect(sel!.anchor.block.blockName).toBe('table.cell.content');
    });

    it('inserts the table BELOW a non-empty paragraph instead of replacing it', async () => {
        const muya = bootMuya('hello\n');
        placeCursorOnFirstBlock(muya, 5);
        muya.createTable({ rows: 2, columns: 2 });
        await vi.waitFor(() => {
            const s = muya.getState();
            expect(s.length).toBe(2);
            expect(s[0].name).toBe('paragraph');
            expect((s[0] as { text: string }).text).toBe('hello');
            expect(s[1].name).toBe('table');
        });
    });

    it('replaces a non-empty block in place when { replace: true } (grid picker path)', async () => {
        const muya = bootMuya('/table\n'); // a non-empty quick-insert trigger line
        placeCursorOnFirstBlock(muya, 6);
        muya.createTable({ rows: 2, columns: 2 }, { replace: true });
        await vi.waitFor(() => {
            const s = muya.getState();
            expect(s.length).toBe(1); // trigger consumed, not left behind
            expect(s[0].name).toBe('table');
        });
    });

    it('inserts the table right after the paragraph INSIDE a list item, not after the list', async () => {
        const muya = bootMuya('- item text\n');
        placeCursorOnFirstBlock(muya, 4);
        muya.createTable({ rows: 2, columns: 2 });
        await vi.waitFor(() => {
            const s = muya.getState();
            // a single top-level bullet-list — the table did NOT land after it
            expect(s.length).toBe(1);
            expect(s[0].name).toBe('bullet-list');
            const item = (s[0] as { children: { children: { name: string }[] }[] }).children[0];
            expect(item.children.map(c => c.name)).toEqual(['paragraph', 'table']);
        });
        // the nested table still serializes without throwing
        expect(() => muya.getMarkdown()).not.toThrow();
    });
});

describe('muya.insertImage()', () => {
    it('inserts an inline image at the cursor', async () => {
        const muya = bootMuya('hello\n');
        placeCursorOnFirstBlock(muya, 5); // caret at end of "hello"
        muya.insertImage({ src: 'https://example.com/cat.png' });
        await vi.waitFor(() => {
            const md = muya.getMarkdown();
            expect(md).toContain('https://example.com/cat.png');
            expect(md).toContain('![');
        });
    });

    it('derives alt text from the file name when none is given', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya, 0);
        muya.insertImage({ src: '/tmp/photos/sunset.jpg' });
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('![sunset](');
        });
    });

    it('uses the provided alt text', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya, 0);
        muya.insertImage({ src: 'https://example.com/x.png', alt: 'My Pic' });
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('![My Pic](https://example.com/x.png)');
        });
    });

    it('percent-encodes spaces in local paths', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya, 0);
        muya.insertImage({ src: '/my photos/a b.png', alt: 'pic' });
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('/my%20photos/a%20b.png');
        });
    });

    it('is a no-op when there is no active formattable block', () => {
        const muya = bootMuya('hello\n');
        muya.editor.activeContentBlock = null;
        muya.editor.selection.clear();
        expect(() => muya.insertImage({ src: 'https://example.com/x.png' })).not.toThrow();
        expect(muya.getMarkdown()).not.toContain('![');
    });

    it('embeds a well-formed base64 data URL verbatim', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya, 0);
        const dataUrl
            = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        muya.insertImage({ src: dataUrl, alt: 'dot' });
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain(`![dot](${dataUrl})`);
        });
    });

    it('does not embed a malformed data: src verbatim (aligns with strict DATA_URL_REG)', async () => {
        const muya = bootMuya('\n');
        placeCursorOnFirstBlock(muya, 0);
        // `data:image/` prefix with no comma/payload — the old loose
        // `^data:image/` check would have embedded it verbatim. It must instead
        // fall through to the plain-path branch (spaces and '#' percent-encoded).
        const malformed = 'data:image/png not-a-real#payload';
        muya.insertImage({ src: malformed, alt: 'bad' });
        await vi.waitFor(() => {
            const md = muya.getMarkdown();
            // Treated as a plain path: spaces and '#' are percent-encoded, so the
            // raw malformed string is not present verbatim.
            expect(md).not.toContain(`(${malformed})`);
            expect(md).toContain('data:image/png%20not-a-real%23payload');
        });
    });
});

describe('muya.setCursor()', () => {
    it('positions the caret in the same block (anchor/focus/path shape)', async () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        muya.setCursor({
            anchor: { offset: 3 },
            focus: { offset: 3 },
            anchorPath: first.path,
            focusPath: first.path,
        });
        await vi.waitFor(() => {
            const sel = muya.editor.selection.getSelection();
            expect(sel).not.toBeNull();
            expect(sel!.anchor.block).toBe(first);
            expect(sel!.anchor.offset).toBe(3);
        });
    });

    it('accepts the start/end/path shape', async () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        muya.setCursor({
            start: { offset: 2 },
            end: { offset: 2 },
            path: first.path,
        });
        await vi.waitFor(() => {
            const sel = muya.editor.selection.getSelection();
            expect(sel!.anchor.block).toBe(first);
            expect(sel!.anchor.offset).toBe(2);
        });
    });

    it('keeps a restored caret out of a hidden CriticMarkup comment', async () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        // Offset 11 is inside the hidden comment body. The nearest visible
        // insertion point is the comment's opening edge at offset 7.
        muya.setCursor({
            start: { offset: 11 },
            end: { offset: 11 },
            path: first.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.offset).toBe(7);
            expect(selection?.focus.offset).toBe(7);
        });
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('cancels input when a native caret is forced inside a hidden comment', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const selection = muya.editor.selection.getSelection();
        if (!selection)
            throw new TypeError('Expected an editor selection.');
        const getSelection = vi.spyOn(
            muya.editor.selection,
            'getSelection',
        ).mockReturnValue({
            ...selection,
            anchor: { offset: 11, block: first, path: first.path },
            focus: { offset: 11, block: first, path: first.path },
            isCollapsed: true,
            isSelectionInSameBlock: true,
        });

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertText',
        });
        const accepted = muya.domNode.dispatchEvent(event);
        getSelection.mockRestore();

        expect(accepted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('moves a real beforeinput caret out of hidden comment DOM before cancelling input', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        // Browser selectionchange is asynchronous relative to native editing.
        // Suppress happy-dom's synchronous notification while placing the
        // illegal caret so beforeinput itself must enforce the invariant.
        const normalize = vi.spyOn(
            muya.editor.selection,
            'normalizeHiddenCriticCommentCaret',
        ).mockReturnValue(false);
        selection.setBaseAndExtent(hiddenText, 3, hiddenText, 3);
        normalize.mockRestore();

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertText',
        });
        const accepted = muya.domNode.dispatchEvent(event);

        expect(accepted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('reseats an exact comment-marker boundary on selectionchange', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const closeMarker = muya.domNode.querySelectorAll(
            '.mu-critic-comment .mu-critic-marker',
        )[1]?.firstChild;
        if (!closeMarker)
            throw new TypeError('Expected a rendered comment close marker.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        selection.setBaseAndExtent(closeMarker, 3, closeMarker, 3);
        document.dispatchEvent(new Event('selectionchange'));

        expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(17);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('reseats an exact comment opener boundary on selectionchange', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const openMarker = muya.domNode.querySelector(
            '.mu-critic-comment .mu-critic-marker',
        )?.firstChild;
        if (!openMarker)
            throw new TypeError('Expected a rendered comment open marker.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        selection.setBaseAndExtent(openMarker, 0, openMarker, 0);
        document.dispatchEvent(new Event('selectionchange'));

        expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(7);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('reseats an element endpoint between hidden comment children', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const comment = muya.domNode.querySelector('.mu-critic-comment');
        if (!comment)
            throw new TypeError('Expected a rendered comment wrapper.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        selection.setBaseAndExtent(
            comment,
            comment.childNodes.length,
            comment,
            comment.childNodes.length,
        );
        document.dispatchEvent(new Event('selectionchange'));

        expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(17);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('cancels beforeinput and reseats an exact hidden comment-marker boundary', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const closeMarker = muya.domNode.querySelectorAll(
            '.mu-critic-comment .mu-critic-marker',
        )[1]?.firstChild;
        if (!closeMarker)
            throw new TypeError('Expected a rendered comment close marker.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        const normalize = vi.spyOn(
            muya.editor.selection,
            'normalizeHiddenCriticCommentCaret',
        ).mockReturnValue(false);
        selection.setBaseAndExtent(closeMarker, 3, closeMarker, 3);
        normalize.mockRestore();

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertText',
        });
        const accepted = muya.domNode.dispatchEvent(event);

        expect(accepted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('cancels beforeinput when a browser target range points into hidden comment DOM', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 0, true);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertReplacementText',
        });
        Object.defineProperty(event, 'getTargetRanges', {
            value: () => [{
                startContainer: hiddenText,
                startOffset: 0,
                endContainer: hiddenText,
                endOffset: 1,
                collapsed: false,
            }],
        });

        const accepted = muya.domNode.dispatchEvent(event);

        expect(accepted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('cancels a hidden browser target range even when the live selection is visible', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 2, true);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertReplacementText',
        });
        Object.defineProperty(event, 'getTargetRanges', {
            value: () => [{
                startContainer: hiddenText,
                startOffset: 0,
                endContainer: hiddenText,
                endOffset: 1,
                collapsed: false,
            }],
        });

        const accepted = muya.domNode.dispatchEvent(event);

        expect(accepted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('moves a native forward-navigation caret past a hidden comment', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');

        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        selection.setBaseAndExtent(hiddenText, 1, hiddenText, 1);

        const event = new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        });
        muya.domNode.dispatchEvent(event);

        const normalized = muya.editor.selection.getSelection();
        expect(normalized?.anchor.offset).toBe(17);
        expect(normalized?.focus.offset).toBe(17);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('moves a native backward-navigation caret before a hidden comment', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');

        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        selection.setBaseAndExtent(hiddenText, 3, hiddenText, 3);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowLeft',
        }));

        const normalized = muya.editor.selection.getSelection();
        expect(normalized?.anchor.offset).toBe(7);
        expect(normalized?.focus.offset).toBe(7);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('reconciles a browser selectionchange inside a hidden comment', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');

        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        selection.setBaseAndExtent(hiddenText, 1, hiddenText, 1);
        document.dispatchEvent(new Event('selectionchange'));

        const normalized = muya.editor.selection.getSelection();
        expect(normalized?.anchor.offset).toBe(7);
        expect(normalized?.focus.offset).toBe(7);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('falls forward to visible content when a leading structural comment has no previous owner', async () => {
        const markdown = '{>>COMMENT\n<<}\n\nVISIBLE\n';
        const muya = bootMuya(markdown);
        const hiddenComment = contentByText(muya, 'COMMENT');
        const visible = contentByText(muya, 'VISIBLE');

        muya.setCursor({
            start: { offset: 1 },
            end: { offset: 1 },
            path: hiddenComment.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.block).toBe(visible);
            expect(selection?.anchor.offset).toBe(0);
            expect(selection?.focus.block).toBe(visible);
        });
        expect(muya.editor.activeContentBlock).toBe(visible);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('falls backward to visible content when a trailing structural comment has no next owner', async () => {
        const markdown = 'VISIBLE\n\n{>>COMMENT\n<<}\n';
        const muya = bootMuya(markdown);
        const visible = contentByText(muya, 'VISIBLE');
        const hiddenComment = contentByText(muya, 'COMMENT');

        muya.setCursor({
            start: { offset: 6 },
            end: { offset: 6 },
            path: hiddenComment.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.block).toBe(visible);
            expect(selection?.anchor.offset).toBe(visible.text.length);
            expect(selection?.focus.block).toBe(visible);
        });
        expect(muya.editor.activeContentBlock).toBe(visible);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('leaves no caret inside a comment-only hidden structural document', () => {
        const markdown = '{>>COMMENT\n<<}\n';
        const muya = bootMuya(markdown);
        const hiddenComment = contentByText(muya, 'COMMENT');

        muya.setCursor({
            start: { offset: 3 },
            end: { offset: 3 },
            path: hiddenComment.path,
        });

        const nativeSelection = document.getSelection();
        const anchorElement = nativeSelection?.anchorNode?.nodeType === Node.ELEMENT_NODE
            ? nativeSelection.anchorNode as Element
            : nativeSelection?.anchorNode?.parentElement;
        expect(
            !nativeSelection?.anchorNode
            || !anchorElement?.closest('[hidden][data-critic-type~="comment"]'),
        ).toBe(true);
        expect(muya.editor.selection.getSelection()).toBeNull();
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('escapes a hidden comment at its document boundary across paragraphs', async () => {
        const markdown = 'a{>>b\n\nc<<}d\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        // Offset 4 is the hidden `b` in the first fragment. Its fragment ends
        // at the paragraph seam, but the semantic comment continues in the
        // next paragraph; the nearest visible position is before the opener.
        muya.setCursor({
            start: { offset: 4 },
            end: { offset: 4 },
            path: first.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.block).toBe(first);
            expect(selection?.anchor.offset).toBe(1);
            expect(selection?.focus.offset).toBe(1);
        });
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('escapes the outermost hidden comment when comments are nested', async () => {
        const markdown = 'a{>>outer {>>inner<<} tail<<}b\n';
        const muya = bootMuya(markdown);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.setCursor({
            start: { offset: 14 },
            end: { offset: 14 },
            path: first.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.offset).toBe(1);
            expect(selection?.focus.offset).toBe(1);
        });
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('keeps a restored caret out of a hidden structural comment carrier', async () => {
        const markdown = [
            '- parent',
            '{>>  - COMMENT',
            '<<}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = bootMuya(markdown);
        const hiddenComment = contentByText(muya, 'COMMENT');
        const nextVisible = contentByText(muya, 'KEEP');

        muya.setCursor({
            start: { offset: 3 },
            end: { offset: 3 },
            path: hiddenComment.path,
        });

        await vi.waitFor(() => {
            const selection = muya.editor.selection.getSelection();
            expect(selection?.anchor.block).toBe(nextVisible);
            expect(selection?.anchor.offset).toBe(0);
            expect(selection?.focus.block).toBe(nextVisible);
        });
        expect(muya.editor.activeContentBlock).toBe(nextVisible);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('routes native keyup to the visible block after cross-paragraph comment escape', () => {
        const markdown = 'a{>>b\n\nc<<}d\n';
        const muya = bootMuya(markdown);
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        const normalize = vi.spyOn(
            muya.editor.selection,
            'normalizeHiddenCriticCommentCaret',
        ).mockReturnValue(false);
        selection.setBaseAndExtent(hiddenText, 0, hiddenText, 0);
        normalize.mockRestore();

        expect(() => muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        }))).not.toThrow();

        const visible = contentByText(muya, 'c<<}d');
        const normalized = muya.editor.selection.getSelection();
        expect(normalized?.anchor.block).toBe(visible);
        expect(normalized?.anchor.offset).toBe(4);
        expect(muya.editor.activeContentBlock).toBe(visible);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('keeps IME composition ownership coherent when a hidden caret is normalized cross-block', () => {
        const markdown = '{>>COMMENT\n<<}\n\nVISIBLE\n';
        const muya = bootMuya(markdown);
        const hiddenComment = contentByText(muya, 'COMMENT');
        const visible = contentByText(muya, 'VISIBLE');
        const hiddenText = hiddenComment.domNode?.firstChild?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected hidden structural comment content.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        const normalize = vi.spyOn(
            muya.editor.selection,
            'normalizeHiddenCriticCommentCaret',
        ).mockReturnValue(false);
        selection.setBaseAndExtent(hiddenText, 2, hiddenText, 2);
        normalize.mockRestore();

        muya.domNode.dispatchEvent(new CompositionEvent('compositionstart', {
            bubbles: true,
            data: 'X',
        }));
        const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertCompositionText',
        });
        muya.domNode.dispatchEvent(beforeInput);
        muya.domNode.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: 'X',
        }));

        expect(beforeInput.defaultPrevented).toBe(true);
        expect((hiddenComment as unknown as { isComposed: boolean }).isComposed)
            .toBe(false);
        expect((visible as unknown as { isComposed: boolean }).isComposed)
            .toBe(false);
        expect(muya.editor.activeContentBlock).toBe(visible);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('ends hidden IME composition when comment-only normalization removes the caret', () => {
        const markdown = '{>>COMMENT\n<<}\n';
        const muya = bootMuya(markdown);
        const hiddenComment = contentByText(muya, 'COMMENT');
        const hiddenText = hiddenComment.domNode?.firstChild?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected hidden structural comment content.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');
        const normalize = vi.spyOn(
            muya.editor.selection,
            'normalizeHiddenCriticCommentCaret',
        ).mockReturnValue(false);
        selection.setBaseAndExtent(hiddenText, 2, hiddenText, 2);
        normalize.mockRestore();

        muya.domNode.dispatchEvent(new CompositionEvent('compositionstart', {
            bubbles: true,
            data: 'X',
        }));
        const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'X',
            inputType: 'insertCompositionText',
        });
        muya.domNode.dispatchEvent(beforeInput);
        muya.domNode.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: 'X',
        }));

        expect(beforeInput.defaultPrevented).toBe(true);
        expect((hiddenComment as unknown as { isComposed: boolean }).isComposed)
            .toBe(false);
        expect(muya.editor.selection.getSelection()).toBeNull();
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('skips a hidden structural comment in one cross-block arrow action', () => {
        const markdown = 'BEFORE\n\n{>>COMMENT\n<<}\n\nAFTER\n';
        const muya = bootMuya(markdown);
        const before = contentByText(muya, 'BEFORE');
        const after = contentByText(muya, 'AFTER');

        before.setCursor(before.text.length, before.text.length, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        let selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(after);
        expect(selection?.anchor.offset).toBe(0);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        }));

        after.setCursor(0, 0, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(before);
        expect(selection?.anchor.offset).toBe(before.text.length);
        expect(muya.editor.activeContentBlock).toBe(before);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('uses semantic traversal rather than physical arrow direction in RTL', () => {
        const markdown = 'BEFORE\n\n{>>COMMENT\n<<}\n\nAFTER\n';
        const muya = bootMuya(markdown);
        muya.domNode.setAttribute('dir', 'rtl');
        const before = contentByText(muya, 'BEFORE');
        const after = contentByText(muya, 'AFTER');

        // In RTL physical Left is the semantic next-block key.
        before.setCursor(before.text.length, before.text.length, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        let selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(after);
        expect(selection?.anchor.offset).toBe(0);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowLeft',
        }));

        // In RTL physical Right is the semantic previous-block key.
        after.setCursor(0, 0, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(before);
        expect(selection?.anchor.offset).toBe(before.text.length);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('uses semantic inline comment affinity for horizontal arrows in RTL', () => {
        const markdown = 'before {>>note<<} after\n';
        const muya = bootMuya(markdown);
        muya.domNode.setAttribute('dir', 'rtl');
        const hiddenText = muya.domNode.querySelector(
            '.mu-critic-comment-text',
        )?.firstChild;
        if (!hiddenText)
            throw new TypeError('Expected a rendered hidden comment body.');
        const selection = document.getSelection();
        if (!selection)
            throw new TypeError('Expected a document selection.');

        // Physical Left advances in an RTL inline flow.
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        selection.setBaseAndExtent(hiddenText, 1, hiddenText, 1);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(17);

        // Physical Right retreats in an RTL inline flow.
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        selection.setBaseAndExtent(hiddenText, 3, hiddenText, 3);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(7);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('transitively skips consecutive structural comments in both directions', () => {
        const markdown = [
            'BEFORE',
            '',
            '{>>A',
            '<<}',
            '',
            '{>>B',
            '<<}',
            '',
            'AFTER',
            '',
        ].join('\n');
        const muya = bootMuya(markdown);
        const before = contentByText(muya, 'BEFORE');
        const after = contentByText(muya, 'AFTER');

        before.setCursor(before.text.length, before.text.length, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        let selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(after);
        expect(selection?.anchor.offset).toBe(0);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        }));

        after.setCursor(0, 0, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(before);
        expect(selection?.anchor.offset).toBe(before.text.length);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('transitively skips nested consecutive structural comments in both directions', () => {
        const markdown = [
            '- parent',
            '{++  - ADD-PARENT',
            '{>>    - FIRST',
            '<<}{>>    - SECOND',
            '<<}  - ADD',
            '++}  - KEEP',
            '- tail',
            '',
        ].join('\n');
        const muya = bootMuya(markdown);
        const before = contentByText(muya, 'ADD-PARENT');
        const after = contentByText(muya, 'ADD');

        before.setCursor(before.text.length, before.text.length, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowRight',
        }));
        let selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(after);
        expect(selection?.anchor.offset).toBe(0);
        muya.domNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'ArrowRight',
        }));

        after.setCursor(0, 0, true);
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
        }));
        selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.block).toBe(before);
        expect(selection?.anchor.offset).toBe(before.text.length);
        expectNativeCaretOutsideHiddenCriticMarkup();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('resolves the target block across two paragraphs', async () => {
        const muya = bootMuya('first\n\nsecond\n');
        const blocks = muya.editor.scrollPage!;
        const secondPara = blocks.find(1) as Parent;
        const secondContent = secondPara.firstContentInDescendant()!;
        muya.setCursor({
            anchor: { offset: 1 },
            focus: { offset: 1 },
            anchorPath: secondContent.path,
            focusPath: secondContent.path,
        });
        await vi.waitFor(() => {
            const sel = muya.editor.selection.getSelection();
            expect(sel!.anchor.block).toBe(secondContent);
            expect(sel!.anchor.offset).toBe(1);
        });
    });

    it('does not throw and leaves the document intact for an unresolvable path', () => {
        const muya = bootMuya('hello\n');
        expect(() => muya.setCursor({
            anchor: { offset: 0 },
            focus: { offset: 0 },
            anchorPath: [99, 'text'],
            focusPath: [99, 'text'],
        })).not.toThrow();
    });
});
