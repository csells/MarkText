// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';

// Anchor-semantics successors to the marker cut guards
// (specs/architecture/comment-anchors.md §What this deletes): with comments
// out-of-band there is nothing in the text to corrupt, so NO cut is ever
// blocked. A cut trims or detaches ranges instead — highlights follow the
// text, threads are never silently dropped, and the caret never eats a
// keystroke defending hidden bytes.

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

const HEAD = '[MC:a]: {"version":2,"status":"open"}';

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

describe('cut over commented text — anchor semantics', () => {
    it('a cut overlapping one end of a range trims the range instead of blocking', async () => {
        // Clean text: 'alpha beta gamma' with 'beta' commented (6..10).
        const muya = bootMuya(`alpha <!--MC:a-->beta<!--MC:~a--> gamma\n\n${HEAD}\n`);
        const blocks = contentBlocks(muya);
        // Cut 'alpha be' (0..8) — swallows the open anchor.
        stubSelection(muya, blocks[0], 0, blocks[0], 8);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain('<!--MC:a-->ta<!--MC:~a--> gamma');
        expect(muya.getComments().ranges[0]?.preview).toBe('ta');
    });

    it('a cut covering the whole range detaches the thread, never dropping it', async () => {
        const muya = bootMuya(`alpha <!--MC:a-->beta<!--MC:~a--> gamma\n\n${HEAD}\n`);
        const blocks = contentBlocks(muya);
        // Cut 'alpha beta' (0..10) — swallows the entire range.
        stubSelection(muya, blocks[0], 0, blocks[0], 10);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain(' gamma');
        expect(markdown).not.toContain('<!--MC:');
        // Detach visibility: the thread's metadata survives serialization.
        expect(markdown).toContain('[MC:a]: {"version":2,"status":"open"}');
        expect(muya.getComments().diagnostics).toContainEqual(expect.objectContaining({
            code: 'orphan-metadata',
            id: 'a',
        }));
    });

    it('a cross-block cut through a cross-block range is never blocked', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta gamma',
            '',
            'delta<!--MC:~a--> epsilon',
            '',
            HEAD,
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // From inside the commented span in block 0 into block 1.
        stubSelection(muya, blocks[0], 8, blocks[1], 3);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain('alpha ');
        expect(markdown).toContain('ta epsilon');
    });
});
