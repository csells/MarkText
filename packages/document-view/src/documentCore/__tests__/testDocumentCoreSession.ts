import type {
    ClipboardBundle,
    ClipboardText,
    DocumentCoreMarkdownOptionPatch,
    EditorIntent,
    InitialModelSelection,
    MarkdownDocument,
    MarkdownNode,
    ModelSelection,
    ModelPosition,
    ModelRange,
    ParseConfiguration,
    SourceSnapshot,
} from '@marktext/document-core';
import {
    acknowledgeClipboardWrite,
    authorizeCut,
    createDocumentSession,
    groupRenderBlocks,
    markdownHeadingAnchors,
    modelPositionAtMarkupCoordinateMap,
    renderMarkupPlan,
} from '@marktext/document-core';
import {
    createDocumentCoreView,
    type DocumentCoreClipboardWriteResult,
    type DocumentCoreViewDispatchResult,
    type DocumentCoreViewSnapshot,
    type IDocumentCoreView,
    type IDocumentCoreViewOptions,
    type IDocumentCoreViewOutlineItem,
    type IDocumentCoreViewSession,
} from '../documentCoreView';

type TestClipboardWriteRequest = Parameters<
    NonNullable<IDocumentCoreViewOptions['clipboardWrite']>
>[0];

export type TestClipboardSink = (
    request: TestClipboardWriteRequest,
    payload: ClipboardBundle | ClipboardText,
) => void | Promise<void>;

export type TestClipboardPaste = (
    target: ModelSelection,
    pasteText: (text: string) => Promise<DocumentCoreViewDispatchResult>,
) => Promise<DocumentCoreViewDispatchResult>;

function outlineOf(
    document: MarkdownDocument,
    sourceOffsetAt: (modelOffset: number) => number,
): readonly IDocumentCoreViewOutlineItem[] {
    return Object.freeze(markdownHeadingAnchors(document).map(heading =>
        Object.freeze({
            nodeId: heading.nodeId,
            level: heading.level,
            content: heading.text,
            slug: heading.slug,
            sourceOffset: sourceOffsetAt(heading.node.range.start),
        }),
    ));
}

function listItemRangesOf(root: MarkdownNode): readonly ModelRange[] {
    const ranges: ModelRange[] = [];
    const visit = (node: MarkdownNode): void => {
        if (node.kind === 'list-item')
            ranges.push(node.range);

        for (let ordinal = 0; ordinal < node.childCount; ordinal += 1)
            visit(node.childAt(ordinal));
    };
    visit(root);
    return Object.freeze(ranges);
}

async function createTestDocumentCoreSessionHarness(
    source: SourceSnapshot,
    parseConfiguration: ParseConfiguration,
): Promise<Readonly<{
    session: IDocumentCoreViewSession;
    writeClipboard: (
        request: TestClipboardWriteRequest,
        sink: TestClipboardSink,
    ) => Promise<DocumentCoreClipboardWriteResult>;
}>> {
    const session = await createDocumentSession({
        source,
        parseConfiguration,
        configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
        initialView: 'markup',
        trackChanges: false,
        initialSelection: {
            anchor: { offset: 0, affinity: 'next' },
            focus: { offset: 0, affinity: 'next' },
        },
    });

    const snapshot = (): DocumentCoreViewSnapshot => {
        const current = session.snapshot();
        if (current.kind === 'source-only') {
            if (current.revision.selection === null)
                throw new Error('The SourceOnly document session has no selection');

            return Object.freeze({
                kind: 'source-only' as const,
                revisionId: current.revision.id,
                parseConfiguration: current.revision.configuration,
                source: current.revision.source,
                facts: current.facts,
                sourceSelection: current.sourceSelection,
                selection: current.revision.selection,
            });
        }
        if (current.revision.selection === null)
            throw new Error('The complete document session has no selection');

        const runs = renderMarkupPlan(current.displayPlan);
        return Object.freeze({
            kind: 'complete' as const,
            revisionId: current.revision.id,
            parseConfiguration: current.revision.configuration,
            source: current.revision.source,
            facts: current.facts,
            sourceSelection: current.sourceSelection,
            projection: current.projection,
            modelText: runs.map(run => run.text).join(''),
            markupModelLength: current.livePlan.modelLength,
            selection: current.revision.selection,
            trackChanges: current.configuration.trackChanges,
            reviewIndex: current.reviewIndex,
            blocks: groupRenderBlocks(current.displayDocument, runs),
            outline: outlineOf(
                current.displayDocument,
                modelOffset => current.livePlan.sourcePositionAt({
                    offset: modelOffset,
                    affinity: 'next',
                }).offset,
            ),
            listItems: listItemRangesOf(current.displayDocument.root),
        });
    };

    const modelPositionAt = (position: ModelPosition): ModelPosition => {
        const current = session.snapshot();
        if (
            !Number.isInteger(position.offset)
            || position.offset < 0
            || position.offset > current.revision.source.length
        ) {
            throw new RangeError('Source position is outside the document');
        }
        if (current.kind === 'source-only')
            return Object.freeze({ ...position });
        return modelPositionAtMarkupCoordinateMap(
            current.livePlan.coordinateMap,
            position,
        );
    };

    const dispatch = async (
        intent: EditorIntent,
    ): Promise<DocumentCoreViewDispatchResult> => {
        const ticket = session.dispatch(intent);
        const admission = await ticket.admission;
        if (admission.kind !== 'admitted')
            throw new Error(`Intent was not admitted: ${admission.kind}`);

        const result = await ticket.completion;
        if (result.kind === 'rejected') {
            return Object.freeze({
                kind: result.kind,
                reason: result.reason,
            });
        }
        if (result.kind === 'noop') {
            return Object.freeze({
                kind: result.kind,
                reason: result.reason,
            });
        }
        if (result.kind === 'cancelled') {
            return Object.freeze({
                kind: result.kind,
                reason: result.reason,
            });
        }
        if (result.kind === 'committed') {
            return Object.freeze({
                kind: result.kind,
                sourceEdits: result.transition.edits,
            });
        }
        return Object.freeze({
            kind: result.kind,
            sourceEdits: Object.freeze([]),
        });
    };

    const reconfigureMarkdownOptions = async (
        patch: DocumentCoreMarkdownOptionPatch,
    ): Promise<DocumentCoreViewDispatchResult> => {
        await session.reconfigureMarkdownOptions(patch).completion;
        return Object.freeze({
            kind: 'state-changed' as const,
            sourceEdits: Object.freeze([]),
        });
    };

    const viewSession: IDocumentCoreViewSession = Object.freeze({
        snapshot,
        dispatch,
        settled: () => session.settled(),
        modelPositionAt,
        select: async (selection: InitialModelSelection) => {
            session.select(selection);
        },
        selectSource: async (selection: InitialModelSelection) => {
            session.selectSource(selection);
        },
        reconfigureMarkdownOptions,
        attachDocument: async () => {
            throw new Error(
                'Test sessions cannot attach main-owned documents',
            );
        },
        close: async () => {
            await session.close().completion;
        },
    });

    const writeClipboard = async (
        request: TestClipboardWriteRequest,
        sink: TestClipboardSink,
    ): Promise<DocumentCoreClipboardWriteResult> => {
        const materialization = await session.materializeClipboard(
            request,
        ).completion;
        if (materialization.kind !== 'materialized') {
            throw new Error(
                'The test clipboard cannot materialize a SourceOnly revision',
            );
        }

        const artifact = materialization.artifact;
        if (artifact.kind === 'disabled') {
            throw new Error(
                `The test clipboard cannot ${artifact.consumer} `
                + `the ${artifact.view} view`,
            );
        }

        const payload = artifact.kind === 'cut-preparation'
            ? artifact.bundle
            : artifact;
        await sink(request, payload);
        if (request.consumer !== 'cut' && request.consumer !== 'cut-table')
            return Object.freeze({ kind: 'written' as const });

        if (artifact.kind !== 'cut-preparation') {
            throw new Error('The test clipboard did not prepare an exact cut');
        }
        const receipt = acknowledgeClipboardWrite(artifact.bundle);
        const authorization = authorizeCut(artifact, receipt);
        const current = session.snapshot();
        if (
            current.revision.id !== materialization.revision.id
            || current.revision.semanticHash !== authorization.semanticHash
        ) {
            throw new Error('The test cut no longer names the current revision');
        }
        let intent: EditorIntent;
        if (authorization.view === 'source') {
            const retained = current.sourceSelection;
            const retainedStart = Math.min(
                retained.anchor.offset,
                retained.focus.offset,
            );
            const retainedEnd = Math.max(
                retained.anchor.offset,
                retained.focus.offset,
            );
            const target = (
                retainedStart === authorization.selection.start
                && retainedEnd === authorization.selection.end
            )
                ? retained
                : Object.freeze({
                    ...retained,
                    anchor: Object.freeze({
                        offset: authorization.selection.start,
                        affinity: 'next' as const,
                    }),
                    focus: Object.freeze({
                        offset: authorization.selection.end,
                        affinity: authorization.selection.start
                            === authorization.selection.end
                            ? 'next' as const
                            : 'previous' as const,
                    }),
                });
            intent = Object.freeze({
                kind: 'edit-source' as const,
                target,
                text: '',
                selection: Object.freeze({
                    anchor: Object.freeze({
                        offset: authorization.selection.start,
                        affinity: 'next' as const,
                    }),
                    focus: Object.freeze({
                        offset: authorization.selection.start,
                        affinity: 'next' as const,
                    }),
                }),
            });
        }
        else {
            if (
                current.kind !== 'complete'
                || current.revision.selection === null
            ) {
                throw new Error('The test cut has no exact Markup selection');
            }
            const target = current.revision.selection;
            const start = Math.min(
                target.anchor.offset,
                target.focus.offset,
            );
            const end = Math.max(
                target.anchor.offset,
                target.focus.offset,
            );
            if (
                start !== authorization.selection.start
                || end !== authorization.selection.end
            ) {
                throw new Error(
                    'The test cut no longer names the exact selection',
                );
            }
            intent = Object.freeze(
                request.consumer === 'cut-table'
                    ? {
                        kind: 'delete-table-cell-contents' as const,
                        target,
                    }
                    : {
                        kind: 'delete-text' as const,
                        target,
                    },
            );
        }

        const result = await dispatch(intent);
        if (result.kind !== 'committed') {
            throw new Error(
                `The test cut did not commit: ${result.kind}`,
            );
        }
        return Object.freeze({ kind: 'cut-committed' as const });
    };

    return Object.freeze({
        session: viewSession,
        writeClipboard,
    });
}

export async function createTestDocumentCoreSession(
    source: SourceSnapshot,
    parseConfiguration: ParseConfiguration,
): Promise<IDocumentCoreViewSession> {
    return (
        await createTestDocumentCoreSessionHarness(
            source,
            parseConfiguration,
        )
    ).session;
}

export type TestDocumentCoreViewOptions =
    & Omit<
        IDocumentCoreViewOptions,
        'session' | 'clipboardWrite' | 'clipboardPaste'
    >
    & Readonly<{
        source: SourceSnapshot;
        parseConfiguration: ParseConfiguration;
        clipboardWrite?: TestClipboardSink;
        clipboardPaste?: TestClipboardPaste;
    }>;

export async function createTestDocumentCoreView(
    options: TestDocumentCoreViewOptions,
): Promise<IDocumentCoreView> {
    const {
        source,
        parseConfiguration,
        clipboardWrite,
        clipboardPaste,
        ...viewOptions
    } = options;
    const harness = await createTestDocumentCoreSessionHarness(
        source,
        parseConfiguration,
    );
    return createDocumentCoreView({
        ...viewOptions,
        session: harness.session,
        ...(clipboardWrite === undefined
            ? {}
            : {
                clipboardWrite: request =>
                    harness.writeClipboard(request, clipboardWrite),
            }),
        ...(clipboardPaste === undefined
            ? {}
            : {
                clipboardPaste: target => clipboardPaste(
                    target,
                    text => harness.session.dispatch(Object.freeze({
                        kind: 'paste-text',
                        target,
                        payload: Object.freeze({
                            kind: 'external-text' as const,
                            text,
                        }),
                    })),
                ),
            }),
    });
}
