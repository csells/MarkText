// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';

// Guards for comment-marker integrity during cut:
//   1. A cut that fully covers ONE endpoint marker of a comment must be
//      blocked when the counterpart marker exists ANYWHERE in the document —
//      not just in the same block (the original in-block-only counterpart
//      check let a same-block cut orphan a cross-block range).
//   2. `cutSelection` reports blocked cuts (`false`) so the keydown path can
//      suppress the browser's native edit — otherwise a printable key would
//      natively collapse the DOM selection while the model kept the blocks.
//   3. Metadata cleanup after a cut removes ONLY the definition's own
//      paragraph (plus ancestors the removal emptied) — never the whole
//      outermost container — and ignores definition-shaped literal text
//      inside code fences.

// The clipboard module pulls in CodeBlockContent → utils/prism which touches
// `window` at import time. Stub the prism shim (same stub as sibling specs).
vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => Promise.resolve([]),
    search: () => [],
}));

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

function metadata(): string {
    return `data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 1, status: 'open', replies: [] }),
    ).toString('base64')}`;
}

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

// Document-order list of every content leaf.
function contentBlocks(muya: Muya): Content[] {
    const out: Content[] = [];
    let c: Content | null = muya.editor.scrollPage!.firstContentInDescendant();
    while (c) {
        out.push(c);
        c = c.nextContentInContext() ?? null;
    }
    return out;
}

// Replace the live (happy-dom-unreliable) DOM selection with a constructed
// `ISelection` the real `cutHandler` consumes; block tree mutations stay real.
function stubSelection(
    muya: Muya,
    a: Content,
    aOff: number,
    f: Content,
    fOff: number,
    direction = SelectionDirection.FORWARD,
) {
    const aPath = a.path;
    const fPath = f.path;
    muya.editor.selection.getSelection = () => ({
        anchor: { offset: aOff, block: a, path: aPath },
        focus: { offset: fOff, block: f, path: fPath },
        isCollapsed: false,
        isSelectionInSameBlock: a === f,
        direction,
        type: SelectionCaretType.RANGE,
    });
}

// json state applies composed ops on a requestAnimationFrame; wait for the
// authoritative markdown to settle.
async function settle(muya: Muya): Promise<string> {
    await new Promise(r => setTimeout(r, 40));
    return muya.getMarkdown();
}

describe('comment marker cut guards — cross-block counterpart detection', () => {
    it('blocks a same-block cut that would orphan a cross-block close marker', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta gamma',
            '',
            'delta<!--MC:~a--> epsilon',
            '',
            `[MC:a]: ${metadata()}`,
            '',
        ].join('\n'));
        const before = muya.getMarkdown();
        const blocks = contentBlocks(muya);
        // Fully covers the open marker (offsets 6..17) but not the close
        // marker, which lives in the NEXT paragraph.
        stubSelection(muya, blocks[0], 0, blocks[0], 21);

        expect(muya.editor.clipboard.cutHandler()).toBe(false);
        expect(await settle(muya)).toBe(before);
    });

    it('still allows a same-block cut that covers the whole open/close pair', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta<!--MC:~a--> gamma',
            '',
            `[MC:a]: ${metadata()}`,
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // Covers open (6..17), 'beta' (17..21), and close (21..33).
        stubSelection(muya, blocks[0], 6, blocks[0], 33);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain('alpha  gamma');
        expect(markdown).not.toContain('MC:a');
    });

    it('reports an unsafe cross-block cut as blocked and leaves the document intact', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta',
            '',
            'gamma delta<!--MC:~a--> end',
            '',
        ].join('\n'));
        const before = muya.getMarkdown();
        const blocks = contentBlocks(muya);
        // Covers the open marker in block 0, ends before the close marker.
        stubSelection(muya, blocks[0], 0, blocks[1], 5);

        expect(muya.editor.clipboard.cutHandler()).toBe(false);
        expect(await settle(muya)).toBe(before);
    });

    it('reports an ordinary cross-block cut as performed', async () => {
        const muya = bootMuya('hello\n\nworld\n');
        const blocks = contentBlocks(muya);
        stubSelection(muya, blocks[0], 2, blocks[1], 3);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        expect(await settle(muya)).toBe('held\n');
    });
});

describe('code-fence literal markers are not counterparts', () => {
    it('lets a genuine orphan open marker be cut even when a fence contains the literal close', async () => {
        const muya = bootMuya([
            'alpha <!--MC:c1-->beta',
            '',
            '```txt',
            'docs: <!--MC:~c1--> is the close marker',
            '```',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // Fully cover the orphan open marker (offsets 6..18) in the paragraph;
        // the only "close" is literal text inside the fence.
        stubSelection(muya, blocks[0], 6, blocks[0], 18);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).not.toContain('<!--MC:c1-->');
        // The fence's literal documentation text is untouched.
        expect(markdown).toContain('docs: <!--MC:~c1--> is the close marker');
    });
});

describe('comment metadata cleanup after a cut', () => {
    it('removes only the definition paragraph from a blockquote, keeping siblings', async () => {
        const muya = bootMuya([
            '> intro line',
            '>',
            `> [MC:a]: ${metadata()}`,
            '',
            'alpha <!--MC:a-->beta<!--MC:~a--> gamma',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        const target = blocks[blocks.length - 1];
        stubSelection(muya, target, 6, target, 33);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain('> intro line');
        expect(markdown).not.toContain('MC:a');
    });

    it('leaves a definition-shaped line inside a code fence untouched', async () => {
        const definition = `[MC:a]: ${metadata()}`;
        const muya = bootMuya([
            '```txt',
            definition,
            '```',
            '',
            'alpha <!--MC:a-->beta<!--MC:~a--> gamma',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        const target = blocks[blocks.length - 1];
        stubSelection(muya, target, 6, target, 33);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        // The fence body is literal text, not comment metadata — it must
        // survive the unreferenced-id cleanup.
        expect(markdown).toContain('```txt');
        expect(markdown).toContain(definition);
    });
});
