// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { TableColumnToolbar } from '../index';

it.each([false, true])('a rapid column change owns removal with toolbar pointer movement=%s', (moveWithinToolbar) => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent('| left | right |\n| --- | --- |\n| keep | remove |\n');
    const toolbar = new TableColumnToolbar(muya);
    const cells = [...muya.domNode.querySelectorAll('tr:first-child th, tr:first-child td')];
    const descriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: (x: number, y: number) => y >= 27 ? [cells[x === 0 ? 0 : 1]] : [] });
    try {
        expect(cells).toHaveLength(2);
        for (const x of [0, 20]) {
            const event = new MouseEvent('mousemove', { clientX: x, clientY: 0, bubbles: true });
            Object.defineProperties(event, { x: { value: x }, y: { value: 0 } });
            document.body.dispatchEvent(event);
        }
        const remove = toolbar.container!.querySelector('li.item.remove');
        expect(remove).not.toBeNull();
        if (moveWithinToolbar) {
            const event = new MouseEvent('mousemove', { bubbles: true });
            Object.defineProperties(event, { x: { value: 0 }, y: { value: 0 } });
            remove!.dispatchEvent(event);
        }
        remove!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        muya.flush();
        expect(muya.domNode.querySelector('tr:first-child td, tr:first-child th')?.textContent).toBe('left');
        expect(muya.domNode.querySelector('tr:last-child td')?.textContent).toBe('keep');
    }
    finally {
        if (descriptor)
            Object.defineProperty(document, 'elementsFromPoint', descriptor);
        else
            Reflect.deleteProperty(document, 'elementsFromPoint');
        vi.clearAllTimers();
        vi.restoreAllMocks();
        vi.useRealTimers();
        toolbar.destroy();
        muya.destroy();
        muya.domNode.remove();
    }
});
