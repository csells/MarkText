// @vitest-environment happy-dom

import type Content from '../block/base/content';
import type TreeNode from '../block/base/treeNode';
import type Table from '../block/gfm/table';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// One coordinate space (editing-invariants.md): marker-shaped text a user
// TYPES is ordinary literal text — visible, searchable, copyable — and no
// edit is ever refused on account of comments. These specs replaced the
// guard-era regression tests (removalOrphansCommentMarker, search/copy
// marker stripping) when the guard machinery was deleted: under the anchor
// runtime, clean state means there is nothing to guard, and structural
// deletes DELETE the affected threads instead of being refused (undo
// restores them).

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function findTable(muya: Muya): Table {
    let table: Table | null = null;
    muya.editor.scrollPage!.depthFirstTraverse((block: TreeNode) => {
        const name = (block.constructor as typeof TreeNode & { blockName?: string }).blockName;
        if (!table && name === 'table')
            table = block as unknown as Table;
    });
    if (!table)
        throw new Error('no table block in document');
    return table;
}

describe('typed marker-shaped text is literal visible text', () => {
    it('renders typed marker bytes as visible text, not a hidden span', () => {
        const muya = boot('hello world\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = 'hello <!--MC:t-->world';
        muya.flush();
        leaf.update();

        expect(muya.domNode.querySelectorAll('.mu-comment-marker').length).toBe(0);
        expect(muya.domNode.textContent).toContain('<!--MC:t-->');
    });

    it('search finds typed marker-shaped bytes at their real offsets', () => {
        // Load-time markers extract into anchors; these bytes arrive by
        // (simulated) typing, so they are literal text in clean state.
        const muya = boot('alpha beta\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = 'alpha <!--MC:zz-->beta';
        muya.flush();

        const search = muya.editor.searchModule;
        search.search('<!--MC:zz-->');

        expect(search.matches.length).toBe(1);
        expect(search.matches[0].start).toBe('alpha '.length);
        expect(search.matches[0].end).toBe('alpha <!--MC:zz-->'.length);
    });

    it('search-replace over typed marker bytes replaces exactly the visible match', () => {
        const muya = boot('alpha\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = 'alpha <!--MC:zz-->beta';
        muya.flush();

        const search = muya.editor.searchModule;
        search.search('<!--MC:zz-->');
        search.replace('LITERAL', { isSingle: true, isRegexp: false });

        expect(leaf.text).toBe('alpha LITERALbeta');
    });
});

describe('malformed marker shapes from a loaded file are literal residue', () => {
    // Invariant 1's second residue (comment-anchors.md): extraction strips
    // only tokenizer-recognized well-formed markers. A malformed shape (an
    // invalid id) cannot be anchored without guessing and must not be
    // destroyed — it stays verbatim in leaf text and round-trips.
    const DOC = 'A <!--MC:bad.id-->kept<!--MC:~bad.id--> and <!--MC:ok-->reviewed<!--MC:~ok--> line.\n\n[MC:ok]: {"version":2,"status":"open"}\n';

    it('load keeps malformed marker bytes in leaf text while extracting the valid thread', () => {
        const muya = boot(DOC);
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        expect(leaf.text).toContain('<!--MC:bad.id-->kept<!--MC:~bad.id-->');
        expect(leaf.text).not.toContain('<!--MC:ok-->');
        expect(muya.editor.jsonState.commentModel.threads.has('ok')).toBe(true);
        expect(muya.editor.jsonState.commentModel.threads.has('bad.id')).toBe(false);
    });

    it('the malformed residue round-trips byte-identically through getMarkdown', () => {
        const muya = boot(DOC);

        expect(muya.getMarkdown()).toBe(DOC);
    });
});

describe('structural deletes delete affected comments instead of refusing (table ops)', () => {
    const TABLE_DOC = [
        'before <!--MC:t-->range starts here.',
        '',
        '| h1 | h2 |',
        '| --- | --- |',
        '| a1 <!--MC:~t--> | b1 |',
        '| a2 | b2 |',
        '',
        '[MC:t]: {"version":2,"status":"open"}',
        '',
    ].join('\n');

    it('removeRow removes a row containing a comment endpoint and deletes the thread', () => {
        const muya = boot(TABLE_DOC);
        const table = findTable(muya);

        const survivor = table.removeRow(1);
        muya.flush();

        expect(survivor).not.toBeNull();
        const markdown = muya.getMarkdown();
        expect(markdown).not.toContain('| a1');
        // The range cannot survive the endpoint loss, so the thread goes
        // with it — no orphaned metadata left in the document.
        expect(markdown).not.toContain('[MC:t]');
        expect(markdown).not.toContain('<!--MC:t-->');
        expect(muya.getComments().threads).toEqual([]);
        expect(muya.getComments().diagnostics).toEqual([]);
    });

    it('removeColumn removes a column containing a comment endpoint and deletes the thread', () => {
        const muya = boot(TABLE_DOC);
        const table = findTable(muya);

        const survivor = table.removeColumn(0);
        muya.flush();

        expect(survivor).not.toBeNull();
        const markdown = muya.getMarkdown();
        expect(markdown).not.toContain('a1');
        expect(markdown).not.toContain('[MC:t]');
        expect(markdown).not.toContain('<!--MC:~t-->');
        expect(muya.getComments().threads).toEqual([]);
        expect(muya.getComments().diagnostics).toEqual([]);
    });
});
