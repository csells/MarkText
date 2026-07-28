// @vitest-environment happy-dom

import type {
    EditorIntent,
    InitialModelSelection,
    ParseConfiguration,
} from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
import {
    createTestDocumentCoreSession,
    createTestDocumentCoreView,
} from './testDocumentCoreSession';
import {
    createDocumentCoreView,
    type DocumentCoreViewSnapshot,
    type IDocumentCoreViewSession,
} from '../documentCoreView';

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

const DESKTOP_CONFIGURATION: ParseConfiguration = {
    ...PARSE_CONFIGURATION,
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createTestDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('authoritative in-place text publication', () => {
    it('renders a recovered authoritative snapshot before surfacing a publication failure', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const authority = await createTestDocumentCoreSession(
            createSourceSnapshot('before'),
            PARSE_CONFIGURATION,
        );
        const session: IDocumentCoreViewSession = Object.freeze({
            snapshot: authority.snapshot,
            modelPositionAt: authority.modelPositionAt,
            select: authority.select,
            selectSource: authority.selectSource,
            reconfigureMarkdownOptions:
                authority.reconfigureMarkdownOptions,
            attachDocument: authority.attachDocument,
            close: authority.close,
            dispatch: async (intent: EditorIntent) => {
                await authority.dispatch(intent);
                throw new Error('damaged transition publication');
            },
        });
        const view = await createDocumentCoreView({ host, session });

        await expect(view.replaceRange(0, 6, 'after')).rejects.toThrow(
            'damaged transition publication',
        );

        expect(session.snapshot().source).toBe('after');
        expect(host.textContent).toBe('after');
    });

    it('preserves a compatible text carrier and remaps its selection', async () => {
        const { host, view } = await mount('Hello world.\n');
        const carrier = host.querySelector<HTMLElement>('.document-view-run');
        const text = carrier?.firstChild;
        expect(carrier).not.toBeNull();
        expect(text).toBeInstanceOf(Text);

        view.setCursorByOffset(11);
        await view.settled();
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(6, 11, 'universe');

        expect(replaceChildren).not.toHaveBeenCalled();
        expect(carrier?.firstChild).toBe(text);
        expect(text?.textContent).toBe('Hello universe.');
        expect(carrier?.dataset.modelStart).toBe('0');
        expect(carrier?.dataset.modelEnd).toBe('15');
        expect(
            [...host.querySelectorAll<HTMLElement>('[data-node-id]')]
                .map(node => node.dataset.modelEnd),
        ).toEqual(['15', '15']);
        expect(view.getSelection()).toEqual({ start: 14, end: 14 });
        expect(document.getSelection()?.anchorNode).toBe(text);
        expect(document.getSelection()?.anchorOffset).toBe(14);
    });

    it('uses exact engine edits without reading or scanning mounted text', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const source = 'a'.repeat(100_000);
        const authority = await createTestDocumentCoreSession(
            createSourceSnapshot(source),
            PARSE_CONFIGURATION,
        );
        let snapshot = authority.snapshot();
        let text: Text | null = null;
        let charCodeAtSpy: ReturnType<typeof vi.spyOn> | null = null;
        const session: IDocumentCoreViewSession = Object.freeze({
            snapshot: () => snapshot,
            modelPositionAt: authority.modelPositionAt,
            reconfigureMarkdownOptions:
                authority.reconfigureMarkdownOptions,
            attachDocument: authority.attachDocument,
            close: authority.close,
            dispatch: async (intent: EditorIntent) => {
                const result = await authority.dispatch(intent);
                snapshot = authority.snapshot();
                charCodeAtSpy = vi.spyOn(String.prototype, 'charCodeAt')
                    .mockImplementation(() => {
                        throw new Error('renderer scanned source text');
                    });
                return result;
            },
            select: async (selection: InitialModelSelection) => {
                await authority.select(selection);
                snapshot = authority.snapshot();
            },
            selectSource: async (selection: InitialModelSelection) => {
                await authority.selectSource(selection);
                snapshot = authority.snapshot();
            },
        });
        const view = await createDocumentCoreView({ host, session });
        text = host.querySelector('.document-view-run')?.firstChild as Text;

        try {
            await view.replaceRange(source.length - 1, source.length, 'z');
        }
        finally {
            charCodeAtSpy?.mockRestore();
        }

        expect(text.data.at(-1)).toBe('z');
        expect(host.querySelector('.document-view-run')?.firstChild).toBe(text);
    });

    it('invalidates the mounted identity after a hostile text mutation', async () => {
        const { host, view } = await mount('Hello world.\n');
        const text = host.querySelector('.document-view-run')?.firstChild;
        expect(text).toBeInstanceOf(Text);
        (text as Text).replaceData(0, 1, 'X');
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(6, 11, 'universe');

        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(text?.isConnected).toBe(false);
        expect(host.textContent).toBe('Hello universe.');
    });

    it('invalidates the mounted identity after an untracked sibling insertion', async () => {
        const { host, view } = await mount('Hello world.\n');
        const text = host.querySelector('.document-view-run')?.firstChild;
        const hostile = document.createElement('span');
        hostile.textContent = 'hostile sibling';
        host.appendChild(hostile);
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(6, 11, 'universe');

        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(text?.isConnected).toBe(false);
        expect(hostile.isConnected).toBe(false);
        expect(host.textContent).toBe('Hello universe.');
    });

    it.each([
        {
            kind: 'Complete',
            source: 'abc',
            configuration: PARSE_CONFIGURATION,
        },
        {
            kind: 'SourceOnly',
            source: `${'> '.repeat(129)}abc`,
            configuration: DESKTOP_CONFIGURATION,
        },
    ])('re-arms hostile-mutation detection after a successful $kind patch', async ({ source, configuration }) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createTestDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: configuration,
        });
        const selector = host.dataset.documentMode === 'source-only'
            ? '.document-view-source'
            : '.document-view-run';
        const text = host.querySelector(selector)?.firstChild;
        expect(text).toBeInstanceOf(Text);

        await view.replaceRange(source.length - 1, source.length, 'd');
        expect(host.querySelector(selector)?.firstChild).toBe(text);

        const hostile = document.createElement('span');
        hostile.textContent = 'hostile sibling after first patch';
        host.appendChild(hostile);
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(source.length - 1, source.length, 'e');

        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(text?.isConnected).toBe(false);
        expect(hostile.isConnected).toBe(false);
        expect(view.getMarkdownSync().at(-1)).toBe('e');
    });

    it('patches exact UTF-16 coordinates without replacing the text node', async () => {
        const { host, view } = await mount('A😀B');
        const text = host.querySelector('.document-view-run')?.firstChild;
        expect(text).toBeInstanceOf(Text);

        view.setSelection(1, 3);
        await view.settled();
        await view.replaceRange(1, 3, '🙂');

        expect(host.querySelector('.document-view-run')?.firstChild).toBe(text);
        expect(text?.textContent).toBe('A🙂B');
        expect(view.getSelection()).toEqual({ start: 3, end: 3 });
        expect(document.getSelection()?.anchorNode).toBe(text);
        expect(document.getSelection()?.anchorOffset).toBe(3);
    });

    it('preserves backward UTF-16 selection direction on the retained text node', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const authority = await createTestDocumentCoreSession(
            createSourceSnapshot('A😀BC'),
            PARSE_CONFIGURATION,
        );
        let forceBackwardSelection = false;
        let publishedSnapshot: DocumentCoreViewSnapshot | null = null;
        const snapshot = (): DocumentCoreViewSnapshot => {
            if (publishedSnapshot !== null)
                return publishedSnapshot;
            const current = authority.snapshot();
            if (!forceBackwardSelection)
                return current;
            if (current.kind !== 'complete')
                throw new Error('Expected a Complete directional-selection fixture');
            const next = Object.freeze({
                ...current,
                selection: Object.freeze({
                    ...current.selection,
                    anchor: Object.freeze({
                        offset: 4,
                        affinity: 'previous' as const,
                    }),
                    focus: Object.freeze({
                        offset: 1,
                        affinity: 'next' as const,
                    }),
                }),
            });
            publishedSnapshot = next;
            return next;
        };
        const session: IDocumentCoreViewSession = Object.freeze({
            snapshot,
            modelPositionAt: authority.modelPositionAt,
            select: authority.select,
            selectSource: authority.selectSource,
            reconfigureMarkdownOptions:
                authority.reconfigureMarkdownOptions,
            attachDocument: authority.attachDocument,
            close: authority.close,
            dispatch: async (intent: EditorIntent) => {
                const result = await authority.dispatch(intent);
                forceBackwardSelection = true;
                return result;
            },
        });
        const view = await createDocumentCoreView({ host, session });
        const text = host.querySelector('.document-view-run')?.firstChild;
        expect(text).toBeInstanceOf(Text);
        document.getSelection()?.setBaseAndExtent(
            text as Text,
            4,
            text as Text,
            1,
        );

        await view.replaceRange(4, 5, 'D');

        const browserSelection = document.getSelection();
        expect(host.querySelector('.document-view-run')?.firstChild).toBe(text);
        expect(text?.textContent).toBe('A😀BD');
        expect(view.getSelection()).toEqual({ start: 4, end: 1 });
        expect(browserSelection?.anchorNode).toBe(text);
        expect(browserSelection?.anchorOffset).toBe(4);
        expect(browserSelection?.focusNode).toBe(text);
        expect(browserSelection?.focusOffset).toBe(1);
    });

    it('falls back to a complete render when an edit changes presentation topology', async () => {
        const { host, view } = await mount('Hello world.\n');
        const text = host.querySelector('.document-view-run')?.firstChild;
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(6, 11, '**world**');

        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(text?.isConnected).toBe(false);
        expect(host.querySelector('strong')?.textContent).toBe('world');
        expect(host.textContent).toBe('Hello world.');
    });

    it('bounds an overlong slash query before slicing its paragraph', async () => {
        const source = `/${'x'.repeat(65_535)}`;
        const { host, view } = await mount(source);
        view.setLocale({
            name: 'bounded-quick-insert',
            resource: { 'No result': 'Keine Treffer' },
        });
        const text = host.querySelector('.document-view-run')?.firstChild;
        expect(text).toBeInstanceOf(Text);
        const nativeSlice = String.prototype.slice;
        const slice = vi.spyOn(String.prototype, 'slice')
            .mockImplementation(function (
                this: string,
                start?: number,
                end?: number,
            ): string {
                if (
                    this.length === source.length
                    && start === 0
                    && end === source.length
                    && new Error().stack?.includes('refreshQuickInsert') === true
                ) {
                    throw new Error('quick insert sliced an overlong query');
                }
                return nativeSlice.call(this, start, end);
            });

        try {
            await view.replaceRange(source.length - 1, source.length, 'z');
        }
        finally {
            slice.mockRestore();
        }

        expect(
            host.querySelector('.document-view-run')?.textContent?.at(-1),
        ).toBe('z');
        expect(host.querySelector('[role="status"]')?.textContent)
            .toBe('Keine Treffer');
    });

    it.each([
        {
            mismatch: 'wrapper',
            mutate: (carrier: HTMLElement) => {
                const wrapper = document.createElement('em');
                wrapper.append(...carrier.childNodes);
                carrier.appendChild(wrapper);
            },
        },
        {
            mismatch: 'model boundary',
            mutate: (carrier: HTMLElement) => {
                carrier.dataset.modelEnd = '1';
            },
        },
    ])('falls back on a mounted $mismatch mismatch', async ({ mutate }) => {
        const { host, view } = await mount('Hello world.\n');
        const carrier = host.querySelector<HTMLElement>('.document-view-run');
        expect(carrier).not.toBeNull();
        mutate(carrier as HTMLElement);
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(11, 12, '!');

        expect(replaceChildren).toHaveBeenCalledOnce();
        expect(carrier?.isConnected).toBe(false);
        expect(host.textContent).toBe('Hello world!');
    });

    it('preserves text identity for an exact edit at the Complete maximum', async () => {
        const source = 'x'.repeat(32_000_000);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createTestDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: DESKTOP_CONFIGURATION,
        });
        const text = host.querySelector('.document-view-run')?.firstChild;
        expect(text).toBeInstanceOf(Text);
        const replaceChildren = vi.spyOn(host, 'replaceChildren');
        const nativeSlice = String.prototype.slice;
        const slice = vi.spyOn(String.prototype, 'slice')
            .mockImplementation(function (
                this: string,
                start?: number,
                end?: number,
            ): string {
                if (
                    this.length === source.length
                    && start === 0
                    && end === source.length
                    && new Error().stack?.includes('refreshQuickInsert') === true
                ) {
                    throw new Error(
                        'exact patch rescanned the maximum paragraph',
                    );
                }
                return nativeSlice.call(this, start, end);
            });

        try {
            await view.replaceRange(source.length - 1, source.length, '.');
        }
        finally {
            slice.mockRestore();
        }

        expect(replaceChildren).not.toHaveBeenCalled();
        expect(host.querySelector('.document-view-run')?.firstChild).toBe(text);
        expect((text as Text).data.at(-1)).toBe('.');
        expect(view.getMarkdownSync().at(-1)).toBe('.');

        await view.replaceRange(source.length - 1, source.length, '');

        expect(replaceChildren).not.toHaveBeenCalled();
        expect(host.querySelector('.document-view-run')?.firstChild).toBe(text);
        expect((text as Text).length).toBe(source.length - 1);
        expect((text as Text).data.at(-1)).toBe('x');
        expect(view.getMarkdownSync().length).toBe(source.length - 1);
    }, 30_000);

    it('preserves text identity for an exact edit at the SourceOnly maximum', async () => {
        const prefix = '> '.repeat(129);
        const source = prefix + 'x'.repeat(32_000_000 - prefix.length);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createTestDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: DESKTOP_CONFIGURATION,
        });
        expect(host.dataset.documentMode).toBe('source-only');
        const text = host.querySelector('.document-view-source')?.firstChild;
        expect(text).toBeInstanceOf(Text);
        const replaceChildren = vi.spyOn(host, 'replaceChildren');

        await view.replaceRange(source.length - 1, source.length, 'z');

        expect(host.dataset.documentMode).toBe('source-only');
        expect(replaceChildren).not.toHaveBeenCalled();
        expect(host.querySelector('.document-view-source')?.firstChild)
            .toBe(text);
        expect((text as Text).data.at(-1)).toBe('z');
        expect(view.getMarkdownSync().at(-1)).toBe('z');
    }, 30_000);
});
