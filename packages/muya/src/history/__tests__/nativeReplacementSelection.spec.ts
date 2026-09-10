// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

describe('standalone native replacement history selection', () => {
    it.each(['strong', 'inline_math'] as const)('restores the selected %s payload after undoing native replacement', (format) => {
        window.MUYA_VERSION = 'test';
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const host = document.body.appendChild(document.createElement('div'));
        const muya = new Muya(host, { markdown: 'aaa\n' });
        try {
            muya.init();
            const block = muya.editor.scrollPage?.firstContentInDescendant();
            if (!block?.domNode)
                throw new Error('Missing native paragraph');
            block.setCursor(0, 3, true);
            muya.format(format);
            muya.flush();
            const formatted = muya.getMarkdown();
            // Separate the native formatting and typing history groups.
            clock.mockReturnValue(2500);
            const selected = muya.getSelection();
            if (!selected)
                throw new Error('Missing format selection');
            const prefix = format === 'strong' ? '**' : '$';
            expect({ anchor: selected.anchor.offset, focus: selected.focus.offset })
                .toEqual({ anchor: prefix.length, focus: prefix.length + 3 });
            const active = selected.focus.block;
            active.domNode!.textContent = `${prefix}X${prefix}`;
            const text = active.domNode!.firstChild;
            if (!text)
                throw new Error('Missing browser text');
            document.getSelection()?.setBaseAndExtent(text, prefix.length + 1, text, prefix.length + 1);
            active.domNode!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
            muya.flush();
            expect(muya.getMarkdown()).toBe(`${prefix}X${prefix}\n`);
            muya.undo();
            muya.flush();
            expect(muya.getMarkdown()).toBe(formatted);
            expect({
                anchor: muya.getSelection()?.anchor.offset,
                focus: muya.getSelection()?.focus.offset,
            }).toEqual({ anchor: selected.anchor.offset, focus: selected.focus.offset });
            muya.format(format);
            muya.flush();
            expect(muya.getMarkdown()).toBe('aaa\n');
        }
        finally {
            muya.destroy();
            host.remove();
            document.getSelection()?.removeAllRanges();
            clock.mockRestore();
            delete (window as Partial<Window>).MUYA_VERSION;
        }
    });
});
