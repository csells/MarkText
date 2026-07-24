import type {
    Disposable,
    DocumentSession,
    ParseConfiguration,
    SourceSnapshot,
} from '@marktext/document-core';
import {
    createDocumentSession,
    createSourceSnapshot,
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
    /**
     * The document's exact canonical source — the bytes that go to disk.
     *
     * This is what save reads. It is deliberately not derived from the rendered
     * DOM or re-serialized from a tree: the revision owns the source, so saving
     * cannot silently rewrite a user's file (ADR-0005, ADR-0007).
     */
    getMarkdown: () => Promise<string>;
    /** Insert text at a model offset, committing a revision and re-rendering. */
    typeText: (modelOffset: number, text: string) => Promise<void>;
    undo: () => Promise<void>;
    render: () => void;
    /** Open a different document in this view, replacing what it holds. */
    setContent: (source: string) => Promise<void>;
    /** The caret/selection as model offsets, not DOM positions. */
    getSelection: () => { start: number; end: number };
    hasFocus: () => boolean;
    blur: () => void;
    /**
     * Observe committed changes, so the editor can mark a tab dirty or drive
     * autosave from the engine rather than from its own idea of "changed".
     * The subscription belongs to the view and survives loading a document.
     */
    onChange: (listener: () => void) => Disposable;
}

export async function createDocumentCoreView(
    options: IDocumentCoreViewOptions,
): Promise<IDocumentCoreView> {
    const { host, parseConfiguration } = options;
    // Listeners belong to the view, not to a session: opening a file replaces
    // the session, and a subscription tied to the old one would silently stop
    // reporting edits.
    const listeners = new Set<() => void>();
    let session: DocumentSession = await createDocumentSession({
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
        for (const listener of listeners)
            listener();
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

    const getMarkdown = async (): Promise<string> => {
        // Read the canonical source through a lease so the engine can guarantee
        // the bytes are a settled revision rather than a half-applied edit.
        // 'materialize' is the engine's name for producing bytes from a
        // revision; save is the caller's reason, not the engine's.
        const flushed = await session.flush('materialize').completion;
        if (flushed.kind !== 'flushed')
            throw new Error(`Could not read canonical source: ${flushed.kind}`);

        let source = '';
        for await (const chunk of flushed.source.readChunks())
            source += chunk.text;

        await flushed.source.release('consumer-finished').completion;
        return source;
    };

    const setContent = async (source: string): Promise<void> => {
        // A new document is a new session: the engine's revisions are immutable
        // and a document's history is its own, so loading a file must not
        // inherit the previous document's undo stack.
        session = await createDocumentSession({
            source: createSourceSnapshot(source),
            parseConfiguration,
            configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
            initialView: 'markup',
            trackChanges: false,
            initialSelection: {
                anchor: { offset: 0, affinity: 'next' },
                focus: { offset: 0, affinity: 'next' },
            },
        });
        render();
    };

    const getSelection = (): { start: number; end: number } => {
        const selection = session.snapshot().revision.selection;
        if (selection === null)
            return { start: 0, end: 0 };

        return {
            start: selection.anchor.offset,
            end: selection.focus.offset,
        };
    };

    const hasFocus = (): boolean =>
        host.ownerDocument.activeElement === host
        || host.contains(host.ownerDocument.activeElement);

    const blur = (): void => {
        if (hasFocus())
            (host.ownerDocument.activeElement as HTMLElement | null)?.blur();
    };

    const onChange = (listener: () => void): Disposable => {
        listeners.add(listener);
        return {
            dispose: () => {
                listeners.delete(listener);
            },
        };
    };

    render();

    return {
        blur,
        getMarkdown,
        getSelection,
        hasFocus,
        modelText,
        onChange,
        render,
        setContent,
        typeText,
        undo,
    };
}
