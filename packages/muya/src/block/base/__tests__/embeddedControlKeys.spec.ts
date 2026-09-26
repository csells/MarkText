// @vitest-environment happy-dom

import type Format from '../format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';

// A focusable control inside the text, such as a comment marker, owns the keys
// pressed on it. Tab moves focus on from it rather than indenting the text.

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function bootMuya(markdown: string): { muya: Muya; content: Format } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    const content = muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
    muya.editor.activeContentBlock = content as never;
    content.setCursor(5, 5);
    return { muya, content };
}

describe('keys pressed on a control inside the text', () => {
    it('leaves Tab on a focusable non-editable control to the browser', () => {
        const { content } = bootMuya('hello\n');
        const marker = document.createElement('span');
        marker.setAttribute('contenteditable', 'false');
        marker.setAttribute('role', 'button');
        marker.tabIndex = 0;
        content.domNode!.appendChild(marker);
        const tabHandler = vi.spyOn(content, 'tabHandler');
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

        marker.dispatchEvent(event);
        content.keydownHandler(event);

        expect(tabHandler).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('still indents on Tab in the text itself', () => {
        const { content } = bootMuya('hello\n');
        const tabHandler = vi.spyOn(content, 'tabHandler');
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

        content.domNode!.dispatchEvent(event);
        content.keydownHandler(event);

        expect(tabHandler).toHaveBeenCalled();
    });
});
