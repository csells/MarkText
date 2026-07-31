// @vitest-environment happy-dom

import type { EditorIntent, InitialModelSelection, ParseConfiguration } from '@marktext/document-core';
import type { IDocumentCoreViewCompleteSnapshot, IDocumentCoreViewSession } from '../documentCoreView';
import { describe, expect, it, vi } from 'vitest';
import {
    createDocumentCoreView,

} from '../documentCoreView';

const configuration: ParseConfiguration = {
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

function remoteSnapshot(
    source: string,
    parseConfiguration: ParseConfiguration = configuration,
): IDocumentCoreViewCompleteSnapshot {
    const selection = {
        session: 'session-remote',
        revision: `revision-${source.length}`,
        view: 'markup',
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' },
    } as const;
    const text = Object.freeze({
        key: `remote:${source.length}:semantic`,
        text: source,
        elements: Object.freeze([]),
        modelRange: Object.freeze({ start: 0, end: source.length }),
        sourceRange: Object.freeze({ start: 0, end: source.length }),
        boundaryMapping: 'identity' as const,
    });
    return Object.freeze({
        kind: 'complete' as const,
        parseConfiguration,
        source,
        facts: Object.freeze({
            kind: 'document-facts' as const,
            recommendedTitle: null,
            statistics: Object.freeze({
                word: source.length === 0 ? 0 : 1,
                paragraph: source.length === 0 ? 0 : 1,
                character: source.length,
                all: source.length,
            }),
        }),
        projection: 'marked' as const,
        modelText: source,
        markupModelLength: source.length,
        selection,
        trackChanges: false,
        reviewIndex: Object.freeze({
            authoring: Object.freeze({
                canCreateAddition: true,
                canCreateDeletion: false,
                canCreateSubstitution: false,
                canCreateHighlight: false,
                canCreateComment: false,
            }),
            items: Object.freeze([]),
            commentedSpans: Object.freeze([]),
        }),
        blocks: Object.freeze([{
            kind: 'paragraph' as const,
            attributes: Object.freeze({}),
            modelRange: Object.freeze({ start: 0, end: source.length }),
            runs: Object.freeze([{
                key: `remote:${source.length}`,
                text: source,
                elements: Object.freeze([]),
                modelRange: Object.freeze({ start: 0, end: source.length }),
                sourceRange: Object.freeze({ start: 0, end: source.length }),
            }]),
            tree: Object.freeze({
                key: `remote:paragraph:${source.length}`,
                kind: 'paragraph' as const,
                attributes: Object.freeze({}),
                modelRange: Object.freeze({ start: 0, end: source.length }),
                elements: Object.freeze([]),
                text: Object.freeze([]),
                children: Object.freeze([{
                    key: `remote:text:${source.length}`,
                    kind: 'text' as const,
                    attributes: Object.freeze({}),
                    modelRange: Object.freeze({ start: 0, end: source.length }),
                    elements: Object.freeze([]),
                    text: Object.freeze([text]),
                    children: Object.freeze([]),
                }]),
            }),
        }]),
        outline: Object.freeze([]),
        listItems: Object.freeze([]),
    }) as unknown as IDocumentCoreViewCompleteSnapshot;
}

describe('document-core view session port', () => {
    it('mounts and mutates only through an injected main-owned session port', async () => {
        let snapshot = remoteSnapshot('remote');
        const intents: EditorIntent[] = [];
        const markdownOptionPatches: unknown[] = [];
        const port: IDocumentCoreViewSession = {
            settled: async () => {},
            snapshot: () => snapshot,
            modelPositionAt: position => position,
            dispatch: async (intent: EditorIntent) => {
                intents.push(intent);
                if (intent.kind !== 'insert-text')
                    throw new Error('Fixture expects one insertion');
                const offset = intent.target.anchor.offset;
                snapshot = remoteSnapshot(
                    snapshot.source.slice(0, offset)
                    + intent.text
                    + snapshot.source.slice(offset),
                );
                return {
                    kind: 'committed' as const,
                    sourceEdits: Object.freeze([{
                        start: offset,
                        end: offset,
                        insert: intent.text,
                    }]),
                };
            },
            select: async (_selection: InitialModelSelection) => {},
            selectSource: async (_selection: InitialModelSelection) => {},
            attachDocument: async (documentId: string) => {
                snapshot = remoteSnapshot(documentId, {
                    ...configuration,
                    markdownOptions: {
                        ...configuration.markdownOptions,
                        footnotes: true,
                        gitLabMath: true,
                        subscriptAndSuperscript: false,
                    },
                });
            },
            reconfigureMarkdownOptions: async (patch) => {
                markdownOptionPatches.push(patch);
                snapshot = remoteSnapshot(snapshot.source, {
                    ...snapshot.parseConfiguration,
                    markdownOptions: {
                        ...snapshot.parseConfiguration.markdownOptions,
                        ...patch,
                    },
                });
                return {
                    kind: 'state-changed' as const,
                    sourceEdits: Object.freeze([]),
                };
            },
            close: async () => {},
        };
        const host = document.createElement('div');
        document.body.appendChild(host);
        const view = await createDocumentCoreView({
            host,
            session: port,
        });

        expect(host.textContent).toBe('remote');
        await view.typeText(6, ' head');
        expect(intents).toHaveLength(1);
        expect(view.getMarkdownSync()).toBe('remote head');
        expect(host.textContent).toBe('remote head');

        view.setOptions({
            footnotes: false,
            gitLabMath: false,
            subscriptAndSuperscript: true,
        });
        await view.settled();
        expect(markdownOptionPatches).toEqual([]);

        view.setOptions({
            footnotes: true,
            gitLabMath: true,
            subscriptAndSuperscript: false,
        });
        await view.settled();
        expect(markdownOptionPatches).toEqual([{
            footnotes: true,
            gitLabMath: true,
            subscriptAndSuperscript: false,
        }]);

        view.setOptions({
            footnotes: true,
            gitLabMath: true,
            subscriptAndSuperscript: false,
        });
        await view.settled();
        expect(markdownOptionPatches).toHaveLength(1);

        view.setOptions({ footnotes: false });
        await view.settled();
        expect(markdownOptionPatches).toEqual([
            {
                footnotes: true,
                gitLabMath: true,
                subscriptAndSuperscript: false,
            },
            { footnotes: false },
        ]);

        await view.attachDocument('attached');
        view.setOptions({
            footnotes: true,
            gitLabMath: true,
            subscriptAndSuperscript: false,
        });
        await view.settled();
        expect(markdownOptionPatches).toHaveLength(2);
    });

    it('retries the same Markdown options after a failed publication', async () => {
        const source = 'remote';
        const attempts: unknown[] = [];
        let fail = true;
        const port: IDocumentCoreViewSession = {
            settled: async () => {},
            snapshot: () => remoteSnapshot(source),
            modelPositionAt: position => position,
            dispatch: async () => ({
                kind: 'committed' as const,
                sourceEdits: Object.freeze([]),
            }),
            select: async () => {},
            selectSource: async () => {},
            attachDocument: async () => {},
            reconfigureMarkdownOptions: async (patch) => {
                attempts.push(patch);
                if (fail) {
                    fail = false;
                    throw new Error('publication failed');
                }
                return {
                    kind: 'state-changed' as const,
                    sourceEdits: Object.freeze([]),
                };
            },
            close: async () => {},
        };
        const view = await createDocumentCoreView({
            host: document.createElement('div'),
            session: port,
        });

        view.setOptions({ footnotes: true });
        await expect(view.settled()).rejects.toThrow('publication failed');
        view.setOptions({ footnotes: true });
        await expect(view.settled()).resolves.toBeUndefined();

        expect(attempts).toEqual([
            { footnotes: true },
            { footnotes: true },
        ]);
    });

    it('starts each selection only after the prior selection reaches a terminal result', async () => {
        const source = 'remote';
        let releaseFirst: (() => void) | undefined;
        const firstMayFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const selectedOffsets: number[] = [];
        const port: IDocumentCoreViewSession = {
            settled: async () => {},
            snapshot: () => remoteSnapshot(source),
            modelPositionAt: position => position,
            dispatch: async () => ({
                kind: 'committed' as const,
                sourceEdits: Object.freeze([]),
            }),
            select: async (selection) => {
                selectedOffsets.push(selection.focus.offset);
                if (selectedOffsets.length === 1) {
                    await firstMayFinish;
                    throw new Error('first selection failed');
                }
            },
            selectSource: async () => {},
            attachDocument: async () => {},
            reconfigureMarkdownOptions: async () => (
                {
                    kind: 'state-changed' as const,
                    sourceEdits: Object.freeze([]),
                }
            ),
            close: async () => {},
        };
        const view = await createDocumentCoreView({
            host: document.createElement('div'),
            session: port,
        });

        view.setCursorByOffset(1);
        view.setCursorByOffset(2);
        await vi.waitFor(() => expect(selectedOffsets).toEqual([1]));

        releaseFirst?.();
        await expect(view.settled()).rejects.toThrow('first selection failed');
        expect(selectedOffsets.filter(offset => offset > 0)).toEqual([1, 2]);

        view.setCursorByOffset(3);
        await expect(view.settled()).resolves.toBeUndefined();
        expect(selectedOffsets.filter(offset => offset > 0)).toEqual([1, 2, 3]);
    });

    it('delegates canonical-source selection mapping to the owning session', async () => {
        const source = 'remote';
        const mappedPositions: InitialModelSelection['anchor'][] = [];
        const selections: InitialModelSelection[] = [];
        const port: IDocumentCoreViewSession = {
            settled: async () => {},
            snapshot: () => remoteSnapshot(source),
            modelPositionAt: position => {
                mappedPositions.push(position);
                return Object.freeze({
                    offset: position.offset + 2,
                    affinity: position.affinity,
                });
            },
            dispatch: async () => ({
                kind: 'committed' as const,
                sourceEdits: Object.freeze([]),
            }),
            select: async selection => {
                selections.push(selection);
            },
            selectSource: async () => {},
            attachDocument: async () => {},
            reconfigureMarkdownOptions: async () => (
                {
                    kind: 'state-changed' as const,
                    sourceEdits: Object.freeze([]),
                }
            ),
            close: async () => {},
        };
        const view = await createDocumentCoreView({
            host: document.createElement('div'),
            session: port,
        });
        const selection = Object.freeze({
            anchor: Object.freeze({ offset: 1, affinity: 'previous' as const }),
            focus: Object.freeze({ offset: 2, affinity: 'next' as const }),
        });

        view.setSourceSelection(selection);
        await view.settled();

        expect(mappedPositions).toEqual([
            selection.anchor,
            selection.focus,
        ]);
        expect(selections).toEqual([{
            anchor: { offset: 3, affinity: 'previous' },
            focus: { offset: 4, affinity: 'next' },
        }]);
    });
});
