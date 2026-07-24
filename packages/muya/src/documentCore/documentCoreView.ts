import type {
    Disposable,
    DocumentSession,
    MarkdownNode,
    ParseConfiguration,
    SourceSnapshot,
} from '@marktext/document-core';
import {
    createDocumentSession,
    createSourceSnapshot,
    groupRenderBlocks,
    renderMarkupPlan,
} from '@marktext/document-core';
import { generateGithubSlug } from '../utils/slug';
import { renderDocumentCoreBlocks } from './renderBlocks';

/** muya's appearance contract: option -> CSS custom property on the root. */
const APPEARANCE_VARIABLES: ReadonlyArray<readonly [string, string]> = [
    ['fontSize', '--mu-font-size'],
    ['lineHeight', '--mu-line-height'],
    ['editorFontFamily', '--mu-font-family'],
    ['codeFontSize', '--mu-code-font-size'],
    ['codeFontFamily', '--mu-code-font-family'],
];

/** Options measured in pixels, so a bare number gains its unit. */
const PIXEL_OPTIONS: ReadonlySet<string> = new Set(['fontSize', 'codeFontSize']);

/**
 * A heading's visible text: the parser's text leaves, not the raw slice.
 * Reading the source span directly would include the `#` syntax and any inline
 * markup delimiters, which is not what an outline entry should say.
 */
function headingText(source: string, node: MarkdownNode): string {
    if (node.childCount === 0) {
        return node.kind === 'text'
            ? source.slice(node.range.start, node.range.end)
            : '';
    }
    let text = '';
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1)
        text += headingText(source, node.childAt(ordinal));

    return text;
}

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

/**
 * What this view can do today. Structural commands are absent because the engine
 * exposes text edits only; approximating them with text surgery would corrupt a
 * document's structure, so they are declined rather than guessed at.
 */
export type DocumentCoreCapability
    = | 'typing'
        | 'deleting'
        | 'search'
        | 'table-of-contents'
        | 'list-indentation'
        | 'tables';

const SUPPORTED_CAPABILITIES: ReadonlySet<DocumentCoreCapability> = new Set([
    'typing',
    'deleting',
    'search',
    'table-of-contents',
    'list-indentation',
]);

export interface IDocumentCoreTocItem {
    readonly level: number;
    readonly content: string;
    readonly slug: string;
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
    /**
     * The same canonical source, read synchronously from the current revision.
     * The editor asks this from change handlers and history bookkeeping, where
     * awaiting is not an option; saving still uses the leased read.
     */
    getMarkdownSync: () => string;
    /** Insert text at a model offset, committing a revision and re-rendering. */
    typeText: (modelOffset: number, text: string) => Promise<void>;
    /**
     * Remove the text between two model offsets — backspace, Delete, or a
     * selection being typed over.
     */
    deleteRange: (start: number, end: number) => Promise<void>;
    /** Replace a range with text. */
    replaceRange: (start: number, end: number, text: string) => Promise<void>;
    /** Select the whole document. */
    selectAll: () => void;
    /** Break the paragraph at an offset. */
    insertParagraph: (modelOffset: number) => Promise<void>;
    /** Insert clipboard text with no formatting applied. */
    pasteAsPlainText: (modelOffset: number, text: string) => Promise<void>;
    /** Replace the word surrounding an offset — autocomplete and emoji. */
    replaceWordAt: (modelOffset: number, replacement: string) => Promise<void>;
    /** Every match, as model ranges over the text the reader sees. */
    search: (query: string) => ReadonlyArray<{ start: number; end: number }>;
    undo: () => Promise<void>;
    render: () => void;
    /** Open a different document in this view, replacing what it holds. */
    setContent: (source: string) => Promise<void>;
    /** The caret/selection as model offsets, not DOM positions. */
    getSelection: () => { start: number; end: number };
    /** @throws RangeError when the offset is outside the document. */
    setCursorByOffset: (modelOffset: number) => void;
    hasFocus: () => boolean;
    focus: () => void;
    blur: () => void;
    /** The mounted element the editor positions tooling against. */
    domNode: () => HTMLElement;
    /** Focus mode dims everything but the active block; a root class here. */
    setFocusMode: (enabled: boolean) => void;
    /** Called on every selection change; this view mounts no float layer yet. */
    hideAllFloatTools: () => void;
    /** Insert an image as Markdown the engine parses, not as a stray DOM node. */
    pasteImage: (
        modelOffset: number,
        image: Readonly<{ src: string; alt?: string }>,
    ) => Promise<void>;
    /**
     * Whether a capability is available, so callers can ask instead of
     * discovering by exception.
     */
    supports: (capability: DocumentCoreCapability) => boolean;
    /** @throws while table structure has no precise source edit. */
    insertTableRow: (modelOffset: number) => Promise<void>;
    setListIndentation: (
        modelOffset: number,
        direction: 'increase' | 'decrease',
    ) => Promise<void>;
    /** The document outline, derived from the parser's headings. */
    getTOC: () => readonly IDocumentCoreTocItem[];
    /**
     * Apply appearance options, following muya's documented contract so a
     * document-core tab themes identically to a legacy one. Options this view
     * does not own are ignored, because the editor passes one bag of options for
     * everything.
     */
    setOptions: (options: Readonly<Record<string, unknown>>) => void;
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

    const deleteRange = async (start: number, end: number): Promise<void> => {
        const selection = session.snapshot().revision.selection;
        if (selection === null)
            throw new Error('The session carries no selection');

        await settle(
            session.dispatch({
                kind: 'delete-text',
                target: {
                    ...selection,
                    anchor: { offset: start, affinity: 'next' },
                    focus: { offset: end, affinity: 'previous' },
                },
            }),
        );
    };

    const replaceRange = async (
        start: number,
        end: number,
        text: string,
    ): Promise<void> => {
        const selection = session.snapshot().revision.selection;
        if (selection === null)
            throw new Error('The session carries no selection');

        // One gesture, one revision, one undo — the engine replaces a range in a
        // single edit rather than this composing a delete with an insert.
        await settle(
            session.dispatch({
                kind: 'replace-text',
                target: {
                    ...selection,
                    anchor: { offset: start, affinity: 'next' },
                    focus: { offset: end, affinity: 'previous' },
                },
                text,
            }),
        );
    };

    const selectAll = (): void => {
        const length = modelText().length;
        session.select({
            anchor: { offset: 0, affinity: 'next' },
            focus: { offset: length, affinity: 'previous' },
        });
    };

    const insertParagraph = async (modelOffset: number): Promise<void> => {
        // A blank line is what makes two paragraphs in Markdown; the engine
        // decides what that means structurally, not this view.
        await typeText(modelOffset, '\n\n');
    };

    const pasteAsPlainText = async (
        modelOffset: number,
        text: string,
    ): Promise<void> => {
        await typeText(modelOffset, text);
    };

    const replaceWordAt = async (
        modelOffset: number,
        replacement: string,
    ): Promise<void> => {
        const text = modelText();
        let start = modelOffset;
        let end = modelOffset;
        while (start > 0 && !/\s/.test(text[start - 1] ?? ''))
            start -= 1;

        while (end < text.length && !/\s/.test(text[end] ?? ''))
            end += 1;

        await replaceRange(start, end, replacement);
    };

    const search = (
        query: string,
    ): ReadonlyArray<{ start: number; end: number }> => {
        if (query.length === 0)
            return [];

        // Search the text the reader sees. Searching the source would match
        // marker characters the user cannot see and miss text they can.
        const text = modelText();
        const matches: Array<{ start: number; end: number }> = [];
        let from = text.indexOf(query);
        while (from !== -1) {
            matches.push({ start: from, end: from + query.length });
            from = text.indexOf(query, from + query.length);
        }
        return Object.freeze(matches);
    };

    const undo = async (): Promise<void> => {
        await settle(session.dispatch({ kind: 'undo' }));
    };

    const getMarkdownSync = (): string => session.snapshot().revision.source;

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

    const setCursorByOffset = (modelOffset: number): void => {
        const caret = { offset: modelOffset, affinity: 'next' } as const;
        // The engine validates and owns the position; the view does not keep a
        // caret of its own.
        session.select({ anchor: caret, focus: caret });
    };

    const getTOC = (): readonly IDocumentCoreTocItem[] => {
        const document = session.snapshot().editingDocument;
        const root = document.root;
        const items: IDocumentCoreTocItem[] = [];
        for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
            const block = root.childAt(ordinal);
            if (block.kind !== 'heading')
                continue;

            // Ask the parser what is a heading and at what level. Re-scanning
            // the text for '#' cannot answer that under CriticMarkup, where the
            // same source is a heading in one view and a paragraph in another.
            const level = block.attributes.level;
            const content = headingText(document.source, block);
            items.push({
                level: typeof level === 'number' ? level : 1,
                content,
                slug: generateGithubSlug(content),
            });
        }
        return Object.freeze(items);
    };

    const setOptions = (options: Readonly<Record<string, unknown>>): void => {
        for (const [key, variable] of APPEARANCE_VARIABLES) {
            const value = options[key];
            if (value === undefined)
                continue;

            host.style.setProperty(
                variable,
                typeof value === 'number' && PIXEL_OPTIONS.has(key)
                    ? `${value}px`
                    : String(value),
            );
        }
        if (typeof options.wrapCodeBlocks === 'boolean')
            host.classList.toggle('mu-code-wrap', options.wrapCodeBlocks);
    };

    const hasFocus = (): boolean =>
        host.ownerDocument.activeElement === host
        || host.contains(host.ownerDocument.activeElement);

    const focus = (): void => {
        if (!host.hasAttribute('tabindex'))
            host.setAttribute('tabindex', '0');

        host.focus();
    };

    const domNode = (): HTMLElement => host;

    const setFocusMode = (enabled: boolean): void => {
        host.classList.toggle('mu-focus-mode', enabled);
    };

    const hideAllFloatTools = (): void => {
        // No float layer is mounted by this view yet. The editor calls this on
        // every selection change, so it has to be a safe no-op.
    };

    const pasteImage = async (
        modelOffset: number,
        image: Readonly<{ src: string; alt?: string }>,
    ): Promise<void> => {
        // An image is document content, so it enters as source the engine
        // parses rather than as a node this view inserts on its own.
        await typeText(modelOffset, `![${image.alt ?? ''}](${image.src})`);
    };

    const supports = (capability: DocumentCoreCapability): boolean =>
        SUPPORTED_CAPABILITIES.has(capability);

    const insertTableRow = async (): Promise<void> => {
        throw new Error(
            'Table editing needs structure a Markdown text edit cannot express precisely',
        );
    };

    const setListIndentation = async (
        modelOffset: number,
        direction: 'increase' | 'decrease',
    ): Promise<void> => {
        // Ask the parser where the item is rather than pattern-matching the
        // source. In Markdown the structure IS the text, so the edit is precise
        // once the engine has named the block — and the engine re-parses to
        // decide what the result means.
        const document = session.snapshot().editingDocument;
        const path = document.nodeAt(modelOffset, 'next');
        const item = [...path].reverse().find(node => node.kind === 'list-item');
        if (item === undefined)
            throw new Error('There is no list item at that position');

        const text = document.source;
        const lineStart = text.lastIndexOf('\n', item.range.start - 1) + 1;
        const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? '';
        if (direction === 'increase') {
            await typeText(lineStart, '  ');
            return;
        }
        const removable = Math.min(2, indent.length);
        if (removable === 0)
            return;

        await deleteRange(lineStart, lineStart + removable);
    };

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
        deleteRange,
        domNode,
        focus,
        hideAllFloatTools,
        insertTableRow,
        pasteImage,
        setFocusMode,
        setListIndentation,
        supports,
        insertParagraph,
        pasteAsPlainText,
        replaceRange,
        replaceWordAt,
        search,
        selectAll,
        getMarkdown,
        getMarkdownSync,
        getSelection,
        hasFocus,
        modelText,
        onChange,
        render,
        getTOC,
        setContent,
        setOptions,
        setCursorByOffset,
        typeText,
        undo,
    };
}
