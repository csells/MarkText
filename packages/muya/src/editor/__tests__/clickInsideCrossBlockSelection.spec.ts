// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// Chromium collapses a range the user clicks inside only after the click event,
// at the node it hit. The editor used to blur its active block during that
// click, redrawing the node away, so the browser dropped the selection and the
// next keystroke or paste went to the top of the document.

interface IContentBlock {
    path: (string | number)[];
    setCursor: (start: number, end: number, needUpdate?: boolean) => void;
    nextContentInContext: () => IContentBlock;
    domNode: HTMLElement;
}

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('a click inside a selection that spans blocks', () => {
    it('leaves the clicked text in place for the browser and then activates the block it collapsed into', async () => {
        const muya = bootMuya('Third para with `code` words\n\nnext para\n');
        const { editor } = muya;
        const first = editor.scrollPage!.firstContentInDescendant()! as unknown as IContentBlock;
        const second = first.nextContentInContext();
        // A caret inside the code span shows its backticks.
        first.setCursor(18, 18, true);
        editor.activeContentBlock = first as never;
        const anchor = editor.selection.getDOMPoint({ path: first.path, offset: 2 })!;
        const focus = editor.selection.getDOMPoint({ path: second.path, offset: 3 })!;
        document.getSelection()!.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        const clicked = anchor.node;

        first.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(clicked.isConnected).toBe(true);
        expect(editor.activeContentBlock).toBe(first);
        document.getSelection()!.collapse(anchor.node, anchor.offset);
        await new Promise(resolve => setTimeout(resolve));
        expect(editor.activeContentBlock).toBe(first);
        expect(editor.selection.getTextPoint({ node: document.getSelection()!.anchorNode!, offset: document.getSelection()!.anchorOffset }))
            .toEqual({ path: first.path, offset: 2 });
    });
});
