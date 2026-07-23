import type {
    DocumentSession,
    ParseConfiguration,
    SourceSnapshot,
} from '@marktext/document-core';
import {
    createDocumentSession,
    groupRenderBlocks,
    renderMarkupPlan,
} from '@marktext/document-core';
import { renderDocumentCoreBlocks } from './renderBlocks';

/**
 * A minimal editing view driven entirely by `@marktext/document-core`.
 *
 * This is the loop the editor runs: a gesture becomes a typed intent, the engine
 * commits a new immutable revision, and the DOM is rendered from it. The view
 * holds no document state of its own — it never edits its DOM text directly and
 * never decides what the document now says, which is what keeps the rendered
 * page and the saved source from drifting apart (ADR-0005, ADR-0009).
 */

export interface IDocumentCoreViewOptions {
    readonly host: HTMLElement;
    readonly source: SourceSnapshot;
    readonly parseConfiguration: ParseConfiguration;
}

export interface IDocumentCoreView {
    /** The document as the user sees it, straight from the engine. */
    modelText: () => string;
    /** Insert text at a model offset, committing a revision and re-rendering. */
    typeText: (modelOffset: number, text: string) => Promise<void>;
    undo: () => Promise<void>;
    render: () => void;
}

export async function createDocumentCoreView(
    options: IDocumentCoreViewOptions,
): Promise<IDocumentCoreView> {
    const { host, parseConfiguration } = options;
    const session: DocumentSession = await createDocumentSession({
        source: options.source,
        parseConfiguration,
        configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
        initialView: 'markup',
        trackChanges: false,
        initialSelection: {
            anchor: { offset: 0, affinity: 'next' },
            focus: { offset: 0, affinity: 'next' },
        },
    });

    const modelText = (): string =>
        renderMarkupPlan(session.snapshot().livePlan)
            .map(run => run.text)
            .join('');

    const render = (): void => {
        const snapshot = session.snapshot();
        // Both halves come from the same snapshot, so the blocks and the runs
        // always describe one revision. The view never re-parses to learn its
        // own structure — that would cost a full parse per keystroke and make
        // the view a second authority on the document (ADR-0009).
        renderDocumentCoreBlocks(
            host,
            groupRenderBlocks(
                snapshot.editingDocument,
                renderMarkupPlan(snapshot.livePlan),
            ),
        );
    };

    const settle = async (
        ticket: ReturnType<DocumentSession['dispatch']>,
    ): Promise<void> => {
        const admission = await ticket.admission;
        if (admission.kind !== 'admitted')
            throw new Error(`Intent was not admitted: ${admission.kind}`);

        await ticket.completion;
        render();
    };

    const typeText = async (
        modelOffset: number,
        text: string,
    ): Promise<void> => {
        const selection = session.snapshot().revision.selection;
        if (selection === null)
            throw new Error('The session carries no selection');

        const caret = { offset: modelOffset, affinity: 'next' } as const;
        await settle(
            session.dispatch({
                kind: 'insert-text',
                target: { ...selection, anchor: caret, focus: caret },
                text,
            }),
        );
    };

    const undo = async (): Promise<void> => {
        await settle(session.dispatch({ kind: 'undo' }));
    };

    render();

    return { modelText, render, typeText, undo };
}
