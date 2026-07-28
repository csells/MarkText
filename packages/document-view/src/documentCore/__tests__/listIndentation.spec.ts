// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Structural editing, done the way a source-authoritative engine allows.
 *
 * This was declined earlier as "text surgery that would corrupt structure", and
 * that was the right call for guessing at it — but wrong as a permanent answer.
 * In Markdown the structure IS the text, so indenting a list item is a precise
 * source edit *provided the parser says where the item begins*. `nodeAt` gives
 * the block path, so the edit is computed from parser-owned ranges rather than
 * by pattern-matching the source, and the engine re-parses to decide what the
 * result means.
 *
 * That distinction is the whole point: the view never decides what a list is.
 */

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
      schema: 'markdown-options-1',
      gfm: true,
      frontMatter: true,
      math: true,
      gitLabMath: false,
      footnotes: false,
      subscriptAndSuperscript: true
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('list indentation', () => {
    it('indents the item at an offset', async () => {
        const { view } = await mount('- one\n- two\n');
        // Offset inside "two".
        await view.setListIndentation(view.modelText().indexOf('two'), 'increase');
        expect(await view.getMarkdown()).toBe('- one\n  - two\n');
    });

    it('outdents an indented item', async () => {
        const { view } = await mount('- one\n  - two\n');
        await view.setListIndentation(view.modelText().indexOf('two'), 'decrease');
        expect(await view.getMarkdown()).toBe('- one\n- two\n');
    });

    it('leaves an already-flush item alone when outdenting', async () => {
        const { view } = await mount('- one\n- two\n');
        await view.setListIndentation(view.modelText().indexOf('two'), 'decrease');
        // Nothing to remove; the document must not be mangled to look busy.
        expect(await view.getMarkdown()).toBe('- one\n- two\n');
    });

    it('undoes as one step', async () => {
        const { view } = await mount('- one\n- two\n');
        await view.setListIndentation(view.modelText().indexOf('two'), 'increase');
        await view.undo();
        expect(await view.getMarkdown()).toBe('- one\n- two\n');
    });

    it('refuses when the offset is not in a list', async () => {
        const { view } = await mount('just a paragraph\n');
        // Indenting a paragraph is not a list operation; silently indenting it
        // would turn prose into a code block.
        await expect(view.setListIndentation(4, 'increase')).rejects.toThrow();
    });

    it('reports the capability as supported', async () => {
        const { view } = await mount('- one\n');
        expect(view.supports('list-indentation')).toBe(true);
    });
});
