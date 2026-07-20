// @vitest-environment happy-dom

import type Table from '../../block/gfm/table';
import type { IImageSelectionData } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import Selection from '..';

// Coverage for the Selection facade (Task 3 of the selection-module refactor):
//   - `type` reports the active SelectionType ('text' | 'table' | 'image').
//   - `activate(type)` enforces mutual exclusivity and emits a
//     `selection-change` payload carrying the new `kind` discriminator.
//   - `clear()` returns to the text selection.
//   - a plain text `setSelection` keeps `type === 'text'`, emits `kind: 'text'`,
//     and preserves the legacy Caret/Range/None `type` field on the payload.

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

describe('selection facade', () => {
    it('binds hidden-comment selection reconciliation to the editor owner document', () => {
        const ownerDocument = document.implementation.createHTMLDocument();
        const domNode = ownerDocument.createElement('div');
        const attachDOMEvent = vi.fn(() => 'event-id');
        const muya = {
            domNode,
            eventCenter: { attachDOMEvent },
        } as unknown as Muya;

        new Selection(muya);

        expect(attachDOMEvent).toHaveBeenCalledWith(
            ownerDocument,
            'selectionchange',
            expect.any(Function),
        );
    });

    it('restores a native selection when the ambient Node constructor belongs to another realm', () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const ownerSelection = muya.domNode.ownerDocument.getSelection()!;
        ownerSelection.removeAllRanges();

        class ForeignRealmNode {}
        Object.defineProperty(ForeignRealmNode, 'ELEMENT_NODE', { value: 1 });
        Object.defineProperty(ForeignRealmNode, 'TEXT_NODE', { value: 3 });
        vi.stubGlobal('Node', ForeignRealmNode);

        try {
            muya.editor.selection.setSelection(
                { offset: 1, block: first, path: first.path },
                { offset: 5, block: first, path: first.path },
            );

            expect(ownerSelection.anchorNode).not.toBeNull();
            expect(ownerSelection.focusNode).not.toBeNull();
            expect(muya.editor.selection.getSelection()?.anchor.offset).toBe(1);
            expect(muya.editor.selection.getSelection()?.focus.offset).toBe(5);
        }
        finally {
            vi.unstubAllGlobals();
        }
    });

    it('reports type "text" after a normal text setSelection', () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.selection.setSelection(
            { offset: 0, block: first, path: first.path },
            { offset: 5, block: first, path: first.path },
        );

        expect(muya.editor.selection.type).toBe('text');
    });

    it('keeps a collapsed text selection out of a hidden comment', () => {
        const muya = bootMuya('before {>>note<<} after\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const hidden = { offset: 11, block: first, path: first.path };

        muya.editor.selection.setSelection(hidden, hidden);

        expect(muya.editor.selection.anchor?.offset).toBe(7);
        expect(muya.editor.selection.focus?.offset).toBe(7);
    });

    it('adds no parser document request for a visibly plain collapsed carrier', () => {
        const muya = bootMuya('plain text\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const getDocument = vi.spyOn(
            muya.editor.criticMarkupDocument,
            'get',
        );

        muya.editor.selection.setSelection(
            { offset: 1, block: first, path: first.path },
            { offset: 3, block: first, path: first.path },
        );
        const reviewPublicationCalls = getDocument.mock.calls.length;
        expect(reviewPublicationCalls).toBeGreaterThan(0);
        getDocument.mockClear();

        muya.editor.selection.setSelection(
            { offset: 3, block: first, path: first.path },
            { offset: 3, block: first, path: first.path },
        );

        expect(getDocument).toHaveBeenCalledTimes(reviewPublicationCalls);
        expect(muya.editor.selection.anchor?.offset).toBe(3);
    });

    it('does not traverse a large plain carrier to prove comment absence', () => {
        const source = 'p'.repeat(512);
        const muya = bootMuya(`${source}\n`);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.domNode!.replaceChildren(...Array.from(
            { length: source.length },
            () => {
                const span = document.createElement('span');
                span.textContent = 'p';
                return span;
            },
        ));
        let textReads = 0;
        for (const span of first.domNode!.children) {
            const node = span.firstChild!;
            Object.defineProperty(node, 'textContent', {
                configurable: true,
                get: () => {
                    textReads++;
                    return 'p';
                },
            });
        }

        muya.editor.selection.setSelection(
            { offset: 0, block: first, path: first.path },
            { offset: 1, block: first, path: first.path },
        );
        const ordinarySelectionReads = textReads;
        textReads = 0;

        muya.editor.selection.setSelection(
            { offset: 0, block: first, path: first.path },
            { offset: 0, block: first, path: first.path },
        );

        expect(textReads).toBeLessThan(ordinarySelectionReads + 8);
        expect(muya.editor.selection.anchor?.offset).toBe(0);
    });

    it('falls back to parser authority for a transient malformed carrier', () => {
        const muya = bootMuya('plain text\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const transient = document.createElement('span');
        transient.classList.add(CLASS_NAMES.MU_INLINE_IMAGE);
        first.domNode!.append(transient);

        expect(() => muya.editor.selection.setSelection(
            { offset: 3, block: first, path: first.path },
            { offset: 3, block: first, path: first.path },
        )).not.toThrow();
        expect(muya.editor.selection.anchor?.offset).toBe(3);
    });

    it('preserves non-collapsed range endpoints even when one endpoint is in comment source', () => {
        const muya = bootMuya('before {>>note<<} after\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.selection.setSelection(
            { offset: 11, block: first, path: first.path },
            { offset: 20, block: first, path: first.path },
        );

        const selection = muya.editor.selection.getSelection();
        expect(selection?.anchor.offset).toBe(11);
        expect(selection?.focus.offset).toBe(20);
        expect(selection?.direction).toBe('forward');
    });

    it('activating image sets type to "image" and emits kind "image"', () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        let payload: Record<string, unknown> | null = null;
        muya.on('selection-change', (p: unknown) => {
            payload = p as Record<string, unknown>;
        });

        muya.editor.selection.selectImage({
            token: {},
            imageId: 'image-1',
            block: first,
        } as unknown as IImageSelectionData);

        expect(muya.editor.selection.type).toBe('image');
        expect(payload).not.toBeNull();
        expect(payload!.kind).toBe('image');
    });

    it('clear() returns type to "text"', () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.selection.selectImage({
            token: {},
            imageId: 'image-1',
            block: first,
        } as unknown as IImageSelectionData);
        expect(muya.editor.selection.type).toBe('image');

        muya.editor.selection.clear();

        expect(muya.editor.selection.type).toBe('text');
        expect(muya.editor.selection.image).toBeNull();
    });

    it('reports type "table" and current table while a table rectangle is frozen', () => {
        const muya = bootMuya('| a | b |\n| --- | --- |\n| c | d |\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const table = first.closestBlock('table') as Table;
        const { selection } = muya.editor;

        selection.table.selectTable(table);

        expect(selection.type).toBe('table');
        expect(selection.current).toBe(selection.table);

        selection.clear();

        expect(selection.type).toBe('text');
    });

    it('text setSelection emits kind "text" while preserving the legacy type field', () => {
        const muya = bootMuya('hello world\n');
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;

        let payload: Record<string, unknown> | null = null;
        muya.on('selection-change', (p: unknown) => {
            payload = p as Record<string, unknown>;
        });

        muya.editor.selection.setSelection(
            { offset: 0, block: first, path: first.path },
            { offset: 5, block: first, path: first.path },
        );

        expect(payload).not.toBeNull();
        expect(payload!.kind).toBe('text');
        expect(['Caret', 'Range', 'None']).toContain(payload!.type);
    });
});
