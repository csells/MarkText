// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    for (const muya of editors.splice(0))
        muya.destroy();
    document.getSelection()?.removeAllRanges();
});

function boot() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: 'seed\n' });
    muya.init();
    host.remove();
    editors.push(muya);
    return muya;
}

describe('destroy with pending native input', () => {
    it('delivers the last input before removing listeners, even when the owner drain resumes later', async () => {
        const muya = boot();
        const deliveredSources: string[] = [];
        muya.on('json-change', () => deliveredSources.push(muya.getMarkdown()));
        const block = muya.editor.scrollPage?.firstContentInDescendant();
        if (!block?.domNode)
            throw new Error('Missing editable paragraph');

        block.setCursor(4, 4);
        block.domNode.textContent = 'seed!';
        block.setCursor(5, 5);
        block.domNode.dispatchEvent(new InputEvent('input', {
            data: '!',
            inputType: 'insertText',
            bubbles: true,
        }));
        expect(deliveredSources).toEqual([]);
        expect(muya.getMarkdown()).toBe('seed\n');

        const ownerDrain = Promise.resolve().then(() => muya.flush());
        muya.destroy();

        expect(deliveredSources).toEqual(['seed!\n']);
        await ownerDrain;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(deliveredSources).toEqual(['seed!\n']);
        expect(muya.getMarkdown()).toBe('seed!\n');
        expect(muya.domNode.isConnected).toBe(false);
    });
});
