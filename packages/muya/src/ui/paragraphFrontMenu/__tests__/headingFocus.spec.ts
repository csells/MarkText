// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { ParagraphFrontMenu } from '../index';

it('keeps the editor selection when pressing the already active heading item', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent('## heading\n\nelsewhere\n');
    const menu = new ParagraphFrontMenu(muya);
    try {
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const other = first.nextContentInContext()!;
        other.setCursor(3, 3, true);
        muya.focus();
        muya.eventCenter.emit('muya-front-menu', { reference: first.domNode, block: first.outMostBlock });
        await vi.advanceTimersByTimeAsync(0);
        const item = menu.container!.querySelectorAll('.turn-into-item.atx-heading')[1];
        expect(item).toBeDefined();
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        item.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(muya.getMarkdown()).toBe('## heading\n\nelsewhere\n');
        expect(muya.editor.selection.getSelection()?.focus).toMatchObject({ block: other, offset: 3 });
    }
    finally {
        vi.clearAllTimers();
        vi.useRealTimers();
        menu.destroy();
        muya.destroy();
        host.remove();
    }
});
