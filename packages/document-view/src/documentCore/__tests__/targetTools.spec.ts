// @vitest-environment happy-dom

import type {
    InitialModelSelection,
    ParseConfiguration,
} from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
import {
    createTestDocumentCoreSession,
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';
import { createDocumentCoreView as createProductionDocumentCoreView } from '../documentCoreView';

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: true,
        subscriptAndSuperscript: true,
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

function placeBrowserCaret(
    host: HTMLElement,
    text: string,
    offset: number,
): void {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.data === text) {
            target = node;
            break;
        }
    }
    if (target === null)
        throw new Error(`Could not find rendered text ${text}`);
    const range = document.createRange();
    range.setStart(target, offset);
    range.collapse(true);
    const selection = document.getSelection();
    if (selection === null)
        throw new Error('Expected a browser selection');
    selection.removeAllRanges();
    selection.addRange(range);
}

async function mountWithDeferredBrowserSelection(
    source: string,
    options: Readonly<{
        requestTableShape?: () => Promise<{
            rows: number;
            columns: number;
        }>;
    }> = {},
) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = await createTestDocumentCoreSession(
        createSourceSnapshot(source),
        PARSE_CONFIGURATION,
    );
    let release: (() => void) | null = null;
    let deferNextSelection = true;
    const view = await createProductionDocumentCoreView({
        host,
        session: Object.freeze({
            ...session,
            select: (selection: InitialModelSelection) => {
                if (!deferNextSelection)
                    return session.select(selection);
                deferNextSelection = false;
                return new Promise<void>((resolve, reject) => {
                    release = () => {
                        session.select(selection).then(resolve, reject);
                    };
                });
            },
        }),
        ...(options.requestTableShape === undefined
            ? {}
            : { requestTableShape: options.requestTableShape }),
    });
    return {
        host,
        view,
        releaseSelection: () => {
            if (release === null)
                throw new Error('No browser selection is awaiting release');
            release();
        },
    };
}

describe('target-owned document tools', () => {
    it('publishes the actual session rejection while Track Changes is active', async () => {
        const { view } = await mount('text\n');
        const rejected = vi.fn();
        view.subscribeTrackChangeRejection(rejected);
        await view.dispatchIntent({
            kind: 'set-track-changes',
            enabled: true,
        });

        await expect(view.executeCommand({
            kind: 'insert-table-row',
            location: 'after',
        })).rejects.toThrow(/wrong-target-kind/);

        expect(rejected).toHaveBeenCalledOnce();
        expect(rejected).toHaveBeenCalledWith({
            beforeMarkdown: 'text\n',
            reason: 'wrong-target-kind',
        });
        expect(await view.getMarkdown()).toBe('text\n');
    });

    it('leaves platform and user accelerators to the host', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const requestTableShape = vi.fn(async() => ({
            rows: 1,
            columns: 1,
        }));
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('\n'),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape,
        });
        view.setCursorByOffset(0);
        await view.settled();

        for (const event of [
            { code: 'KeyC', key: 'c', metaKey: true, altKey: true },
            { code: 'Digit1', key: '1', ctrlKey: true },
            { code: 'KeyT', key: 't', ctrlKey: true, shiftKey: true },
        ]) {
            host.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                ...event,
            }));
        }
        await view.settled();

        expect(requestTableShape).not.toHaveBeenCalled();
        expect(await view.getMarkdown()).toBe('\n');
    });

    it('dispatches code, link, image, and footnote tools through typed commands', async () => {
        const code = await mount('```js\nconst x = 1\n```\n');
        code.view.setCursorByOffset(2);
        await code.view.settled();
        await code.view.executeCommand({
            kind: 'set-code-language',
            language: 'typescript',
        });
        expect(await code.view.getMarkdown())
            .toBe('```typescript\nconst x = 1\n```\n');
        expect(code.view.getSelection()).toEqual({ start: 2, end: 2 });
        await code.view.undo();
        expect(await code.view.getMarkdown()).toBe('```js\nconst x = 1\n```\n');

        const link = await mount('before word after');
        link.view.setSelection(7, 11);
        await link.view.settled();
        await link.view.executeCommand({
            kind: 'insert-link',
            href: 'https://example.test/docs',
            title: 'Docs',
        });
        expect(await link.view.getMarkdown())
            .toBe('before [word](https://example.test/docs "Docs") after');
        expect(link.view.getSelection()).toEqual({ start: 8, end: 12 });
        await link.view.undo();
        expect(await link.view.getMarkdown()).toBe('before word after');

        const image = await mount('See ');
        image.view.setCursorByOffset(4);
        await image.view.settled();
        await image.view.executeCommand({
            kind: 'insert-image',
            src: 'images/cat.png',
            alt: 'cat',
            title: 'Cat',
        });
        expect(await image.view.getMarkdown())
            .toBe('See ![cat](images/cat.png "Cat")');
        await image.view.undo();
        expect(await image.view.getMarkdown()).toBe('See ');

        const footnote = await mount('Note');
        footnote.view.setCursorByOffset(4);
        await footnote.view.settled();
        await footnote.view.executeCommand({
            kind: 'insert-footnote',
            label: 'n',
            content: 'body',
        });
        expect(await footnote.view.getMarkdown())
            .toBe('Note[^n]\n\n[^n]: body\n');
        await footnote.view.undo();
        expect(await footnote.view.getMarkdown()).toBe('Note');
    });

    it('publishes heading-link copy from an accessible parser-derived control', async () => {
        const { host, view } = await mount('## My **Section**\n');
        const interactions = vi.fn();
        view.subscribeInteraction(interactions);

        const button = host.querySelector<HTMLButtonElement>(
            'h2 > button[data-document-command="copy-heading-link"]',
        );
        expect(button?.getAttribute('aria-label'))
            .toBe('Copy anchor link to this heading: My Section');
        expect(button?.textContent).toBe('');
        expect(host.querySelector('h2')?.textContent).toBe('My Section');
        button?.click();

        expect(interactions).toHaveBeenCalledWith({
            kind: 'copy-heading-link',
            targetNodeId: expect.any(String),
        });
        expect(await view.getMarkdown()).toBe('## My **Section**\n');
    });

    it('publishes link navigation only from the target link and its own tool', async () => {
        const { host, view } = await mount('[jump](#destination)\n');
        const interactions = vi.fn();
        view.subscribeInteraction(interactions);
        const link = host.querySelector<HTMLAnchorElement>('a.document-view-link');
        const open = host.querySelector<HTMLButtonElement>(
            '[data-document-command="navigate-link"]',
        );
        expect(link?.getAttribute('href')).toBe('#destination');
        expect(open?.getAttribute('aria-label')).toBe('Open link: #destination');
        expect(link?.dataset.nodeId).toEqual(expect.any(String));

        link?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        }));
        expect(interactions).not.toHaveBeenCalled();

        link?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        }));
        expect(interactions).toHaveBeenLastCalledWith({
            kind: 'navigate-link',
            targetNodeId: link?.dataset.nodeId,
        });

        open?.click();
        expect(interactions).toHaveBeenLastCalledWith({
            kind: 'navigate-link',
            targetNodeId: link?.dataset.nodeId,
        });
        expect(await view.getMarkdown()).toBe('[jump](#destination)\n');
    });

    it('publishes image preview from pointer and keyboard without editing source', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('![shape](assets/shape.png)\n'),
            parseConfiguration: PARSE_CONFIGURATION,
            resolveImageSource: async () => Object.freeze({
                kind: 'resolved' as const,
                src: 'marktext-image://asset/shape-capability',
            }),
        });
        await view.settled();
        const interactions = vi.fn();
        view.subscribeInteraction(interactions);
        const image = host.querySelector<HTMLImageElement>(
            'img.document-view-image',
        );

        image?.click();
        host.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: ' ',
        }));
        expect(interactions).toHaveBeenLastCalledWith({
            kind: 'preview-image',
            src: 'marktext-image://asset/shape-capability',
            trigger: 'keyboard',
        });

        image?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
        }));
        expect(interactions).toHaveBeenLastCalledWith({
            kind: 'preview-image',
            src: 'marktext-image://asset/shape-capability',
            trigger: 'modifier-click',
        });
        expect(await view.getMarkdown()).toBe('![shape](assets/shape.png)\n');
    });

    it('keeps a localized image draft outside document history until submit', async () => {
        const { host, view } = await mount('See ');
        view.setCursorByOffset(4);
        await view.settled();
        view.setLocale({
            name: 'test',
            resource: {
                'Image link or local path': 'Image source',
                'Alt text': 'Alternative text',
                'Image title': 'Optional title',
                'Embed Image': 'Insert image',
                'Cancel': 'Dismiss',
            },
        });

        await view.openImageSelector();

        const selector = host.querySelector<HTMLFormElement>(
            '.document-view-image-selector',
        );
        const src = selector?.querySelector<HTMLInputElement>('input.src');
        expect(selector?.getAttribute('role')).toBe('dialog');
        expect(src?.getAttribute('aria-label')).toBe('Image source');
        expect(host.querySelector('[data-image-field="alt"]')
            ?.getAttribute('aria-label')).toBe('Alternative text');
        expect(document.activeElement).toBe(src);
        expect(await view.getMarkdown()).toBe('See ');

        selector?.querySelector<HTMLButtonElement>(
            'button[data-image-command="cancel"]',
        )?.click();
        expect(host.querySelector('.document-view-image-selector')).toBeNull();
        expect(await view.getMarkdown()).toBe('See ');
    });

    it('captures the live browser selection before opening a new Image draft', async () => {
        const { host, view, releaseSelection } =
            await mountWithDeferredBrowserSelection('First\n\nSecond');
        placeBrowserCaret(host, 'Second', 'Second'.length);

        const opening = Promise.resolve(view.openImageSelector());
        await Promise.resolve();
        expect(host.querySelector('.document-view-image-selector')).toBeNull();
        releaseSelection();
        await opening;
        const selector = host.querySelector<HTMLFormElement>(
            '.document-view-image-selector',
        );
        const src = selector?.querySelector<HTMLInputElement>('input.src');
        if (selector === null || src === null || src === undefined)
            throw new Error('Expected the Image selector');
        src.value = 'images/live.png';
        selector.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true,
        }));
        await view.settled();

        expect(view.getMarkdownSync())
            .toBe('First\n\nSecond![](images/live.png)');
    });

    it('captures the live browser selection before requesting Table dimensions', async () => {
        const requestTableShape = vi.fn(async() => ({
            rows: 1,
            columns: 1,
        }));
        const { host, view, releaseSelection } =
            await mountWithDeferredBrowserSelection('First\n\nSecond', {
                requestTableShape,
            });
        placeBrowserCaret(host, 'Second', 'Second'.length);

        const request = view.requestTable();
        await Promise.resolve();
        expect(requestTableShape).not.toHaveBeenCalled();
        releaseSelection();
        await request;

        expect(view.getMarkdownSync())
            .toBe('First\n\nSecond\n\n|   |\n| --- |');
    });

    it('cancels a stale malformed Table response before decoding it', async () => {
        let respond: ((shape: { rows: number; columns: number }) => void)
            | undefined;
        let requestSignal: AbortSignal | undefined;
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('First\n\nSecond'),
            parseConfiguration: PARSE_CONFIGURATION,
            requestTableShape: signal => new Promise(resolve => {
                requestSignal = signal;
                respond = resolve;
            }),
        });
        view.setCursorByOffset(1);
        await view.settled();

        const request = view.requestTable();
        for (let turn = 0; respond === undefined && turn < 10; turn += 1)
            await Promise.resolve();
        if (respond === undefined)
            throw new Error('Table shape request did not start');
        await view.selectSource({
            anchor: {
                offset: 'First\n\nSecond'.length,
                affinity: 'next',
            },
            focus: {
                offset: 'First\n\nSecond'.length,
                affinity: 'next',
            },
        });
        expect(view.getSelection()).toEqual({ start: 13, end: 13 });
        expect(requestSignal?.aborted).toBe(true);
        respond?.({ rows: Number.NaN, columns: 99 });

        await expect(request).resolves.toBeUndefined();
        expect(view.getMarkdownSync()).toBe('First\n\nSecond');
    });

    it('submits an image draft through one typed intent and one undo step', async () => {
        const { host, view } = await mount('See ');
        view.setCursorByOffset(4);
        await view.settled();
        await view.openImageSelector();

        const selector = host.querySelector<HTMLFormElement>(
            '.document-view-image-selector',
        );
        const src = selector?.querySelector<HTMLInputElement>('input.src');
        const alt = selector?.querySelector<HTMLInputElement>('input.alt');
        const title = selector?.querySelector<HTMLInputElement>('input.title');
        if (
            selector === null
            || src == null
            || alt == null
            || title == null
        ) {
            throw new Error('Expected the complete Image selector form');
        }
        src.value = 'images/cat.png';
        alt.value = 'cat';
        title.value = 'Cat';
        selector.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true,
        }));
        await view.settled();

        expect(await view.getMarkdown())
            .toBe('See ![cat](images/cat.png "Cat")');
        expect(host.querySelector('.document-view-image-selector')).toBeNull();
        expect(document.activeElement).toBe(host);
        await view.undo();
        expect(await view.getMarkdown()).toBe('See ');
    });

    it('edits an existing image from parser identity and canonical source range', async () => {
        const source = 'A ![old](assets/old.png "Old") Z';
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: PARSE_CONFIGURATION,
            resolveImageSource: async () => Object.freeze({
                kind: 'resolved' as const,
                src: 'marktext-image://asset/display-capability',
            }),
        });
        await view.settled();
        const image = host.querySelector<HTMLImageElement>(
            'img.document-view-image',
        );
        expect(image?.dataset.nodeId).toEqual(expect.any(String));
        expect(image?.dataset.modelStart).toBe(String(source.indexOf('![old]')));
        expect(image?.dataset.modelEnd).toBe(String(source.indexOf(' Z')));
        expect(image?.getAttribute('src'))
            .toBe('marktext-image://asset/display-capability');

        image?.click();
        const selector = host.querySelector<HTMLFormElement>(
            '.document-view-image-selector',
        );
        const src = selector?.querySelector<HTMLInputElement>('input.src');
        const alt = selector?.querySelector<HTMLInputElement>('input.alt');
        const title = selector?.querySelector<HTMLInputElement>('input.title');
        expect(src?.value).toBe('assets/old.png');
        expect(alt?.value).toBe('old');
        expect(title?.value).toBe('Old');
        if (
            selector === null
            || src == null
            || alt == null
            || title == null
        ) {
            throw new Error('Expected the existing Image selector form');
        }
        src.value = 'assets/new.png';
        alt.value = 'new';
        title.value = 'New';
        selector.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true,
        }));
        await view.settled();

        expect(await view.getMarkdown())
            .toBe('A ![new](assets/new.png "New") Z');
        expect(document.activeElement).toBe(host);
        await view.undo();
        expect(await view.getMarkdown()).toBe(source);
    });
});
