// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import StateToMarkdown from '../state/stateToMarkdown';

// One coordinate space (editing-invariants.md): word count measures the same
// clean text as selection, highlights, search, and anchors. getCleanMarkdown
// serializes the CLEAN document — no marker bytes, no metadata appendix — so
// hosts can count words over what the user actually sees.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    vi.restoreAllMocks();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

const DOC = 'Hello <!--MC:a-->reviewed<!--MC:~a--> world.\n\n[MC:a]: {"version":2,"status":"open"}\n';

describe('getCleanMarkdown', () => {
    it('serializes the clean document: no marker bytes, no metadata appendix', () => {
        const muya = boot(DOC);

        expect(muya.getCleanMarkdown()).toBe('Hello reviewed world.\n');
        // The wire serialization is unchanged.
        expect(muya.getMarkdown()).toBe(DOC);
    });

    it('equals getMarkdown for a comment-free document', () => {
        const muya = boot('# Title\n\nplain prose\n');

        expect(muya.getCleanMarkdown()).toBe(muya.getMarkdown());
    });

    // The source-mode word count strips the wire bytes from the materialized
    // markdown; the WYSIWYG count reads the clean serialization. The two
    // projections must agree byte-for-byte for word counting to agree across
    // modes — a strip that leaves residual newlines where definition lines
    // sat diverges in the 'all' display mode.
    it('the analyzer strip of the wire bytes equals the clean serialization', async () => {
        const { stripAnalyzedCommentSyntaxFromMarkdown } = await import('../comments');
        const muya = boot([
            'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
            '',
            'Second paragraph here.',
            '',
            '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"A reply"}',
            '',
        ].join('\n'));

        const stripped = stripAnalyzedCommentSyntaxFromMarkdown(muya.getMarkdown());

        expect(stripped).toBe(muya.getCleanMarkdown());
    });

    // A never-invalidating cache would serve stale text after an edit; the
    // per-version contract needs an edit between reads to be enforced.
    it('re-serializes clean text after a document edit', () => {
        const muya = boot(DOC);
        const before = muya.getCleanMarkdown();

        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        leaf.text = `ZZ${leaf.text}`;
        muya.flush();

        expect(before).toBe('Hello reviewed world.\n');
        expect(muya.getCleanMarkdown()).toBe('ZZHello reviewed world.\n');
    });

    it('serializes once per document version regardless of caller count', () => {
        const muya = boot(DOC);
        const generate = vi.spyOn(StateToMarkdown.prototype, 'generate');

        const first = muya.getCleanMarkdown();
        muya.getCleanMarkdown();
        muya.getCleanMarkdown();

        expect(generate).toHaveBeenCalledTimes(1);
        expect(muya.getCleanMarkdown()).toBe(first);
    });
});
