// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

/**
 * Table of contents from the engine.
 *
 * The outline is derived from the parser's headings — kind and level — rather
 * than re-scanning the text for `#` characters. That matters for CriticMarkup:
 * `{--# --}Title` is a heading in one view and a paragraph in another, and a
 * regex over the source cannot know which. Only the engine can say what is
 * actually a heading in the document the user is editing.
 *
 * Slugs reuse muya's existing `generateGithubSlug`, so anchors stay identical to
 * the ones the legacy engine produced and existing links keep working.
 */

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    liveHtmlSafetyProfile: 'live-html-safety-profile-1',
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
            { level: 1, content: 'One', slug: 'one' },
            { level: 3, content: 'Three', slug: 'three' },
            { level: 2, content: 'Two', slug: 'two' },
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
            { level: 1, content: 'Title', slug: 'title' },
        ]);
    });

    it('tracks the document after an edit', async () => {
        const view = await mount('# One\n');
        await view.setContent('## Renamed\n');
        expect(view.getTOC()).toEqual([
            { level: 2, content: 'Renamed', slug: 'renamed' },
        ]);
    });
});
