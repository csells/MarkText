// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
    FRONT_MATTER_CORPUS,
    IDENTICAL_SUBSTITUTION_ARM_CORPUS,
} from '../../criticMarkup/__tests__/sharedCorpus';
import { Muya } from '../../muya';
import { getClipBoardHtml } from '../../utils/marked/getClipboardHtml';
import { MarkdownToHtml } from '../markdownToHtml';
import { renderToStaticHTML } from '../renderToStaticHTML';

const SOURCE = '{++new++} {--old--} {~~old~>new~~} {==focus==} {>>note<<}';

describe('criticMarkup HTML pipelines', () => {
    it('enables semantic CriticMarkup in static HTML by default', () => {
        const html = renderToStaticHTML(SOURCE, { sanitize: false });

        expect(html).toContain('data-critic-type="addition"');
        expect(html).toContain('data-critic-type="deletion"');
        expect(html).toContain('data-critic-type="substitution"');
        expect(html).toContain('data-critic-type="highlight"');
        expect(html).toContain('data-critic-type="comment"');
    });

    it('preserves CriticMarkup semantics through the export sanitizer', () => {
        const html = renderToStaticHTML('{++new++}');

        expect(html).toContain('data-critic-type="addition"');
    });

    it('forwards original and revised projections to the parser extension', () => {
        const original = renderToStaticHTML(SOURCE, {
            criticMarkupProjection: 'original',
            sanitize: false,
        });
        const revised = renderToStaticHTML(SOURCE, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        });

        expect(original.trim()).toBe('<p> old old focus </p>');
        expect(revised.trim()).toBe('<p>new  new focus </p>');
    });

    it('projects additions that cross a paragraph boundary before block parsing', () => {
        const source = 'first{++\n\n++}second';

        expect(renderToStaticHTML(source, {
            criticMarkupProjection: 'original',
            sanitize: false,
        })).toBe('<p>firstsecond</p>\n');
        expect(renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        })).toBe('<p>first</p>\n<p>second</p>\n');
    });

    it('renders one linked marked-up addition across native block tokens', () => {
        const html = renderToStaticHTML(
            'before {++one\n\n# two++} after\n',
            { sanitize: false },
        );

        expect(html).not.toContain('{++');
        expect(html).not.toContain('++}');
        expect(html.match(/data-critic-id="critic-7-23"/g))
            .toHaveLength(2);
        expect(html).toContain('data-critic-role="start"');
        expect(html).toContain('data-critic-role="end"');
        expect(html).toMatch(/<p>before <ins[^>]*>one<\/ins><\/p>/);
        expect(html).toMatch(/<h1><ins[^>]*>two<\/ins> after<\/h1>/);
    });

    it('re-lexes substitution arms after removing cross-block Critic markers', () => {
        const html = renderToStaticHTML(
            '{~~old ~~strike~~\n\n# tail~>new\n\nend~~}\n',
            { sanitize: false },
        );
        const root = document.createElement('div');
        root.innerHTML = html;
        const fragments = Array.from(root.querySelectorAll<HTMLElement>(
            '[data-critic-type="substitution"]',
        ));

        expect(fragments).toHaveLength(3);
        expect(fragments.map(fragment => fragment.dataset.criticRole))
            .toEqual(['start', 'middle', 'end']);
        expect(new Set(fragments.map(fragment => fragment.dataset.criticId)).size)
            .toBe(1);
        expect(fragments[0].querySelectorAll('del')).toHaveLength(2);
        expect(fragments[0].textContent).toBe('old strike');
        expect(fragments[1].querySelector(':scope > del')?.textContent)
            .toBe('tail');
        expect(fragments[1].querySelector(':scope > ins')?.textContent)
            .toBe('new');
        expect(fragments[2].querySelector(':scope > ins')?.textContent)
            .toBe('end');
    });

    it.each([
        ['deletion', '{--one\n\ntwo--}'],
        ['highlight', '{==one\n\ntwo==}'],
        ['comment', '{>>one\n\ntwo<<}'],
    ] as const)('renders linked %s fragments without raw markers', (type, source) => {
        const html = renderToStaticHTML(source, { sanitize: false });
        const root = document.createElement('div');
        root.innerHTML = html;
        const fragments = Array.from(root.querySelectorAll<HTMLElement>(
            `[data-critic-type="${type}"]`,
        ));

        expect(fragments).toHaveLength(2);
        expect(fragments.map(fragment => fragment.dataset.criticRole))
            .toEqual(['start', 'end']);
        expect(new Set(fragments.map(fragment => fragment.dataset.criticId)).size)
            .toBe(1);
        expect(html).not.toContain(source.slice(0, 3));
        expect(html).not.toContain(source.slice(-3));
    });

    it('keeps nested cross-block items linked to distinct semantic IDs', () => {
        const html = renderToStaticHTML(
            '{++outer\n\n{--inner\n\ntail--} end++}\n',
            { sanitize: false },
        );
        const root = document.createElement('div');
        root.innerHTML = html;
        const additions = root.querySelectorAll(
            '[data-critic-type="addition"]',
        );
        const deletions = root.querySelectorAll(
            '[data-critic-type="deletion"]',
        );

        expect(additions).toHaveLength(3);
        expect(deletions).toHaveLength(2);
        expect(
            additions[0].getAttribute('data-critic-id'),
        ).not.toBe(deletions[0].getAttribute('data-critic-id'));
        expect(
            additions[1].querySelector('[data-critic-type="deletion"]'),
        ).not.toBeNull();
    });

    it('maps linked fragments through native blockquote prefixes', () => {
        const html = renderToStaticHTML([
            '> before {++one',
            '>',
            '> two++} after',
        ].join('\n'), { sanitize: false });
        const root = document.createElement('div');
        root.innerHTML = html;
        const fragments = root.querySelectorAll(
            'blockquote [data-critic-type="addition"]',
        );

        expect(fragments).toHaveLength(2);
        expect(fragments[0].textContent).toBe('one');
        expect(fragments[1].textContent).toBe('two');
    });

    it('maps linked fragments through loose list-item prefixes', () => {
        const html = renderToStaticHTML([
            '- before {++one',
            '',
            '  two++} after',
        ].join('\n'), { sanitize: false });
        const root = document.createElement('div');
        root.innerHTML = html;
        const fragments = root.querySelectorAll(
            'li [data-critic-type="addition"]',
        );

        expect(fragments).toHaveLength(2);
        expect(fragments[0].textContent).toBe('one');
        expect(fragments[1].textContent).toBe('two');
    });

    it('maps linked fragments across table cells with escaped pipes', () => {
        const html = renderToStaticHTML([
            '| first | second |',
            '| --- | --- |',
            String.raw`| {++a\|b | two++} |`,
        ].join('\n'), { sanitize: false });
        const root = document.createElement('div');
        root.innerHTML = html;
        const fragments = root.querySelectorAll(
            'td [data-critic-type="addition"]',
        );

        expect(fragments).toHaveLength(2);
        expect(fragments[0].textContent).toBe('a|b');
        expect(fragments[1].textContent).toBe('two');
    });

    it('preserves linked fragment identity through default sanitization', () => {
        const html = renderToStaticHTML(
            'before {++one\n\n# two++} after\n',
        );

        expect(html.match(/data-critic-id="critic-7-23"/g))
            .toHaveLength(2);
        expect(html).toContain('data-critic-role="start"');
        expect(html).toContain('data-critic-role="end"');
    });

    it('does not project CriticMarkup-looking bytes in literal Markdown contexts', () => {
        const source = [
            '[link](https://example.test/{++path++})',
            '',
            '<span title="{--attribute--}">text</span>',
            '',
            '<https://example.test/{++path++}>',
        ].join('\n');
        const html = renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        });

        expect(html).toContain('href="https://example.test/%7B++path++%7D"');
        expect(html).toContain('title="{--attribute--}"');
        expect(html.match(/href="https:\/\/example\.test\/%7B\+\+path\+\+%7D"/g))
            .toHaveLength(2);
    });

    it('still projects visible link text while protecting its destination', () => {
        const html = renderToStaticHTML(
            '[x {++yes++}](https://example.test/{++path++})',
            {
                criticMarkupProjection: 'revised',
                sanitize: false,
            },
        );

        expect(html).toContain('>x yes</a>');
        expect(html).toContain('href="https://example.test/%7B++path++%7D"');
    });

    it('protects literal contexts nested inside a substitution arm', () => {
        const html = renderToStaticHTML(
            '{~~old~>[new](https://example.test/{++path++})~~}',
            {
                criticMarkupProjection: 'revised',
                sanitize: false,
            },
        );

        expect(html).toContain('>new</a>');
        expect(html).toContain('href="https://example.test/%7B++path++%7D"');
    });

    it('projects tables with escaped pipes without losing visible changes', () => {
        const source = [
            '| escaped | change |',
            '| --- | --- |',
            String.raw`| a\|b | {++new++} |`,
        ].join('\n');

        expect(() => renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        })).not.toThrow();
        expect(renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        })).toContain('<td>new</td>');
        expect(renderToStaticHTML(source, {
            criticMarkupProjection: 'original',
            sanitize: false,
        })).toContain('<td></td>');
    });

    it('protects CriticMarkup-looking bytes in reference definitions', () => {
        const source = [
            '[id]: https://example.test/{++path++} "{--title--}"',
            '',
            '[link][id] {++visible++}',
        ].join('\n');
        const html = renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        });

        expect(html).toContain('href="https://example.test/%7B++path++%7D"');
        expect(html).toContain('title="{--title--}"');
        expect(html).toContain('</a> visible');
    });

    it('source-maps literal and visible ranges inside loose blockquotes', () => {
        const source = [
            '> a',
            '>',
            '> `{++literal++}`',
            '>',
            '> {++visible++}',
        ].join('\n');

        const original = renderToStaticHTML(source, {
            criticMarkupProjection: 'original',
            sanitize: false,
        });
        const revised = renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        });

        expect(original).toContain('<code>{++literal++}</code>');
        expect(original).not.toContain('visible');
        expect(revised).toContain('<code>{++literal++}</code>');
        expect(revised).toContain('<p>visible</p>');
    });

    it('source-maps literal and visible ranges inside loose list items', () => {
        const source = [
            '- a',
            '',
            '  `{++literal++}`',
            '',
            '  {++visible++}',
        ].join('\n');

        const original = renderToStaticHTML(source, {
            criticMarkupProjection: 'original',
            sanitize: false,
        });
        const revised = renderToStaticHTML(source, {
            criticMarkupProjection: 'revised',
            sanitize: false,
        });

        expect(original).toContain('<code>{++literal++}</code>');
        expect(original).not.toContain('visible');
        expect(revised).toContain('<code>{++literal++}</code>');
        expect(revised).toContain('<p>visible</p>');
    });

    it('uses the same native extension for clipboard HTML', () => {
        const html = getClipBoardHtml('{~~old~>new~~}');

        expect(html).toContain('data-critic-type="substitution"');
    });

    it('uses linked document fragments for rich clipboard HTML', () => {
        const html = getClipBoardHtml('before {++one\n\n# two++} after\n');

        expect(html.match(/data-critic-id="critic-7-23"/g))
            .toHaveLength(2);
        expect(html).not.toContain('{++');
        expect(html).not.toContain('++}');
    });

    it('can be disabled for strict CommonMark and GFM conformance', () => {
        const html = renderToStaticHTML('{++literal++}', {
            criticMarkup: false,
            sanitize: false,
        });

        expect(html).toBe('<p>{++literal++}</p>\n');
    });

    it('threads the active projection through the primary HTML exporter', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: SOURCE,
            criticMarkupProjection: 'original',
        });
        muya.init();

        try {
            const html = await new MarkdownToHtml(SOURCE, muya).renderHtml();

            expect(html).toContain(' old old focus ');
            expect(html).not.toContain('critic-addition');
        }
        finally {
            host.remove();
        }
    });

    it('threads the disabled front-matter profile through HTML export', async () => {
        const source = '---\ntitle: {++new++}\n---\n';
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: source,
            frontMatter: false,
        });
        muya.init();

        try {
            const html = await new MarkdownToHtml(source, muya).renderHtml();

            expect(html).toContain('data-critic-type="addition"');
            expect(html).toContain('new</ins>');
        }
        finally {
            muya.destroy();
            host.remove();
        }
    });

    it.each(FRONT_MATTER_CORPUS)(
        'keeps $id non-semantic in static and clipboard HTML',
        (row) => {
            const staticOriginal = renderToStaticHTML(row.source, {
                ...row.options,
                criticMarkupProjection: 'original',
                sanitize: false,
            });
            const staticRevised = renderToStaticHTML(row.source, {
                ...row.options,
                criticMarkupProjection: 'revised',
                sanitize: false,
            });
            const clipboardOriginal = getClipBoardHtml(row.source, {
                ...row.options,
                criticMarkupProjection: 'original',
            });
            const clipboardRevised = getClipBoardHtml(row.source, {
                ...row.options,
                criticMarkupProjection: 'revised',
            });

            expect(staticOriginal).toBe(staticRevised);
            expect(clipboardOriginal).toBe(clipboardRevised);
            for (const html of [
                staticOriginal,
                staticRevised,
                clipboardOriginal,
                clipboardRevised,
            ]) {
                expect(html).toContain('{++literal++}');
                expect(html).not.toContain('data-critic-type');
            }
        },
    );

    it.each(IDENTICAL_SUBSTITUTION_ARM_CORPUS)(
        'preserves repeated literal link destinations for $id in every HTML adapter',
        (row) => {
            for (const projection of ['original', 'revised'] as const) {
                const staticHtml = renderToStaticHTML(row.source, {
                    criticMarkupProjection: projection,
                    sanitize: false,
                });
                const clipboardHtml = getClipBoardHtml(row.source, {
                    criticMarkupProjection: projection,
                });

                for (const html of [staticHtml, clipboardHtml]) {
                    expect(html).toContain('href="u%7B++v++%7D"');
                    expect(html).not.toContain('href="uv"');
                }
            }
        },
    );
});
