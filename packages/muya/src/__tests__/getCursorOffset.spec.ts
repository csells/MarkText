// @vitest-environment happy-dom

import type { ISelection } from '../selection/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';
import { injectStateSentinels, locateSentinelOffsets } from '../selection/offsetCursor';
import { SelectionCaretType, SelectionDirection } from '../selection/types';

// PARITY (gap PG2 / Phase G — G7): `getCursorOffset` is the READ inverse of
// `setCursorByOffset`. It maps the live WYSIWYG block-key caret back to a
// source-mode (CodeMirror) `{ line, ch }` index cursor so toggling
// WYSIWYG -> source opens at the same caret. Legacy muyajs computed this in
// `ContentState.getMuyaIndexCursor`; `@muyajs/core` shipped only the WRITE
// direction until this was re-added.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
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
    bootedHosts.push(muya.domNode);
    return muya;
}

const COMMENT_METADATA
    = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';

describe('muya.getCursorOffset() (Phase G — G7)', () => {
    it('maps a collapsed caret in a paragraph to its {line, ch}', () => {
        const muya = bootMuya('first para\n\nsecond para\n\nthird para here\n');
        const third = muya.editor.scrollPage!.lastContentInDescendant()!;
        // Caret after "third " (offset 6) in the third paragraph.
        third.setCursor(6, 6, true);

        const cursor = muya.getCursorOffset();
        expect(cursor).not.toBeNull();
        // Lines: 0 first, 1 blank, 2 second, 3 blank, 4 third.
        expect(cursor!.anchor).toEqual({ line: 4, ch: 6 });
        expect(cursor!.focus).toEqual({ line: 4, ch: 6 });
        // The live document is untouched (no sentinel residue).
        expect(muya.getMarkdown()).not.toContain('mUyAcUrSoR');
    });

    it('maps a caret inside a heading (marker kept in content text)', () => {
        const muya = bootMuya('# Title\n\nbody text\n');
        const heading = muya.editor.scrollPage!.firstContentInDescendant()!;
        heading.setCursor(4, 4, true); // after "# Ti"

        const cursor = muya.getCursorOffset();
        expect(cursor).not.toBeNull();
        expect(cursor!.anchor).toEqual({ line: 0, ch: 4 });
    });

    it('round-trips with setCursorByOffset (set -> read returns the same offset)', () => {
        const muya = bootMuya('alpha\n\nbeta gamma\n\ndelta\n');
        const target = { line: 2, ch: 5 }; // inside "beta gamma" -> after "beta "
        const restored = muya.setCursorByOffset({ anchor: target, focus: target });
        expect(restored).toBe(true);

        const cursor = muya.getCursorOffset();
        expect(cursor).not.toBeNull();
        expect(cursor!.anchor).toEqual(target);
        expect(cursor!.focus).toEqual(target);
    });

    it('maps a caret through hidden comment marker bytes', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${COMMENT_METADATA}`,
            '',
        ].join('\n');
        const muya = bootMuya(markdown);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const offset = 'A <!--MC:a-->reviewed'.length;
        block.setCursor(offset, offset, true);

        const cursor = muya.getCursorOffset();

        expect(cursor?.anchor).toEqual({ line: 0, ch: offset });
        expect(cursor?.focus).toEqual({ line: 0, ch: offset });
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('maps a caret inside a hidden comment metadata definition', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${COMMENT_METADATA}`,
            '',
        ].join('\n');
        const muya = bootMuya(markdown);
        const metadataBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
        metadataBlock.setCursor(7, 7, true);

        const cursor = muya.getCursorOffset();

        expect(cursor?.anchor).toEqual({ line: 2, ch: 7 });
        expect(cursor?.focus).toEqual({ line: 2, ch: 7 });
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('resolves a non-collapsed selection within a block to anchor/focus offsets', () => {
        // Asserted at the function level: happy-dom collapses a non-collapsed
        // DOM range across re-render, so we drive injectStateSentinels directly
        // (the resolver computes the sentinel-free anchor/focus offsets).
        const muya = bootMuya('hello world\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const selection: ISelection = {
            anchor: { offset: 0, block, path: [0, 'text'] },
            focus: { offset: 5, block, path: [0, 'text'] },
            isCollapsed: false,
            isSelectionInSameBlock: true,
            direction: SelectionDirection.FORWARD,
            type: SelectionCaretType.RANGE,
        };
        const sentinelState = injectStateSentinels(muya.getState(), selection);
        expect(sentinelState).not.toBeNull();
        const md = muya.editor.jsonState.getMarkdownFromState(sentinelState!);
        const cursor = locateSentinelOffsets(md);
        expect(cursor).not.toBeNull();
        expect(cursor!.anchor).toEqual({ line: 0, ch: 0 });
        expect(cursor!.focus).toEqual({ line: 0, ch: 5 });
    });

    it('resolves a BACKWARD same-block selection (anchor after focus)', () => {
        const muya = bootMuya('hello world\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const selection: ISelection = {
            anchor: { offset: 9, block, path: [0, 'text'] }, // after "hello wor"
            focus: { offset: 2, block, path: [0, 'text'] }, //  after "he"
            isCollapsed: false,
            isSelectionInSameBlock: true,
            direction: SelectionDirection.BACKWARD,
            type: SelectionCaretType.RANGE,
        };
        const sentinelState = injectStateSentinels(muya.getState(), selection);
        expect(sentinelState).not.toBeNull();
        const md = muya.editor.jsonState.getMarkdownFromState(sentinelState!);
        const cursor = locateSentinelOffsets(md);
        expect(cursor).not.toBeNull();
        // Sentinel-free offsets recovered regardless of injection order.
        expect(cursor!.anchor).toEqual({ line: 0, ch: 9 });
        expect(cursor!.focus).toEqual({ line: 0, ch: 2 });
    });

    it('returns null when there is no selection', () => {
        const muya = bootMuya('text\n');
        document.getSelection()?.removeAllRanges();
        expect(muya.getCursorOffset()).toBeNull();
    });
});

// A collapsed caret placed strictly inside a comment marker renders invisibly
// (the marker's raw text is a zero-width hidden span). The click/arrow handlers
// snap the caret out via `_caretOutOfCommentMarker`.
describe('caret snaps out of hidden comment markers', () => {
    const openStart = 'A '.length; // 2
    const openEnd = openStart + '<!--MC:a-->'.length; // 13

    interface IWithSkip {
        _caretOutOfCommentMarker: (offset: number, prefer: 'backward' | 'forward') => number | null;
    }

    function commentedBlock(): IWithSkip {
        const muya = bootMuya(
            `A <!--MC:a-->commented<!--MC:~a--> B\n\n[MC:a]: ${COMMENT_METADATA}\n`,
        );
        return muya.editor.scrollPage!.firstContentInDescendant()! as unknown as IWithSkip;
    }

    it('snaps a strictly-interior caret to the marker edge in the preferred direction', () => {
        const block = commentedBlock();
        const inside = openStart + 3;
        expect(block._caretOutOfCommentMarker(inside, 'forward')).toBe(openEnd);
        expect(block._caretOutOfCommentMarker(inside, 'backward')).toBe(openStart);
    });

    it('leaves a caret at a marker boundary or in plain text alone', () => {
        const block = commentedBlock();
        expect(block._caretOutOfCommentMarker(openEnd, 'forward')).toBeNull();
        expect(block._caretOutOfCommentMarker(openStart, 'forward')).toBeNull();
        expect(block._caretOutOfCommentMarker(0, 'forward')).toBeNull();
    });

    it('falls back to the visible edge when the marker begins the block', () => {
        // Comment starts the block (open marker at [0, 11)); arrowing right in
        // from the previous line lands here and would snap backward to offset 0
        // (before a hidden line-start marker → still invisible), so it must fall
        // back to the end edge.
        const muya = bootMuya(
            `<!--MC:a-->commented<!--MC:~a--> B\n\n[MC:a]: ${COMMENT_METADATA}\n`,
        );
        const block = muya.editor.scrollPage!.firstContentInDescendant()! as unknown as IWithSkip;
        const markerEnd = '<!--MC:a-->'.length; // 11
        // Caret AT offset 0 (the marker's start edge, which begins the block) is
        // invisible too — arrowing in from the previous line lands exactly here.
        expect(block._caretOutOfCommentMarker(0, 'backward')).toBe(markerEnd);
        expect(block._caretOutOfCommentMarker(0, 'forward')).toBe(markerEnd);
        // ...as is a strictly-interior offset.
        expect(block._caretOutOfCommentMarker(3, 'backward')).toBe(markerEnd);
        expect(block._caretOutOfCommentMarker(3, 'forward')).toBe(markerEnd);
    });
});
