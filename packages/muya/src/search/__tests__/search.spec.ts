// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { Search } from '../index';

// Coverage for the Search module (src/search/index.ts) — the find/replace
// engine the desktop "Find in document" / "Find and replace" surfaces drive.
// The module lives at muya.editor.searchModule and exposes search(value, opts),
// find('previous'|'next'), and replace(value, {isSingle, isRegexp}). Each match
// renders a highlight span into the live DOM: the active match gets
// `span.mu-highlight`, every other match gets `span.mu-selection`
// (Renderer.getHighlightClassName). block.update() patches the inline DOM
// synchronously, so the spans are queryable right after the call.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(
    markdown: string,
    options: ConstructorParameters<typeof Muya>[1] = {},
): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { ...options, markdown });
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function placeCursorOnFirstBlock(muya: Muya): Content {
    const first = muya.editor.scrollPage!.firstContentInDescendant()!;
    muya.editor.activeContentBlock = first;
    return first;
}

function highlightCount(muya: Muya): number {
    return muya.domNode.querySelectorAll('span.mu-highlight').length;
}

function selectionCount(muya: Muya): number {
    return muya.domNode.querySelectorAll('span.mu-selection').length;
}

function searchMatchesUseLiveBlocks(muya: Muya): boolean {
    return muya.editor.searchModule.matches.every(({ block }) =>
        muya.editor.scrollPage?.queryBlock([...block.path]) === block);
}

describe('search.search()', () => {
    it('collects 200k text-derived matches without a variadic push', () => {
        const text = 'x'.repeat(200_000);
        const block = {
            isContent: () => true,
            text,
            update: vi.fn(),
            focusHandler: vi.fn(),
            parent: null,
        } as unknown as Content;
        const scrollPage = {
            depthFirstTraverse(visitor: (block: Content) => void) {
                visitor(block);
            },
        };
        const search = new Search({
            editor: { scrollPage },
        } as unknown as Muya);

        search.search('x');

        expect(search.matches).toHaveLength(text.length);
        expect(search.matches[0]).toMatchObject({ start: 0, end: 1 });
        expect(search.matches.at(-1)).toMatchObject({
            start: text.length - 1,
            end: text.length,
        });
        expect(block.update).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('collects every match and highlights the first (one mu-highlight, rest mu-selection)', () => {
        const muya = bootMuya('apple banana apple cherry\n');
        placeCursorOnFirstBlock(muya);

        const search = muya.editor.searchModule;
        search.search('apple');

        expect(search.matches.length).toBe(2);
        expect(search.index).toBe(0);
        // First match active, second selected.
        expect(search.matches[0].start).toBe(0);
        expect(search.matches[1].start).toBe(13);

        // Active match -> span.mu-highlight, the remaining match -> span.mu-selection.
        expect(highlightCount(muya)).toBe(1);
        expect(selectionCount(muya)).toBe(search.matches.length - 1);
        expect(selectionCount(muya)).toBe(1);
    });

    it('clears highlights when searching for an empty value', () => {
        const muya = bootMuya('apple banana apple cherry\n');
        placeCursorOnFirstBlock(muya);

        const search = muya.editor.searchModule;
        search.search('apple');
        expect(highlightCount(muya)).toBe(1);

        search.search('');
        expect(search.matches.length).toBe(0);
        expect(search.index).toBe(-1);
        expect(highlightCount(muya)).toBe(0);
        expect(selectionCount(muya)).toBe(0);
    });
});

describe('search.search() — CriticMarkup sink policy', () => {
    it('searches canonical bytes in Marked and active text in clean projections', () => {
        const source = '{++new++} {--old--}\n';
        const muya = bootMuya(source);
        placeCursorOnFirstBlock(muya);
        const search = muya.editor.searchModule;

        search.search('{++');
        expect(search.matches).toHaveLength(1);
        search.search('old');
        expect(search.matches).toHaveLength(1);

        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        search.search('{++');
        expect(search.matches).toHaveLength(0);
        search.search('new');
        expect(search.matches).toHaveLength(1);
        search.search('old');
        expect(search.matches).toHaveLength(0);

        muya.setOptions({ criticMarkupProjection: 'original' }, true);
        search.search('new');
        expect(search.matches).toHaveLength(0);
        search.search('old');
        expect(search.matches).toHaveLength(1);
        expect(muya.getMarkdown()).toBe(source);
    });
});

describe('search.search() — selectHighlight restores the editor cursor', () => {
    it('places the cursor on the last active match when closing the search bar (empty value + selectHighlight)', () => {
        const muya = bootMuya('apple banana apple cherry\n');
        const block = placeCursorOnFirstBlock(muya);

        const search = muya.editor.searchModule;
        search.search('apple');
        // Move the active match to the second "apple" (offset 13-18).
        search.find('next');
        expect(search.index).toBe(1);

        // Closing the search bar empties the search with selectHighlight, which
        // must drop the editor cursor back onto the last active match so the
        // user can keep typing where the highlight was.
        search.search('', { selectHighlight: true });

        expect(highlightCount(muya)).toBe(0);
        expect(muya.editor.activeContentBlock).toBe(block);
        expect(muya.editor.selection.anchorBlock).toBe(block);
        expect(muya.editor.selection.focusBlock).toBe(block);
        expect(muya.editor.selection.anchor!.offset).toBe(13);
        expect(muya.editor.selection.focus!.offset).toBe(18);
        expect(window.getSelection()?.toString()).toBe('apple');
    });
});

describe('search.find() — cursor navigation across matches', () => {
    it('wraps forward 0 -> 1 -> 2 -> 0 and backward 0 -> 2, moving the active mu-highlight', () => {
        const muya = bootMuya('x and x and x\n');
        placeCursorOnFirstBlock(muya);

        const search = muya.editor.searchModule;
        search.search('x');
        expect(search.matches.length).toBe(3);
        expect(search.index).toBe(0);
        expect(highlightCount(muya)).toBe(1);
        expect(selectionCount(muya)).toBe(2);

        // next three times wraps forward: 1, 2, 0
        search.find('next');
        expect(search.index).toBe(1);
        search.find('next');
        expect(search.index).toBe(2);
        search.find('next');
        expect(search.index).toBe(0);

        // The single active highlight follows the index.
        expect(highlightCount(muya)).toBe(1);
        expect(selectionCount(muya)).toBe(2);

        // previous from index 0 wraps backward to the last match (2).
        search.find('previous');
        expect(search.index).toBe(2);
        expect(highlightCount(muya)).toBe(1);
        expect(selectionCount(muya)).toBe(2);
    });
});

describe('search.replace() — replace all across multiple blocks', () => {
    it('replaces every occurrence of the needle in every block (replace-all flush)', async () => {
        const muya = bootMuya('x foo x foo end\n\n# foo here\n\n- foo\n');
        placeCursorOnFirstBlock(muya);

        const search = muya.editor.searchModule;
        search.search('foo');
        // Two in the paragraph, one in the heading, one in the list item.
        expect(search.matches.length).toBe(4);

        search.replace('BAR', { isSingle: false, isRegexp: false });

        // block.text writes are batched into the json state on the next rAF, so
        // wait for getMarkdown (which serializes the json state) to settle.
        await vi.waitFor(() => {
            const md = muya.getMarkdown();
            expect(md).not.toContain('foo');
        });

        const md = muya.getMarkdown();
        // Paragraph with two occurrences plus trailing text survives intact.
        expect(md).toContain('x BAR x BAR end');
        // Heading block.
        expect(md).toContain('# BAR here');
        // List item block.
        expect(md).toContain('- BAR');

        // A fresh search for the old needle finds nothing.
        search.search('foo');
        expect(search.matches.length).toBe(0);
    });
});

describe('search.replace() — criticMarkup Track Changes', () => {
    it('tracks one current replacement as one native substitution', async () => {
        const source = 'teh then teh\n';
        const muya = bootMuya(source, {
            criticMarkupTrackChanges: true,
        });
        placeCursorOnFirstBlock(muya);
        const search = muya.editor.searchModule;
        search.search('teh');

        search.replace('the', { isSingle: true, isRegexp: false });

        expect(muya.getMarkdown()).toBe('{~~teh~>the~~} then teh\n');
        expect(muya.getCriticMarkupItems()).toMatchObject([{
            type: 'substitution',
            oldContent: 'teh',
            newContent: 'the',
        }]);
        expect(searchMatchesUseLiveBlocks(muya)).toBe(true);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it('tracks replace-all when the result is exactly one contiguous edit', () => {
        const source = 'one foo only\n';
        const muya = bootMuya(source, {
            criticMarkupTrackChanges: true,
        });
        placeCursorOnFirstBlock(muya);
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        const search = muya.editor.searchModule;
        search.search('foo');

        search.replace('food', { isSingle: false, isRegexp: false });

        expect(muya.getMarkdown()).toBe('one {~~foo~>food~~} only\n');
        expect(rejected).not.toHaveBeenCalled();
        expect(searchMatchesUseLiveBlocks(muya)).toBe(true);
    });

    it('tracks every replace-all match as an exact edit without sweeping untouched Markdown', () => {
        const source = 'before foo **untouched** foo after\n\n# foo heading\n';
        const muya = bootMuya(source, {
            criticMarkupTrackChanges: true,
        });
        placeCursorOnFirstBlock(muya);
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        const search = muya.editor.searchModule;
        search.search('foo');

        search.replace('bar', { isSingle: false, isRegexp: false });

        expect(muya.getMarkdown()).toBe(
            'before {~~foo~>bar~~} **untouched** {~~foo~>bar~~} after\n'
            + '\n# {~~foo~>bar~~} heading\n',
        );
        expect(muya.getCriticMarkupItems()).toHaveLength(3);
        expect(muya.editor.criticMarkupDocument.get().project('original'))
            .toBe(source);
        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe('before bar **untouched** bar after\n\n# bar heading\n');
        expect(rejected).not.toHaveBeenCalled();
        expect(searchMatchesUseLiveBlocks(muya)).toBe(true);
    });

    it('uses parser literal ranges to reject a replacement in inline code', () => {
        const source = '`foo` outside\n';
        const muya = bootMuya(source, {
            criticMarkupTrackChanges: true,
        });
        placeCursorOnFirstBlock(muya);
        const search = muya.editor.searchModule;
        search.search('foo');

        search.replace('bar', { isSingle: true, isRegexp: false });

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems()).toHaveLength(0);
        expect(searchMatchesUseLiveBlocks(muya)).toBe(true);
    });
});
