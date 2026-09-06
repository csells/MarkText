// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const hosts: HTMLElement[] = [];
afterEach(() => {
    for (const host of hosts.splice(0)) host.remove();
});

describe('native input history identity', () => {
    it('shares the native group across authority presentation and cuts off at input boundaries', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const muya = new Muya(host, { markdown: 'seed\n' } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);
        const type = (text: string) => {
            const block = muya.editor.scrollPage?.queryBlock([0, 'text']);
            if (!block?.isContent())
                throw new Error('Missing paragraph');
            muya.editor.history.markInputBoundary('insertText', text);
            block.text += text;
            muya.flush();
        };
        type('A');
        const first = muya.getInputHistoryGroup();
        expect(first).toEqual(expect.any(Number));
        type('B');
        expect(muya.getInputHistoryGroup()).toBe(first);
        muya.setContent('seedAB\n', false, { preserveInputGrouping: true });
        type('C');
        expect(muya.getInputHistoryGroup()).toBe(first);
        type(' ');
        expect(muya.getInputHistoryGroup()).toBeGreaterThan(first!);
        const second = muya.getInputHistoryGroup();
        muya.setContent('new\n');
        type('D');
        expect(muya.getInputHistoryGroup()).toBeGreaterThan(second!);
    });
});

it('keeps an explicit paragraph command separate from typing on either side', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: 'seed\n' } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    const type = (text: string) => {
        const block = muya.editor.scrollPage?.firstContentInDescendant();
        if (!block)
            throw new Error('Missing paragraph');
        muya.editor.activeContentBlock = block;
        block.setCursor(block.text.length, block.text.length);
        muya.editor.history.markInputBoundary('insertText', text);
        block.text += text;
        muya.flush();
    };
    try {
        type('A');
        const typing = muya.getInputHistoryGroup();
        muya.updateParagraph('ul-bullet');
        muya.flush();
        const formatting = muya.getInputHistoryGroup();
        expect(formatting).not.toBe(typing);
        type('!');
        expect(muya.getInputHistoryGroup()).not.toBe(formatting);
        muya.undo();
        expect(muya.getMarkdown()).toBe('- seedA\n');
    }
    finally {
        muya.destroy();
    }
});
