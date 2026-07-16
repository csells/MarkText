// @vitest-environment jsdom
import type Format from '../format';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

function createEditor(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;
    return { muya, block };
}

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

describe('input with no committed cursor', () => {
    // The mutation gateway flushes pending boundaries before user input, so
    // the first keystroke after a UI interaction can arrive with no committed
    // selection. Red evidence: at fdc48c4f this crashed the input path
    // (`Cannot read properties of null (reading 'offset')` in autoPair via
    // the slash-menu E2E) and the broken block swallowed later keystrokes.
    it('ignores a keystroke without a committed cursor and recovers on the next one', () => {
        const { muya, block } = createEditor('seed');
        muya.editor.selection.clear();
        muya.editor.activeContentBlock = null;

        block.domNode!.textContent = 'seed/';
        expect(() => {
            muya.editor.mutationGateway.run({ kind: 'user-edit' }, () => {
                block.inputHandler(new InputEvent('input', {
                    bubbles: true,
                    data: '/',
                    inputType: 'insertText',
                }));
            });
        }).not.toThrow();
        // With no cursor there is no safe edit position: the event is
        // ignored and the model stays consistent.
        expect(block.text).toBe('seed');

        // The next keystroke with a committed cursor lands normally.
        block.setCursor(5, 5);
        muya.editor.mutationGateway.run({ kind: 'user-edit' }, () => {
            block.inputHandler(new InputEvent('input', {
                bubbles: true,
                data: '/',
                inputType: 'insertText',
            }));
        });
        expect(block.text).toBe('seed/');
    });
});
