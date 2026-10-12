// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// After a full render the code block redraws itself once its grammar loads
// and its gutter fills. Search highlights painted on it in between stay, so
// a preference toggle with the find bar open keeps them (upstream #5651).

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
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

function codeContent(muya: Muya): Content {
    let target: Content | null = null;
    const visit = (block: {
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName === 'codeblock.content')
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error('codeblock.content block not found');
    return target;
}

describe('codeBlockContent search highlights', () => {
    it('keeps highlights through a grammar or gutter redraw of the same text', () => {
        const muya = bootMuya('```\napple()\n```\n');
        const content = codeContent(muya) as Content & { redraw: () => void };
        content.update(undefined, [{ start: 0, end: 5, active: true }]);
        expect(content.domNode!.querySelector('.mu-highlight')?.textContent).toBe('apple');

        content.redraw();
        expect(content.domNode!.querySelector('.mu-highlight')?.textContent).toBe('apple');

        content.update();
        content.redraw();
        expect(content.domNode!.querySelector('.mu-highlight')).toBeNull();
    });
});
