// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    grammarSources: [] as string[],
    lexSources: [] as string[],
    prefilterSources: [] as string[],
}));

vi.mock('../../criticMarkup/parser', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../criticMarkup/parser')
    >();
    return {
        ...actual,
        prepareCriticMarkupCandidateIdentity: (
            ...args: Parameters<
                typeof actual.prepareCriticMarkupCandidateIdentity
            >
        ) => {
            calls.prefilterSources.push(args[0]);
            return actual.prepareCriticMarkupCandidateIdentity(...args);
        },
        scanCriticMarkupCandidate: (
            ...args: Parameters<typeof actual.scanCriticMarkupCandidate>
        ) => {
            calls.grammarSources.push(args[0]);
            return actual.scanCriticMarkupCandidate(...args);
        },
    };
});

vi.mock('../../utils/marked/lexBlock', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../utils/marked/lexBlock')
    >();
    return {
        ...actual,
        lexBlock: (...args: Parameters<typeof actual.lexBlock>) => {
            calls.lexSources.push(args[0]);
            return actual.lexBlock(...args);
        },
    };
});

const { Muya } = await import('../../muya');
const { MarkdownToHtml } = await import('../markdownToHtml');
const hosts: HTMLElement[] = [];
const editors: InstanceType<typeof Muya>[] = [];

afterEach(() => {
    calls.grammarSources.length = 0;
    calls.lexSources.length = 0;
    calls.prefilterSources.length = 0;
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown: source });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('criticMarkup export analysis authority', () => {
    it.each(['marked', 'revised'] as const)(
        'rebinds the live %s analysis without another grammar scan',
        async (projection) => {
            const source = 'before {++new++} after\n';
            const muya = boot(source);
            muya.options.criticMarkupProjection = projection;
            muya.editor.criticMarkupDocument.getContext();
            calls.grammarSources.length = 0;
            calls.lexSources.length = 0;
            calls.prefilterSources.length = 0;

            const html = await new MarkdownToHtml(source, muya).renderHtml();

            expect(html).toContain('new');
            expect(calls.grammarSources.filter(value => value === source))
                .toHaveLength(0);
            expect(calls.lexSources.filter(value => value === source))
                .toHaveLength(0);
            expect(calls.prefilterSources.filter(value => value === source))
                .toHaveLength(0);
        },
    );

    it('keeps a no-opener clean export on the zero-scan fast path', async () => {
        const source = 'ordinary Markdown\n';
        const muya = boot(source);
        muya.options.criticMarkupProjection = 'revised';
        calls.grammarSources.length = 0;
        calls.prefilterSources.length = 0;

        const html = await new MarkdownToHtml(source, muya).renderHtml();

        expect(html).toContain('ordinary Markdown');
        expect(calls.grammarSources).toEqual([]);
        expect(calls.prefilterSources).toEqual([]);
    });

    it('falls back instead of binding a live analysis to other Markdown', async () => {
        const muya = boot('live {++document++}\n');
        const exported = 'other {++source++}\n';
        calls.grammarSources.length = 0;

        const html = await new MarkdownToHtml(exported, muya).renderHtml();

        expect(html).toContain('source');
        expect(calls.grammarSources.filter(value => value === exported))
            .toHaveLength(1);
    });
});
