// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
import {
    createDocumentCoreView as createSessionBackedDocumentCoreView,
} from '../documentCoreView';
import {
    createTestDocumentCoreSession,
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

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
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

function textNodeContaining(root: Node, text: string): Text {
    const walker = root.ownerDocument?.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
    );
    let node = walker?.nextNode() ?? null;
    while (node) {
        if (node instanceof Text && node.data.includes(text))
            return node;

        node = walker?.nextNode() ?? null;
    }
    throw new Error(`No text node contains ${JSON.stringify(text)}`);
}

function placeCaret(node: Text, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = document.getSelection();
    if (!selection)
        throw new Error('The test document has no Selection');

    selection.removeAllRanges();
    selection.addRange(range);
}

function placeSelection(node: Text, start: number, end: number): void {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = document.getSelection();
    if (!selection)
        throw new Error('The test document has no Selection');

    selection.removeAllRanges();
    selection.addRange(range);
}

function beforeInput(
    host: HTMLElement,
    inputType: string,
    data: string | null = null,
): InputEvent {
    const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data,
        inputType,
    });
    expect(host.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    return event;
}

describe('document-core browser input', () => {
    it.each([
        {
            option: 'autoPairBrackets' as const,
            open: '(',
            expected: 'a()b',
        },
        {
            option: 'autoPairQuotes' as const,
            open: '"',
            expected: 'a""b',
        },
        {
            option: 'autoPairMarkdown' as const,
            open: '*',
            expected: 'a**b',
        },
    ])('applies $option as one paired insertion and one undo', async (row) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('ab'),
            parseConfiguration: PARSE_CONFIGURATION,
        });
        view.setOptions({ [row.option]: true });
        placeCaret(textNodeContaining(host, 'ab'), 1);

        beforeInput(host, 'insertText', row.open);
        await view.settled();

        expect(view.getMarkdownSync()).toBe(row.expected);
        expect(document.getSelection()?.anchorOffset).toBe(2);
        await view.undo();
        expect(view.getMarkdownSync()).toBe('ab');
        await view.destroy();
    });

    it('inserts only the typed character when its auto-pair option is off', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('ab'),
            parseConfiguration: PARSE_CONFIGURATION,
        });
        view.setOptions({ autoPairBrackets: false });
        placeCaret(textNodeContaining(host, 'ab'), 1);

        beforeInput(host, 'insertText', '(');
        await view.settled();

        expect(view.getMarkdownSync()).toBe('a(b');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('ab');
        await view.destroy();
    });

    it('steps over an existing auto-paired closer without a document change', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('a()b'),
            parseConfiguration: PARSE_CONFIGURATION,
        });
        view.setOptions({ autoPairBrackets: true });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });
        placeCaret(textNodeContaining(host, 'a()b'), 2);

        beforeInput(host, 'insertText', ')');
        await view.settled();

        expect(view.getMarkdownSync()).toBe('a()b');
        expect(document.getSelection()?.anchorOffset).toBe(3);
        expect(changes).toBe(0);
        await view.destroy();
    });

    it('maps input at an atomic Comment indicator outside its hidden payload', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('before {>>note<<} after\n'),
            parseConfiguration: PARSE_CONFIGURATION,
        });
        const indicator = host.querySelector<HTMLElement>(
            '.document-view-critic-comment-indicator',
        );
        if (indicator === null)
            throw new Error('Expected a parser-described Comment indicator');
        const range = document.createRange();
        range.setStart(indicator, 0);
        range.collapse(true);
        const selection = document.getSelection();
        if (selection === null)
            throw new Error('The test document has no Selection');
        selection.removeAllRanges();
        selection.addRange(range);

        beforeInput(host, 'insertText', 'Z');
        await view.settled();

        expect(view.getMarkdownSync()).toBe('before {>>note<<}Z after\n');
        expect(host.textContent).toBe('before Z after');
        expect(host.textContent).not.toContain('note');
        expect(
            host.querySelectorAll('.document-view-critic-comment-indicator'),
        ).toHaveLength(1);
        await view.destroy();
    });

    it('commits a real beforeinput, restores its DOM caret, and undoes exactly', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello world.\n'),
            parseConfiguration: PARSE_CONFIGURATION,
        });

        expect(host.getAttribute('contenteditable')).toBe('true');
        placeCaret(textNodeContaining(host, 'Hello world.'), 5);
        const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: ' there',
            inputType: 'insertText',
        });

        expect(host.dispatchEvent(beforeInput)).toBe(false);
        expect(beforeInput.defaultPrevented).toBe(true);
        await view.settled();

        expect(view.getMarkdownSync()).toBe('Hello there world.\n');
        expect(host.textContent).toBe('Hello there world.');
        expect(document.getSelection()?.anchorNode?.textContent).toBe(
            'Hello there world.',
        );
        expect(document.getSelection()?.anchorOffset).toBe(11);

        await view.undo();
        expect(view.getMarkdownSync()).toBe('Hello world.\n');
        expect(host.textContent).toBe('Hello world.');
        expect(document.getSelection()?.anchorNode?.textContent).toBe(
            'Hello world.',
        );
        expect(document.getSelection()?.anchorOffset).toBe(5);

        view.destroy();
    });

    it('preserves event order while earlier remote input is still pending', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
        });

        placeCaret(textNodeContaining(host, 'Hello'), 5);
        for (const data of ['a', 'b', 'c']) {
            const beforeInput = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                data,
                inputType: 'insertText',
            });
            expect(host.dispatchEvent(beforeInput)).toBe(false);
        }

        await view.settled();
        expect(view.getMarkdownSync()).toBe('Helloabc');
        expect(host.textContent).toBe('Helloabc');
        expect(document.getSelection()?.anchorOffset).toBe(8);

        view.destroy();
    });

    it('defers a browser selectionchange until its admitted edit is published', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const authority = await createTestDocumentCoreSession(
            createSourceSnapshot('Hello'),
            PARSE_CONFIGURATION,
        );
        let releaseDispatch = (): void => undefined;
        const deliveryGate = new Promise<void>(resolve => {
            releaseDispatch = resolve;
        });
        let reportMainCommit = (): void => undefined;
        const mainCommitted = new Promise<void>(resolve => {
            reportMainCommit = resolve;
        });
        let pendingDispatch = Promise.resolve();
        const session = Object.freeze({
            ...authority,
            dispatch: (
                intent: Parameters<typeof authority.dispatch>[0],
            ) => {
                const delivered = authority.dispatch(intent).then(
                    async (result) => {
                        reportMainCommit();
                        await deliveryGate;
                        return result;
                    },
                );
                pendingDispatch = delivered.then(
                    () => undefined,
                    () => undefined,
                );
                return delivered;
            },
            select: async (
                selection: Parameters<typeof authority.select>[0],
            ): Promise<void> => {
                await pendingDispatch;
                await authority.select(selection);
            },
        });
        const view = await createSessionBackedDocumentCoreView({
            host,
            session,
        });
        placeCaret(textNodeContaining(host, 'Hello'), 5);
        await view.commitSelection();

        beforeInput(host, 'deleteContentBackward');
        await mainCommitted;
        document.dispatchEvent(new Event('selectionchange'));
        releaseDispatch();

        await expect(view.settled()).resolves.toBeUndefined();
        expect(view.getMarkdownSync()).toBe('Hell');
        expect(view.getSelection()).toEqual({ start: 4, end: 4 });
        await view.destroy();
    });

    it('does not synchronize a deferred selection after destruction begins', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const authority = await createTestDocumentCoreSession(
            createSourceSnapshot('Hello'),
            PARSE_CONFIGURATION,
        );
        let releaseDispatch = (): void => undefined;
        const deliveryGate = new Promise<void>(resolve => {
            releaseDispatch = resolve;
        });
        let reportMainCommit = (): void => undefined;
        const mainCommitted = new Promise<void>(resolve => {
            reportMainCommit = resolve;
        });
        let pendingDispatch = Promise.resolve();
        let selectRequests = 0;
        let closeRequests = 0;
        const session = Object.freeze({
            ...authority,
            dispatch: (
                intent: Parameters<typeof authority.dispatch>[0],
            ) => {
                const delivered = authority.dispatch(intent).then(
                    async (result) => {
                        reportMainCommit();
                        await deliveryGate;
                        return result;
                    },
                );
                pendingDispatch = delivered.then(
                    () => undefined,
                    () => undefined,
                );
                return delivered;
            },
            select: async (
                selection: Parameters<typeof authority.select>[0],
            ): Promise<void> => {
                selectRequests += 1;
                await pendingDispatch;
                await authority.select(selection);
            },
            close: async (): Promise<void> => {
                closeRequests += 1;
                await authority.close();
            },
        });
        const view = await createSessionBackedDocumentCoreView({
            host,
            session,
        });
        placeCaret(textNodeContaining(host, 'Hello'), 5);
        await view.commitSelection();
        selectRequests = 0;

        beforeInput(host, 'deleteContentBackward');
        await mainCommitted;
        document.dispatchEvent(new Event('selectionchange'));
        const contenteditableMutations: MutationRecord[] = [];
        const observer = new MutationObserver(records => {
            contenteditableMutations.push(...records);
        });
        observer.observe(host, {
            attributes: true,
            attributeFilter: ['contenteditable'],
            attributeOldValue: true,
        });
        const destroyed = view.destroy();
        releaseDispatch();
        await destroyed;
        contenteditableMutations.push(...observer.takeRecords());
        observer.disconnect();

        expect(selectRequests).toBe(0);
        expect(closeRequests).toBe(1);
        expect(
            contenteditableMutations.filter(mutation =>
                mutation.oldValue === null
            ),
        ).toHaveLength(0);
        expect(host.hasAttribute('contenteditable')).toBe(false);
    });

    it.each([
        {
            title: 'backspace',
            source: 'Hello',
            selection: [5, 5],
            inputType: 'deleteContentBackward',
            data: null,
            expected: 'Hell',
        },
        {
            title: 'forward delete',
            source: 'Hello',
            selection: [0, 0],
            inputType: 'deleteContentForward',
            data: null,
            expected: 'ello',
        },
        {
            title: 'paragraph break',
            source: 'one two',
            selection: [3, 3],
            inputType: 'insertParagraph',
            data: null,
            expected: 'one\n\n two',
        },
        {
            title: 'soft line break',
            source: 'one two',
            selection: [3, 3],
            inputType: 'insertLineBreak',
            data: null,
            expected: 'one\n two',
        },
        {
            title: 'plain-text paste',
            source: 'Hello ',
            visible: 'Hello',
            selection: [6, 6],
            domSelection: [5, 5],
            inputType: 'insertFromPaste',
            data: 'renderer-forged',
            clipboardPasteText: 'world',
            expected: 'Hello world',
        },
    ])('commits $title through beforeinput as one undoable intent', async (row) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(row.source),
            parseConfiguration: PARSE_CONFIGURATION,
            ...(
                'clipboardPasteText' in row
                && typeof row.clipboardPasteText === 'string'
                    ? {
                        clipboardPaste: (
                            _target,
                            pasteText,
                        ) => pasteText(row.clipboardPasteText),
                    }
                    : {}
            ),
        });
        const visible = 'visible' in row && typeof row.visible === 'string'
            ? row.visible
            : row.source;
        const node = textNodeContaining(host, visible);
        const selection = 'domSelection' in row
            && row.domSelection !== undefined
            ? row.domSelection
            : row.selection;
        placeSelection(node, selection[0], selection[1]);

        beforeInput(host, row.inputType, row.data);
        await view.settled();
        expect(view.getMarkdownSync()).toBe(row.expected);

        await view.undo();
        expect(view.getMarkdownSync()).toBe(row.source);
        view.destroy();
    });

    it('commits one completed IME composition as one history entry', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('ab'),
            parseConfiguration: PARSE_CONFIGURATION,
        });
        placeCaret(textNodeContaining(host, 'ab'), 1);

        host.dispatchEvent(new CompositionEvent('compositionstart', {
            bubbles: true,
        }));
        beforeInput(host, 'insertCompositionText', '日');
        beforeInput(host, 'insertCompositionText', '日本');
        host.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: '日本',
        }));

        await view.settled();
        expect(view.getMarkdownSync()).toBe('a日本b');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('ab');
        view.destroy();
    });

    it('routes real copy, cut, and null-data paste gestures through host/core seams', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const writes: unknown[] = [];
        const pasteTargets: unknown[] = [];
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardWrite: async request => {
                writes.push(request);
            },
            clipboardPaste: async (target, pasteText) => {
                pasteTargets.push(target);
                return pasteText('world');
            },
        });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });

        placeSelection(textNodeContaining(host, 'Hello'), 1, 4);
        const copy = new Event('copy', { bubbles: true, cancelable: true });
        expect(host.dispatchEvent(copy)).toBe(false);
        await view.settled();
        expect(writes).toEqual([{
            consumer: 'normal-copy',
            view: 'markup',
            selection: { start: 1, end: 4 },
        }]);
        expect(view.getMarkdownSync()).toBe('Hello');

        placeSelection(textNodeContaining(host, 'Hello'), 1, 4);
        const cut = new Event('cut', { bubbles: true, cancelable: true });
        expect(host.dispatchEvent(cut)).toBe(false);
        await view.settled();
        expect(writes.at(-1)).toEqual({
            consumer: 'cut',
            view: 'markup',
            selection: { start: 1, end: 4 },
        });
        expect(view.getMarkdownSync()).toBe('Ho');
        expect(host.textContent).toBe('Ho');
        expect(changes).toBe(1);

        await view.undo();
        expect(view.getMarkdownSync()).toBe('Hello');
        placeCaret(textNodeContaining(host, 'Hello'), 5);
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        expect(host.dispatchEvent(paste)).toBe(false);
        await view.settled();
        expect(view.getMarkdownSync()).toBe('Helloworld');
        expect(pasteTargets).toEqual([
            expect.objectContaining({
                view: 'markup',
                anchor: expect.objectContaining({ offset: 5 }),
                focus: expect.objectContaining({ offset: 5 }),
            }),
        ]);

        view.destroy();
    });

    it('binds Source paste to an exact authenticated Source selection', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const targets: unknown[] = [];
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardPaste: async (target, pasteText) => {
                targets.push(target);
                return pasteText('trusted');
            },
        });

        await view.pasteSourceClipboard({
            anchor: { offset: 1, affinity: 'next' },
            focus: { offset: 4, affinity: 'previous' },
        });

        expect(targets).toEqual([
            expect.objectContaining({
                view: 'source',
                revision: expect.any(String),
                anchor: { offset: 1, affinity: 'next' },
                focus: { offset: 4, affinity: 'previous' },
            }),
        ]);
        expect(view.getMarkdownSync()).toBe('Htrustedo');
        await view.undo();
        expect(view.getMarkdownSync()).toBe('Hello');
        await view.destroy();
    });

    it('does not read clipboard material exposed by beforeinput', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const dataRead = vi.fn(() => 'renderer clipboard text');
        const transferRead = vi.fn(() => 'renderer transfer text');
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardPaste: (_target, pasteText) => pasteText(' trusted'),
        });
        placeCaret(textNodeContaining(host, 'Hello'), 5);
        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
        });
        Object.defineProperty(event, 'data', { get: dataRead });
        Object.defineProperty(event, 'dataTransfer', {
            get: () => Object.freeze({ getData: transferRead }),
        });

        expect(host.dispatchEvent(event)).toBe(false);
        await view.settled();

        expect(dataRead).not.toHaveBeenCalled();
        expect(transferRead).not.toHaveBeenCalled();
        expect(view.getMarkdownSync()).toBe('Hello trusted');
        await view.destroy();
    });

    it('does not mutate when the clipboard sink rejects a cut', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardWrite: async () => {
                throw new Error('clipboard unavailable');
            },
        });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });
        placeSelection(textNodeContaining(host, 'Hello'), 1, 4);

        const cut = new Event('cut', { bubbles: true, cancelable: true });
        expect(host.dispatchEvent(cut)).toBe(false);
        await expect(view.settled()).rejects.toThrow('clipboard unavailable');

        expect(view.getMarkdownSync()).toBe('Hello');
        expect(host.textContent).toBe('Hello');
        expect(changes).toBe(0);
        view.destroy();
    });

    it('treats a collapsed cut as a no-op without touching the clipboard', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const writes: unknown[] = [];
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardWrite: async request => {
                writes.push(request);
            },
        });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });
        placeCaret(textNodeContaining(host, 'Hello'), 2);

        const cut = new Event('cut', { bubbles: true, cancelable: true });
        expect(host.dispatchEvent(cut)).toBe(false);
        await view.settled();

        expect(writes).toEqual([]);
        expect(view.getMarkdownSync()).toBe('Hello');
        expect(host.textContent).toBe('Hello');
        expect(changes).toBe(0);
        await view.destroy();
    });

    it('commits a source cut once and rerenders the owning session', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const writes: unknown[] = [];
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardWrite: async request => {
                writes.push(request);
            },
        });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });

        await view.cutSource(2, 2);
        expect(writes).toEqual([]);
        expect(view.getMarkdownSync()).toBe('Hello');
        expect(changes).toBe(0);

        await view.cutSource(1, 4);

        expect(writes).toEqual([{
            consumer: 'cut',
            view: 'source',
            selection: { start: 1, end: 4 },
        }]);
        expect(view.getMarkdownSync()).toBe('Ho');
        expect(host.textContent).toBe('Ho');
        expect(changes).toBe(1);
        await view.undo();
        expect(view.getMarkdownSync()).toBe('Hello');
        await view.destroy();
    });

    it('leaves source unchanged when its cut sink fails', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot('Hello'),
            parseConfiguration: PARSE_CONFIGURATION,
            clipboardWrite: async () => {
                throw new Error('clipboard unavailable');
            },
        });
        let changes = 0;
        view.onChange(() => {
            changes += 1;
        });

        await expect(view.cutSource(1, 4)).rejects.toThrow(
            'clipboard unavailable',
        );

        expect(view.getMarkdownSync()).toBe('Hello');
        expect(host.textContent).toBe('Hello');
        expect(changes).toBe(0);
        await view.destroy();
    });

    it('requires the closed clipboard result for copy and cut consumers', async () => {
        const copyHost = document.createElement('div');
        document.body.appendChild(copyHost);
        const copyView = await createSessionBackedDocumentCoreView({
            host: copyHost,
            session: await createTestDocumentCoreSession(
                createSourceSnapshot('Hello'),
                PARSE_CONFIGURATION,
            ),
            clipboardWrite: async () =>
                Object.freeze({ kind: 'cut-committed' as const }),
        });
        placeSelection(textNodeContaining(copyHost, 'Hello'), 1, 4);
        copyHost.dispatchEvent(
            new Event('copy', { bubbles: true, cancelable: true }),
        );
        await expect(copyView.settled()).rejects.toThrow(
            /copy requires a written clipboard result/i,
        );
        expect(copyView.getMarkdownSync()).toBe('Hello');
        await copyView.destroy();

        const cutHost = document.createElement('div');
        document.body.appendChild(cutHost);
        const cutView = await createSessionBackedDocumentCoreView({
            host: cutHost,
            session: await createTestDocumentCoreSession(
                createSourceSnapshot('Hello'),
                PARSE_CONFIGURATION,
            ),
            clipboardWrite: async () =>
                Object.freeze({ kind: 'written' as const }),
        });
        placeSelection(textNodeContaining(cutHost, 'Hello'), 1, 4);
        cutHost.dispatchEvent(
            new Event('cut', { bubbles: true, cancelable: true }),
        );
        await expect(cutView.settled()).rejects.toThrow(
            /cut requires a cut-committed clipboard result/i,
        );
        expect(cutView.getMarkdownSync()).toBe('Hello');
        await cutView.destroy();
    });
});
