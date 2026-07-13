// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import {
    SelectionCaretType,
    SelectionDirection,
} from '../../selection/types';
import { CopyType } from '../types';

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (source: string) => source,
    loadLanguage: () => null,
    search: () => [],
}));

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(
    markdown: string,
    projection: 'marked' | 'original' | 'revised',
): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, {
        markdown,
        criticMarkupProjection: projection,
    });
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function selectLiteralCriticText(muya: Muya, selected: string): void {
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Content;
    const start = block.text.indexOf(selected);
    if (start < 0)
        throw new TypeError(`Selection fixture does not contain ${selected}.`);
    const end = start + selected.length;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block, path: block.path },
        focus: { offset: end, block, path: block.path },
        isCollapsed: false,
        isSelectionInSameBlock: true,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

function copy(
    markdown: string,
    projection: 'marked' | 'original' | 'revised',
    copyType: CopyType,
): Map<string, string> {
    const selected = 'url{++v++}';
    const muya = bootMuya(markdown, projection);
    selectLiteralCriticText(muya, selected);
    muya.editor.clipboard.copyType = copyType;
    const setData = vi.fn();

    muya.editor.clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return new Map(setData.mock.calls as Array<[string, string]>);
}

function copyCrossBlock(
    projection: 'marked' | 'original' | 'revised',
    copyType: CopyType,
): Map<string, string> {
    const selected = 'url{++v++}';
    const muya = bootMuya(
        '[label](url{++v++}) tail\n\nnext\n',
        projection,
    );
    const startBlock = muya.editor.scrollPage!.firstContentInDescendant()!;
    const endBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
    const start = startBlock.text.indexOf(selected);
    if (start < 0)
        throw new TypeError('Cross-block fixture lost its literal selection.');
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block: startBlock, path: startBlock.path },
        focus: { offset: 2, block: endBlock, path: endBlock.path },
        isCollapsed: false,
        isSelectionInSameBlock: false,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
    muya.editor.clipboard.copyType = copyType;
    const setData = vi.fn();

    muya.editor.clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return new Map(setData.mock.calls as Array<[string, string]>);
}

function copyCrossBlockList(
    projection: 'marked' | 'original' | 'revised',
    copyType: CopyType,
): Map<string, string> {
    const selected = 'url{++v++}';
    const muya = bootMuya(
        '- [label](url{++v++}) tail\n- next\n',
        projection,
    );
    const startBlock = muya.editor.scrollPage!.firstContentInDescendant()!;
    const endBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
    const start = startBlock.text.indexOf(selected);
    if (start < 0)
        throw new TypeError('List fixture lost its literal selection.');
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block: startBlock, path: startBlock.path },
        focus: { offset: 2, block: endBlock, path: endBlock.path },
        isCollapsed: false,
        isSelectionInSameBlock: false,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
    muya.editor.clipboard.copyType = copyType;
    const setData = vi.fn();

    muya.editor.clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return new Map(setData.mock.calls as Array<[string, string]>);
}

function copySemanticCrossBlockList(): Map<string, string> {
    const selected = '{++new++}';
    const muya = bootMuya('- before {++new++}\n- next\n', 'marked');
    const startBlock = muya.editor.scrollPage!.firstContentInDescendant()!;
    const endBlock = muya.editor.scrollPage!.lastContentInDescendant()!;
    const start = startBlock.text.indexOf(selected);
    if (start < 0)
        throw new TypeError('Semantic list fixture lost its Critic selection.');
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block: startBlock, path: startBlock.path },
        focus: { offset: 2, block: endBlock, path: endBlock.path },
        isCollapsed: false,
        isSelectionInSameBlock: false,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
    muya.editor.clipboard.copyType = CopyType.COPY_AS_RICH;
    const setData = vi.fn();

    muya.editor.clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return new Map(setData.mock.calls as Array<[string, string]>);
}

function renderedRoot(html: string): HTMLDivElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
}

function literalRenderedText(html: string): string {
    const root = renderedRoot(html);
    expect(root.querySelector('[data-critic-id]')).toBeNull();
    return root.textContent ?? '';
}

describe.each([
    ['inline code', '`before url{++v++} after`\n'],
    ['link destination', '[label](url{++v++})\n'],
] as const)('critic-looking selection inside %s', (_label, markdown) => {
    it.each(['marked', 'original', 'revised'] as const)(
        'preserves canonical literal context for every %s sink',
        (projection) => {
            const selected = 'url{++v++}';

            const normal = copy(markdown, projection, CopyType.NORMAL);
            expect(normal.get('text/html')).toBe('');
            expect(normal.get('text/plain')).toBe(selected);

            const markdownCopy = copy(
                markdown,
                projection,
                CopyType.COPY_AS_MARKDOWN,
            );
            expect(markdownCopy.get('text/html')).toBe('');
            expect(markdownCopy.get('text/plain')).toBe(selected);

            const html = copy(markdown, projection, CopyType.COPY_AS_HTML);
            expect(html.get('text/html')).toBe('');
            expect(literalRenderedText(html.get('text/plain') ?? ''))
                .toContain(selected);

            const rich = copy(markdown, projection, CopyType.COPY_AS_RICH);
            expect(rich.get('text/plain')).toBe(selected);
            expect(literalRenderedText(rich.get('text/html') ?? ''))
                .toContain(selected);
        },
    );
});

describe('critic selection keeps live semantic context', () => {
    it('renders a middle-of-document Marked selection from the live analysis', () => {
        const projection = 'marked';
        const plainText = 'url{++v++}';
        const rendered = 'urlv';
        const hasReviewItem = true;
        const markdown = 'before url{++v++} after\n';

        const normal = copy(markdown, projection, CopyType.NORMAL);
        expect(normal.get('text/plain')).toBe(plainText);

        const raw = copy(markdown, projection, CopyType.COPY_AS_MARKDOWN);
        expect(raw.get('text/plain')).toBe('url{++v++}');

        const html = copy(markdown, projection, CopyType.COPY_AS_HTML);
        const htmlRoot = renderedRoot(html.get('text/plain') ?? '');
        expect(htmlRoot.textContent).toContain(rendered);
        expect(htmlRoot.querySelector('[data-critic-id]') !== null)
            .toBe(hasReviewItem);

        const rich = copy(markdown, projection, CopyType.COPY_AS_RICH);
        const richRoot = renderedRoot(rich.get('text/html') ?? '');
        expect(rich.get('text/plain')).toBe(plainText);
        expect(richRoot.textContent).toContain(rendered);
        expect(richRoot.querySelector('[data-critic-id]') !== null)
            .toBe(hasReviewItem);
    });
});

describe('cross-block clipboard projection keeps canonical start context', () => {
    it.each(['marked', 'original', 'revised'] as const)(
        'keeps a link-destination opener literal in every %s sink',
        (projection) => {
            const selected = 'url{++v++}';
            const normal = copyCrossBlock(projection, CopyType.NORMAL);
            expect(normal.get('text/plain')).toContain(selected);

            const raw = copyCrossBlock(
                projection,
                CopyType.COPY_AS_MARKDOWN,
            );
            expect(raw.get('text/plain')).toContain(selected);

            const html = copyCrossBlock(projection, CopyType.COPY_AS_HTML);
            expect(literalRenderedText(html.get('text/plain') ?? ''))
                .toContain(selected);

            const rich = copyCrossBlock(projection, CopyType.COPY_AS_RICH);
            expect(rich.get('text/plain')).toContain(selected);
            expect(literalRenderedText(rich.get('text/html') ?? ''))
                .toContain(selected);
        },
    );

    it.each(['marked', 'original', 'revised'] as const)(
        'keeps generated list structure without reparsing Critic under %s',
        (projection) => {
            const selected = 'url{++v++}';
            const normal = copyCrossBlockList(projection, CopyType.NORMAL);
            expect(normal.get('text/plain')).toContain(selected);

            const html = copyCrossBlockList(
                projection,
                CopyType.COPY_AS_HTML,
            );
            expect(literalRenderedText(html.get('text/plain') ?? ''))
                .toContain(selected);

            const rich = copyCrossBlockList(
                projection,
                CopyType.COPY_AS_RICH,
            );
            expect(rich.get('text/plain')).toContain(selected);
            expect(literalRenderedText(rich.get('text/html') ?? ''))
                .toContain(selected);
        },
    );

    it('binds a semantic item through generated list structure', () => {
        const rich = copySemanticCrossBlockList();
        const root = renderedRoot(rich.get('text/html') ?? '');

        expect(root.querySelector('li')).not.toBeNull();
        expect(root.querySelector('[data-critic-id]')).not.toBeNull();
        expect(root.textContent).toContain('new');
    });
});
