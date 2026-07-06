// @vitest-environment happy-dom

import type TextSelection from '../TextSelection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// The placement-layer backstop for the hard invariant: a collapsed caret that
// comes to REST inside a hidden comment metadata block — by any means the
// per-input-path guards did not foresee (native select-all collapse, script,
// platform-specific jumps) — is snapped to the nearest visible position on
// the native selectionchange that follows. The e2e twin drives the real
// browser path in desktop test/e2e/comment-metadata-unreachable.spec.ts.

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';

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

function textSelectionOf(muya: Muya): TextSelection {
    return (muya.editor.selection as unknown as { _text: TextSelection })._text;
}

function firstTextNodeIn(root: Node): Text {
    const walk = (node: Node): Text | null => {
        if (node.nodeType === Node.TEXT_NODE)
            return node as Text;
        for (const child of Array.from(node.childNodes)) {
            const found = walk(child);
            if (found)
                return found;
        }
        return null;
    };
    const found = walk(root);
    if (!found)
        throw new Error('no text node under the given root');
    return found;
}

describe('snapCaretOutOfHiddenSyntax', () => {
    it('snaps a caret resting in a trailing metadata block to the end of the last visible block', () => {
        const muya = bootMuya(`alpha\n\n<!--MC:a-->x<!--MC:~a--> y\n\n[MC:a]: ${META}\n`);
        const metaBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
        expect(metaBlock.isCommentMetadataBlock()).toBe(true);

        const textNode = firstTextNodeIn(metaBlock.domNode!);
        document.getSelection()!.collapse(textNode, 1);
        textSelectionOf(muya).snapCaretOutOfHiddenSyntax();

        const { focusBlock, focus } = muya.editor.selection;
        expect(focusBlock?.isCommentMetadataBlock()).toBe(false);
        expect(focusBlock?.text).toContain('y');
        expect(focus?.offset).toBe(focusBlock?.text.length);
    });

    it('snaps forward when the metadata block has no previous visible content', () => {
        const muya = bootMuya(`[MC:a]: ${META}\n\n<!--MC:a-->body<!--MC:~a--> text\n`);
        const metaBlock = muya.editor.scrollPage!.firstContentInDescendant()!;
        expect(metaBlock.isCommentMetadataBlock()).toBe(true);

        const textNode = firstTextNodeIn(metaBlock.domNode!);
        document.getSelection()!.collapse(textNode, 1);
        textSelectionOf(muya).snapCaretOutOfHiddenSyntax();

        const { focusBlock, focus } = muya.editor.selection;
        expect(focusBlock?.isCommentMetadataBlock()).toBe(false);
        expect(focus?.offset).toBe(0);
    });

    it('leaves a non-collapsed selection spanning hidden syntax alone', () => {
        const muya = bootMuya(`alpha\n\n<!--MC:a-->x<!--MC:~a--> y\n\n[MC:a]: ${META}\n`);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const metaBlock = muya.editor.scrollPage!.lastContentInDescendant()!;

        const sel = document.getSelection()!;
        sel.collapse(firstTextNodeIn(first.domNode!), 0);
        sel.extend(firstTextNodeIn(metaBlock.domNode!), 1);
        const before = muya.editor.selection.focusBlock;
        textSelectionOf(muya).snapCaretOutOfHiddenSyntax();

        // No snap: the tracked endpoints must be untouched.
        expect(muya.editor.selection.focusBlock).toBe(before);
    });

    it('ignores carets outside this muya instance', () => {
        const muya = bootMuya(`alpha\n\n[MC:a]: ${META}\n`);
        const outside = document.createElement('p');
        outside.textContent = `[MC:a]: ${META}`;
        document.body.appendChild(outside);

        document.getSelection()!.collapse(outside.firstChild!, 1);
        const before = muya.editor.selection.focusBlock;
        textSelectionOf(muya).snapCaretOutOfHiddenSyntax();

        expect(muya.editor.selection.focusBlock).toBe(before);
        outside.remove();
    });
});
