// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
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

    it('exposes the editable document as a multiline textbox', async () => {
        const { host, view } = await mount('Hello world.\n');

        expect(host.getAttribute('contenteditable')).toBe('true');
        expect(host.getAttribute('role')).toBe('textbox');
        expect(host.getAttribute('aria-multiline')).toBe('true');
        expect(host.getAttribute('aria-readonly')).toBe('false');

        await view.setProjection('original');
        expect(host.getAttribute('contenteditable')).toBe('false');
        expect(host.getAttribute('aria-readonly')).toBe('true');

        await view.setProjection('revised');
        expect(host.getAttribute('contenteditable')).toBe('false');
        expect(host.getAttribute('aria-readonly')).toBe('true');

        await view.setProjection('marked');
        expect(host.getAttribute('contenteditable')).toBe('true');
        expect(host.getAttribute('aria-readonly')).toBe('false');

        await view.destroy();
        expect(host.hasAttribute('contenteditable')).toBe(false);
        expect(host.hasAttribute('role')).toBe(false);
        expect(host.hasAttribute('aria-multiline')).toBe(false);
        expect(host.hasAttribute('aria-readonly')).toBe(false);
        expect(host.hasAttribute('aria-expanded')).toBe(false);
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
        ).toBe('Copier l’ancre: Title');
        const open = host.querySelector<HTMLButtonElement>(
            '[data-document-command="navigate-link"]',
        );
        expect(open?.textContent).toBe('Ouvrir le lien');
        expect(open?.getAttribute('aria-label'))
            .toBe('Ouvrir le lien: https://example.test');
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

    it('offers Table and every Profile 1 diagram through one Quick Insert intent', async () => {
        const { host, view } = await mount('');
        await view.typeText(0, '/');

        const labels = [...host.querySelectorAll<HTMLElement>(
            '.document-view-quick-insert-item',
        )].map(item => item.dataset.label);
        expect(labels).toEqual(expect.arrayContaining([
            'table',
            'vega-lite',
            'mermaid',
            'plantuml',
            'flowchart',
            'sequence',
        ]));

        host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="mermaid"]',
        )?.click();
        await view.settled();
        expect(view.getMarkdownSync()).toBe('```mermaid\n\n```');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('/');
        await view.redo();
        expect(view.getMarkdownSync()).toBe('```mermaid\n\n```');
    });

    it('keeps a localized no-result status and announces the active option', async () => {
        const { host, view } = await mount('');
        view.setLocale({
            name: 'quick-insert-accessibility',
            resource: { 'No result': 'Keine Treffer' },
        });
        view.focus();
        await view.typeText(0, '/missing');

        const overlay = host.querySelector<HTMLElement>(
            '.document-view-quick-insert',
        );
        const listbox = overlay?.querySelector<HTMLElement>('[role="listbox"]');
        const status = overlay?.querySelector<HTMLElement>('[role="status"]');
        expect(overlay).not.toBeNull();
        expect(overlay?.hasAttribute('role')).toBe(false);
        expect(listbox).not.toBeNull();
        expect(listbox?.tabIndex).toBe(0);
        expect(status?.textContent).toBe('Keine Treffer');
        expect(status?.parentElement).toBe(overlay);
        expect(listbox?.contains(status ?? null)).toBe(false);
        expect(host.getAttribute('aria-controls')).toBe(listbox?.id);
        expect(host.hasAttribute('aria-expanded')).toBe(false);
        expect(host.getAttribute('aria-haspopup')).toBe('listbox');
        expect(host.getAttribute('aria-autocomplete')).toBe('list');
        expect(host.hasAttribute('aria-activedescendant')).toBe(false);

        await view.replaceRange(0, '/missing'.length, '/');
        const choices = [...host.querySelectorAll<HTMLElement>(
            '.document-view-quick-insert-item',
        )];
        expect(choices.length).toBeGreaterThan(1);
        expect(new Set(choices.map(choice => choice.id)).size)
            .toBe(choices.length);
        const activeListbox = host.querySelector<HTMLElement>(
            '.document-view-quick-insert-listbox',
        );
        expect(host.getAttribute('aria-activedescendant')).toBe(choices[0]?.id);
        expect(activeListbox?.getAttribute('aria-activedescendant'))
            .toBe(choices[0]?.id);

        host.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown',
        }));
        expect(host.getAttribute('aria-activedescendant')).toBe(choices[1]?.id);
        expect(activeListbox?.getAttribute('aria-activedescendant'))
            .toBe(choices[1]?.id);
    });

    it('keeps the keyboard-active Quick Insert option in view', async () => {
        const { host, view } = await mount('');
        await view.typeText(0, '/');
        const choices = [...host.querySelectorAll<HTMLElement>(
            '.document-view-quick-insert-item',
        )];
        const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
            .mockImplementation(() => undefined);

        host.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown',
        }));

        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(scrollIntoView.mock.instances[0]).toBe(choices[1]);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
        scrollIntoView.mockRestore();
    });

    it('dismisses Quick Insert on Tab without trapping focus', async () => {
        const { host, view } = await mount('');
        await view.typeText(0, '/');
        const tab = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Tab',
        });

        host.dispatchEvent(tab);

        expect(tab.defaultPrevented).toBe(false);
        expect(host.querySelector('.document-view-quick-insert')).toBeNull();
        expect(host.hasAttribute('aria-controls')).toBe(false);
        expect(host.hasAttribute('aria-autocomplete')).toBe(false);
    });

    it('requests only Table dimensions and commits the captured 1×1 target', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const requestTableShape = vi.fn(async() => ({
            rows: 1,
            columns: 1,
        }));
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape,
        });
        await view.typeText(0, '/table');

        host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        )?.click();
        await view.settled();

        expect(requestTableShape).toHaveBeenCalledOnce();
        expect(requestTableShape).toHaveBeenCalledWith(
            expect.any(AbortSignal),
        );
        expect(view.getMarkdownSync()).toBe('|   |\n| --- |');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('/table');
        await view.redo();
        expect(view.getMarkdownSync()).toBe('|   |\n| --- |');
    });

    it('authenticates a Quick Insert click after queued browser typing settles', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: async() => ({ rows: 1, columns: 1 }),
        });
        view.focus();
        host.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: '/',
        }));
        await view.settled();
        const table = host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        );
        if (table === null)
            throw new Error('Expected the initial Table choice');

        for (const data of 'table') {
            host.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data,
            }));
        }
        table.click();
        await view.settled();

        expect(view.getMarkdownSync()).toBe('|   |\n| --- |');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('/table');
    });

    it('does not retarget a queued Quick Insert click to another paragraph', async () => {
        const { host, view } = await mount('/\n\n/');
        const heading = host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="atx-heading 1"]',
        );
        if (heading === null)
            throw new Error('Expected the first paragraph Quick Insert choice');

        view.setCursorByOffset('/\n\n/'.length);
        await view.settled();
        heading.click();
        await view.settled();

        expect(view.getMarkdownSync()).toBe('/\n\n/');
    });

    it('cancels a delayed Table response instead of retargeting a newer revision', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let respond: ((shape: { rows: number; columns: number }) => void)
            | undefined;
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: () => new Promise(resolve => {
                respond = resolve;
            }),
        });
        await view.typeText(0, '/table');
        host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        )?.click();
        await Promise.resolve();

        const snapshot = view.snapshot();
        if (snapshot.kind !== 'complete')
            throw new Error('Expected a complete snapshot');
        await view.dispatchIntent({
            kind: 'insert-text',
            target: snapshot.selection,
            text: 'x',
        });
        respond?.({ rows: 1, columns: 1 });
        await view.settled();

        expect(view.getMarkdownSync()).toBe('/tablex');
    });

    it('cancels Table without mutation and aborts a pending request on destroy', async () => {
        const cancelHost = document.createElement('div');
        document.body.appendChild(cancelHost);
        const cancelled = await createDocumentCoreView({
            host: cancelHost,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: async() => null,
        });
        await cancelled.typeText(0, '/table');
        cancelled.focus();
        cancelHost.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        )?.click();
        await cancelled.settled();
        expect(cancelled.getMarkdownSync()).toBe('/table');
        expect(document.activeElement).toBe(cancelHost);

        const destroyHost = document.createElement('div');
        document.body.appendChild(destroyHost);
        let requestSignal: AbortSignal | undefined;
        const destroyed = await createDocumentCoreView({
            host: destroyHost,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: signal => new Promise(resolve => {
                requestSignal = signal;
                signal.addEventListener('abort', () => resolve(null), {
                    once: true,
                });
            }),
        });
        await destroyed.typeText(0, '/table');
        destroyHost.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        )?.click();
        await Promise.resolve();
        await destroyed.destroy();
        expect(requestSignal?.aborted).toBe(true);
    });

    it('rejects malformed Table dimensions without changing source', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(''),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: async() => ({ rows: 31, columns: 1 }),
        });
        await view.typeText(0, '/table');
        host.querySelector<HTMLButtonElement>(
            '.document-view-quick-insert-item[data-label="table"]',
        )?.click();

        await expect(view.settled()).rejects.toThrow(
            /outside 1–30 rows by 1–20 columns/,
        );
        expect(view.getMarkdownSync()).toBe('/table');
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
