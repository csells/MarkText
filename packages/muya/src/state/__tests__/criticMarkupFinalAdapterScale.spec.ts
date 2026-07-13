// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_SCALE_CORPUS_LINKS } from '../../criticMarkup/__tests__/sharedCorpus';
import { Muya } from '../../muya';
import { renderToStaticHTML } from '../renderToStaticHTML';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function scaleSource(id: (typeof CRITIC_MARKUP_SCALE_CORPUS_LINKS)[number]['id']): {
    source: string;
    itemCount: number;
} {
    switch (id) {
        case 'ordinary-no-opener-4096-lines':
            return {
                source: 'ordinary { json: true } ++ -- == >> ~~ and [link](url)\n'
                    .repeat(4_096),
                itemCount: 0,
            };
        case 'malformed-opener-run-16000':
            return { source: `${'{++'.repeat(16_000)}\n`, itemCount: 0 };
        case 'deep-balanced-additions-12000':
            return {
                source: `${'{++'.repeat(12_000)}x${'++}'.repeat(12_000)}\n`,
                itemCount: 12_000,
            };
        case 'deep-context-additions-1024':
            return {
                source: `${'{++'.repeat(1_024)}x${'++}'.repeat(1_024)}\n`,
                itemCount: 1_024,
            };
        case 'native-markdown-nesting-5000':
            return {
                source: `${'> '.repeat(5_000)}{++literal++}\n`,
                itemCount: 0,
            };
        case 'wide-adjacent-additions-257':
            return { source: `${'{++x++}'.repeat(257)}\n`, itemCount: 257 };
        case 'exclusion-heavy-prefix-1024':
            return {
                source: `${'`x` '.repeat(1_024)}{++visible++}\n`,
                itemCount: 1,
            };
    }
}

function boot(source: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown: source });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('criticMarkup executable final-adapter scale matrix', () => {
    it.each(CRITIC_MARKUP_SCALE_CORPUS_LINKS)(
        'runs $id through static Marked and live Muya adapters',
        ({ id }) => {
            const { source, itemCount } = scaleSource(id);
            const staticHtml = renderToStaticHTML(source);
            const muya = boot(source);

            expect(staticHtml).toBeTruthy();
            expect(muya.getCriticMarkupItems()).toHaveLength(itemCount);
            expect(muya.getMarkdown()).toBe(source);
            expect(muya.domNode.querySelectorAll('[data-critic-id]'))
                .toHaveLength(id.startsWith('deep-')
                    ? 64
                    : itemCount);
            if (id.startsWith('deep-')) {
                expect(staticHtml).toContain(
                    'critic-markup-render-depth-limit',
                );
                expect(muya.domNode.innerHTML).toContain(
                    'critic-markup-render-depth-limit',
                );
            }
            if (id === 'native-markdown-nesting-5000') {
                expect(staticHtml).toContain(
                    'data-markdown-diagnostic="marked-block-nesting-limit"',
                );
                expect(muya.domNode.innerHTML).toContain(
                    'data-markdown-diagnostic="marked-block-nesting-limit"',
                );
            }
        },
        60_000,
    );
});
