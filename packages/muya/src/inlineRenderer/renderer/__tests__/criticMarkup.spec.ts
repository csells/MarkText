// @vitest-environment happy-dom

import type Format from '../../../block/base/format';
import type { Muya } from '../../../muya';
import type InlineRenderer from '../../index';
import { describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_RENDER_DEPTH_LIMIT } from '../../../criticMarkup/renderPolicy';
import { mappedMarkdown, markdownStatePath } from '../../../state/markdownSourceMap';
import { parseBoundCriticMarkupDocument } from '../../../utils/marked/criticMarkupDocument';
import { tokenizer } from '../../lexer';
import Renderer from '../index';

function render(
    source: string,
    projection: 'marked' | 'original' | 'revised' = 'marked',
): string {
    const renderer = new Renderer(
        { options: { criticMarkupProjection: projection } } as Muya,
        {} as InlineRenderer,
    );
    const block = { text: source } as Format;
    const document = parseBoundCriticMarkupDocument(mappedMarkdown(
        source,
        markdownStatePath([0, 'text']),
        0,
    ));

    return renderer.output(tokenizer(source, {
        options: {
            criticMarkupDocumentFragments: document.fragmentsForPath(
                markdownStatePath([0, 'text']),
            ),
            footnote: false,
            superSubScript: true,
        },
    }), block, {});
}

describe('criticMarkup renderer', () => {
    it.each([
        ['{++new++}', 'addition', '<ins'],
        ['{--old--}', 'deletion', '<del'],
        ['{==focus==}', 'highlight', '<mark'],
    ])('renders %s as semantic HTML', (source, type, element) => {
        const html = render(source);

        expect(html).toContain(`data-critic-type="${type}"`);
        expect(html).toContain(element);
        expect(html).toContain('mu-critic-markup');
    });

    it('renders a substitution as one review item with old and new arms', () => {
        const html = render('{~~**old**~>_new_~~}');

        expect(html.match(/data-critic-type="substitution"/g)).toHaveLength(1);
        expect(html).toContain('<del');
        expect(html).toContain('<ins');
        expect(html).toContain('<strong');
        expect(html).toContain('<em');
    });

    it('renders a standalone comment as an inline review indicator', () => {
        const html = render('{>>Review this<<}');

        expect(html).toContain('data-critic-type="comment"');
        expect(html).toContain('mu-critic-comment-indicator');
        expect(html).toContain('aria-label="Review this"');
    });

    it('keeps the fragment renderer marked-only when host view state is stale', () => {
        const html = render('{++new++}', 'original');

        expect(html).toContain('data-critic-type="addition"');
        expect(html).toContain('<ins');
        expect(html).not.toContain('mu-critic-hidden');
    });

    it('surfaces the render budget while keeping excess source editable', () => {
        const excessDepth = 32;
        const depth = CRITIC_MARKUP_RENDER_DEPTH_LIMIT + excessDepth;
        const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;
        const html = render(source);
        const host = document.createElement('div');
        host.innerHTML = html;
        const diagnostic = host.querySelector<HTMLElement>(
            '[data-critic-diagnostic="critic-markup-render-depth-limit"]',
        );

        expect(host.querySelectorAll('[data-critic-type="addition"]'))
            .toHaveLength(CRITIC_MARKUP_RENDER_DEPTH_LIMIT);
        expect(diagnostic?.textContent).toBe(
            `${'{++'.repeat(excessDepth)}x${'++}'.repeat(excessDepth)}`,
        );
        expect(diagnostic?.classList.contains('mu-critic-render-limit'))
            .toBe(true);
        expect(diagnostic?.title).toContain('shown as literal source');
    });
});
