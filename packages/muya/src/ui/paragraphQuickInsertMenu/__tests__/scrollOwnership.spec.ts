// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { ParagraphQuickInsertMenu } from '../index';

it('scrolls active menu items inside the menu without scrolling the document', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    const menu = new ParagraphQuickInsertMenu(muya);
    const scroll = menu.container!;
    const pageScroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const menuScroll = vi.spyOn(scroll, 'scrollTo');
    try {
        menu.step('next');
        expect(menuScroll).toHaveBeenCalled();
        expect(pageScroll).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
        menu.destroy();
        muya.destroy();
        muya.domNode.remove();
    }
});
