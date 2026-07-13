// @vitest-environment jsdom

import type { ICriticMarkupCorpusRow } from '../../criticMarkup/__tests__/sharedCorpus';
import { describe, expect, it } from 'vitest';
import { HOSTILE_CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { getSanitizeClipboardHtml } from '../../utils/marked/getClipboardHtml';
import { renderToStaticHTML } from '../renderToStaticHTML';

const URL_ATTRIBUTES = new Set([
    'action',
    'formaction',
    'href',
    'poster',
    'src',
    'xlink:href',
]);

function expectInertHtml(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('script')).toBeNull();
    for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
            expect(attribute.name.toLowerCase()).not.toMatch(/^on/);
            expect(attribute.name.toLowerCase()).not.toBe('srcdoc');
            if (URL_ATTRIBUTES.has(attribute.name.toLowerCase())) {
                const compactValue = attribute.value
                    .split('')
                    .filter(character => character.charCodeAt(0) > 0x20)
                    .join('')
                    .toLowerCase();
                expect(compactValue)
                    .not
                    .toMatch(/^(?:javascript|vbscript|data):/);
            }
        }
    }

    return root;
}

function expectCriticSemantics(
    root: HTMLElement,
    row: ICriticMarkupCorpusRow,
) {
    const items = new Map<string, {
        type: string;
        start: number;
        end: number;
    }>();

    for (const element of root.querySelectorAll<HTMLElement>(
        '[data-critic-id]',
    )) {
        expect(element.dataset.criticId).toMatch(/^critic-\d+-\d+$/);
        expect(element.dataset.criticRole)
            .toMatch(/^(?:only|start|middle|end)$/);
        expect(element.dataset.criticType).toBeTruthy();
        const start = Number(element.dataset.start);
        const end = Number(element.dataset.end);
        expect(Number.isInteger(start)).toBe(true);
        expect(Number.isInteger(end)).toBe(true);
        expect(end).toBeGreaterThan(start);

        const id = element.dataset.criticId!;
        const summary = {
            type: element.dataset.criticType!,
            start,
            end,
        };
        expect(items.get(id) ?? summary).toEqual(summary);
        items.set(id, summary);
    }

    expect([...items.values()]
        .sort((left, right) => left.start - right.start)
        .map(item => item.type))
        .toEqual(row.expected.itemTypes);
    expect(items.size).toBe(row.expected.itemRaw.length);
}

describe('criticMarkup final HTML sink security', () => {
    it('covers every semantic Critic form with hostile final-sink input', () => {
        expect(new Set(HOSTILE_CRITIC_MARKUP_CORPUS.flatMap(
            row => row.expected.itemTypes,
        ))).toEqual(new Set([
            'addition',
            'deletion',
            'substitution',
            'highlight',
            'comment',
        ]));
    });

    it('preserves the semantic review attributes through sanitization', () => {
        for (const html of [
            renderToStaticHTML('{++new++}'),
            getSanitizeClipboardHtml('{++new++}'),
        ]) {
            const root = document.createElement('div');
            root.innerHTML = html;
            const item = root.querySelector<HTMLElement>(
                '[data-critic-type="addition"]',
            );

            expect(item).not.toBeNull();
            expect(item?.dataset.criticId).toBe('critic-0-9');
            expect(item?.dataset.criticRole).toBe('only');
            expect(item?.dataset.start).toBe('0');
            expect(item?.dataset.end).toBe('9');
        }
    });

    it.each(HOSTILE_CRITIC_MARKUP_CORPUS)(
        'keeps $id inert in static and sanitized clipboard HTML',
        (row) => {
            expect(row.expected.mustBeInert).toBe(true);
            for (const html of [
                renderToStaticHTML(row.source, row.options),
                getSanitizeClipboardHtml(row.source, row.options),
            ]) {
                const root = expectInertHtml(html);
                expectCriticSemantics(root, row);
            }

            for (const projection of ['original', 'revised'] as const) {
                expectInertHtml(renderToStaticHTML(row.source, {
                    ...row.options,
                    criticMarkupProjection: projection,
                }));
                expectInertHtml(getSanitizeClipboardHtml(row.source, {
                    ...row.options,
                    criticMarkupProjection: projection,
                }));
            }
        },
    );
});
