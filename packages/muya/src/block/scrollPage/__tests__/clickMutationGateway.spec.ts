// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';

const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    document.body.replaceChildren();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('scroll-page click mutation gateway', () => {
    it('does not append a paragraph from a blank-area click in a clean projection', () => {
        const source = '{++hello++}\n';
        const muya = boot(source);
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        const scrollPage = muya.editor.scrollPage!;
        vi.spyOn(scrollPage.lastChild!.domNode!, 'getBoundingClientRect')
            .mockReturnValue({ bottom: 0 } as DOMRect);

        scrollPage.domNode!.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            clientY: 100,
        }));

        expect(scrollPage.length()).toBe(1);
        expect(muya.getMarkdown()).toBe(source);
    });
});
