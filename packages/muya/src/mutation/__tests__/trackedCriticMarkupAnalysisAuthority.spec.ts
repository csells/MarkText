// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    grammarSources: [] as string[],
}));

vi.mock('../../criticMarkup/parser', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../criticMarkup/parser')
    >();
    return {
        ...actual,
        scanCriticMarkupCandidate: (
            ...args: Parameters<typeof actual.scanCriticMarkupCandidate>
        ) => {
            calls.grammarSources.push(args[0]);
            return actual.scanCriticMarkupCandidate(...args);
        },
    };
});

const { Muya } = await import('../../muya');
const { default: StateToMarkdown } = await import('../../state/stateToMarkdown');
const hosts: HTMLElement[] = [];
const editors: InstanceType<typeof Muya>[] = [];

afterEach(() => {
    calls.grammarSources.length = 0;
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: true,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    return {
        muya,
        block: muya.editor.scrollPage!.firstContentInDescendant() as Format,
    };
}

describe('tracked CriticMarkup analysis authority', () => {
    it('reuses the proof analysis while the committed tree rebuilds', () => {
        const { muya, block } = boot('ab\n');
        const tracked = 'a{++x++}b\n';

        block.domNode!.textContent = 'axb';
        block.setCursor(2, 2);
        block.inputHandler(new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText',
        }));

        expect(muya.getMarkdown()).toBe(tracked);
        expect(calls.grammarSources.filter(source => source === tracked))
            .toHaveLength(1);
        expect(muya.editor.criticMarkupDocument.get().analysis.source)
            .toBe(tracked);
    });

    it('validates staged Markdown a bounded number of times for many blocks', () => {
        const tail = Array.from(
            { length: 64 },
            (_, index) => `paragraph ${index}`,
        );
        const { muya, block } = boot(['ab', ...tail].join('\n\n'));
        const mapped = vi.spyOn(StateToMarkdown.prototype, 'generateMapped');

        block.domNode!.textContent = 'axb';
        block.setCursor(2, 2);
        block.inputHandler(new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText',
        }));

        expect(muya.getMarkdown()).toContain('a{++x++}b');
        expect(mapped.mock.calls.length).toBeLessThanOrEqual(8);
        mapped.mockRestore();
    });
});
