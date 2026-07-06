// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';
import { pastePlainText } from '../paste';

// muyajs `pasteCtrl` MERGE semantics ported into @muyajs/core: pasting a
// paragraph into a non-empty text block merges its first paragraph inline
// (head + pasted + tail) instead of inserting it as a separate block below;
// the trailing text of the anchor is sewn onto the last pasted block; a
// multi-line paragraph pasted into a heading keeps only its first line in the
// heading; a same-type list pasted into a list item merges into that list.

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => Promise.resolve([]),
    search: () => [],
}));

// normalizePastedHTML uses DOMPurify which needs a richer DOM than happy-dom
// gives; we only paste plain-text markdown here, so pass the html through.
vi.mock('../../utils/paste', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/paste')>();
    return { ...actual, normalizePastedHTML: async (html: string) => html };
});

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function contentBlocks(muya: Muya): Content[] {
    const out: Content[] = [];
    let c: Content | null = muya.editor.scrollPage!.firstContentInDescendant();
    while (c) {
        out.push(c);
        c = c.nextContentInContext() ?? null;
    }
    return out;
}

function stubSelection(muya: Muya, block: Content, start: number, end: number) {
    const path = block.path;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block, path },
        focus: { offset: end, block, path },
        isCollapsed: start === end,
        isSelectionInSameBlock: true,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

function stubCrossSelection(
    muya: Muya,
    anchorBlock: Content,
    start: number,
    focusBlock: Content,
    end: number,
) {
    const anchorPath = anchorBlock.path;
    const focusPath = focusBlock.path;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: start, block: anchorBlock, path: anchorPath },
        focus: { offset: end, block: focusBlock, path: focusPath },
        isCollapsed: false,
        isSelectionInSameBlock: false,
        direction: SelectionDirection.FORWARD,
        type: SelectionCaretType.RANGE,
    });
}

function pasteEvent(text: string) {
    return {
        preventDefault() {},
        stopPropagation() {},
        clipboardData: {
            getData: (t: string) => (t === 'text/plain' ? text : ''),
            files: [],
            items: [],
        },
    } as unknown as ClipboardEvent;
}

async function paste(muya: Muya, block: Content, start: number, end: number, text: string): Promise<string> {
    stubSelection(muya, block, start, end);
    await muya.editor.clipboard.pasteHandler(pasteEvent(text), text, '');
    await new Promise(r => setTimeout(r, 40));
    return muya.getMarkdown();
}

async function pasteWithCurrentSelection(muya: Muya, text: string): Promise<string> {
    await muya.editor.clipboard.pasteHandler(pasteEvent(text), text, '');
    await new Promise(r => setTimeout(r, 40));
    return muya.getMarkdown();
}

describe('paste — paragraph merges inline into a non-empty text block (A3)', () => {
    it('pasting a paragraph at the cursor merges it into the paragraph', async () => {
        const muya = bootMuya('foobar\n');
        const block = contentBlocks(muya)[0];
        expect(await paste(muya, block, 3, 3, 'hello')).toBe('foohellobar\n');
    });

    it('pasting over a selection replaces it inline (A4)', async () => {
        const muya = bootMuya('foobar\n');
        const block = contentBlocks(muya)[0];
        expect(await paste(muya, block, 3, 5, 'X')).toBe('fooXr\n');
    });

    it('pasting multiple paragraphs merges the first and sews the tail onto the last', async () => {
        const muya = bootMuya('foobar\n');
        const block = contentBlocks(muya)[0];
        expect(await paste(muya, block, 3, 3, 'one\n\ntwo')).toBe('fooone\n\ntwobar\n');
    });
});

describe('paste — multi-line paragraph into a heading keeps only the first line (A6)', () => {
    it('only the first soft-line lands in the heading, the rest become a paragraph', async () => {
        const muya = bootMuya('# Title\n');
        const block = contentBlocks(muya)[0]; // atx-heading content, text '# Title'
        expect(await paste(muya, block, block.text.length, block.text.length, 'a\nb\nc')).toBe(
            '# Titlea\n\nb\nc\n',
        );
    });

    it('pasting multiple paragraphs mid-heading sews the heading tail after the paste', async () => {
        const muya = bootMuya('# hello world\n');
        const block = contentBlocks(muya)[0]; // '# hello world'
        // cursor between 'hello ' and 'world' (offset 8); 'world' must trail the
        // whole paste, not stay in the heading.
        expect(await paste(muya, block, 8, 8, 'A\n\nB')).toBe('# hello A\n\nBworld\n');
    });

    it('pasting a single paragraph mid-heading keeps it on the heading line', async () => {
        const muya = bootMuya('# hello world\n');
        const block = contentBlocks(muya)[0];
        expect(await paste(muya, block, 8, 8, 'A')).toBe('# hello Aworld\n');
    });

    it('a multi-line paragraph pasted into a SETEXT heading stays one block (only atx splits)', async () => {
        const muya = bootMuya('Title\n===\n');
        const block = contentBlocks(muya)[0]; // setext-heading content 'Title'
        const md = await paste(muya, block, block.text.length, block.text.length, 'aaa\nbbb');
        // muyajs keeps the whole paragraph inside the setext heading — one block.
        expect(muya.editor.scrollPage!.length()).toBe(1);
        expect(md).toContain('Titleaaa');
        expect(md).toContain('bbb');
    });
});

describe('paste — NEWLINE into an emptied non-paragraph wrapper (muyajs removeBlock parity)', () => {
    it('removes the emptied heading wrapper instead of leaving a stray empty block', async () => {
        const muya = bootMuya('# heading\n');
        const block = contentBlocks(muya)[0];
        // cursor before the heading text (offset 0); paste a non-mergeable block.
        await paste(muya, block, 0, 0, '---');
        // muyajs's NEWLINE branch removes the now-empty wrapper unconditionally;
        // the heading must not linger as a stray empty block.
        expect(muya.editor.scrollPage!.length()).toBe(1);
    });
});

// marktext #3848: pasting a URL (which the clipboard delivers as a smart-link
// `[Title](url)`) inside an existing link's parentheses `[text](|)` produced a
// nested `[text]([Title](url))`. When the caret is in a link destination, a
// pasted whole markdown link should contribute only its URL.
describe('paste — markdown link into a link destination uses only the URL (#3848)', () => {
    it('pasting `[title](url)` inside `[text](|)` yields `[text](url)`, not a nested link', async () => {
        const muya = bootMuya('[my text]()\n');
        const block = contentBlocks(muya)[0];
        // caret between the parentheses of `[my text]()` (offset 10)
        const md = await paste(muya, block, 10, 10, '[Some Page Title](https://example.com/page)');
        expect(md).toBe('[my text](https://example.com/page)\n');
    });
});

describe('paste — portable markdown comments', () => {
    it('does not paste when cross-block cut is blocked even if the next selection read changed shape', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const [first, second] = contentBlocks(muya);
        const crossSelection = {
            anchor: { offset: 1, block: first, path: first.path },
            focus: { offset: 2, block: second, path: second.path },
            isCollapsed: false,
            isSelectionInSameBlock: false,
            direction: SelectionDirection.FORWARD,
            type: SelectionCaretType.RANGE,
        };
        const sameBlockSelection = {
            anchor: { offset: 1, block: first, path: first.path },
            focus: { offset: 1, block: first, path: first.path },
            isCollapsed: true,
            isSelectionInSameBlock: true,
            direction: SelectionDirection.FORWARD,
            type: SelectionCaretType.RANGE,
        };
        let selectionReads = 0;
        muya.editor.selection.getSelection = () => {
            selectionReads += 1;
            return selectionReads === 1 ? crossSelection : sameBlockSelection;
        };
        vi.spyOn(muya.editor.clipboard, 'cutHandler').mockReturnValue(false);

        const markdown = await pasteWithCurrentSelection(muya, 'INSERT');

        expect(markdown).toBe('alpha\n\nbeta\n');
    });

    it('preserves pasted MC markers and metadata as a live comment graph', async () => {
        const meta = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';
        const pasted = [
            '<!--MC:a-->reviewed<!--MC:~a-->',
            '',
            `[MC:a]: ${meta}`,
            '',
        ].join('\n');
        const muya = bootMuya('\n');
        const block = contentBlocks(muya)[0];

        const markdown = await paste(muya, block, 0, 0, pasted);

        expect(markdown).toBe(pasted);
        expect(muya.getComments()).toMatchObject({
            threads: [{ id: 'a', status: 'open' }],
            ranges: [{ id: 'a' }],
            diagnostics: [],
        });
    });

    it('remaps pasted comment IDs that collide with existing document comments', async () => {
        const meta = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';
        const muya = bootMuya([
            'Existing <!--MC:a-->comment<!--MC:~a-->.',
            '',
            `[MC:a]: ${meta}`,
            '',
            'Paste here.',
            '',
        ].join('\n'));
        const target = contentBlocks(muya).find(block => block.text.includes('Paste here.'))!;
        const offset = target.text.length;

        const markdown = await paste(muya, target, offset, offset, [
            '<!--MC:a-->copied<!--MC:~a-->',
            '',
            `[MC:a]: ${meta}`,
            '',
        ].join('\n'));

        expect(markdown).toContain('Existing <!--MC:a-->comment<!--MC:~a-->.');
        expect(markdown).toContain('<!--MC:cmt_1-->copied<!--MC:~cmt_1-->');
        expect(markdown).toContain('[MC:a]: ');
        expect(markdown).toContain('[MC:cmt_1]: ');
        expect(muya.getComments()).toMatchObject({
            diagnostics: [],
            threads: [
                { id: 'a', status: 'open' },
                { id: 'cmt_1', status: 'open' },
            ],
        });
    });

    it('does not remap MC-looking text inside pasted fenced code', async () => {
        const meta = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';
        const muya = bootMuya([
            'Existing <!--MC:a-->comment<!--MC:~a-->.',
            '',
            `[MC:a]: ${meta}`,
            '',
            'Paste here.',
            '',
        ].join('\n'));
        const target = contentBlocks(muya).find(block => block.text.includes('Paste here.'))!;
        const offset = target.text.length;

        const markdown = await paste(muya, target, offset, offset, [
            '```md',
            '<!--MC:a-->literal<!--MC:~a-->',
            '```',
            '',
        ].join('\n'));

        expect(markdown).toContain([
            '```md',
            '<!--MC:a-->literal<!--MC:~a-->',
            '```',
        ].join('\n'));
        expect(markdown).not.toContain('<!--MC:cmt_1-->literal<!--MC:~cmt_1-->');
        expect(muya.getComments().threads.map(thread => thread.id)).toEqual(['a']);
    });

    it('does not paste over part of a hidden comment marker', async () => {
        const meta = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';
        const initial = [
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            `[MC:a]: ${meta}`,
            '',
        ].join('\n');
        const muya = bootMuya(initial);
        const block = contentBlocks(muya).find(item => item.text.includes('<!--MC:a-->'))!;
        const start = 'A <!--'.length;
        const end = 'A <!--MC:a'.length;

        const markdown = await paste(muya, block, start, end, 'X');

        expect(markdown).toBe(initial);
        expect(muya.getComments()).toMatchObject({
            threads: [{ id: 'a', status: 'open' }],
            ranges: [{ id: 'a' }],
            diagnostics: [],
        });
    });

    it('does not recurse when cross-block paste selection partially cuts a marker', async () => {
        const meta = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';
        const initial = [
            'Alpha <!--MC:a-->one.',
            '',
            'Two<!--MC:~a--> omega.',
            '',
            `[MC:a]: ${meta}`,
            '',
        ].join('\n');
        const muya = bootMuya(initial);
        const blocks = contentBlocks(muya);
        const startBlock = blocks.find(item => item.text.includes('<!--MC:a-->'))!;
        const endBlock = blocks.find(item => item.text.includes('<!--MC:~a-->'))!;
        stubCrossSelection(
            muya,
            startBlock,
            'Alpha <!--'.length,
            endBlock,
            'Two'.length,
        );

        const markdown = await pasteWithCurrentSelection(muya, 'replacement');

        expect(markdown).toBe(initial);
        expect(muya.getComments().diagnostics).toEqual([]);
    });
});

// F4 (adversarial review): "Paste as Plain Text" of block-level HTML replaced
// the selection via applyPlainTextBlockHtml with NO comment-marker guard,
// unlike the ordinary text/literal paste paths — so pasting over one endpoint
// of a comment whose partner survives elsewhere orphaned it.
describe('paste — Paste as Plain Text over a comment marker', () => {
    function markerKinds(muya: Muya): Record<string, string[]> {
        const out: Record<string, Set<string>> = {};
        let leaf = contentBlocks(muya)[0] as { text: string; nextContentInContext: () => unknown } | null;
        while (leaf) {
            for (const m of leaf.text.matchAll(/<!--MC:(~?)([\w-]+)-->/g))
                (out[m[2]] ??= new Set()).add(m[1] === '~' ? 'close' : 'open');
            leaf = leaf.nextContentInContext() as typeof leaf;
        }
        return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
    }

    it('does not orphan a marker when block HTML is pasted over one endpoint', async () => {
        const muya = bootMuya([
            'A <!--MC:a-->reviewed<!--MC:~a--> span.',
            '',
            'more text',
            '',
        ].join('\n'));
        const block = contentBlocks(muya)[0];
        const closeStart = 'A <!--MC:a-->reviewed'.length;
        const closeEnd = closeStart + '<!--MC:~a-->'.length;
        stubSelection(muya, block, closeStart, closeEnd);

        // Block-level HTML → getCopyTextType 'code' → applyPlainTextBlockHtml.
        await pastePlainText(muya.editor.clipboard, '<ul><li>x</li></ul>');
        await new Promise(r => setTimeout(r, 40));

        // The close marker was not deleted: the comment is still balanced.
        expect(markerKinds(muya)).toEqual({ a: ['open', 'close'] });
    });
});
