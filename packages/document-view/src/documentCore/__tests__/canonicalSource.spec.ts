// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * The read path save depends on.
 *
 * Migrating the first flow (type, then save) needs the view to hand back the
 * document's exact canonical source — the bytes that go to disk. This is the
 * contract that makes the engine safe to save from: CriticMarkup markers survive
 * verbatim, and nothing is normalized on the way out (ADR-0005, ADR-0007).
 *
 * Exactness is the whole point. A view that returns "equivalent" Markdown would
 * silently rewrite a user's file the first time they saved.
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

describe('canonical source', () => {
    it('returns the document byte for byte', async () => {
        for (const source of [
            '# Title\n\nHello world.\n',
            'a{++x++}b\n',
            'a{~~old~>new~~}b\n',
            'Hello {==world==}{>>note<<}.\n',
            // No terminal newline, and CRLF: the cases a serializer would
            // "helpfully" normalize.
            'no trailing newline',
            'crlf\r\nlines\r\n',
        ]) {
            const view = await mount(source);
            expect(await view.getMarkdown()).toBe(source);
        }
    });

    it('keeps CriticMarkup markers in the saved bytes', async () => {
        const view = await mount('a{++x++}b\n');
        const saved = await view.getMarkdown();
        // The reader sees 'axb'; the file keeps the markers.
        expect(view.modelText()).toBe('axb\n');
        expect(saved).toBe('a{++x++}b\n');
    });

    it('reflects an edit in the saved bytes', async () => {
        const view = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        expect(await view.getMarkdown()).toBe('Hello there world.\n');
    });

    it('writes an edit beside a tracked change without disturbing it', async () => {
        const view = await mount('Hello {++world++}.\n');
        await view.typeText(0, 'Oh, ');
        // The addition is still an addition in the file, not accepted into it.
        expect(await view.getMarkdown()).toBe('Oh, Hello {++world++}.\n');
    });
});

describe('synchronous canonical source', () => {
    it('matches the leased read', async () => {
        const view = await mount('a{++x++}b\n');
        expect(view.getMarkdownSync()).toBe(await view.getMarkdown());
    });

    it('tracks edits without awaiting', async () => {
        const view = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        expect(view.getMarkdownSync()).toBe('Hello there world.\n');
    });
});
