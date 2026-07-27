// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * The remaining view surface the editor calls.
 *
 * These are the presentation-side methods — the mounted node, focus, focus mode,
 * float tools, image paste. They are thin next to the editing semantics, but the
 * editor calls them unconditionally, so a tab running on this engine has to
 * answer them rather than throw.
 *
 * Structural calls cross the typed command seam; the view never rewrites source
 * or infers table structure from rendered DOM.
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
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source = '# Title\n\nBody.\n') {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('view surface', () => {
    it('exposes the mounted node', async () => {
        const { host, view } = await mount();
        expect(view.domNode()).toBe(host);
    });

    it('focuses and blurs the mounted node', async () => {
        const { view } = await mount();
        view.focus();
        expect(view.hasFocus()).toBe(true);
        view.blur();
        expect(view.hasFocus()).toBe(false);
    });

    it('toggles focus mode as a root class', async () => {
        const { host, view } = await mount();
        view.setFocusMode(true);
        expect(host.classList.contains('document-view-focus-mode')).toBe(true);
        view.setFocusMode(false);
        expect(host.classList.contains('document-view-focus-mode')).toBe(false);
    });

    it('hides the table-owned floating tool and clears its cell selection', async () => {
        const { host, view } = await mount([
            '| a | b |',
            '| --- | --- |',
            '| one | two |',
            ''
        ].join('\n'));
        host.querySelector('tbody td')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );
        expect(document.body.querySelector(
            '.document-view-table-tools',
        )).not.toBeNull();
        expect(host.querySelector(
            '.document-view-table-cell[data-table-selected="true"]',
        )).not.toBeNull();

        view.dismissTransientTools();

        expect(document.body.querySelector(
            '.document-view-table-tools',
        )).toBeNull();
        expect(host.querySelector(
            '.document-view-table-cell[data-table-selected="true"]',
        )).toBeNull();
    });

    it('pastes an image as Markdown the engine owns', async () => {
        const { view } = await mount('before after\n');
        await view.pasteImage(7, { src: 'assets/a.png', alt: 'a shape' });
        // The image is document content, so it goes in as source the engine
        // parses — not as a DOM node the view sticks in by itself.
        expect(await view.getMarkdown())
            .toBe('before ![a shape](assets/a.png)after\n');
    });

    it('reports which capabilities it supports', async () => {
        const { view } = await mount();
        // The editor can ask before presenting a command; every advertised
        // capability is backed by the typed engine seam.
        expect(view.supports('typing')).toBe(true);
        expect(view.supports('search')).toBe(true);
        expect(view.supports('list-indentation')).toBe(true);
        expect(view.supports('tables')).toBe(true);
    });

    it('inserts a table row through the parser-owned structural command', async () => {
        const source = '| a | b |\n| --- | --- |\n| c | d |\n';
        const { view } = await mount(source);
        await view.insertTableRow(source.indexOf('c'));
        expect(await view.getMarkdown()).toBe(
            '| a | b |\n| --- | --- |\n| c | d |\n|   |   |\n',
        );
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });
});
