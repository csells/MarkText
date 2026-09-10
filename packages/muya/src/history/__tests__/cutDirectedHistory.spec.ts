// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Muya } from '../../muya';

it('retains the actual backward selection before the first native Cut command', () => {
    window.MUYA_VERSION = 'test';
    const host = document.body.appendChild(document.createElement('div'));
    const muya = new Muya(host, { markdown: 'aaa\n' });
    try {
        muya.init();
        const block = muya.editor.scrollPage?.firstContentInDescendant();
        if (!block)
            throw new Error('Missing native paragraph');
        block.setCursor(2, 0, true);
        muya.editor.clipboard.cutHandler();
        muya.flush();
        expect(muya.getMarkdown()).toBe('a\n');
        muya.undo();
        muya.flush();
        expect(muya.getMarkdown()).toBe('aaa\n');
        expect({ anchor: muya.getSelection()?.anchor.offset, focus: muya.getSelection()?.focus.offset }).toEqual({ anchor: 2, focus: 0 });
        muya.redo();
        muya.flush();
        expect(muya.getMarkdown()).toBe('a\n');
        expect({ anchor: muya.getSelection()?.anchor.offset, focus: muya.getSelection()?.focus.offset }).toEqual({ anchor: 0, focus: 0 });
    }
    finally {
        muya.destroy();
        host.remove();
        document.getSelection()?.removeAllRanges();
        delete (window as Partial<Window>).MUYA_VERSION;
    }
});
