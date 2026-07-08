// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';

// comment-anchors.md §Paste absorption: a paste whose payload carries MC
// syntax runs with recording suppressed, folds the syntax into the model via
// a materialize→re-extract rebuild, and records ONE boundary from the
// pre-paste snapshot. The user-visible contract pinned here: a single undo
// after such a paste restores the pre-paste document bytes AND the pre-paste
// comment model — never a partial state between the paste's internal steps.

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => Promise.resolve([]),
    search: () => [],
}));

vi.mock('../../utils/paste', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/paste')>();
    return { ...actual, normalizePastedHTML: async (html: string) => html };
});

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function stubSelection(muya: Muya, block: Content, start: number, end: number) {
    const path = block.path;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block, path },
        focus: { offset: end, block, path },
        isCollapsed: start === end,
        isSelectionInSameBlock: true,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

function pasteEvent(text: string) {
    return {
        preventDefault() {},
        stopPropagation() {},
        clipboardData: {
            getData: (t: string) => (t === 'text/plain' ? text : ''),
            files: [],
            items: [],
        },
    } as unknown as ClipboardEvent;
}

async function paste(muya: Muya, block: Content, start: number, end: number, text: string): Promise<void> {
    stubSelection(muya, block, start, end);
    await muya.editor.clipboard.pasteHandler(pasteEvent(text), text, '');
    await new Promise(r => setTimeout(r, 40));
}

const MC_PAYLOAD
    = 'pasted <!--MC:p1-->target<!--MC:~p1--> tail\n\n'
        + '[MC:p1]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}\n'
        + '[MC:p1.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"Pasted thread."}\n';

describe('paste absorbing MC syntax — single undo boundary', () => {
    it('one undo restores the pre-paste bytes and comment model', async () => {
        const muya = bootMuya('Intro paragraph.\n\nOutro paragraph.\n');
        const before = muya.getMarkdown();
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        await paste(muya, block, block.text.length, block.text.length, MC_PAYLOAD);

        // The paste landed as a MODEL comment: thread present, and the wire
        // serialization carries the markers + definition it materializes.
        expect(muya.editor.jsonState.commentModel.threads.has('p1')).toBe(true);
        const pasted = muya.getMarkdown();
        expect(pasted).toContain('<!--MC:p1-->');
        expect(pasted).toContain('[MC:p1]:');
        expect(pasted).not.toBe(before);

        muya.undo();

        expect(muya.getMarkdown()).toBe(before);
        expect(muya.editor.jsonState.commentModel.threads.size).toBe(0);
        expect(muya.editor.jsonState.commentModel.anchors).toHaveLength(0);
    });

    it('the boundary is exactly one history entry: redo re-applies the whole paste', async () => {
        const muya = bootMuya('Intro paragraph.\n\nOutro paragraph.\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        await paste(muya, block, block.text.length, block.text.length, MC_PAYLOAD);
        const pasted = muya.getMarkdown();

        muya.undo();
        muya.redo();

        expect(muya.getMarkdown()).toBe(pasted);
        expect(muya.editor.jsonState.commentModel.threads.has('p1')).toBe(true);
    });
});
