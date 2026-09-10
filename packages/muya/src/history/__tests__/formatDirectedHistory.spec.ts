// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Muya } from '../../muya';

it.each([{ format: 'strong', marker: '**' }, { format: 'em', marker: '*' }])('retains actual backward selection through native $format first undo and redo', ({ format, marker }) => {
    window.MUYA_VERSION = 'test';
    const host = document.body.appendChild(document.createElement('div'));
    const muya = new Muya(host, { markdown: 'aaa\n' });
    try {
        muya.init();
        const block = muya.editor.scrollPage?.firstContentInDescendant();
        if (!block)
            throw new Error('Missing native paragraph');
        block.setCursor(3, 0, true);
        muya.format(format);
        muya.flush();
        const selection = () => ({ anchor: muya.getSelection()?.anchor.offset, focus: muya.getSelection()?.focus.offset });
        expect(muya.getMarkdown()).toBe(`${marker}aaa${marker}\n`);
        expect(selection()).toEqual({ anchor: marker.length + 3, focus: marker.length });
        muya.undo();
        muya.flush();
        expect(muya.getMarkdown()).toBe('aaa\n');
        expect(selection()).toEqual({ anchor: 3, focus: 0 });
        muya.redo();
        muya.flush();
        expect(muya.getMarkdown()).toBe(`${marker}aaa${marker}\n`);
        expect(selection()).toEqual({ anchor: marker.length + 3, focus: marker.length });
        muya.format(format);
        muya.flush();
        expect(muya.getMarkdown()).toBe('aaa\n');
        expect(selection()).toEqual({ anchor: 3, focus: 0 });
    }
    finally {
        muya.destroy();
        host.remove();
        document.getSelection()?.removeAllRanges();
        delete (window as Partial<Window>).MUYA_VERSION;
    }
});
