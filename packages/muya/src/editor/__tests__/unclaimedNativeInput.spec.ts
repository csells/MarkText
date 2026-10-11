// @vitest-environment happy-dom
import type { DocumentEditing } from '../documentEditingTypes';
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// With a bound model every native edit is the model's: Muya submits it, or
// keeps the browser from making it. None reaches Muya's own reading of the
// text (its inline tokenizer, auto-pairing and block conversion) (B9).

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
    const input = vi.fn((_operation: unknown, _apply: () => void) => false);
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

function caretIn(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
}

// Chromium reports these with no `data`; happy-dom fills in an empty string.
function withoutData(event: InputEvent): InputEvent {
    Object.defineProperty(event, 'data', { value: null });
    return event;
}

function textNodeOf(element: Element): Text {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode() as Text;
}

it('submits typing in a table cell while the button is still down on it', () => {
    const { muya, input } = boot('| a | b |\n| - | - |\n| cell | d |\n');
    const cell = [...muya.domNode.querySelectorAll('td')].find(node => node.textContent === 'cell')!;
    caretIn(textNodeOf(cell), 2);
    // happy-dom's MouseEvent lacks the `x` a real pointer event has.
    const press = new MouseEvent('mousedown', { bubbles: true, button: 0 });
    Object.defineProperty(press, 'x', { value: 0 });
    cell.dispatchEvent(press);
    expect(muya.editor.selection.table.hasSelection).toBe(true);
    expect(muya.editor.selection.table.hasRectangle).toBe(false);
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true });
    cell.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveBeenCalledTimes(1);
    expect((input.mock.calls[0]![0] as { data: string }).data).toBe('x');
    const release = new MouseEvent('mouseup', { bubbles: true });
    Object.defineProperty(release, 'x', { value: 0 });
    document.dispatchEvent(release);
});

it('submits a spelling correction whose replacement the browser states in dataTransfer', () => {
    const { muya, input } = boot('Teh word\n');
    const paragraph = muya.domNode.querySelector('.mu-paragraph-content')!;
    const text = textNodeOf(paragraph);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const dataTransfer = { getData: (type: string) => type === 'text/plain' ? 'The' : '' } as unknown as DataTransfer;
    const event = withoutData(new InputEvent('beforeinput', { inputType: 'insertReplacementText', bubbles: true, cancelable: true }));
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    paragraph.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveBeenCalledTimes(1);
    expect((input.mock.calls[0]![0] as { data: string; inputType: string })).toMatchObject({ data: 'The', inputType: 'insertReplacementText' });
});

it('keeps the browser from inserting text it does not state', () => {
    const { muya, input } = boot('Teh word\n');
    const paragraph = muya.domNode.querySelector('.mu-paragraph-content')!;
    caretIn(textNodeOf(paragraph), 3);
    const event = withoutData(new InputEvent('beforeinput', { inputType: 'insertReplacementText', bubbles: true, cancelable: true }));
    paragraph.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input).not.toHaveBeenCalled();
});

it('reads unclaimed native text as written, without pairing or converting it', () => {
    const { muya } = boot('plain\n');
    const paragraph = muya.domNode.querySelector('.mu-paragraph-content')!;
    const text = textNodeOf(paragraph);
    text.data = '# plain (';
    caretIn(text, text.data.length);
    paragraph.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '(', bubbles: true }));
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    expect(block.text).toBe('# plain (');
    expect(block.blockName).toBe('paragraph.content');
});

// Muya's DOM holds text its model lacks only while a native composition's
// text awaits the model's commit. A deletion there has no model position;
// the browser must not make it either.
it.each([
    { inputType: 'deleteContentBackward', caret: 4 },
    { inputType: 'deleteContentForward', caret: 3 },
])('prevents a $inputType whose deleted range has no DOM point', ({ inputType, caret }) => {
    const { muya, input } = boot('ab\n');
    const paragraph = muya.domNode.querySelector('.mu-paragraph-content')!;
    const text = textNodeOf(paragraph);
    text.data = 'abXY';
    caretIn(text, caret);
    const event = withoutData(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
    paragraph.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input).not.toHaveBeenCalled();
    expect(text.data).toBe('abXY');
});
