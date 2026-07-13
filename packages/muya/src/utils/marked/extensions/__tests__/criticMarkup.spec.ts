// @vitest-environment happy-dom

import type { Tokens } from 'marked';
import type { ILexOption } from '../../types';
import { Marked } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { CriticMarkupDocument } from '../../../../criticMarkup/document';
import { CRITIC_MARKUP_RENDER_DEPTH_LIMIT } from '../../../../criticMarkup/renderPolicy';
import { HalfOpenIntervalIndex } from '../../../../mapped-range';
import { getHighlightHtml } from '../../getHighlightHtml';
import criticMarkupDocumentExtension from '../criticMarkupDocument';
import mathExtension from '../math';

function render(source: string) {
    const marked = new Marked();
    marked.use(criticMarkupDocumentExtension(source));

    return marked.parse(source) as string;
}

function renderProjection(
    source: string,
    projection: 'original' | 'revised',
): string {
    return getHighlightHtml(source, {
        criticMarkup: true,
        criticMarkupProjection: projection,
    });
}

describe('marked criticMarkup extension', () => {
    it('keeps fragment rendering marked-only for legacy projection-shaped input', () => {
        const source = '{++new++}';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            projection: 'original',
        } as never));

        const html = marked.parse(source) as string;

        expect(html).toContain('data-critic-type="addition"');
        expect(html).toContain('<ins');
    });

    it('creates one native semantic token for a substitution', () => {
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension('{~~old~>new~~}'));
        let token: Tokens.Generic | undefined;
        marked.use({
            walkTokens(candidate) {
                if (candidate.type === 'criticMarkupDocumentFragment')
                    token = candidate as Tokens.Generic;
            },
        });

        marked.parse('{~~old~>new~~}');

        expect(token?.type).toBe('criticMarkupDocumentFragment');
        expect(token?.criticType).toBe('substitution');
        expect(token?.oldTokens).toBeDefined();
        expect(token?.newTokens).toBeDefined();
    });

    it('exposes both substitution arms to Marked walkTokens', () => {
        const seen: string[] = [];
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension('{~~**old**~>_new_~~}'));
        marked.use({
            walkTokens(token) {
                seen.push(token.type);
            },
        });

        marked.parse('{~~**old**~>_new_~~}');

        expect(seen).toContain('strong');
        expect(seen).toContain('em');
    });

    it('exposes semantic children to Marked walkTokens', () => {
        const seen: string[] = [];
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension('{++**new**++}'));
        marked.use({
            walkTokens(token) {
                seen.push(token.type);
            },
        });

        marked.parse('{++**new**++}');

        expect(seen).toContain('strong');
    });

    it.each([
        ['{++new++}', 'addition', '<ins'],
        ['{--old--}', 'deletion', '<del'],
        ['{==focus==}', 'highlight', '<mark'],
        ['{>>note<<}', 'comment', 'critic-comment'],
    ])('renders %s in the marked projection', (source, type, fragment) => {
        const html = render(source);

        expect(html).toContain(`data-critic-type="${type}"`);
        expect(html).toContain(fragment);
    });

    it('renders both substitution arms as one marked review item', () => {
        const html = render('{~~**old**~>_new_~~}');

        expect(html.match(/data-critic-type="substitution"/g)).toHaveLength(1);
        expect(html).toContain('<del><strong>old</strong></del>');
        expect(html).toContain('<ins><em>new</em></ins>');
    });

    it('renders nested CriticMarkup as nested semantic HTML', () => {
        const html = render('{++outer {++inner++} tail++}');

        expect(html.match(/data-critic-type="addition"/g)).toHaveLength(2);
        expect(html).toContain('outer <ins');
        expect(html).toContain('inner</ins> tail');
    });

    it('ignores delimiter-looking text inside a nested code span', () => {
        const source = '{++before `literal ++}` after++}';
        const html = render(source);

        expect(html.match(/data-critic-type="addition"/g)).toHaveLength(1);
        expect(html).toContain('<code>literal ++}</code>');
        expect(html).toContain(' after</ins>');
    });

    it('leaves substitutions with multiple top-level separators literal', () => {
        expect(render('{~~a~>b~>c~~}')).not.toContain('data-critic-type');
    });

    it('keeps delimiter-looking link destinations inside the outer review item', () => {
        const source = '{++before [x](https://example.test/++}) after++}';
        const html = render(source);

        expect(html.match(/critic-addition/g)).toHaveLength(1);
        expect(html).toContain('<a href="https://example.test/++%7D">x</a>');
        expect(html).toContain(' after</ins>');
    });

    it('keeps delimiter-looking HTML attributes inside the outer review item', () => {
        const source = '{++before <span data-value="++}">x</span> after++}';
        const html = render(source);

        expect(html.match(/critic-addition/g)).toHaveLength(1);
        expect(html).toContain('<span data-value="++}">x</span>');
        expect(html).toContain(' after</ins>');
    });

    it('uses the active math extension when classifying literal contexts', () => {
        const marked = new Marked();
        const source = '{++before $x ++} y$ after++}';
        marked.use(criticMarkupDocumentExtension(source));
        marked.use(mathExtension({ useKatexRender: false }));
        const html = marked.parse(source) as string;

        expect(html.match(/critic-addition/g)).toHaveLength(1);
        expect(html).toContain('before $x ++} y$ after</ins>');
    });

    it('rejects relabeling a token tree with different parser options', () => {
        const source = '$x {++literal++}$';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { math: true },
        }));

        const actualParserOptions: ILexOption = { math: false };
        expect(() => marked.parse(source, actualParserOptions))
            .toThrow(/parser options differ/);
    });

    it('uses the active lexer reference-definition table for context', () => {
        const source = [
            '{++before [x][id++}] after++}',
            '',
            '[id++}]: https://example.test',
        ].join('\n');
        const html = render(source);

        expect(html.match(/critic-addition/g)).toHaveLength(1);
        expect(html).toContain('<a href="https://example.test">x</a>');
        expect(html).toContain(' after</ins>');
    });

    it('does not materialize every shrinking suffix for dense adjacent changes', () => {
        const item = '{++x++}';
        const source = item.repeat(2_000);
        const pathLookups = vi.spyOn(
            CriticMarkupDocument.prototype,
            'fragmentsForPath',
        );
        const originalSlice = String.prototype.slice;
        let shrinkingSuffixes = 0;
        const slice = vi.spyOn(String.prototype, 'slice').mockImplementation(
            function (this: string, start?: number, end?: number) {
                const value = String(this);
                if (
                    end === undefined
                    && start === item.length
                    && value.length >= item.length * 100
                    && value.startsWith(item + item)
                ) {
                    shrinkingSuffixes++;
                }

                return originalSlice.call(value, start, end);
            },
        );

        let html: string;
        let pathLookupCount = 0;
        try {
            html = render(source);
        }
        finally {
            pathLookupCount = pathLookups.mock.calls.length;
            slice.mockRestore();
            pathLookups.mockRestore();
        }

        expect(html.match(/critic-addition/g)).toHaveLength(2_000);
        // A bounded number would allow parser setup/teardown. A suffix cache
        // that copies the remaining document after every item is linear here
        // and fails this structural complexity assertion without timing noise.
        expect(shrinkingSuffixes).toBeLessThan(10);
        expect(pathLookupCount).toBe(1);
    });

    it('assigns each dense native-wrapper item to a container exactly once', () => {
        const count = 257;
        const source = `**${'{++x++}'.repeat(count)}**`;
        const containment = vi.spyOn(
            HalfOpenIntervalIndex.prototype,
            'containingRange',
        );

        let html: string;
        let containmentCalls = 0;
        try {
            html = render(source);
        }
        finally {
            containmentCalls = containment.mock.calls.length;
            containment.mockRestore();
        }

        expect(html.match(/critic-addition/g)).toHaveLength(count);
        expect(containmentCalls).toBe(count);
    });

    it('renders over-budget nesting as exact literal source with a diagnostic', () => {
        const excessDepth = 512;
        const depth = CRITIC_MARKUP_RENDER_DEPTH_LIMIT + excessDepth;
        const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;
        const html = render(source);
        const host = document.createElement('div');
        host.innerHTML = html;
        const diagnostic = host.querySelector<HTMLElement>(
            '[data-critic-diagnostic="critic-markup-render-depth-limit"]',
        );
        const literal = `${'{++'.repeat(excessDepth)}x${'++}'.repeat(excessDepth)}`;

        expect(html.match(/critic-addition/g)).toHaveLength(
            CRITIC_MARKUP_RENDER_DEPTH_LIMIT,
        );
        expect(host.querySelectorAll('.critic-render-limit')).toHaveLength(1);
        expect(diagnostic?.textContent).toBe(literal);
        expect(diagnostic?.title).toContain(
            `${CRITIC_MARKUP_RENDER_DEPTH_LIMIT} render levels`,
        );
    });

    it.each([
        ['original', '<p> old old focus </p>'],
        ['revised', '<p>new  new focus </p>'],
    ] as const)('renders the %s projection', (projection, expected) => {
        const source = '{++new++} {--old--} {~~old~>new~~} {==focus==} {>>note<<}';

        expect(renderProjection(source, projection).trim()).toBe(expected);
    });

    it('leaves CriticMarkup-looking text inside code literal', () => {
        const fenced = render('````md\n{--fenced--}\n````');

        expect(render('`{++inline++}`')).toContain('<code>{++inline++}</code>');
        expect(fenced).toContain('{--fenced--}');
        expect(fenced).not.toContain('data-critic-type');
    });

    it('keeps ordinary GFM strikethrough distinct from substitution', () => {
        const marked = new Marked({ gfm: true });
        const source = '~~strike~~ {~~old~>new~~}';
        marked.use(criticMarkupDocumentExtension(source));
        const html = marked.parse(source) as string;

        expect(html.match(/<del>/g)).toHaveLength(2);
        expect(html.match(/data-critic-type="substitution"/g)).toHaveLength(1);
    });

    it.each([
        {
            source: '[label {++new++}](https://example.test)',
            open: '<a href="https://example.test">label <ins',
            close: 'new</ins></a>',
        },
        {
            source: '*before {++new++} after*',
            open: '<em>before <ins',
            close: 'new</ins> after</em>',
        },
        {
            source: '[label {++new++}][id]\n\n[id]: https://example.test',
            open: '<a href="https://example.test">label <ins',
            close: 'new</ins></a>',
        },
    ])('preserves the enclosing native Markdown token for $source', ({
        source,
        open,
        close,
    }) => {
        const html = render(source);

        expect(html).toContain(open);
        expect(html).toContain(close);
    });

    it('uses the revised plain-text meaning in image alt text', () => {
        const source = '![{++new++} {--old--} {~~old~>new~~} {==focus==} {>>note<<}](image.png)';

        expect(render(source)).toContain('alt="new  new focus "');
        expect(render(source)).not.toContain('alt="&lt;ins');
    });

    it('uses the selected projection in image alt text', () => {
        const source = '![{++new++} {--old--} {~~old~>new~~} {==focus==} {>>note<<}](image.png)';

        expect(renderProjection(source, 'original'))
            .toContain('alt=" old old focus "');
    });

    it('keeps image destinations and titles literal while projecting the alternative', () => {
        const source = '![{++new++}](img/{--path--}.png "{>>title<<}")';
        const html = render(source);

        expect(html).toContain('alt="new"');
        expect(html).toContain('src="img/%7B--path--%7D.png"');
        expect(html).toContain('title="{&gt;&gt;title&lt;&lt;}"');
        expect(html).not.toContain('data-critic-type');
    });

    it('projects reference-image alternatives through the same canonical model', () => {
        const source = '![{--old--} {++new++}][pic]\n\n[pic]: image.png\n';

        expect(render(source)).toContain('alt=" new"');
        expect(renderProjection(source, 'original')).toContain('alt="old "');
    });
});
