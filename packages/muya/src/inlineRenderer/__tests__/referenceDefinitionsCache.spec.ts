// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

function createEditor(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    return muya;
}

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

describe('inline renderer reference-definition collection', () => {
    it('collects whole-document definitions once per document version, not per block', () => {
        const muya = createEditor('seed');
        const jsonState = muya.editor.jsonState;
        const getState = vi.spyOn(jsonState, 'getState');

        const paragraphs = 80;
        const markdown = Array.from(
            { length: paragraphs },
            (_, index) => `paragraph ${index} with a [ref] link`,
        ).join('\n\n');
        muya.setContent(`[ref]: https://example.test\n\n${markdown}`);

        // A whole-tree rebuild renders every block against ONE frozen state
        // revision. Cloning the full document per block is O(blocks²) and
        // took 10k-paragraph documents past their open budget.
        const collectionClones = getState.mock.calls.length;
        expect(collectionClones).toBeLessThan(10);

        // The collected labels stay correct: the definition resolves.
        expect(
            muya.editor.inlineRenderer.labels.has('ref'),
        ).toBe(true);
    });

    it('recollects after an edit changes the document', () => {
        const muya = createEditor('[a]: https://one.test\n\nuse [a]');
        expect(muya.editor.inlineRenderer.labels.has('a')).toBe(true);

        muya.setContent('[b]: https://two.test\n\nuse [b]');
        expect(muya.editor.inlineRenderer.labels.has('b')).toBe(true);
        expect(muya.editor.inlineRenderer.labels.has('a')).toBe(false);
    });
});
