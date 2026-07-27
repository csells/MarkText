// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Increment 4, end to end — the loop the editor actually runs.
 *
 * A keystroke lands on the DOM, becomes a typed intent against the engine,
 * commits a new immutable revision, and the DOM re-renders from it. The engine
 * is the authority the whole way round: the view never edits its own DOM text
 * and never decides what the document now says.
 *
 * The point of proving it here rather than only in document-core is that this is
 * a real browser DOM, mounted by the direct view, driven by user-shaped gestures.
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
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('document-core view', () => {
    it('mounts the engine-rendered document', async () => {
        const { host } = await mount('# Title\n\nHello {++world++}.\n');
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'P',
        ]);
        expect(host.querySelector('ins')?.textContent).toBe('world');
    });

    it('renders target-owned document controls from the active locale', async () => {
        const { host, view } = await mount(
            '# Title\n\n'
            + '[site](https://example.test)\n\n'
            + '```ts\nconst value = 1\n```\n',
        );

        view.setLocale({
            name: 'control-test',
            resource: {
                'Copy anchor link to this heading': 'Copier l’ancre',
                'Open link': 'Ouvrir le lien',
                'Input Language Identifier...': 'Langage du bloc',
            },
        });

        expect(
            host.querySelector('.document-view-heading-link-copy')
                ?.getAttribute('aria-label'),
        ).toBe('Copier l’ancre');
        const open = host.querySelector<HTMLButtonElement>(
            '[data-document-command="navigate-link"]',
        );
        expect(open?.textContent).toBe('Ouvrir le lien');
        expect(open?.getAttribute('aria-label')).toBe('Ouvrir le lien');
        expect(
            host.querySelector('.document-view-code-language')
                ?.getAttribute('aria-label'),
        ).toBe('Langage du bloc');
    });

    it('mounts parser-described Comment indicators without exposing payload text', async () => {
        const { host, view } = await mount(
            'before {==reviewed==}{>>private note<<} after {>>point note<<}\n',
        );
        const comments = view.getReviewIndex().items.filter(
            item => item.kind === 'comment',
        );
        const anchored = view.getReviewIndex().commentedSpans[0];
        expect(comments).toHaveLength(2);
        expect(anchored).toBeDefined();
        expect(host.textContent).toBe('before reviewed after');
        expect(host.textContent).not.toContain('private note');
        expect(host.textContent).not.toContain('point note');

        const indicators = [
            ...host.querySelectorAll<HTMLElement>(
                '.document-view-critic-comment-indicator',
            ),
        ];
        expect(indicators).toHaveLength(2);
        expect(indicators.map(indicator => ({
            role: indicator.getAttribute('role'),
            label: indicator.getAttribute('aria-label'),
            editable: indicator.getAttribute('contenteditable'),
            text: indicator.textContent,
            nodeId: indicator.dataset.criticCommentNodeId,
            start: Number(indicator.dataset.modelStart),
            end: Number(indicator.dataset.modelEnd),
        }))).toEqual(comments.map(comment => {
            const anchor = view.getReviewIndex().commentedSpans.find(
                span => span.comment === comment.nodeId,
            );
            const offset = anchor?.modelRange.end ?? comment.focusOffset;
            return {
                role: 'img',
                label: 'Comment',
                editable: 'false',
                text: '',
                nodeId: comment.nodeId,
                start: offset,
                end: offset,
            };
        }));

        view.setLocale({
            name: 'comment-test',
            resource: { Comment: 'Kommentar' },
        });
        expect(indicators.map(indicator =>
            indicator.getAttribute('aria-label'))).toEqual([
            'Kommentar',
            'Kommentar',
        ]);

        await view.setProjection('original');
        expect(
            host.querySelectorAll('.document-view-critic-comment-indicator'),
        ).toHaveLength(0);
        await view.setProjection('marked');
        expect(
            host.querySelectorAll('.document-view-critic-comment-indicator'),
        ).toHaveLength(2);
    });

    it('commits a keystroke and re-renders from the new revision', async () => {
        const { host, view } = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        expect(host.textContent).toBe('Hello there world.');
        expect(view.modelText()).toBe('Hello there world.\n');
    });

    it('converts a slash query through the target-owned Quick Insert overlay', async () => {
        const { host, view } = await mount('');
        await view.typeText(0, '/');

        const overlay = host.querySelector<HTMLElement>(
            '.document-view-quick-insert',
        );
        expect(overlay).not.toBeNull();
        const heading = overlay?.querySelector<HTMLButtonElement>(
            '[data-label="atx-heading 1"]',
        );
        expect(heading).not.toBeNull();

        heading?.click();
        await view.settled();

        expect(host.querySelector('h1')).not.toBeNull();
        expect(view.getMarkdownSync()).toBe('# ');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('/');
    });

    it('localizes and honors the empty-paragraph Quick Insert hint option', async () => {
        const { host, view } = await mount('');
        expect(host.dataset.quickInsertPlaceholder).toBe(
            'Type / to insert...',
        );

        view.setLocale({
            name: 'quick-insert-test',
            resource: { 'Type / to insert...': 'Insérez avec /' },
        });
        expect(host.dataset.quickInsertPlaceholder).toBe(
            'Insérez avec /',
        );

        view.setOptions({ hideQuickInsertHint: true });
        expect(host.hasAttribute(
            'data-quick-insert-placeholder',
        )).toBe(false);
        view.setOptions({ hideQuickInsertHint: false });
        expect(host.dataset.quickInsertPlaceholder).toBe(
            'Insérez avec /',
        );
    });

    it('filters localized Quick Insert choices and supports keyboard selection', async () => {
        const { host, view } = await mount('');
        view.setLocale({
            name: 'quick-insert-test',
            resource: { 'Heading 1': 'Titre principal' },
        });
        await view.typeText(0, '/titre');

        const overlay = host.querySelector<HTMLElement>(
            '.document-view-quick-insert',
        );
        const items = [
            ...(overlay?.querySelectorAll<HTMLButtonElement>(
                '.document-view-quick-insert-item',
            ) ?? []),
        ];
        expect(items.map(item => item.dataset.label)).toEqual([
            'atx-heading 1',
        ]);
        expect(items[0]?.textContent).toBe('Titre principal');

        host.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }));
        await view.settled();
        expect(view.getMarkdownSync()).toBe('# ');
        expect(host.querySelector('h1')).not.toBeNull();
    });

    it('leaves a tracked change intact when typing beside it', async () => {
        const { host, view } = await mount('Hello {++world++}.\n');
        await view.typeText(0, 'Oh, ');
        // The addition is still an addition, not accepted or flattened away.
        expect(host.querySelector('ins')?.textContent).toBe('world');
        expect(host.textContent).toBe('Oh, Hello world.');
    });

    it('keeps the DOM offsets addressing the new revision after an edit', async () => {
        const { host, view } = await mount('Hello {++world++}.\n');
        await view.typeText(0, 'Oh, ');
        const inserted = host.querySelector('ins');
        // Offsets must describe the document as it is NOW; stale ones would
        // send the next edit to the wrong place.
        const start = Number(inserted?.getAttribute('data-model-start'));
        expect(view.modelText().slice(start, start + 5)).toBe('world');
    });

    it('undoes back to the exact prior document', async () => {
        const { host, view } = await mount('Hello world.\n');
        await view.typeText(5, '!');
        expect(view.modelText()).toBe('Hello! world.\n');
        await view.undo();
        expect(view.modelText()).toBe('Hello world.\n');
        expect(host.textContent).toBe('Hello world.');
    });
});
