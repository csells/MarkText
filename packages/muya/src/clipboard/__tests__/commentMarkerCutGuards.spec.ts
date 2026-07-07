// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { Muya } from '../../muya';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../muya';
import { SelectionCaretType, SelectionDirection } from '../../selection/types';
import { blockedCommentMarkerCut } from '../cut';

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

    it('allows cutting literal marker text OUT OF a code fence (edited block is not scannable)', async () => {
        const muya = bootMuya([
            'alpha <!--MC:c1-->beta<!--MC:~c1--> gamma',
            '',
            '```txt',
            'docs line with <!--MC:c1--> literal here',
            '```',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // The code-fence content leaf holding the literal marker.
        const fence = blocks.find(b => b.blockName === 'codeblock.content')!;
        const start = 'docs line with '.length;
        // Select just the literal '<!--MC:c1-->' (12 chars) inside the fence.
        stubSelection(muya, fence, start, fence, start + 12);

        // A real comment pair exists in the paragraph above, but the fence text
        // is literal — cutting it must be allowed, not blocked by treating the
        // literal as an endpoint.
        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        // The real comment is untouched; the fence literal is gone.
        expect(markdown).toContain('<!--MC:c1-->beta<!--MC:~c1-->');
        expect(markdown).toContain('docs line with  literal here');
    });

    it('allows a CROSS-block cut of an orphan marker whose only close is a fence literal', async () => {
        const muya = bootMuya([
            'alpha <!--MC:c1-->beta',
            '',
            'gamma delta more text here',
            '',
            '```txt',
            'docs: <!--MC:~c1--> is the close marker',
            '```',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // Cross-block selection from inside block 0 (covering the orphan open
        // marker) into block 1. The only close is literal fence text the parser
        // ignores — the cross-block guard must not count it as a counterpart.
        stubSelection(muya, blocks[0], 0, blocks[1], 5);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).not.toContain('<!--MC:c1-->');
        expect(markdown).toContain('docs: <!--MC:~c1--> is the close marker');
    });
});

describe('inline-code literal markers are not counterparts (real tokenizer, not regex)', () => {
    it('lets an orphan open marker be cut when its only close is inside an inline-code span', async () => {
        const muya = bootMuya([
            'alpha <!--MC:c1-->beta',
            '',
            'docs: `<!--MC:~c1-->` is the close marker syntax',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // The close marker is literal text inside an inline-code span in block 1;
        // the real inline tokenizer does not treat it as a comment marker, so
        // cutting the genuine orphan open marker must be allowed.
        stubSelection(muya, blocks[0], 6, blocks[0], 18);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).not.toContain('<!--MC:c1-->beta');
        expect(markdown).toContain('`<!--MC:~c1-->`');
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

    it('cleans up metadata for a comment sitting between inline-code spans', async () => {
        // Adversarial-review regression: the same-block cut computed cleanup ids
        // by tokenizing only the removed slice, so a marker live in the block but
        // falling inside a spurious code span in the fragment was missed and its
        // metadata left orphaned. The cut must scan the full block text.
        const muya = bootMuya([
            `\`a\` <!--MC:x-->t<!--MC:~x--> \`b\``,
            '',
            `[MC:x]: ${metadata()}`,
            '',
        ].join('\n'));
        const para = contentBlocks(muya)[0];
        // Cut from inside the left code span to inside the right one; both x
        // markers are fully covered, so the cut is allowed.
        stubSelection(muya, para, 1, para, 31);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).not.toContain('MC:x');
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

    it('removes metadata when only marker-looking inline-code text remains', async () => {
        const muya = bootMuya([
            'Literal `<!--MC:a-->docs<!--MC:~a-->` text.',
            '',
            'alpha <!--MC:a-->beta<!--MC:~a--> gamma',
            '',
            `[MC:a]: ${metadata()}`,
            '',
        ].join('\n'));
        const target = contentBlocks(muya).find(block => block.text.startsWith('alpha '));
        if (!target)
            throw new Error('Commented paragraph not found');
        stubSelection(muya, target, 6, target, 33);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        const markdown = await settle(muya);
        expect(markdown).toContain('`<!--MC:a-->docs<!--MC:~a-->`');
        expect(markdown).not.toContain('[MC:a]:');
    });

    it('does not prune an empty marker-looking pair inside inline code after an adjacent cut', async () => {
        const muya = bootMuya('`x<!--MC:a--><!--MC:~a-->y`\n');
        const block = contentBlocks(muya)[0];
        stubSelection(muya, block, 1, block, 2);

        expect(muya.editor.clipboard.cutHandler()).toBe(true);
        expect(await settle(muya)).toBe('`<!--MC:a--><!--MC:~a-->y`\n');
    });
});

describe('blocked cut does not clobber the clipboard (Ctrl+X guard predicate)', () => {
    it('reports a cross-block cut that would orphan a marker as blocked', () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta',
            '',
            'gamma delta<!--MC:~a--> end',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        stubSelection(muya, blocks[0], 0, blocks[1], 5);

        // The cut-event handler consults this BEFORE writing the clipboard, so
        // a true result means copy+cut are skipped and the clipboard is kept.
        expect(blockedCommentMarkerCut(muya.editor.clipboard)).toBe(true);
    });

    it('reports an ordinary cross-block cut as not blocked', () => {
        const muya = bootMuya('hello\n\nworld\n');
        const blocks = contentBlocks(muya);
        stubSelection(muya, blocks[0], 2, blocks[1], 3);

        expect(blockedCommentMarkerCut(muya.editor.clipboard)).toBe(false);
    });
});

describe('iME composition over a guarded SAME-block selection', () => {
    it('collapses a same-block selection covering a lone marker so compose cannot delete it', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta',
            '',
            'delta<!--MC:~a--> end',
            '',
        ].join('\n'));
        const before = muya.getMarkdown();
        const blocks = contentBlocks(muya);
        (blocks[0].domNode as HTMLElement).focus();
        // Same-block selection fully covering the open marker (offsets 6..18);
        // its close lives in another block.
        stubSelection(muya, blocks[0], 6, blocks[0], 18);

        const setCursorSpy = vi.spyOn(blocks[0], 'setCursor');
        document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        await new Promise(r => setTimeout(r, 20));

        // The marker would be orphaned by a native compose, so the handler
        // collapses the selection to a caret and leaves the model untouched.
        const collapsed = setCursorSpy.mock.calls.some(([begin, end]) => begin === end);
        expect(collapsed).toBe(true);
        expect(muya.getMarkdown()).toBe(before);
    });

    it('leaves an ordinary same-block selection alone at compositionstart', async () => {
        const muya = bootMuya('plain paragraph text here\n');
        const blocks = contentBlocks(muya);
        (blocks[0].domNode as HTMLElement).focus();
        stubSelection(muya, blocks[0], 0, blocks[0], 5);

        const setCursorSpy = vi.spyOn(blocks[0], 'setCursor');
        document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        await new Promise(r => setTimeout(r, 20));

        // No marker at risk: the handler does not interfere (native compose
        // replaces the selection as usual).
        expect(setCursorSpy).not.toHaveBeenCalled();
    });
});

describe('iME composition over a guarded cross-block selection', () => {
    it('collapses the selection at compositionstart so native compose cannot merge the blocks', async () => {
        const muya = bootMuya([
            'alpha <!--MC:a-->beta',
            '',
            'gamma delta<!--MC:~a--> end',
            '',
        ].join('\n'));
        const before = muya.getMarkdown();
        const blocks = contentBlocks(muya);
        // Focus a node inside the editor so the document-level handler owns the
        // event (muya.hasFocus()).
        (blocks[0].domNode as HTMLElement).focus();
        stubSelection(muya, blocks[0], 0, blocks[1], 5);

        const setCursorSpy = vi.spyOn(blocks[0], 'setCursor');

        document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        await new Promise(r => setTimeout(r, 20));

        // The guarded cut is blocked, so the handler collapses the selection to
        // a caret (begin === end) rather than letting the native composition
        // merge the blocks.
        const collapsed = setCursorSpy.mock.calls.some(([begin, end]) => begin === end);
        expect(collapsed).toBe(true);
        // The model is untouched by the collapse (no cross-block merge).
        expect(muya.getMarkdown()).toBe(before);
    });
});

describe('cross-block cut guards protect metadata definitions', () => {
    it('blocks a cut that covers the hidden definition while its markers survive', () => {
        const muya = bootMuya([
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            'middle paragraph',
            '',
            `[MC:a]: ${metadata()}`,
            '',
            'tail paragraph',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        // From inside "middle paragraph" to inside "tail paragraph" — the
        // definition paragraph is fully inside the removed range while the
        // comment markers survive above it.
        stubSelection(muya, blocks[1], 3, blocks[3], 4);

        expect(blockedCommentMarkerCut(muya.editor.clipboard)).toBe(true);
    });

    it('allows a cut that removes the definition together with all its markers', () => {
        const muya = bootMuya([
            'lead paragraph',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata()}`,
            '',
            'tail paragraph',
            '',
        ].join('\n'));
        const blocks = contentBlocks(muya);
        stubSelection(muya, blocks[0], 4, blocks[3], 4);

        expect(blockedCommentMarkerCut(muya.editor.clipboard)).toBe(false);
    });
});
