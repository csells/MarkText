// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function place(muya: Muya, start: number, end: number): void {
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;
    muya.editor.activeContentBlock = block;
    block.setCursor(start, end, true);
}

describe('add Comment requires a selection', () => {
    it('cannot create a comment with a collapsed caret, only with a selection', () => {
        const muya = boot('hello world');

        // Collapsed caret — every app comment must have a highlighted anchor,
        // so with nothing selected a comment cannot start.
        place(muya, 2, 2);
        expect(muya.getCriticMarkupReviewSnapshot().canCreateComment).toBe(false);

        // A real selection can anchor a comment.
        place(muya, 0, 5);
        expect(muya.getCriticMarkupReviewSnapshot().canCreateComment).toBe(true);
    });

    it('still allows an addition at a collapsed caret', () => {
        const muya = boot('hello world');
        place(muya, 2, 2);
        expect(muya.getCriticMarkupReviewSnapshot().canCreateAddition).toBe(true);
    });
});
