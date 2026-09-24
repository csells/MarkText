// @vitest-environment happy-dom
import type { DocumentEditing } from '../documentEditingTypes';
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const hosts: HTMLElement[] = [];
afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent(markdown);
    hosts.push(muya.domNode);
    const input = vi.fn(() => false);
    muya.editor.bindDocumentEditing({
        prepareImage() { throw new Error('Unexpected image preparation'); },
        prepareClipboard() { throw new Error('Unexpected clipboard preparation'); },
        emojiContext: () => undefined,
        codeLanguage: () => undefined,
        activeFormats: () => [],
        input,
        clipboard: () => { throw new Error('Unexpected clipboard'); },
        format: () => { throw new Error('Unexpected format'); },
        compositionStart: () => { throw new Error('Unexpected composition'); },
        compositionUpdate: () => { throw new Error('Unexpected composition'); },
        compositionEnd: () => { throw new Error('Unexpected composition'); },
    } as DocumentEditing);
    return { muya, input };
}

it.each(['insertText', 'deleteContentBackward', 'insertParagraph'])('keeps %s at a heading point outside its content from mutating the DOM', (inputType) => {
    const { muya, input } = boot('### B1\n');
    const heading = muya.domNode.querySelector('h3')!;
    expect(heading.querySelector('.mu-atxheading-content')).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(heading);
    range.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(muya.editor.selection.getDOMSelection()).toBeNull();
    const event = new InputEvent('beforeinput', { inputType, data: inputType === 'insertText' ? 'x' : null, bubbles: true, cancelable: true });
    heading.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input).not.toHaveBeenCalled();
});
