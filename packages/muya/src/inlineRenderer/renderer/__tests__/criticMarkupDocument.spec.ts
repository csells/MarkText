// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

const hosts: HTMLElement[] = [];

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    return muya;
}

describe('criticMarkup document fragment renderer', () => {
    it('renders linked semantic fragments across a paragraph and heading', () => {
        const muya = boot('before {++one\n\n# two++} after\n');
        const fragments = Array.from(muya.domNode.querySelectorAll<HTMLElement>(
            '[data-critic-id="critic-7-23"]',
        ));

        expect(fragments).toHaveLength(2);
        expect(fragments.map(fragment => fragment.dataset.criticRole))
            .toEqual(['start', 'end']);
        expect(fragments.map(fragment => fragment.querySelector('ins')?.textContent))
            .toEqual(['one', 'two']);
        expect(fragments[1].closest('h1')).not.toBeNull();
    });

    it('keeps nested linked items addressable by their own document IDs', () => {
        const muya = boot('{++outer\n\n{--inner\n\ntail--} end++}\n');

        expect(muya.domNode.querySelectorAll('[data-critic-id="critic-0-34"]'))
            .toHaveLength(3);
        expect(muya.domNode.querySelectorAll('[data-critic-id="critic-10-27"]'))
            .toHaveLength(2);
    });

    it('maps a full DOM range across semantic fragments back to source offsets', () => {
        const markdown = 'Alpha {++added++}, {--removed--}, and {~~before~>after~~}.';
        const muya = boot(markdown);
        const content = muya.editor.scrollPage!.firstContentInDescendant()!;
        const range = document.createRange();
        range.selectNodeContents(content.domNode!);
        const domSelection = document.getSelection()!;
        domSelection.removeAllRanges();
        domSelection.addRange(range);

        const selection = muya.editor.selection.getSelection();

        expect(selection?.anchor.offset).toBe(0);
        expect(selection?.focus.offset).toBe(markdown.length);
    });
});
