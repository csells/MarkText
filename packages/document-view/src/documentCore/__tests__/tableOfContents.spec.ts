// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Table of contents from the engine.
 *
 * The outline is derived from the parser's headings — kind and level — rather
 * than re-scanning the text for `#` characters. That matters for CriticMarkup:
 * `{--# --}Title` is a heading in one view and a paragraph in another, and a
 * regex over the source cannot know which. Only the engine can say what is
 * actually a heading in the document the user is editing.
 *
 * Node identity and unique anchor slugs come from the document-core heading
 * outline rather than being reconstructed by the view.
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
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    return createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
}

describe('table of contents', () => {
    it('lists headings with their level and text', async () => {
        const view = await mount('# One\n\ntext\n\n### Three\n\n## Two\n');
        expect(view.getTOC()).toEqual([
            expect.objectContaining({
                level: 1, content: 'One', slug: 'one', sourceOffset: 0,
                nodeId: expect.any(String),
            }),
            expect.objectContaining({
                level: 3, content: 'Three', slug: 'three', sourceOffset: 13,
                nodeId: expect.any(String),
            }),
            expect.objectContaining({
                level: 2, content: 'Two', slug: 'two', sourceOffset: 24,
                nodeId: expect.any(String),
            }),
        ]);
    });

    it('is empty when the document has no headings', async () => {
        const view = await mount('just a paragraph\n');
        expect(view.getTOC()).toEqual([]);
    });

    it('reads a heading the engine sees through CriticMarkup', async () => {
        // The editing view shows the deletion's content, so `# ` is present and
        // this IS a heading — a regex over the raw source would see the marker
        // and a re-scan of Revised would see a paragraph.
        const view = await mount('{--# --}Title\n');
        expect(view.getTOC()).toEqual([
            expect.objectContaining({
                level: 1, content: 'Title', slug: 'title', sourceOffset: 3,
                nodeId: expect.any(String),
            }),
        ]);
    });

    it('tracks the document after an edit', async () => {
        const view = await mount('# One\n');
        await view.editSource(0, '# One\n'.length, '## Renamed\n', {
            anchor: { offset: '## Renamed\n'.length, affinity: 'next' },
            focus: { offset: '## Renamed\n'.length, affinity: 'next' },
        });
        expect(view.getTOC()).toEqual([
            expect.objectContaining({
                level: 2, content: 'Renamed', slug: 'renamed', sourceOffset: 0,
                nodeId: expect.any(String),
            }),
        ]);
    });

    it('preserves parser heading identity and unique anchors for duplicate text', async () => {
        const host = document.createElement('div');
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('# Repeat\n\n# Repeat\n'),
            parseConfiguration: PARSE_CONFIGURATION,
        });

        const toc = view.getTOC();
        expect(toc).toHaveLength(2);
        expect(toc[0]?.nodeId).not.toBe(toc[1]?.nodeId);
        expect(toc.map(item => item.slug)).toEqual(['repeat', 'repeat-1']);
        expect([
            ...host.querySelectorAll<HTMLElement>(
                '.document-view-heading[data-node-id]',
            ),
        ].map(element => element.dataset.nodeId)).toEqual(
            toc.map(item => item.nodeId),
        );

        const authenticSecond = host.querySelectorAll<HTMLElement>(
            '.document-view-heading[data-node-id]',
        )[1];
        const spoof = document.createElement('h1');
        spoof.className = 'document-view-heading';
        spoof.dataset.nodeId = toc[1]?.nodeId;
        spoof.textContent = 'hostile raw HTML spoof';
        host.prepend(spoof);

        expect(view.resolveHeadingElement(toc[1]!.nodeId))
            .toBe(authenticSecond);
    });

    it('retains parser identity for a heading nested in a blockquote', async () => {
        const host = document.createElement('div');
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('> ## Nested\n\n## Later\n'),
            parseConfiguration: PARSE_CONFIGURATION,
        });

        const toc = view.getTOC();
        expect(toc.map(item => ({
            content: item.content,
            level: item.level,
        }))).toEqual([
            { content: 'Nested', level: 2 },
            { content: 'Later', level: 2 },
        ]);
        expect(view.resolveHeadingElement(toc[0]!.nodeId))
            .toBe(host.querySelector('blockquote h2'));
        expect(view.resolveHeadingElement(toc[1]!.nodeId))
            .toBe(host.querySelector(':scope > h2'));
    });
});
