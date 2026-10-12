// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// A selection that reaches from a block showing inline syntax into the next
// block blurs the first block, which redraws without its markers. The redraw
// replaced the text nodes holding the selection's start, so the browser moved
// that start to the block's beginning or dropped the selection.

interface IFormatBlock {
    path: (string | number)[];
    blurHandler: () => void;
    setCursor: (start: number, end: number, needUpdate?: boolean) => void;
    nextContentInContext: () => IFormatBlock;
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

describe('format.blurHandler', () => {
    it('keeps a selection that starts in the redrawn block and ends in the next one', () => {
        const muya = bootMuya('Third para with `code` words\n\nnext para\n');
        const { selection } = muya.editor;
        const first = muya.editor.scrollPage!.firstContentInDescendant()! as unknown as IFormatBlock;
        const second = first.nextContentInContext();
        // A caret inside the code span shows its backticks.
        first.setCursor(18, 18, true);
        const shown = first.domNode.innerHTML;

        const anchor = selection.getDOMPoint({ path: first.path, offset: 13 })!;
        const focus = selection.getDOMPoint({ path: second.path, offset: 3 })!;
        document.getSelection()!.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        first.blurHandler();

        expect(first.domNode.innerHTML).not.toBe(shown);
        const native = selection.getDOMSelection();
        expect(native && selection.getTextPoint(native.anchor)).toEqual({ path: first.path, offset: 13 });
        expect(native && selection.getTextPoint(native.focus)).toEqual({ path: second.path, offset: 3 });
    });
});
