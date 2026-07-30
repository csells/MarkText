import type {
    BlockConversion,
    ClipboardConsumer,
    ClipboardView,
    ConsumerView,
    CriticMarkupAuthoringInput,
    CriticMarkupProjection,
    Disposable,
    DocumentCoreMarkdownOptionPatch,
    DocumentFacts,
    DocumentSearchQuery,
    EditorIntent,
    InitialModelSelection,
    InlineFormat,
    MarkdownNodeKind,
    MarkupModelSelection,
    MarkupRenderBlock,
    MarkupRenderNode,
    ModelSelection,
    ModelPosition,
    ModelRange,
    NodeId,
    ParseConfiguration,
    QuickInsertBlock,
    RejectionCode,
    ReviewIndex,
    SearchMatchRange,
    SourceModelSelection,
    TableColumnAlignment,
} from '@marktext/document-core';
import {
    findMarkupSearchMatches,
    findSearchMatches,
} from '@marktext/document-core';
import {
    documentCoreInputRange,
    documentCoreSelectionIsMounted,
    documentCoreSelectionRange,
    restoreDocumentCoreSelection as restoreBrowserSelection,
} from './documentCoreInputAdapter';
import {
    forgetDocumentCoreTextPublication,
    patchDocumentCoreTextPublication,
    rememberDocumentCoreTextPublication,
} from './patchDocumentCoreTextPublication';
import {
    clearCodeTokenDecorations,
    paintCodeTokenDecorations,
} from './codeTokenDecorations';
import {
    clearSearchDecorations,
    paintSearchDecorations,
} from './searchDecorations';
import { renderDocumentCoreBlocks } from './renderBlocks';
import { en } from '../locales/en';
import type { ILocale } from '../i18n/types';
import type {
    ICriticMarkupTrackChangeRejection,
} from '../criticMarkup/rejectionContract';

/** Appearance option -> target-owned CSS custom property on the root. */
type AppearanceOption =
    | 'fontSize'
    | 'lineHeight'
    | 'editorFontFamily'
    | 'codeFontSize'
    | 'codeFontFamily';

const APPEARANCE_VARIABLES: ReadonlyArray<
    readonly [AppearanceOption, string]
> = [
    ['fontSize', '--document-view-font-size'],
    ['lineHeight', '--document-view-line-height'],
    ['editorFontFamily', '--document-view-font-family'],
    ['codeFontSize', '--document-view-code-font-size'],
    ['codeFontFamily', '--document-view-code-font-family'],
];

/** Options measured in pixels, so a bare number gains its unit. */
const PIXEL_OPTIONS: ReadonlySet<AppearanceOption> = new Set([
    'fontSize',
    'codeFontSize',
]);

interface QuickInsertChoice {
    readonly label: string;
    readonly title: keyof typeof en.resource;
    readonly block:
        | Exclude<QuickInsertBlock, Readonly<{ readonly kind: 'table' }>>
        | Readonly<{ readonly kind: 'table' }>;
}

const QUICK_INSERT_CHOICES: readonly QuickInsertChoice[] = Object.freeze([
    {
        label: 'paragraph',
        title: 'Paragraph',
        block: { kind: 'conversion', conversion: { kind: 'paragraph' } },
    },
    {
        label: 'thematic-break',
        title: 'Horizontal Line',
        block: {
            kind: 'conversion',
            conversion: { kind: 'thematic-break' },
        },
    },
    {
        label: 'frontmatter',
        title: 'Front Matter',
        block: { kind: 'conversion', conversion: { kind: 'front-matter' } },
    },
    ...Array.from({ length: 6 }, (_, index): QuickInsertChoice => ({
        label: `atx-heading ${String(index + 1)}`,
        title: `Heading ${String(index + 1)}` as QuickInsertChoice['title'],
        block: {
            kind: 'conversion',
            conversion: {
                kind: 'heading',
                level: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
            },
        },
    })),
    {
        label: 'table',
        title: 'Table Block',
        block: { kind: 'table' },
    },
    {
        label: 'math-block',
        title: 'Display Math',
        block: { kind: 'conversion', conversion: { kind: 'math-block' } },
    },
    {
        label: 'html-block',
        title: 'HTML Block',
        block: { kind: 'conversion', conversion: { kind: 'html-block' } },
    },
    {
        label: 'code-block',
        title: 'Code Block',
        block: { kind: 'conversion', conversion: { kind: 'code-block' } },
    },
    {
        label: 'block-quote',
        title: 'Quote Block',
        block: { kind: 'conversion', conversion: { kind: 'blockquote' } },
    },
    {
        label: 'order-list',
        title: 'Order List',
        block: { kind: 'conversion', conversion: { kind: 'ordered-list' } },
    },
    {
        label: 'bullet-list',
        title: 'Bullet List',
        block: { kind: 'conversion', conversion: { kind: 'unordered-list' } },
    },
    {
        label: 'task-list',
        title: 'To-do List',
        block: { kind: 'conversion', conversion: { kind: 'task-list' } },
    },
    {
        label: 'vega-lite',
        title: 'Vega Chart',
        block: { kind: 'diagram', language: 'vega-lite' },
    },
    {
        label: 'mermaid',
        title: 'Mermaid',
        block: { kind: 'diagram', language: 'mermaid' },
    },
    {
        label: 'plantuml',
        title: 'Plantuml',
        block: { kind: 'diagram', language: 'plantuml' },
    },
    {
        label: 'flowchart',
        title: 'Flowchart',
        block: { kind: 'diagram', language: 'flowchart' },
    },
    {
        label: 'sequence',
        title: 'Sequence',
        block: { kind: 'diagram', language: 'sequence' },
    },
]);

const decodeTableShape = (value: unknown): DocumentCoreTableShape => {
    if (
        value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== 2
        || !Object.prototype.hasOwnProperty.call(value, 'rows')
        || !Object.prototype.hasOwnProperty.call(value, 'columns')
    ) {
        throw new TypeError('Table shape must be a closed dimensions record');
    }
    const { rows, columns } = value as Record<string, unknown>;
    if (
        !Number.isSafeInteger(rows)
        || !Number.isSafeInteger(columns)
        || (rows as number) < 1
        || (rows as number) > 30
        || (columns as number) < 1
        || (columns as number) > 20
    ) {
        throw new RangeError('Table shape is outside 1–30 rows by 1–20 columns');
    }
    return Object.freeze({
        rows: rows as number,
        columns: columns as number,
    });
};

const sameSelection = (
    left: ModelSelection,
    right: ModelSelection,
): boolean =>
    left.session === right.session
    && left.revision === right.revision
    && left.view === right.view
    && left.anchor.offset === right.anchor.offset
    && left.anchor.affinity === right.anchor.affinity
    && left.focus.offset === right.focus.offset
    && left.focus.affinity === right.focus.affinity;

/**
 * A minimal editing view driven entirely by `@marktext/document-core`.
 *
 * This is the loop the editor runs: a gesture becomes a typed intent, the engine
 * commits a new immutable revision, and the DOM is rendered from it. The view
 * holds no document state of its own — it never edits its DOM text directly and
 * never decides what the document now says, which is what keeps the rendered
 * page and the saved source from drifting apart (ADR-0005, ADR-0009).
 */

/**
 * A dispatched intent the engine refused, carrying its typed reason. A
 * refusal is a normal outcome of a user command against the wrong state — a
 * collapsed selection, a stale target — and hosts present it as such; only
 * failures that are not this class are system errors.
 */
export class DocumentCoreIntentRejectedError extends Error {
    readonly reason: string;

    constructor(reason: string | undefined) {
        super(`Intent was rejected: ${reason ?? 'unspecified'}`);
        this.name = 'DocumentCoreIntentRejectedError';
        this.reason = reason ?? 'unspecified';
    }
}

export interface IDocumentCoreViewOptions {
    readonly host: HTMLElement;
    readonly session: IDocumentCoreViewSession;
    /** Initial locale for target-owned editor chrome such as table tools. */
    readonly locale?: ILocale;
    /**
     * Ask the host for dimensions only. The adapter receives no document,
     * revision, selection, or mutation capability; the view retains and
     * authenticates the target captured by the originating gesture.
     */
    readonly requestTableShape?: (
        signal: AbortSignal,
    ) => Promise<DocumentCoreTableShape | null>;
    /** Main-owned clipboard materializer for every copy and cut surface. */
    readonly clipboardWrite?: (
        request: Readonly<{
            readonly consumer: Exclude<
                ClipboardConsumer,
                "copy-heading-link"
            >;
            readonly view: ClipboardView;
            readonly selection: Readonly<{ start: number; end: number }>;
        }>,
    ) => (
        DocumentCoreClipboardWriteResult
        | Promise<DocumentCoreClipboardWriteResult>
    );
    /**
     * Observes every refused browser input as it is refused. The failure is
     * also retained for `settled()`, but a host that only settles at flush
     * boundaries would otherwise show the user nothing for a dropped gesture.
     */
    readonly onBrowserInputFailure?: (error: unknown) => void;
    /**
     * Main-owned clipboard transaction. The view supplies only the exact
     * parser-issued target; clipboard material never enters renderer memory.
     */
    readonly clipboardPaste?: (
        target: ModelSelection,
    ) => (
        DocumentCoreViewDispatchResult
        | Promise<DocumentCoreViewDispatchResult>
    );
    /**
     * Resolve a parser-preserved local image reference through the host's
     * document/path authority. Remote, data, and blob sources never cross this
     * seam, and a local reference has no DOM `src` until this returns.
     */
    readonly resolveImageSource?: (
        request: DocumentCoreImageSourceRequest,
    ) => (
        DocumentCoreImageSourceResolution
        | Promise<DocumentCoreImageSourceResolution>
    );
}

export interface DocumentCoreTableShape {
    readonly rows: number;
    readonly columns: number;
}

export interface DocumentCoreImageSourceRequest {
    readonly revisionId: string;
    readonly reference: string;
}

export type DocumentCoreImageSourceResolution =
    | Readonly<{
        readonly kind: 'resolved';
        readonly src: string;
    }>
    | Readonly<{
        readonly kind: 'unavailable';
    }>;

export interface IDocumentCoreViewOutlineItem {
    readonly nodeId: NodeId;
    readonly level: number;
    readonly content: string;
    readonly slug: string;
    readonly sourceOffset: number;
}

export interface IDocumentCoreViewCompleteSnapshot {
    readonly kind: 'complete';
    readonly revisionId: string;
    readonly parseConfiguration: ParseConfiguration;
    readonly source: string;
    readonly facts: DocumentFacts;
    readonly sourceSelection: SourceModelSelection;
    readonly projection: CriticMarkupProjection;
    readonly modelText: string;
    readonly markupModelLength: number;
    readonly selection: MarkupModelSelection;
    readonly trackChanges: boolean;
    readonly reviewIndex: ReviewIndex;
    readonly blocks: readonly MarkupRenderBlock[];
    readonly outline: readonly IDocumentCoreViewOutlineItem[];
    readonly listItems: readonly ModelRange[];
}

export interface IDocumentCoreViewSourceOnlySnapshot {
    readonly kind: 'source-only';
    readonly revisionId: string;
    readonly parseConfiguration: ParseConfiguration;
    readonly source: string;
    readonly facts: DocumentFacts;
    readonly sourceSelection: SourceModelSelection;
    readonly selection: SourceModelSelection;
}

export type DocumentCoreViewSnapshot
    = | IDocumentCoreViewCompleteSnapshot
        | IDocumentCoreViewSourceOnlySnapshot;

export interface DocumentCoreViewSourceEdit {
    readonly start: number;
    readonly end: number;
    readonly insert: string;
}

export type DocumentCoreViewDispatchResult =
    | Readonly<{
        kind: 'committed';
        sourceEdits: readonly DocumentCoreViewSourceEdit[];
    }>
    | Readonly<{
        kind: 'state-changed';
        sourceEdits: readonly DocumentCoreViewSourceEdit[];
    }>
    | Readonly<{ kind: 'rejected'; reason: RejectionCode }>
    | Readonly<{ kind: 'noop'; reason: 'empty-insertion' }>
    | Readonly<{ kind: 'cancelled'; reason: 'cancelled' }>;

/**
 * Closed acknowledgement from the host-owned clipboard transaction.
 *
 * A cut is complete only after the host has written the clipboard and
 * committed the parser-authorized deletion against the same revision.
 */
export type DocumentCoreClipboardWriteResult =
    | Readonly<{ readonly kind: 'written' }>
    | Readonly<{ readonly kind: 'cut-committed' }>;

export interface IDocumentCoreViewSession {
    readonly snapshot: () => DocumentCoreViewSnapshot;
    readonly dispatch: (
        intent: EditorIntent,
    ) => Promise<DocumentCoreViewDispatchResult>;
    /** Translate canonical source, snapping hidden syntax by affinity. */
    readonly modelPositionAt: (position: ModelPosition) => ModelPosition;
    readonly select: (selection: InitialModelSelection) => Promise<void>;
    readonly selectSource: (
        selection: InitialModelSelection,
    ) => Promise<void>;
    readonly reconfigureMarkdownOptions: (
        patch: DocumentCoreMarkdownOptionPatch,
    ) => Promise<DocumentCoreViewDispatchResult>;
    readonly attachDocument: (documentId: string) => Promise<void>;
    readonly close: () => Promise<void>;
}

export type DocumentCoreEditorCommand
    = Readonly<{
        readonly kind: 'convert-block';
        readonly conversion: BlockConversion;
    }>
    | Readonly<{ readonly kind: 'duplicate-block' }>
    | Readonly<{ readonly kind: 'delete-block' }>
    | Readonly<{
        readonly kind: 'insert-paragraph';
        readonly location: 'before' | 'after';
    }>
    | Readonly<{
        readonly kind: 'format-text';
        readonly format: InlineFormat;
    }>
    | Readonly<{
        readonly kind: 'set-list-indentation';
        readonly direction: 'increase' | 'decrease';
    }>
    | Readonly<{
        readonly kind: 'set-code-language';
        readonly language: string;
    }>
    | Readonly<{
        readonly kind: 'insert-link';
        readonly href: string;
        readonly title?: string;
    }>
    | Readonly<{
        readonly kind: 'insert-image';
        readonly src: string;
        readonly alt: string;
        readonly title?: string;
    }>
    | Readonly<{
        readonly kind: 'insert-footnote';
        readonly label: string;
        readonly content: string;
    }>
    | Readonly<{
        readonly kind: 'paste-text';
        readonly text: string;
        readonly source: 'external-text';
    }>
    | Readonly<{
        readonly kind: 'insert-table-row';
        readonly location: 'before' | 'after';
    }>
    | Readonly<{ readonly kind: 'remove-table-row' }>
    | Readonly<{
        readonly kind: 'insert-table-column';
        readonly location: 'left' | 'right';
    }>
    | Readonly<{ readonly kind: 'remove-table-column' }>
    | Readonly<{
        readonly kind: 'align-table-column';
        readonly alignment: TableColumnAlignment;
    }>
    | Readonly<{
        readonly kind: 'move-table-row';
        readonly direction: 'up' | 'down';
    }>
    | Readonly<{
        readonly kind: 'move-table-column';
        readonly direction: 'left' | 'right';
    }>
    | Readonly<{ readonly kind: 'delete-table-cell-contents' }>;

/** Capabilities committed by the document-core command and render seam. */
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
    'tables',
]);

const SOURCE_ONLY_REVIEW_INDEX: ReviewIndex = Object.freeze({
    authoring: Object.freeze({
        canCreateAddition: false,
        canCreateDeletion: false,
        canCreateSubstitution: false,
        canCreateHighlight: false,
        canCreateComment: false,
    }),
    items: Object.freeze([]),
    commentedSpans: Object.freeze([]),
});

export interface IDocumentCoreTocItem {
    readonly nodeId: NodeId;
    readonly level: number;
    readonly content: string;
    readonly slug: string;
    readonly sourceOffset: number;
}

export interface IDocumentSelectionNode {
    readonly key: string;
    readonly kind: MarkdownNodeKind;
    readonly attributes: Readonly<Record<string, string | number | boolean>>;
    readonly range: ModelRange;
}

export interface IDocumentSelectionPoint {
    readonly offset: number;
    readonly path: readonly IDocumentSelectionNode[];
}

export interface IDocumentSelectionFlags {
    readonly hasFrontMatter: boolean;
    readonly isMultiblock: boolean;
    readonly isCodeLike: boolean;
    readonly isCodeBlock: boolean;
    readonly isTable: boolean;
    readonly isList: boolean;
    readonly isTaskList: boolean;
    readonly isLooseList: boolean;
}

/**
 * The sole live-selection vocabulary exposed to a host.
 *
 * Every semantic fact comes from parser-emitted render nodes. Coordinates are
 * the only browser-owned field and may be absent when the selection has no
 * mounted range (for example, immediately after opening a background tab).
 */
export interface DocumentSelectionContext {
    readonly anchor: IDocumentSelectionPoint;
    readonly focus: IDocumentSelectionPoint;
    readonly selectedText: string;
    readonly activeInlineFormats: readonly InlineFormat[];
    readonly blockPath: readonly IDocumentSelectionNode[];
    readonly flags: IDocumentSelectionFlags;
    readonly cursor: Readonly<{ readonly x: number; readonly y: number }> | null;
}

export interface DocumentViewOptions {
    readonly fontSize?: number;
    readonly lineHeight?: number;
    readonly editorFontFamily?: string;
    readonly codeFontSize?: number;
    readonly codeFontFamily?: string;
    readonly editorLineWidth?: string;
    readonly wrapCodeBlocks?: boolean;
    readonly footnotes?: boolean;
    readonly gitLabMath?: boolean;
    readonly subscriptAndSuperscript?: boolean;
    readonly spellcheck?: boolean;
    readonly hideSpellcheckMarks?: boolean;
    readonly autoPairBrackets?: boolean;
    readonly autoPairQuotes?: boolean;
    readonly autoPairMarkdown?: boolean;
    readonly autoCheckTasks?: boolean;
    readonly hideQuickInsertHint?: boolean;
    readonly hideLinkTools?: boolean;
}

export type DocumentViewInteraction =
    | Readonly<{
        readonly kind: 'copy-heading-link';
        readonly targetNodeId: NodeId;
    }>
    | Readonly<{
        readonly kind: 'navigate-link';
        readonly targetNodeId: NodeId;
    }>
    | Readonly<{
        readonly kind: 'preview-image';
        readonly src: string;
        readonly trigger: 'modifier-click' | 'keyboard';
    }>;

const DOCUMENT_VIEW_OPTION_KEYS: ReadonlySet<keyof DocumentViewOptions> = new Set([
    'fontSize',
    'lineHeight',
    'editorFontFamily',
    'codeFontSize',
    'codeFontFamily',
    'editorLineWidth',
    'wrapCodeBlocks',
    'footnotes',
    'gitLabMath',
    'subscriptAndSuperscript',
    'spellcheck',
    'hideSpellcheckMarks',
    'autoPairBrackets',
    'autoPairQuotes',
    'autoPairMarkdown',
    'autoCheckTasks',
    'hideQuickInsertHint',
    'hideLinkTools',
]);

const FINITE_DOCUMENT_VIEW_OPTIONS: ReadonlySet<
    keyof DocumentViewOptions
> = new Set([
    'fontSize',
    'lineHeight',
    'codeFontSize',
]);

const STRING_DOCUMENT_VIEW_OPTIONS: ReadonlySet<
    keyof DocumentViewOptions
> = new Set([
    'editorFontFamily',
    'codeFontFamily',
]);

const BOOLEAN_DOCUMENT_VIEW_OPTIONS: ReadonlySet<
    keyof DocumentViewOptions
> = new Set([
    'wrapCodeBlocks',
    'footnotes',
    'gitLabMath',
    'subscriptAndSuperscript',
    'spellcheck',
    'hideSpellcheckMarks',
    'autoPairBrackets',
    'autoPairQuotes',
    'autoPairMarkdown',
    'autoCheckTasks',
    'hideQuickInsertHint',
    'hideLinkTools',
]);

function assertDocumentViewOptions(options: DocumentViewOptions): void {
    for (const [untypedKey, value] of Object.entries(options)) {
        const key = untypedKey as keyof DocumentViewOptions;
        if (!DOCUMENT_VIEW_OPTION_KEYS.has(key))
            throw new TypeError(`Unknown document option: ${untypedKey}`);
        if (value === undefined)
            continue;
        const valid = FINITE_DOCUMENT_VIEW_OPTIONS.has(key)
            ? typeof value === 'number' && Number.isFinite(value)
            : STRING_DOCUMENT_VIEW_OPTIONS.has(key)
                ? typeof value === 'string'
                : BOOLEAN_DOCUMENT_VIEW_OPTIONS.has(key)
                    ? typeof value === 'boolean'
                    : key === 'editorLineWidth'
                        ? typeof value === 'string'
                            && (
                                value === ''
                                || /^\d+(?:\.\d+)?(?:ch|px|%)$/.test(value)
                            )
                        : false;
        if (!valid) {
            throw new TypeError(
                `Invalid document option value for ${untypedKey}`,
            );
        }
    }
}

export interface IDocumentCoreView {
    /** Current immutable publication from the owning parser session. */
    snapshot: () => DocumentCoreViewSnapshot;
    /** The document as the user sees it, straight from the engine. */
    modelText: () => string;
    /** Parser-owned serializable Review index for the mounted revision. */
    getReviewIndex: () => ReviewIndex;
    /** Durable runtime Track Changes policy from the owning session. */
    getTrackChanges: () => boolean;
    /** Active parser-owned live projection. */
    getProjection: () => CriticMarkupProjection;
    /**
     * Admit one typed engine intent without exposing the owning session.
     *
     * Desktop Review commands use this seam for semantic transforms and
     * Track Changes state; the view still renders only after a committed
     * publication.
     */
    dispatchIntent: (intent: EditorIntent) => Promise<void>;
    /** Execute one typed editor command against the current selection. */
    executeCommand: (command: DocumentCoreEditorCommand) => Promise<void>;
    /** Switch among editable Markup and read-only clean projections. */
    setProjection: (projection: CriticMarkupProjection) => Promise<void>;
    /** Commit the mounted browser selection into the owning session. */
    commitSelection: () => Promise<void>;
    /** Author CriticMarkup around the session-owned current Markup selection. */
    authorCriticMarkup: (
        input: CriticMarkupAuthoringInput,
    ) => Promise<void>;
    /** The exact source from the last verified publication cache. */
    getMarkdown: () => Promise<string>;
    /**
     * The same canonical source, read synchronously from the current revision.
     * The editor asks this from change handlers and history bookkeeping, where
     * awaiting is not an option. Persistence is a main-owned transaction.
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
    /** Commit one raw source-surface range gesture. */
    editSource: (
        start: number,
        end: number,
        text: string,
        selection: InitialModelSelection,
    ) => Promise<void>;
    /**
     * Write and atomically commit one authenticated canonical-source cut.
     *
     * The host owns clipboard materialization and deletion; the view only
     * remounts the resulting session publication.
     */
    cutSource: (start: number, end: number) => Promise<void>;
    /** Serialize and insert an image at the authenticated source selection. */
    insertSourceImage: (image: Readonly<{
        src: string;
        alt: string;
        title?: string;
    }>) => Promise<void>;
    /** Select the whole document. */
    selectAll: () => void;
    /** Paste OS clipboard text through the host-owned authenticated target. */
    pasteFromClipboard: () => Promise<void>;
    /** Paste OS clipboard text into one canonical-source selection. */
    pasteSourceClipboard: (
        selection: InitialModelSelection,
    ) => Promise<void>;
    /** Replace the word surrounding an offset — autocomplete and emoji. */
    replaceWordAt: (modelOffset: number, replacement: string) => Promise<void>;
    /** Every match, as model ranges over the text the reader sees. */
    search: (query: DocumentSearchQuery) => readonly SearchMatchRange[];
    /**
     * Paint search matches as presentation-only decorations that survive
     * repaints; an empty range list clears them. Never touches the session.
     */
    setSearchDecorations: (
        ranges: readonly Readonly<{ start: number; end: number }>[],
        activeIndex: number,
    ) => void;
    /**
     * Recompute and replace every current match inside the owning session.
     *
     * The returned search state is calculated only after that one atomic
     * revision has settled.
     */
    replaceCurrentMatches: (
        query: DocumentSearchQuery,
        replacement: string,
    ) => Promise<readonly SearchMatchRange[]>;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    render: () => void;
    /** Mount a different main-owned document by opaque identity. */
    attachDocument: (documentId: string) => Promise<void>;
    /** The caret/selection as model offsets, not DOM positions. */
    getSelection: () => { start: number; end: number };
    /** The engine-owned selection translated to canonical-source positions. */
    getSourceSelection: () => InitialModelSelection;
    /** Complete parser-derived context for menus and target-owned tools. */
    getSelectionContext: () => DocumentSelectionContext;
    /** Observe browser and programmatic selection publications. */
    subscribeSelection: (
        listener: (context: DocumentSelectionContext) => void,
    ) => Disposable;
    /** Typed pointer/keyboard actions owned by the live document surface. */
    subscribeInteraction: (
        listener: (interaction: DocumentViewInteraction) => void,
    ) => Disposable;
    /** Observe an actual rejected session intent while Track Changes is active. */
    subscribeTrackChangeRejection: (
        listener: (rejection: ICriticMarkupTrackChangeRejection) => void,
    ) => Disposable;
    /** Select one model range; the owning session authenticates its bounds. */
    setSelection: (start: number, end: number) => void;
    /** Restore a canonical-source selection through the parser-owned map. */
    setSourceSelection: (selection: InitialModelSelection) => void;
    /** Commit a canonical-source selection and await its publication. */
    selectSource: (selection: InitialModelSelection) => Promise<void>;
    /** @throws RangeError when the offset is outside the document. */
    setCursorByOffset: (modelOffset: number) => void;
    hasFocus: () => boolean;
    focus: () => void;
    blur: () => void;
    /** The mounted element the editor positions tooling against. */
    domNode: () => HTMLElement;
    /** Focus mode dims everything but the active block; a root class here. */
    setFocusMode: (enabled: boolean) => void;
    /** Tear down any target-owned floating table or selection tools. */
    dismissTransientTools: () => void;
    /**
     * Open the target-owned Image draft for the authenticated current
     * selection. Opening and cancelling never dispatch a document intent.
     */
    openImageSelector: () => Promise<void>;
    /** Capture one target, ask the host for dimensions, then commit or cancel. */
    requestTable: () => Promise<void>;
    /** Replace target-owned chrome strings without rebuilding the document. */
    setLocale: (locale: ILocale) => void;
    /** Reinterpret parser-owned Markdown feature switches in one publication. */
    reconfigureMarkdownOptions: (
        patch: DocumentCoreMarkdownOptionPatch,
    ) => Promise<void>;
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
     * Resolve a parser-owned heading identity to the exact element created for
     * the current render. DOM attributes are presentation only and are never
     * consulted as an ownership registry.
     */
    resolveHeadingElement: (nodeId: NodeId) => HTMLElement | null;
    /**
     * Apply a partial closed view configuration.
     *
     * Unknown keys, wrong value types, and malformed width values throw before
     * any option is applied.
     */
    setOptions: (options: DocumentViewOptions) => void;
    /**
     * Observe committed changes, so the editor can mark a tab dirty or drive
     * autosave from the engine rather than from its own idea of "changed".
     * The subscription belongs to the view and survives loading a document.
     */
    onChange: (listener: () => void) => Disposable;
    /** Wait for browser input already admitted by this view to settle. */
    settled: () => Promise<void>;
    /** Detach browser input and await release of the owned session. */
    destroy: () => Promise<void>;
}

let quickInsertInstanceSequence = 0;

export async function createDocumentCoreView(
    options: IDocumentCoreViewOptions,
): Promise<IDocumentCoreView> {
    const { host } = options;
    host.classList.add('document-view-container');
    let headingElements: ReadonlyMap<string, HTMLElement> = new Map();
    // Listeners belong to the view, not to a session: opening a file replaces
    // the session, and a subscription tied to the old one would silently stop
    // reporting edits.
    const listeners = new Set<() => void>();
    const interactionListeners = new Set<
        (interaction: DocumentViewInteraction) => void
    >();
    const trackChangeRejectionListeners = new Set<
        (rejection: ICriticMarkupTrackChangeRejection) => void
    >();
    const selectionListeners = new Set<
        (context: DocumentSelectionContext) => void
    >();
    let tableTools: HTMLElement | null = null;
    let tableDragAnchor: HTMLElement | null = null;
    let quickInsertOverlay: HTMLElement | null = null;
    let quickInsertActiveIndex = 0;
    const quickInsertListboxId =
        `document-view-quick-insert-${String(++quickInsertInstanceSequence)}`;
    const pendingTableShapeRequests = new Set<AbortController>();
    let destroyPromise: Promise<void> | null = null;
    let destroying = false;
    let imageSelectorWrapper: HTMLElement | null = null;
    let selectedImageSrc: string | null = null;
    let suppressNextTableClick = false;
    let localeResource: Record<string, string> = {
        ...en.resource,
        ...options.locale?.resource,
    };
    const translate = (key: string): string => localeResource[key] ?? key;
    let autoPairBrackets = false;
    let autoPairQuotes = false;
    let autoPairMarkdown = false;
    let autoCheckTasks = false;
    let hideQuickInsertHint = false;
    let pendingBrowserInput: Promise<void> = Promise.resolve();
    let pendingSelection: Promise<void> = Promise.resolve();
    const pendingImageResolutions = new Set<Promise<void>>();
    let selectionIdle = true;
    let browserInputFailure: unknown;
    let selectionFailure: unknown;
    let browserInputIdle = true;
    let deferredBrowserSelection = false;
    let restoringBrowserSelection = false;
    let ignoredProgrammaticSelection: Readonly<{
        range: Readonly<{ start: number; end: number }>;
        anchor: number;
        focus: number;
    }> | null = null;
    let browserInputGeneration = 0;
    let imageRenderGeneration = 0;
    const session = options.session;
    let mountedSnapshot: DocumentCoreViewSnapshot | null = null;
    const parseConfiguration = session.snapshot().parseConfiguration;
    const committedMarkdownOptions = {
        footnotes: parseConfiguration.markdownOptions.footnotes,
        gitLabMath: parseConfiguration.markdownOptions.gitLabMath,
        subscriptAndSuperscript:
            parseConfiguration.markdownOptions.subscriptAndSuperscript,
    };
    const desiredMarkdownOptions = { ...committedMarkdownOptions };
    const markdownOptionKeys = [
        'footnotes',
        'gitLabMath',
        'subscriptAndSuperscript',
    ] as const;
    const synchronizeMarkdownOptions = (
        completedPatch?: DocumentCoreMarkdownOptionPatch,
    ): void => {
        const published = session.snapshot()
            .parseConfiguration.markdownOptions;
        for (const key of markdownOptionKeys) {
            committedMarkdownOptions[key] = published[key];
            if (
                completedPatch === undefined
                || (
                    completedPatch[key] !== undefined
                    && desiredMarkdownOptions[key] === completedPatch[key]
                )
            ) {
                desiredMarkdownOptions[key] = published[key];
            }
        }
    };
    let compositionDraft: Readonly<{
        // Null when the composition began mid-burst: the target is resolved
        // from the settled session selection when the commit dequeues.
        range: Readonly<{ start: number; end: number }> | null;
        text: string;
    }> | null = null;
    const completeSnapshot = (): IDocumentCoreViewCompleteSnapshot => {
        const snapshot = session.snapshot();
        if (snapshot.kind !== 'complete') {
            throw new Error(
                'The document-core WYSIWYG view is unavailable in SourceOnly mode',
            );
        }
        return snapshot;
    };

    const modelText = (): string => {
        const snapshot = session.snapshot();
        return snapshot.kind === 'complete'
            ? snapshot.modelText
            : snapshot.source;
    };
    const activeSelection = () => session.snapshot().selection;
    const selectionMatches = (
        current: InitialModelSelection,
        requested: InitialModelSelection,
    ): boolean =>
        current.anchor.offset === requested.anchor.offset
        && current.anchor.affinity === requested.anchor.affinity
        && current.focus.offset === requested.focus.offset
        && current.focus.affinity === requested.focus.affinity;
    const abortPendingTableShapeRequests = (): void => {
        for (const request of pendingTableShapeRequests)
            request.abort();
    };
    const getReviewIndex = (): ReviewIndex => {
        const snapshot = session.snapshot();
        return snapshot.kind === 'complete'
            ? snapshot.reviewIndex
            : SOURCE_ONLY_REVIEW_INDEX;
    };
    const getTrackChanges = (): boolean => {
        const snapshot = session.snapshot();
        return snapshot.kind === 'complete' && snapshot.trackChanges;
    };
    const getProjection = (): CriticMarkupProjection => {
        const snapshot = session.snapshot();
        return snapshot.kind === 'complete'
            ? snapshot.projection
            : 'marked';
    };

    // Around a source-mode exit the mounted DOM and the renderer snapshot can
    // both trail the head main already holds, so a selection read from them is
    // refused by main as out-of-view. That refusal is benign and self-healing:
    // the pending publication mount restores the authoritative selection.
    // Every other rejection is a real failure.
    const isStaleViewSelectRejection = (error: unknown): boolean =>
        error instanceof Error
        && error.message.includes('outside the active document');

    const selectSession = (
        selection: InitialModelSelection,
    ): Promise<void> => {
        if (!selectionMatches(activeSelection(), selection))
            abortPendingTableShapeRequests();

        let result: Promise<void>;
        if (selectionIdle) {
            selectionIdle = false;
            try {
                result = Promise.resolve(session.select(selection));
            }
            catch (error) {
                result = Promise.reject(error);
            }
        }
        else {
            result = pendingSelection.then(
                () => session.select(selection),
            );
        }
        const isolated = result.then(
            () => undefined,
            (error: unknown) => {
                if (!isStaleViewSelectRejection(error))
                    selectionFailure ??= error;
            },
        );
        pendingSelection = isolated;
        void isolated.then(() => {
            if (pendingSelection === isolated)
                selectionIdle = true;
        });
        return result;
    };

    const restoreDocumentCoreSelection = (
        target: HTMLElement,
        anchor: ModelPosition,
        focus: ModelPosition,
    ): void => {
        restoringBrowserSelection = true;
        try {
            restoreBrowserSelection(target, anchor, focus);
            if (documentCoreSelectionIsMounted(target)) {
                ignoredProgrammaticSelection = Object.freeze({
                    range: documentCoreSelectionRange(target),
                    anchor: anchor.offset,
                    focus: focus.offset,
                });
            }
        }
        finally {
            restoringBrowserSelection = false;
        }
    };

    const restoreSelectionIfCommitted = (
        expected: InitialModelSelection,
    ): void => {
        const snapshot = session.snapshot();
        if (
            snapshot.selection.anchor.offset !== expected.anchor.offset
            || snapshot.selection.focus.offset !== expected.focus.offset
        ) {
            return;
        }
        if (
            snapshot.kind === 'source-only'
            || snapshot.projection === 'marked'
        ) {
            restoreDocumentCoreSelection(
                host,
                snapshot.selection.anchor,
                snapshot.selection.focus,
            );
        }
    };

    const commitSelection = async (): Promise<void> => {
        const snapshot = session.snapshot();
        if (
            (
                snapshot.kind === 'complete'
                && snapshot.projection !== 'marked'
            )
            || !documentCoreSelectionIsMounted(host)
        ) {
            return;
        }

        const range = documentCoreSelectionRange(host);
        // A DOM read whose offsets exceed the current snapshot's coordinate
        // length can only come from a mount that predates a pending remount
        // (source-mode exit shrinks the head before the DOM restamps). The
        // publication mount restores the authoritative selection; committing
        // the stale read would send an out-of-document position to main.
        const length = snapshot.kind === 'complete'
            ? snapshot.markupModelLength
            : snapshot.source.length;
        if (range.end > length)
            return;
        try {
            await selectSession({
                anchor: { offset: range.start, affinity: 'next' },
                focus: {
                    offset: range.end,
                    affinity: range.start === range.end ? 'next' : 'previous',
                },
            });
        }
        catch (error) {
            // Around a source-mode exit the renderer's snapshot AND the DOM
            // can both trail the head main already holds, so the local length
            // check above cannot see the staleness — only main can refuse the
            // position. That refusal is benign and self-healing: the pending
            // publication mount restores the authoritative selection, exactly
            // the tolerance synchronizeBrowserSelection extends to the same
            // rejection. Anything else is a real failure.
            if (isStaleViewSelectRejection(error))
                return;
            throw error;
        }
        publishSelection();
    };

    const assertModelOffset = (offset: number): void => {
        const snapshot = session.snapshot();
        const length = snapshot.kind === 'complete'
            ? snapshot.markupModelLength
            : snapshot.source.length;
        if (
            !Number.isInteger(offset)
            || offset < 0
            || offset > length
        ) {
            throw new RangeError('Model position is outside the active document view');
        }
    };

    const decodeImageSourceResolution = (
        value: unknown,
    ): DocumentCoreImageSourceResolution => {
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            throw new TypeError('Image source resolution must be a closed record');

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);
        if (record.kind === 'unavailable' && keys.length === 1)
            return Object.freeze({ kind: 'unavailable' as const });

        if (
            record.kind !== 'resolved'
            || keys.length !== 2
            || !keys.includes('src')
            || typeof record.src !== 'string'
            || !/^(?:https?:|data:|blob:|marktext-image:)/i.test(record.src)
        ) {
            throw new TypeError('Image source resolution fields are invalid');
        }
        return Object.freeze({
            kind: 'resolved' as const,
            src: record.src,
        });
    };

    const presentLocalImage = (
        revisionId: string,
        generation: number,
    ) => (
        image: HTMLImageElement,
        reference: string,
    ): void => {
        const resolver = options.resolveImageSource;
        if (resolver === undefined)
            return;

        let task: Promise<void>;
        task = Promise.resolve()
            .then(() => resolver(Object.freeze({ revisionId, reference })))
            .then(decodeImageSourceResolution)
            .then((resolution) => {
                if (
                    resolution.kind !== 'resolved'
                    || generation !== imageRenderGeneration
                    || session.snapshot().revisionId !== revisionId
                    || !image.isConnected
                ) {
                    return;
                }
                image.setAttribute('src', resolution.src);
            })
            // Missing, stale, malformed, or rejected capabilities leave the
            // image inert. Document content must never become a fallback path.
            .catch(() => undefined)
            .finally(() => {
                pendingImageResolutions.delete(task);
            });
        pendingImageResolutions.add(task);
    };

    const clearQuickInsert = (): void => {
        quickInsertOverlay?.remove();
        quickInsertOverlay = null;
        quickInsertActiveIndex = 0;
        host.removeAttribute('aria-controls');
        host.removeAttribute('aria-activedescendant');
        host.removeAttribute('aria-autocomplete');
        host.removeAttribute('aria-haspopup');
        host.removeAttribute('aria-expanded');
        host.removeAttribute('data-quick-insert-placeholder');
        for (const paragraph of host.querySelectorAll<HTMLElement>(
            '.document-view-paragraph[data-quick-insert-placeholder]',
        )) {
            paragraph.removeAttribute('data-quick-insert-placeholder');
        }
    };

    const capturedQuickInsertTargetIsCurrent = (
        target: ModelSelection,
    ): boolean => {
        const current = session.snapshot();
        return destroyPromise === null
            && current.kind === 'complete'
            && current.projection === 'marked'
            && current.revisionId === target.revision
            && sameSelection(current.selection, target);
    };

    const restoreQuickInsertFocus = (): void => {
        const current = session.snapshot();
        if (
            destroyPromise !== null
            || current.kind !== 'complete'
            || current.projection !== 'marked'
        ) {
            return;
        }
        host.focus();
        restoreDocumentCoreSelection(
            host,
            current.selection.anchor,
            current.selection.focus,
        );
    };

    const requestTableShapeForTarget = async (
        target: ModelSelection,
    ): Promise<DocumentCoreTableShape | null> => {
        if (options.requestTableShape === undefined)
            return null;

        const cancellation = new AbortController();
        pendingTableShapeRequests.add(cancellation);
        let response: DocumentCoreTableShape | null;
        try {
            response = await options.requestTableShape(cancellation.signal);
        }
        catch (error) {
            if (cancellation.signal.aborted)
                return null;
            throw error;
        }
        finally {
            pendingTableShapeRequests.delete(cancellation);
        }
        if (!capturedQuickInsertTargetIsCurrent(target))
            return null;
        if (response === null) {
            restoreQuickInsertFocus();
            return null;
        }
        return decodeTableShape(response);
    };

    const activateQuickInsertChoice = async (
        choice: QuickInsertChoice,
        target: ModelSelection,
    ): Promise<void> => {
        let block: QuickInsertBlock;
        if (choice.block.kind === 'table') {
            const shape = await requestTableShapeForTarget(target);
            if (shape === null)
                return;
            block = Object.freeze({ kind: 'table', ...shape });
        }
        else {
            block = choice.block;
        }
        if (!capturedQuickInsertTargetIsCurrent(target))
            return;
        await dispatchIntent({ kind: 'quick-insert-block', target, block });
        restoreQuickInsertFocus();
    };

    const requestTable = async (): Promise<void> => {
        await pendingSelection;
        await commitSelection();
        const selection = completeSnapshot().selection;
        const target = Object.freeze({
            ...selection,
            anchor: Object.freeze({ ...selection.anchor }),
            focus: Object.freeze({ ...selection.focus }),
        });
        const shape = await requestTableShapeForTarget(target);
        if (shape === null || !capturedQuickInsertTargetIsCurrent(target))
            return;
        await dispatchIntent({ kind: 'create-table', target, ...shape });
        restoreQuickInsertFocus();
    };

    const quickInsertChoicesForQuery = (
        query: string,
    ): readonly QuickInsertChoice[] => QUICK_INSERT_CHOICES.filter(choice =>
        choice.label.toLocaleLowerCase().includes(query)
        || translate(choice.title).toLocaleLowerCase().includes(query));

    type QuickInsertQuery =
        | Readonly<{ readonly kind: 'not-triggered' }>
        | Readonly<{ readonly kind: 'bounded-no-match' }>
        | Readonly<{ readonly kind: 'query'; readonly value: string }>;
    const QUICK_INSERT_NOT_TRIGGERED: QuickInsertQuery = Object.freeze({
        kind: 'not-triggered',
    });
    const QUICK_INSERT_BOUNDED_NO_MATCH: QuickInsertQuery = Object.freeze({
        kind: 'bounded-no-match',
    });
    const quickInsertQuery = (
        snapshot: IDocumentCoreViewCompleteSnapshot,
        range: ModelRange,
    ): QuickInsertQuery => {
        const length = range.end - range.start;
        if (length === 0)
            return QUICK_INSERT_NOT_TRIGGERED;
        const marker = snapshot.modelText[range.start];
        if (marker !== '/' && marker !== '、')
            return QUICK_INSERT_NOT_TRIGGERED;
        const maximumQueryLength = QUICK_INSERT_CHOICES.reduce(
            (maximum, choice) => Math.max(
                maximum,
                choice.label.toLocaleLowerCase().length,
                translate(choice.title).toLocaleLowerCase().length,
            ),
            0,
        );
        if (length - 1 > maximumQueryLength)
            return QUICK_INSERT_BOUNDED_NO_MATCH;
        const paragraphText = snapshot.modelText.slice(
            range.start,
            range.end,
        );
        const match = /^[/、]([^\s]*)$/u.exec(paragraphText);
        return match === null
            ? QUICK_INSERT_NOT_TRIGGERED
            : Object.freeze({
                kind: 'query' as const,
                value: (match[1] ?? '').toLocaleLowerCase(),
            });
    };

    const currentQuickInsertTarget = (
        renderedTarget: ModelSelection,
        paragraphNodeId: string,
        choice: QuickInsertChoice,
    ): ModelSelection | null => {
        const snapshot = session.snapshot();
        if (
            destroyPromise !== null
            || snapshot.kind !== 'complete'
            || snapshot.projection !== 'marked'
            || snapshot.selection.session !== renderedTarget.session
            || snapshot.selection.anchor.offset
                !== snapshot.selection.focus.offset
        ) {
            return null;
        }
        const offset = snapshot.selection.anchor.offset;
        const block = snapshot.blocks.find(candidate =>
            candidate.kind === 'paragraph'
            && candidate.modelRange.start <= offset
            && offset <= candidate.modelRange.end);
        if (block === undefined || block.tree.key !== paragraphNodeId)
            return null;
        const query = quickInsertQuery(snapshot, block.modelRange);
        if (query.kind !== 'query')
            return null;
        if (!quickInsertChoicesForQuery(query.value).includes(choice))
            return null;
        return Object.freeze({
            ...snapshot.selection,
            anchor: Object.freeze({ ...snapshot.selection.anchor }),
            focus: Object.freeze({ ...snapshot.selection.focus }),
        });
    };

    const refreshQuickInsert = (
        publishedSnapshot?: DocumentCoreViewSnapshot,
    ): void => {
        clearQuickInsert();
        const snapshot = publishedSnapshot ?? session.snapshot();
        if (
            snapshot.kind !== 'complete'
            || snapshot.projection !== 'marked'
            || snapshot.selection.anchor.offset
                !== snapshot.selection.focus.offset
        ) {
            return;
        }

        const offset = snapshot.selection.anchor.offset;
        if (snapshot.blocks.length === 0) {
            if (!hideQuickInsertHint) {
                host.setAttribute(
                    'data-quick-insert-placeholder',
                    translate('Type / to insert...'),
                );
            }
            return;
        }
        const block = snapshot.blocks.find(candidate =>
            candidate.kind === 'paragraph'
            && candidate.modelRange.start <= offset
            && offset <= candidate.modelRange.end);
        if (block === undefined)
            return;

        const paragraph = [...host.querySelectorAll<HTMLElement>(
            '.document-view-paragraph[data-node-id]',
        )].find(candidate => candidate.dataset.nodeId === block.tree.key);
        if (paragraph === undefined)
            return;

        if (
            block.modelRange.start === block.modelRange.end
            && !hideQuickInsertHint
        ) {
            paragraph.setAttribute(
                'data-quick-insert-placeholder',
                translate('Type / to insert...'),
            );
        }

        const query = quickInsertQuery(snapshot, block.modelRange);
        if (query.kind === 'not-triggered')
            return;
        const choices = query.kind === 'bounded-no-match'
            ? Object.freeze([])
            : quickInsertChoicesForQuery(query.value);
        const overlay = host.ownerDocument.createElement('div');
        overlay.className = 'document-view-quick-insert';
        overlay.setAttribute('contenteditable', 'false');
        const listbox = host.ownerDocument.createElement('div');
        listbox.className = 'document-view-quick-insert-listbox';
        listbox.id = quickInsertListboxId;
        listbox.setAttribute('role', 'listbox');
        listbox.setAttribute('aria-label', translate('Type / to insert...'));
        listbox.dataset.localeKey = 'Type / to insert...';
        listbox.tabIndex = 0;
        overlay.appendChild(listbox);
        host.setAttribute('aria-controls', listbox.id);
        host.setAttribute('aria-haspopup', 'listbox');
        host.setAttribute('aria-autocomplete', 'list');

        const target = Object.freeze({
            ...snapshot.selection,
            anchor: Object.freeze({ ...snapshot.selection.anchor }),
            focus: Object.freeze({ ...snapshot.selection.focus }),
        });
        if (choices.length === 0) {
            const status = host.ownerDocument.createElement('div');
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            status.dataset.localeKey = 'No result';
            status.dataset.localeText = 'true';
            status.textContent = translate('No result');
            overlay.appendChild(status);
        }
        choices.forEach((choice, index) => {
            const button = host.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'document-view-quick-insert-item';
            button.id = `${quickInsertListboxId}-option-${choice.label.replace(
                /[^a-z0-9_-]+/giu,
                '-',
            )}`;
            button.dataset.label = choice.label;
            button.dataset.localeKey = choice.title;
            button.dataset.localeText = 'true';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
            button.tabIndex = -1;
            button.textContent = translate(choice.title);
            button.setAttribute('aria-label', translate(choice.title));
            button.addEventListener('pointerdown', event => {
                event.preventDefault();
            });
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                clearQuickInsert();
                enqueueBrowserInput(async () => {
                    const liveTarget = currentQuickInsertTarget(
                        target,
                        block.tree.key,
                        choice,
                    );
                    if (liveTarget === null)
                        return;
                    await activateQuickInsertChoice(choice, liveTarget);
                });
            });
            listbox.appendChild(button);
        });
        if (choices[0] !== undefined) {
            const activeId =
                `${quickInsertListboxId}-option-${choices[0].label.replace(
                    /[^a-z0-9_-]+/giu,
                    '-',
                )}`;
            host.setAttribute('aria-activedescendant', activeId);
            listbox.setAttribute('aria-activedescendant', activeId);
        }

        const cursor = selectionCursor();
        const hostBounds = host.getBoundingClientRect();
        overlay.style.position = 'fixed';
        overlay.style.left = `${String(cursor?.x ?? hostBounds.left)}px`;
        overlay.style.top = `${String(
            cursor === null ? hostBounds.top + 24 : cursor.y + 24,
        )}px`;
        host.appendChild(overlay);
        quickInsertOverlay = overlay;
    };

    let searchDecorations: Readonly<{
        ranges: readonly Readonly<{ start: number; end: number }>[];
        activeIndex: number;
    }> | null = null;

    // Code tokens paint before search decorations so a match highlight layers
    // over the syntax colour rather than being erased by it.
    const repaintDecorations = (): void => {
        paintCodeTokenDecorations(host);
        repaintSearchDecorations();
        updateActiveBlockMarker();
    };

    const repaintSearchDecorations = (): void => {
        if (searchDecorations === null)
            return;
        paintSearchDecorations(
            host,
            searchDecorations.ranges,
            searchDecorations.activeIndex,
        );
    };

    const setSearchDecorations = (
        ranges: readonly Readonly<{ start: number; end: number }>[],
        activeIndex: number,
    ): void => {
        searchDecorations = ranges.length === 0
            ? null
            : Object.freeze({ ranges, activeIndex });
        if (searchDecorations === null) {
            clearSearchDecorations(host);
            return;
        }
        repaintSearchDecorations();
    };

    const render = (restoreSelection = false): void => {
        forgetDocumentCoreTextPublication(host);
        imageRenderGeneration += 1;
        const generation = imageRenderGeneration;
        selectedImageSrc = null;
        quickInsertOverlay = null;
        imageSelectorWrapper = null;
        const snapshot = session.snapshot();
        if (snapshot.kind === 'source-only') {
            headingElements = new Map();
            const carrier = host.ownerDocument.createElement('span');
            carrier.className = 'document-view-run document-view-source';
            carrier.setAttribute('data-model-start', '0');
            carrier.setAttribute('data-model-end', String(snapshot.source.length));
            carrier.appendChild(
                host.ownerDocument.createTextNode(snapshot.source),
            );
            host.replaceChildren(carrier);
            host.classList.add('document-view-document');
            host.setAttribute('data-markdown-kind', 'document');
            host.dataset.documentMode = 'source-only';
            delete host.dataset.criticProjection;
            host.setAttribute('contenteditable', 'true');
            host.setAttribute('aria-readonly', 'false');
            if (restoreSelection) {
                restoreDocumentCoreSelection(
                    host,
                    snapshot.selection.anchor,
                    snapshot.selection.focus,
                );
            }
            clearQuickInsert();
            repaintDecorations();
        rememberDocumentCoreTextPublication(host, snapshot);
            mountedSnapshot = snapshot;
            return;
        }

        host.dataset.documentMode = 'semantic';
        const mountedImages: Array<
            readonly [HTMLImageElement, MarkupRenderNode]
        > = [];
        // The owner supplies one already-joined portable block plan. Desktop's
        // owner lives in main; this renderer mounts without parsing or
        // reconstructing document structure.
        headingElements = renderDocumentCoreBlocks(
            host,
            snapshot.blocks,
            presentLocalImage(snapshot.revisionId, generation),
            snapshot.projection === 'marked'
                ? snapshot.reviewIndex
                : undefined,
            localeResource.Comment ?? 'Comment',
            snapshot.projection === 'marked'
                ? (node, checked) => {
                    const markerStart = node.attributes.taskMarkerStart;
                    if (
                        typeof markerStart !== 'number'
                        || !Number.isInteger(markerStart)
                    ) {
                        enqueueBrowserInput(() => Promise.reject(
                            new Error(
                                'Task checkbox is missing its parser-owned marker',
                            ),
                        ));
                        return;
                    }
                    const current = completeSnapshot();
                    const point = Object.freeze({
                        offset: markerStart + 1,
                        affinity: 'next' as const,
                    });
                    const target = Object.freeze({
                        ...current.selection,
                        anchor: point,
                        focus: point,
                    });
                    enqueueBrowserInput(() => dispatchIntent({
                        kind: 'set-task-checked',
                        target,
                        checked,
                        cascade: autoCheckTasks,
                    }));
                }
                : undefined,
            Object.freeze({
                completed: translate('Completed task'),
                incomplete: translate('Incomplete task'),
            }),
            (image, node) => mountedImages.push(
                Object.freeze([image, node] as const),
            ),
        );
        snapshot.outline.forEach((item) => {
            const heading = headingElements.get(item.nodeId);
            if (heading === undefined)
                return;

            const button = host.ownerDocument.createElement('button');
            button.type = 'button';
            button.dataset.documentCommand = 'copy-heading-link';
            button.className = 'document-view-heading-link-copy';
            button.dataset.localeKey = 'Copy anchor link to this heading';
            button.dataset.localeSuffix = `: ${item.content}`;
            button.setAttribute(
                'aria-label',
                `${translate('Copy anchor link to this heading')}: ${item.content}`,
            );
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                for (const listener of interactionListeners) {
                    listener(Object.freeze({
                        kind: 'copy-heading-link',
                        targetNodeId: item.nodeId,
                    }));
                }
            });
            heading.appendChild(button);
        });
        for (const link of host.querySelectorAll<HTMLAnchorElement>(
            'a.document-view-link, a.document-view-autolink',
        )) {
            const targetNodeId = link.dataset.nodeId as NodeId | undefined;
            if (targetNodeId === undefined) {
                throw new Error('Parser link has no node identity');
            }
            link.addEventListener('click', (event) => {
                event.preventDefault();
                if (!event.metaKey && !event.ctrlKey)
                    return;

                for (const listener of interactionListeners) {
                    listener(Object.freeze({
                        kind: 'navigate-link',
                        targetNodeId,
                    }));
                }
            });
            const tools = host.ownerDocument.createElement('span');
            tools.className = 'document-view-link-tools';
            tools.setAttribute('contenteditable', 'false');
            const open = host.ownerDocument.createElement('button');
            open.type = 'button';
            open.dataset.documentCommand = 'navigate-link';
            open.dataset.localeKey = 'Open link';
            open.dataset.localeText = 'true';
            open.dataset.localeSuffix = `: ${link.getAttribute('href') ?? ''}`;
            open.setAttribute(
                'aria-label',
                `${translate('Open link')}: ${link.getAttribute('href') ?? ''}`,
            );
            open.textContent = translate('Open link');
            open.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                for (const listener of interactionListeners) {
                    listener(Object.freeze({
                        kind: 'navigate-link',
                        targetNodeId,
                    }));
                }
            });
            tools.appendChild(open);
            link.after(tools);
        }
        for (const codeBlock of host.querySelectorAll<HTMLElement>(
            'pre.document-view-code-block',
        )) {
            const code = codeBlock.querySelector<HTMLElement>('code');
            const language = code?.dataset.language ?? '';
            const input = host.ownerDocument.createElement('input');
            input.type = 'text';
            input.value = language;
            input.className = 'document-view-code-language';
            input.dataset.documentCommand = 'set-code-language';
            input.dataset.localeKey = 'Input Language Identifier...';
            input.setAttribute(
                'aria-label',
                translate('Input Language Identifier...'),
            );
            input.setAttribute('contenteditable', 'false');
            input.addEventListener('change', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const start = Number(codeBlock.dataset.modelStart);
                if (!Number.isInteger(start))
                    throw new Error('Code block has no parser-owned range');

                enqueueBrowserInput(async () => {
                    await selectSession({
                        anchor: { offset: start, affinity: 'next' },
                        focus: { offset: start, affinity: 'next' },
                    });
                    await executeCommand({
                        kind: 'set-code-language',
                        language: input.value,
                    });
                });
            });
            codeBlock.prepend(input);
        }
        for (const [image, node] of mountedImages) {
            image.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                for (const selected of host.querySelectorAll<HTMLImageElement>(
                    'img.document-view-image[data-document-selected="true"]',
                )) {
                    selected.removeAttribute('data-document-selected');
                }
                image.dataset.documentSelected = 'true';
                selectedImageSrc = image.getAttribute('src') ?? '';
                if (event.metaKey || event.ctrlKey) {
                    for (const listener of interactionListeners) {
                        listener(Object.freeze({
                            kind: 'preview-image',
                            src: selectedImageSrc,
                            trigger: 'modifier-click',
                        }));
                    }
                    return;
                }

                const src = node.attributes.src;
                const alt = node.attributes.alt;
                const title = node.attributes.title;
                if (
                    node.kind !== 'image'
                    || typeof src !== 'string'
                    || typeof alt !== 'string'
                    || !Number.isInteger(node.modelRange.start)
                    || !Number.isInteger(node.modelRange.end)
                ) {
                    enqueueBrowserInput(() => Promise.reject(
                        new Error(
                            'Image tool requires parser-owned identity and range',
                        ),
                    ));
                    return;
                }
                const current = completeSnapshot();
                const target = Object.freeze({
                    ...current.selection,
                    anchor: Object.freeze({
                        offset: node.modelRange.start,
                        affinity: 'next' as const,
                    }),
                    focus: Object.freeze({
                        offset: node.modelRange.end,
                        affinity: 'previous' as const,
                    }),
                });
                showImageSelector(
                    target,
                    Object.freeze({
                        src,
                        alt,
                        title: typeof title === 'string' ? title : '',
                    }),
                    node.key,
                    image,
                );
            });
        }
        host.dataset.criticProjection = snapshot.projection;
        host.setAttribute(
            'contenteditable',
            snapshot.projection === 'marked' ? 'true' : 'false',
        );
        host.setAttribute(
            'aria-readonly',
            snapshot.projection === 'marked' ? 'false' : 'true',
        );
        if (restoreSelection && snapshot.projection === 'marked') {
            restoreDocumentCoreSelection(
                host,
                snapshot.selection.anchor,
                snapshot.selection.focus,
            );
        }
        refreshQuickInsert(snapshot);
        repaintDecorations();
        rememberDocumentCoreTextPublication(host, snapshot);
        mountedSnapshot = snapshot;
    };

    const settle = async (
        completion: Promise<DocumentCoreViewDispatchResult>,
        restoreSelection = documentCoreSelectionIsMounted(host),
    ): Promise<void> => {
        const before = mountedSnapshot ?? session.snapshot();
        let result: DocumentCoreViewDispatchResult;
        try {
            result = await completion;
        }
        catch (error) {
            // A remote authority can recover and mount its verified full head
            // before rejecting a damaged transition publication. Render that
            // current authority state before the original failure escapes, so
            // the DOM never remains on a stale base.
            if (!destroying) {
                render(restoreSelection);
                for (const listener of listeners)
                    listener();
            }
            throw error;
        }
        if (result.kind === 'rejected') {
            if (
                !destroying
                && getTrackChanges()
                && result.reason !== undefined
            ) {
                const rejection = Object.freeze({
                    beforeMarkdown: session.snapshot().source,
                    reason: result.reason,
                });
                for (const listener of trackChangeRejectionListeners)
                    listener(rejection);
            }
            throw new DocumentCoreIntentRejectedError(result.reason);
        }
        if (result.kind === 'cancelled')
            throw new Error('Intent was cancelled');
        // Session authority may finish an already-admitted transaction while
        // destruction drains it. Its committed state remains authoritative,
        // but a destroyed view must never publish that state back into the DOM.
        if (destroying)
            return;

        const after = session.snapshot();
        // The patcher reconciles the mounted text nodes against the previous
        // publication; decoration spans would make that surgery miss. Strip
        // them first and repaint after the DOM settles.
        clearSearchDecorations(host);
        clearCodeTokenDecorations(host);
        const patched = result.kind === 'committed'
            && patchDocumentCoreTextPublication(
                host,
                before,
                after,
                result.sourceEdits,
            );
        if (patched) {
            mountedSnapshot = after;
            clearQuickInsert();
            if (restoreSelection) {
                restoreDocumentCoreSelection(
                    host,
                    after.selection.anchor,
                    after.selection.focus,
                );
            }
            refreshQuickInsert(after);
            repaintDecorations();
        rememberDocumentCoreTextPublication(host, after);
        }
        else {
            render(restoreSelection);
        }
        for (const listener of listeners)
            listener();
    };

    const typeText = async (
        modelOffset: number,
        text: string,
    ): Promise<void> => {
        assertModelOffset(modelOffset);
        const selection = activeSelection();

        const caret = { offset: modelOffset, affinity: 'next' } as const;
        await settle(
            session.dispatch({
                kind: 'insert-text',
                target: { ...selection, anchor: caret, focus: caret },
                text,
            }),
        );
    };

    const dispatchIntent = async (intent: EditorIntent): Promise<void> => {
        await settle(session.dispatch(intent));
    };

    const pasteTargetFromClipboard = async (
        target: ModelSelection,
    ): Promise<void> => {
        if (options.clipboardPaste === undefined) {
            throw new Error(
                'The host did not install its clipboard paste transaction',
            );
        }
        await settle(Promise.resolve(options.clipboardPaste(target)), true);
    };

    const pasteFromClipboard = async (): Promise<void> => {
        await pendingSelection;
        await commitSelection();
        await pasteTargetFromClipboard(completeSnapshot().selection);
    };

    const pasteSourceClipboard = async (
        selection: InitialModelSelection,
    ): Promise<void> => {
        const snapshot = session.snapshot();
        const sourceLength = snapshot.source.length;
        for (const position of [selection.anchor, selection.focus]) {
            if (
                !Number.isInteger(position.offset)
                || position.offset < 0
                || position.offset > sourceLength
            ) {
                throw new RangeError(
                    'Source clipboard paste is outside the active document',
                );
            }
        }
        await pasteTargetFromClipboard(Object.freeze({
            ...snapshot.sourceSelection,
            anchor: Object.freeze({ ...selection.anchor }),
            focus: Object.freeze({ ...selection.focus }),
        }));
    };

    const executeCommand = async (
        command: DocumentCoreEditorCommand,
    ): Promise<void> => {
        const target = completeSnapshot().selection;
        if (command.kind === 'convert-block') {
            await dispatchIntent({
                kind: 'convert-block',
                target,
                conversion: command.conversion,
            });
            return;
        }
        if (command.kind === 'duplicate-block') {
            await dispatchIntent({ kind: 'duplicate-block', target });
            return;
        }
        if (command.kind === 'delete-block') {
            await dispatchIntent({ kind: 'delete-block', target });
            return;
        }
        if (command.kind === 'insert-paragraph') {
            await dispatchIntent({
                kind: 'insert-paragraph',
                target,
                location: command.location,
            });
            return;
        }
        if (command.kind === 'format-text') {
            await dispatchIntent({
                kind: 'format-text',
                target,
                format: command.format,
            });
            return;
        }
        if (command.kind === 'set-list-indentation') {
            await dispatchIntent({
                kind: 'set-list-indentation',
                target,
                direction: command.direction,
            });
            return;
        }
        if (command.kind === 'set-code-language') {
            await dispatchIntent({
                kind: 'set-code-language',
                target,
                language: command.language,
            });
            return;
        }
        if (command.kind === 'insert-link') {
            await dispatchIntent({
                kind: 'insert-link',
                target,
                href: command.href,
                ...(command.title === undefined
                    ? {}
                    : { title: command.title }),
            });
            return;
        }
        if (command.kind === 'insert-image') {
            await dispatchIntent({
                kind: 'insert-image',
                target,
                src: command.src,
                alt: command.alt,
                ...(command.title === undefined
                    ? {}
                    : { title: command.title }),
            });
            return;
        }
        if (command.kind === 'insert-footnote') {
            await dispatchIntent({
                kind: 'insert-footnote',
                target,
                label: command.label,
                content: command.content,
            });
            return;
        }
        if (command.kind === 'paste-text') {
            await dispatchIntent({
                kind: 'paste-text',
                target,
                text: command.text,
                source: command.source,
            });
            return;
        }
        if (command.kind === 'insert-table-row') {
            await dispatchIntent({
                kind: 'insert-table-row',
                target,
                location: command.location,
            });
            return;
        }
        if (command.kind === 'remove-table-row') {
            await dispatchIntent({ kind: 'remove-table-row', target });
            return;
        }
        if (command.kind === 'insert-table-column') {
            await dispatchIntent({
                kind: 'insert-table-column',
                target,
                location: command.location,
            });
            return;
        }
        if (command.kind === 'remove-table-column') {
            await dispatchIntent({ kind: 'remove-table-column', target });
            return;
        }
        if (command.kind === 'align-table-column') {
            await dispatchIntent({
                kind: 'align-table-column',
                target,
                alignment: command.alignment,
            });
            return;
        }
        if (command.kind === 'move-table-row') {
            await dispatchIntent({
                kind: 'move-table-row',
                target,
                direction: command.direction,
            });
            return;
        }
        if (command.kind === 'move-table-column') {
            await dispatchIntent({
                kind: 'move-table-column',
                target,
                direction: command.direction,
            });
            return;
        }
        if (command.kind === 'delete-table-cell-contents') {
            await dispatchIntent({
                kind: 'delete-table-cell-contents',
                target,
            });
            return;
        }
        throw new TypeError('Unknown document editor command');
    };

    const setProjection = async (
        projection: CriticMarkupProjection,
    ): Promise<void> => {
        if (projection === getProjection())
            return;

        await settle(session.dispatch({
            kind: 'set-projection',
            projection,
        }), projection === 'marked');
    };

    const authorCriticMarkup = async (
        input: CriticMarkupAuthoringInput,
    ): Promise<void> => {
        await settle(session.dispatch({
            kind: 'author-critic-markup',
            target: completeSnapshot().selection,
            input,
        }));
    };

    const deleteRange = async (start: number, end: number): Promise<void> => {
        assertModelOffset(start);
        assertModelOffset(end);
        const selection = activeSelection();

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
        assertModelOffset(start);
        assertModelOffset(end);
        const selection = activeSelection();

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
        const snapshot = session.snapshot();
        if (
            snapshot.kind === 'complete'
            && snapshot.projection !== 'marked'
        ) {
            const range = host.ownerDocument.createRange();
            range.selectNodeContents(host);
            const selection = host.ownerDocument.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            return;
        }
        const length = modelText().length;
        const requested = {
            anchor: { offset: 0, affinity: 'next' },
            focus: { offset: length, affinity: 'previous' },
        } as const;
        void selectSession(requested).then(() => {
            const committed = session.snapshot();
            restoreDocumentCoreSelection(
                host,
                committed.selection.anchor,
                committed.selection.focus,
            );
            publishSelection();
        }, () => undefined);
        restoreSelectionIfCommitted(requested);
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
        query: DocumentSearchQuery,
    ): readonly SearchMatchRange[] => {
        const snapshot = session.snapshot();
        return snapshot.kind === 'complete'
            ? findMarkupSearchMatches(snapshot.blocks, query)
            : findSearchMatches(snapshot.source, query);
    };

    const replaceCurrentMatches = async (
        query: DocumentSearchQuery,
        replacement: string,
    ): Promise<readonly SearchMatchRange[]> => {
        await settle(session.dispatch({
            kind: 'replace-current-matches',
            target: activeSelection(),
            query,
            replacement,
        }));
        return search(query);
    };

    const undo = async (): Promise<void> => {
        await settle(session.dispatch({ kind: 'undo' }));
    };

    const redo = async (): Promise<void> => {
        await settle(session.dispatch({ kind: 'redo' }));
    };

    const editSource = async (
        start: number,
        end: number,
        text: string,
        selection: InitialModelSelection,
    ): Promise<void> => {
        const snapshot = session.snapshot();
        const authenticated = snapshot.sourceSelection;
        await settle(session.dispatch({
            kind: 'edit-source',
            target: Object.freeze({
                ...authenticated,
                anchor: Object.freeze({
                    offset: start,
                    affinity: 'next' as const,
                }),
                focus: Object.freeze({
                    offset: end,
                    affinity: start === end ? 'next' as const : 'previous' as const,
                }),
            }),
            text,
            selection,
        }), false);
    };

    const insertSourceImage = async (image: Readonly<{
        src: string;
        alt: string;
        title?: string;
    }>): Promise<void> => {
        const target = session.snapshot().sourceSelection;
        await settle(session.dispatch({
            kind: 'insert-image',
            target,
            src: image.src,
            alt: image.alt,
            ...(image.title === undefined ? {} : { title: image.title }),
        }), false);
    };

    const getMarkdownSync = (): string => session.snapshot().source;

    const getMarkdown = async (): Promise<string> => {
        await settled();
        return session.snapshot().source;
    };

    const attachDocument = async (documentId: string): Promise<void> => {
        await settled();
        await session.attachDocument(documentId);
        synchronizeMarkdownOptions();
        render();
    };

    const reconfigureMarkdownOptions = async (
        patch: DocumentCoreMarkdownOptionPatch,
    ): Promise<void> => {
        await settle(session.reconfigureMarkdownOptions(patch));
        synchronizeMarkdownOptions(patch);
    };

    const getSelection = (): { start: number; end: number } => {
        const snapshot = session.snapshot();
        return {
            start: snapshot.selection.anchor.offset,
            end: snapshot.selection.focus.offset,
        };
    };

    const selectionNode = (
        node: MarkupRenderNode,
    ): IDocumentSelectionNode => Object.freeze({
        key: node.key,
        kind: node.kind,
        attributes: node.attributes,
        range: node.modelRange,
    });

    const containsOffset = (
        node: MarkupRenderNode,
        offset: number,
        affinity: 'previous' | 'next',
    ): boolean => affinity === 'previous'
        ? node.modelRange.start < offset && offset <= node.modelRange.end
        : node.modelRange.start <= offset && offset < node.modelRange.end;

    const pathAt = (
        offset: number,
        affinity: 'previous' | 'next',
    ): readonly IDocumentSelectionNode[] => {
        const snapshot = completeSnapshot();
        const fallback = affinity === 'previous' && offset === 0
            ? 'next'
            : affinity;
        const visit = (
            node: MarkupRenderNode,
        ): readonly IDocumentSelectionNode[] => {
            const child = node.children.find(candidate =>
                containsOffset(candidate, offset, fallback));
            return Object.freeze([
                selectionNode(node),
                ...(child === undefined ? [] : visit(child)),
            ]);
        };
        const block = snapshot.blocks.find(candidate =>
            containsOffset(candidate.tree, offset, fallback))
            ?? (
                offset === snapshot.markupModelLength
                    ? snapshot.blocks.at(-1)
                    : undefined
            );
        return block === undefined
            ? Object.freeze([])
            : visit(block.tree);
    };

    const commonPath = (
        left: readonly IDocumentSelectionNode[],
        right: readonly IDocumentSelectionNode[],
    ): readonly IDocumentSelectionNode[] => {
        const result: IDocumentSelectionNode[] = [];
        const length = Math.min(left.length, right.length);
        for (let index = 0; index < length; index += 1) {
            const leftNode = left[index];
            const rightNode = right[index];
            if (
                leftNode === undefined
                || rightNode === undefined
                || leftNode.key !== rightNode.key
            ) {
                break;
            }
            result.push(leftNode);
        }
        return Object.freeze(result);
    };

    const inlineFormatOf = (
        kind: MarkdownNodeKind,
    ): InlineFormat | null => {
        const formats: Partial<Record<MarkdownNodeKind, InlineFormat>> = {
            emphasis: 'emphasis',
            strong: 'strong',
            strikethrough: 'strikethrough',
            subscript: 'subscript',
            superscript: 'superscript',
            'inline-code': 'inline-code',
            'inline-math': 'inline-math',
            link: 'link',
            image: 'image',
        };
        return formats[kind] ?? null;
    };

    const selectionCursor = (
    ): Readonly<{ readonly x: number; readonly y: number }> | null => {
        if (!documentCoreSelectionIsMounted(host))
            return null;

        const selection = host.ownerDocument.getSelection();
        if (selection === null || selection.rangeCount === 0)
            return null;

        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
        if (typeof range.getBoundingClientRect !== 'function')
            return null;

        // A collapsed range between text nodes can measure as an empty rect
        // (all zeros), which the desktop's typewriter scroll would read as a
        // real caret at the viewport origin. Fall back to the containing
        // element, which always has a box.
        const hasRects = typeof range.getClientRects === 'function'
            && range.getClientRects().length > 0;
        if (!hasRects) {
            const node = range.startContainer;
            const element = node.nodeType === Node.ELEMENT_NODE
                ? node as Element
                : node.parentElement;
            if (element === null)
                return null;
            const elementBounds = element.getBoundingClientRect();
            return Object.freeze({ x: elementBounds.x, y: elementBounds.y });
        }
        const bounds = range.getBoundingClientRect();
        return Object.freeze({ x: bounds.x, y: bounds.y });
    };

    const getSelectionContext = (): DocumentSelectionContext => {
        const snapshot = completeSnapshot();
        const { anchor, focus } = snapshot.selection;
        const anchorPath = pathAt(anchor.offset, 'next');
        const focusPath = pathAt(
            focus.offset,
            anchor.offset === focus.offset ? 'next' : 'previous',
        );
        const blockPath = commonPath(anchorPath, focusPath);
        const anchorFormats = new Set(
            anchorPath
                .map(node => inlineFormatOf(node.kind))
                .filter((format): format is InlineFormat => format !== null),
        );
        const activeInlineFormats = Object.freeze(
            focusPath
                .map(node => inlineFormatOf(node.kind))
                .filter((format): format is InlineFormat =>
                    format !== null && anchorFormats.has(format)),
        );
        const semanticPath = [...anchorPath, ...focusPath];
        const lists = semanticPath.filter(node => node.kind === 'list');
        const isCodeBlock = semanticPath.some(node => node.kind === 'code-block');
        const isCodeLike = semanticPath.some(node =>
            node.kind === 'code-block'
            || node.kind === 'math-block'
            || node.kind === 'html-block'
            || node.kind === 'diagram'
            || node.kind === 'front-matter');
        const start = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);
        return Object.freeze({
            anchor: Object.freeze({
                offset: anchor.offset,
                path: anchorPath,
            }),
            focus: Object.freeze({
                offset: focus.offset,
                path: focusPath,
            }),
            selectedText: snapshot.modelText.slice(start, end),
            activeInlineFormats,
            blockPath,
            flags: Object.freeze({
                hasFrontMatter: snapshot.blocks.some(
                    block => block.kind === 'front-matter',
                ),
                isMultiblock: anchorPath[0]?.key !== focusPath[0]?.key,
                isCodeLike,
                isCodeBlock,
                isTable: semanticPath.some(node => node.kind === 'table'),
                isList: lists.length > 0,
                isTaskList: lists.some(
                    node => node.attributes.taskList === true,
                ),
                isLooseList: lists.some(
                    node => node.attributes.tight === false,
                ),
            }),
            cursor: selectionCursor(),
        });
    };

    const publishSelection = (): void => {
        if (session.snapshot().kind !== 'complete')
            return;

        // The caret defines which block focus mode leaves lit.
        updateActiveBlockMarker();
        const context = getSelectionContext();
        for (const listener of selectionListeners)
            listener(context);
    };

    const subscribeSelection = (
        listener: (context: DocumentSelectionContext) => void,
    ): Disposable => {
        selectionListeners.add(listener);
        return {
            dispose: () => {
                selectionListeners.delete(listener);
            },
        };
    };

    const setCursorByOffset = (modelOffset: number): void => {
        assertModelOffset(modelOffset);
        const caret = { offset: modelOffset, affinity: 'next' } as const;
        // The engine validates and owns the position; the view does not keep a
        // caret of its own.
        void selectSession({ anchor: caret, focus: caret })
            .then(() => {
                const snapshot = session.snapshot();
                if (
                    snapshot.kind === 'source-only'
                    || snapshot.projection === 'marked'
                ) {
                    restoreDocumentCoreSelection(
                        host,
                        snapshot.selection.anchor,
                        snapshot.selection.focus,
                    );
                }
                publishSelection();
            }, () => undefined);
        restoreSelectionIfCommitted({ anchor: caret, focus: caret });
    };

    const setSelection = (start: number, end: number): void => {
        assertModelOffset(start);
        assertModelOffset(end);
        const requested = {
            anchor: { offset: start, affinity: 'next' },
            focus: {
                offset: end,
                affinity: start === end ? 'next' : 'previous',
            },
        } as const;
        void selectSession(requested).then(() => {
            const snapshot = session.snapshot();
            if (
                snapshot.kind === 'source-only'
                || snapshot.projection === 'marked'
            ) {
                restoreDocumentCoreSelection(
                    host,
                    snapshot.selection.anchor,
                    snapshot.selection.focus,
                );
            }
            publishSelection();
        }, () => undefined);
        restoreSelectionIfCommitted(requested);
    };

    const getSourceSelection = (): InitialModelSelection => {
        const selection = session.snapshot().sourceSelection;
        return Object.freeze({
            anchor: selection.anchor,
            focus: selection.focus,
        });
    };

    const selectSource = async (
        selection: InitialModelSelection,
    ): Promise<void> => {
        if (!selectionMatches(session.snapshot().sourceSelection, selection))
            abortPendingTableShapeRequests();
        await session.selectSource(selection);
        publishSelection();
    };

    const setSourceSelection = (
        selection: InitialModelSelection,
    ): void => {
        const mapped = Object.freeze({
            anchor: session.modelPositionAt(selection.anchor),
            focus: session.modelPositionAt(selection.focus),
        });
        void selectSession(mapped).then(() => {
            const snapshot = session.snapshot();
            if (
                snapshot.kind === 'source-only'
                || snapshot.projection === 'marked'
            ) {
                restoreDocumentCoreSelection(
                    host,
                    snapshot.selection.anchor,
                    snapshot.selection.focus,
                );
            }
            publishSelection();
        }, () => undefined);
        restoreSelectionIfCommitted(mapped);
    };

    const getTOC = (): readonly IDocumentCoreTocItem[] => {
        const snapshot = session.snapshot();
        if (snapshot.kind === 'source-only')
            return Object.freeze([]);

        return snapshot.outline;
    };

    const resolveHeadingElement = (nodeId: NodeId): HTMLElement | null => {
        const element = headingElements.get(nodeId);
        return element !== undefined && host.contains(element)
            ? element
            : null;
    };

    const setOptions = (options: DocumentViewOptions): void => {
        assertDocumentViewOptions(options);
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
        if (options.editorLineWidth !== undefined) {
            if (options.editorLineWidth === '') {
                host.style.removeProperty(
                    '--document-view-editor-area-width',
                );
            } else {
                host.style.setProperty(
                    '--document-view-editor-area-width',
                    `calc(100px + ${options.editorLineWidth})`,
                );
            }
        }
        if (typeof options.wrapCodeBlocks === 'boolean') {
            host.classList.toggle(
                'document-view-code-wrap',
                options.wrapCodeBlocks,
            );
        }
        if (typeof options.spellcheck === 'boolean')
            host.spellcheck = options.spellcheck;
        if (typeof options.hideSpellcheckMarks === 'boolean') {
            host.classList.toggle(
                'document-view-hide-spellcheck-marks',
                options.hideSpellcheckMarks,
            );
        }
        if (typeof options.hideLinkTools === 'boolean') {
            host.classList.toggle(
                'document-view-hide-link-tools',
                options.hideLinkTools,
            );
        }
        if (typeof options.autoCheckTasks === 'boolean')
            autoCheckTasks = options.autoCheckTasks;
        if (typeof options.autoPairBrackets === 'boolean')
            autoPairBrackets = options.autoPairBrackets;
        if (typeof options.autoPairQuotes === 'boolean')
            autoPairQuotes = options.autoPairQuotes;
        if (typeof options.autoPairMarkdown === 'boolean')
            autoPairMarkdown = options.autoPairMarkdown;
        if (typeof options.hideQuickInsertHint === 'boolean') {
            hideQuickInsertHint = options.hideQuickInsertHint;
            refreshQuickInsert();
        }

        const markdownOptionPatch: DocumentCoreMarkdownOptionPatch
            = Object.freeze({
                ...(
                    typeof options.footnotes === 'boolean'
                    && options.footnotes
                        !== desiredMarkdownOptions.footnotes
                    ? { footnotes: options.footnotes }
                    : {}),
                ...(
                    typeof options.gitLabMath === 'boolean'
                    && options.gitLabMath
                        !== desiredMarkdownOptions.gitLabMath
                    ? { gitLabMath: options.gitLabMath }
                    : {}),
                ...(
                    typeof options.subscriptAndSuperscript === 'boolean'
                    && options.subscriptAndSuperscript
                        !== desiredMarkdownOptions.subscriptAndSuperscript
                    ? {
                        subscriptAndSuperscript:
                            options.subscriptAndSuperscript,
                    }
                    : {}),
            });
        if (Object.keys(markdownOptionPatch).length > 0) {
            Object.assign(desiredMarkdownOptions, markdownOptionPatch);
            enqueueBrowserInput(async () => {
                try {
                    await reconfigureMarkdownOptions(markdownOptionPatch);
                }
                catch (error) {
                    for (const untypedKey of Object.keys(markdownOptionPatch)) {
                        const key = untypedKey as
                            keyof DocumentCoreMarkdownOptionPatch;
                        if (
                            desiredMarkdownOptions[key]
                            === markdownOptionPatch[key]
                        ) {
                            desiredMarkdownOptions[key]
                                = committedMarkdownOptions[key];
                        }
                    }
                    throw error;
                }
            });
        }
    };

    const hasFocus = (): boolean =>
        host.ownerDocument.activeElement === host
        || host.contains(host.ownerDocument.activeElement);

    const focus = (): void => {
        if (!host.hasAttribute('tabindex'))
            host.setAttribute('tabindex', '0');

        host.focus();
        const snapshot = session.snapshot();
        const selection = snapshot.selection;
        if (
            snapshot.kind === 'source-only'
            || snapshot.projection === 'marked'
        ) {
            restoreDocumentCoreSelection(
                host,
                selection.anchor,
                selection.focus,
            );
        }
    };

    const domNode = (): HTMLElement => host;

    /**
     * Mark the top-level block holding the caret. Focus mode dims every direct
     * child and exempts the marked one, so without this nothing is ever
     * un-dimmed and the whole document reads at 25% opacity.
     */
    const updateActiveBlockMarker = (): void => {
        // Only focus mode reads the marker, and marking mutates block
        // attributes — which the in-place text patcher treats as a DOM the
        // publication no longer describes, forcing a full re-render. Stay
        // inert unless focus mode is actually on.
        if (!host.classList.contains('document-view-focus-mode'))
            return;
        for (const previous of host.querySelectorAll(
            '[data-document-view-active]',
        )) {
            previous.removeAttribute('data-document-view-active');
            previous.classList.remove('document-view-active');
        }
        const selection = host.ownerDocument.getSelection();
        const origin = selection?.focusNode ?? null;
        if (origin === null || !host.contains(origin))
            return;
        let block = origin instanceof Element ? origin : origin.parentElement;
        while (block !== null && block.parentElement !== host)
            block = block.parentElement;
        if (block === null || block.parentElement !== host)
            return;
        block.setAttribute('data-document-view-active', 'true');
        block.classList.add('document-view-active');
    };

    const setFocusMode = (enabled: boolean): void => {
        host.classList.toggle('document-view-focus-mode', enabled);
        if (enabled)
            updateActiveBlockMarker();
    };

    const dismissTransientTools = (): void => {
        clearQuickInsert();
        imageSelectorWrapper?.remove();
        imageSelectorWrapper = null;
        selectedImageSrc = null;
        tableTools?.remove();
        tableTools = null;
        tableDragAnchor = null;
        for (const selected of host.querySelectorAll<HTMLElement>(
            '.document-view-table-cell[data-table-selected="true"]',
        )) {
            selected.removeAttribute('data-table-selected');
        }
        for (const selected of host.querySelectorAll<HTMLElement>(
            'img.document-view-image[data-document-selected="true"]',
        )) {
            selected.removeAttribute('data-document-selected');
        }
    };

    const hasTableRectangle = (): boolean =>
        host.querySelector(
            '.document-view-table-cell[data-table-selected="true"]',
        ) !== null;

    const writeClipboard = async (
        consumer: Exclude<ClipboardConsumer, 'copy-heading-link'>,
    ): Promise<DocumentCoreClipboardWriteResult> => {
        if (options.clipboardWrite === undefined)
            throw new Error('The host did not install its clipboard materializer');

        await pendingSelection;
        if (!hasTableRectangle())
            await commitSelection();

        const snapshot = completeSnapshot();
        const view: ConsumerView = snapshot.projection === 'marked'
            ? 'markup'
            : snapshot.projection;
        const selection = getSelection();
        return options.clipboardWrite({ consumer, view, selection });
    };

    const copyOrCut = async (
        operation: 'copy' | 'cut',
    ): Promise<void> => {
        const table = hasTableRectangle();
        if (operation === 'cut' && !table) {
            await pendingSelection;
            await commitSelection();
            const selection = getSelection();
            if (selection.start === selection.end)
                return;
        }
        const consumer = table
            ? operation === 'cut' ? 'cut-table' : 'copy-table'
            : operation === 'cut' ? 'cut' : 'normal-copy';
        const result = await writeClipboard(consumer);
        if (operation === 'copy') {
            if (result.kind !== 'written') {
                throw new Error(
                    'Copy requires a written clipboard result, received '
                    + result.kind,
                );
            }
            return;
        }

        if (result.kind !== 'cut-committed') {
            throw new Error(
                'Cut requires a cut-committed clipboard result, received '
                + result.kind,
            );
        }
        dismissTransientTools();
        render(true);
        for (const listener of listeners)
            listener();
    };

    const cutSource = async (start: number, end: number): Promise<void> => {
        await settled();
        const sourceLength = session.snapshot().source.length;
        if (
            !Number.isInteger(start)
            || !Number.isInteger(end)
            || start < 0
            || end < start
            || end > sourceLength
        ) {
            throw new RangeError('Source cut is outside the active document');
        }
        if (start === end)
            return;
        if (options.clipboardWrite === undefined)
            throw new Error('The host did not install its clipboard materializer');

        const result = await options.clipboardWrite({
            consumer: 'cut',
            view: 'source',
            selection: Object.freeze({ start, end }),
        });
        if (result.kind !== 'cut-committed') {
            throw new Error(
                'Cut requires a cut-committed clipboard result, received '
                + result.kind,
            );
        }
        dismissTransientTools();
        render(true);
        for (const listener of listeners)
            listener();
    };

    const setLocale = (locale: ILocale): void => {
        localeResource = {
            ...en.resource,
            ...locale.resource,
        };
        const localizedElements = [
            ...host.querySelectorAll<HTMLElement>('[data-locale-key]'),
            ...(tableTools === null
                ? []
                : [
                    tableTools,
                    ...tableTools.querySelectorAll<HTMLElement>(
                        '[data-locale-key]',
                    ),
                ]),
        ];
        for (const element of localizedElements) {
            const key = element.dataset.localeKey;
            if (key === undefined)
                continue;

            const label = translate(key);
            if (element.dataset.localeText === 'true')
                element.textContent = label;
            element.setAttribute(
                'aria-label',
                label + (element.dataset.localeSuffix ?? ''),
            );
        }
        refreshQuickInsert();
    };

    const showTableTools = (
        cell: HTMLElement,
        target: Readonly<{ start: number; end: number }>,
    ): void => {
        tableTools?.remove();
        tableTools = null;
        const { start, end } = target;
        if (!Number.isInteger(start) || !Number.isInteger(end))
            return;

        void selectSession({
            anchor: { offset: start, affinity: 'next' },
            focus: {
                offset: end,
                affinity: start === end ? 'next' : 'previous',
            },
        });

        const toolbar = host.ownerDocument.createElement('div');
        toolbar.className = 'document-view-table-tools';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.dataset.localeKey = 'Table tools';
        toolbar.setAttribute('aria-label', translate('Table tools'));
        toolbar.setAttribute('contenteditable', 'false');
        toolbar.dataset.modelStart = String(start);
        toolbar.dataset.modelEnd = String(end);

        const commands: readonly Readonly<{
            id: string;
            label: keyof typeof en.resource;
            command: DocumentCoreEditorCommand;
        }>[] = [
            {
                id: 'insert-row-before',
                label: 'Insert Row Above',
                command: { kind: 'insert-table-row', location: 'before' },
            },
            {
                id: 'insert-row-after',
                label: 'Insert Row Below',
                command: { kind: 'insert-table-row', location: 'after' },
            },
            {
                id: 'remove-row',
                label: 'Remove Row',
                command: { kind: 'remove-table-row' },
            },
            {
                id: 'move-row-up',
                label: 'Move Row Up',
                command: { kind: 'move-table-row', direction: 'up' },
            },
            {
                id: 'move-row-down',
                label: 'Move Row Down',
                command: { kind: 'move-table-row', direction: 'down' },
            },
            {
                id: 'insert-column-left',
                label: 'Insert Column left',
                command: { kind: 'insert-table-column', location: 'left' },
            },
            {
                id: 'insert-column-right',
                label: 'Insert Column right',
                command: { kind: 'insert-table-column', location: 'right' },
            },
            {
                id: 'remove-column',
                label: 'Remove Column',
                command: { kind: 'remove-table-column' },
            },
            {
                id: 'move-column-left',
                label: 'Move Column Left',
                command: { kind: 'move-table-column', direction: 'left' },
            },
            {
                id: 'move-column-right',
                label: 'Move Column Right',
                command: { kind: 'move-table-column', direction: 'right' },
            },
            {
                id: 'align-left',
                label: 'Align Left',
                command: {
                    kind: 'align-table-column',
                    alignment: 'left',
                },
            },
            {
                id: 'align-center',
                label: 'Align Center',
                command: {
                    kind: 'align-table-column',
                    alignment: 'center',
                },
            },
            {
                id: 'align-right',
                label: 'Align Right',
                command: {
                    kind: 'align-table-column',
                    alignment: 'right',
                },
            },
            {
                id: 'align-none',
                label: 'Clear Alignment',
                command: {
                    kind: 'align-table-column',
                    alignment: 'none',
                },
            },
            {
                id: 'delete-cell-contents',
                label: 'Delete Cell Contents',
                command: { kind: 'delete-table-cell-contents' },
            },
        ];
        for (const item of commands) {
            const button = host.ownerDocument.createElement('button');
            button.type = 'button';
            button.dataset.tableCommand = item.id;
            const label = localeResource[item.label] ?? item.label;
            button.dataset.localeKey = item.label;
            button.dataset.localeText = 'true';
            button.textContent = label;
            button.setAttribute('aria-label', label);
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                enqueueBrowserInput(async () => {
                    await pendingSelection;
                    await executeCommand(item.command);
                    dismissTransientTools();
                });
            });
            toolbar.appendChild(button);
        }
        const cut = host.ownerDocument.createElement('button');
        cut.type = 'button';
        cut.dataset.tableCommand = 'cut-cells';
        cut.dataset.localeKey = 'Cut Cells';
        const cutLabel = localeResource['Cut Cells'] ?? 'Cut Cells';
        cut.textContent = cutLabel;
        cut.setAttribute('aria-label', cutLabel);
        cut.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            enqueueBrowserInput(async () => {
                await copyOrCut('cut');
            });
        });
        toolbar.appendChild(cut);

        const bounds = cell.getBoundingClientRect();
        toolbar.style.position = 'fixed';
        toolbar.style.left = `${String(bounds.left)}px`;
        toolbar.style.top = `${String(bounds.bottom)}px`;
        host.ownerDocument.body.appendChild(toolbar);
        tableTools = toolbar;
    };

    const tableCellFromEvent = (event: Event): HTMLElement | null => {
        const target = event.target;
        if (!(target instanceof Element))
            return null;

        const cell = target.closest<HTMLElement>(
            '.document-view-table-cell',
        );
        return cell !== null && host.contains(cell) ? cell : null;
    };

    const activateTableRectangle = (
        anchor: HTMLElement,
        focus: HTMLElement,
    ): void => {
        const table = anchor.closest('table');
        if (table === null || focus.closest('table') !== table)
            return;

        const rows = [...table.querySelectorAll<HTMLElement>(
            '.document-view-table-row',
        )];
        const coordinate = (
            cell: HTMLElement,
        ): Readonly<{ row: number; column: number }> | null => {
            const row = rows.findIndex(candidate => candidate.contains(cell));
            if (row < 0)
                return null;

            const cells = [...rows[row]!.children].filter(
                (candidate): candidate is HTMLElement =>
                    candidate instanceof HTMLElement
                    && candidate.classList.contains(
                        'document-view-table-cell',
                    ),
            );
            const column = cells.indexOf(cell);
            return column < 0 ? null : { row, column };
        };
        const from = coordinate(anchor);
        const to = coordinate(focus);
        if (from === null || to === null)
            return;

        const rowStart = Math.min(from.row, to.row);
        const rowEnd = Math.max(from.row, to.row);
        const columnStart = Math.min(from.column, to.column);
        const columnEnd = Math.max(from.column, to.column);
        const selected: HTMLElement[] = [];
        for (const candidate of host.querySelectorAll<HTMLElement>(
            '.document-view-table-cell[data-table-selected="true"]',
        )) {
            candidate.removeAttribute('data-table-selected');
        }
        for (let row = rowStart; row <= rowEnd; row += 1) {
            const cells = [...(rows[row]?.children ?? [])].filter(
                (candidate): candidate is HTMLElement =>
                    candidate instanceof HTMLElement
                    && candidate.classList.contains(
                        'document-view-table-cell',
                    ),
            );
            for (
                let column = columnStart;
                column <= columnEnd;
                column += 1
            ) {
                const cell = cells[column];
                if (cell === undefined)
                    continue;

                cell.dataset.tableSelected = 'true';
                selected.push(cell);
            }
        }
        const starts = selected.map(cell =>
            Number(cell.getAttribute('data-model-start')));
        const ends = selected.map(cell =>
            Number(cell.getAttribute('data-model-end')));
        const start = Math.min(...starts);
        const end = Math.max(...ends);
        if (!Number.isInteger(start) || !Number.isInteger(end))
            return;

        showTableTools(focus, { start, end });
    };

    const handleTableCellClick = (event: MouseEvent): void => {
        if (suppressNextTableClick) {
            suppressNextTableClick = false;
            return;
        }

        const cell = tableCellFromEvent(event);
        if (cell === null)
            return;

        activateTableRectangle(cell, cell);
    };

    const handleTablePointerDown = (event: PointerEvent): void => {
        const cell = tableCellFromEvent(event);
        if (cell === null)
            return;

        tableDragAnchor = cell;
        suppressNextTableClick = false;
        activateTableRectangle(cell, cell);
    };

    const handleTablePointerOver = (event: PointerEvent): void => {
        if (tableDragAnchor === null || event.buttons === 0)
            return;

        const cell = tableCellFromEvent(event);
        if (cell !== null)
            activateTableRectangle(tableDragAnchor, cell);
    };

    const handleTablePointerUp = (event: PointerEvent): void => {
        const anchor = tableDragAnchor;
        tableDragAnchor = null;
        if (anchor === null)
            return;

        const cell = tableCellFromEvent(event) ?? anchor;
        activateTableRectangle(anchor, cell);
        suppressNextTableClick = cell !== anchor;
    };

    const handleClipboardCopy = (event: Event): void => {
        if (isImageSelectorEvent(event))
            return;

        event.preventDefault();
        enqueueBrowserInput(() => copyOrCut('copy'));
    };

    const handleClipboardCut = (event: Event): void => {
        if (isImageSelectorEvent(event))
            return;

        event.preventDefault();
        enqueueBrowserInput(() => copyOrCut('cut'));
    };

    const handleClipboardPaste = (event: Event): void => {
        if (isImageSelectorEvent(event))
            return;

        event.preventDefault();
        enqueueBrowserInput(pasteFromClipboard);
    };

    const pasteImage = async (
        modelOffset: number,
        image: Readonly<{ src: string; alt?: string }>,
    ): Promise<void> => {
        assertModelOffset(modelOffset);
        const selection = completeSnapshot().selection;
        const caret = Object.freeze({
            offset: modelOffset,
            affinity: 'next' as const,
        });
        await dispatchIntent({
            kind: 'insert-image',
            target: Object.freeze({
                ...selection,
                anchor: caret,
                focus: caret,
            }),
            src: image.src,
            alt: image.alt ?? '',
        });
    };

    const supports = (capability: DocumentCoreCapability): boolean =>
        SUPPORTED_CAPABILITIES.has(capability);

    const insertTableRow = async (modelOffset: number): Promise<void> => {
        assertModelOffset(modelOffset);
        const selection = completeSnapshot().selection;
        const caret = Object.freeze({
            offset: modelOffset,
            affinity: 'next' as const,
        });
        await dispatchIntent({
            kind: 'insert-table-row',
            target: Object.freeze({
                ...selection,
                anchor: caret,
                focus: caret,
            }),
            location: 'after',
        });
    };

    const setListIndentation = async (
        modelOffset: number,
        direction: 'increase' | 'decrease',
    ): Promise<void> => {
        assertModelOffset(modelOffset);
        const selection = completeSnapshot().selection;
        const caret = Object.freeze({
            offset: modelOffset,
            affinity: 'next' as const,
        });
        const result = await session.dispatch({
            kind: 'set-list-indentation',
            target: Object.freeze({
                ...selection,
                anchor: caret,
                focus: caret,
            }),
            direction,
        });
        if (result.kind === 'rejected' && result.reason === 'no-source-change')
            return;

        await settle(Promise.resolve(result));
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

    const subscribeInteraction = (
        listener: (interaction: DocumentViewInteraction) => void,
    ): Disposable => {
        interactionListeners.add(listener);
        return {
            dispose: () => {
                interactionListeners.delete(listener);
            },
        };
    };

    const subscribeTrackChangeRejection = (
        listener: (rejection: ICriticMarkupTrackChangeRejection) => void,
    ): Disposable => {
        trackChangeRejectionListeners.add(listener);
        return {
            dispose: () => {
                trackChangeRejectionListeners.delete(listener);
            },
        };
    };

    // The settled session selection as a plain model range — the one truth a
    // chained burst input targets once the previous commit has published.
    const sessionCaretRange = (): Readonly<{ start: number; end: number }> => {
        const selection = activeSelection();
        return Object.freeze({
            start: Math.min(selection.anchor.offset, selection.focus.offset),
            end: Math.max(selection.anchor.offset, selection.focus.offset),
        });
    };

    const commitBrowserInput = async (
        inputType: string,
        data: string | null,
        range: Readonly<{ start: number; end: number }>,
    ): Promise<void> => {
        const selection = activeSelection();
        let start = range.start;
        let end = range.end;
        if (start === end && inputType === 'deleteContentBackward') {
            const previous = [...modelText().slice(0, start)].at(-1);
            start = Math.max(0, start - (previous?.length ?? 0));
        }
        else if (start === end && inputType === 'deleteContentForward') {
            const next = [...modelText().slice(end)][0];
            end = Math.min(modelText().length, end + (next?.length ?? 0));
        }

        const target = Object.freeze({
            ...selection,
            anchor: { offset: start, affinity: 'next' as const },
            focus: {
                offset: end,
                affinity: start === end
                    ? ('next' as const)
                    : ('previous' as const),
            },
        });

        if (inputType === 'historyUndo') {
            await settle(session.dispatch({ kind: 'undo' }), true);
            return;
        }
        if (inputType === 'historyRedo') {
            await settle(session.dispatch({ kind: 'redo' }), true);
            return;
        }
        if (inputType === 'deleteByCut') {
            return;
        }
        if (inputType === 'insertFromPaste') {
            await pasteTargetFromClipboard(target);
            return;
        }
        if (inputType.startsWith('delete')) {
            if (start === end)
                return;

            await settle(session.dispatch({ kind: 'delete-text', target }), true);
            return;
        }

        if (inputType === 'formatBold') {
            await settle(session.dispatch({
                kind: 'format-text',
                target,
                format: 'strong',
            }), true);
            return;
        }

        if (
            inputType === 'insertParagraph'
            || inputType === 'insertLineBreak'
        ) {
            await settle(session.dispatch({
                kind: inputType === 'insertParagraph'
                    ? 'insert-paragraph-break'
                    : 'insert-line-break',
                target,
            }), true);
            return;
        }

        const inserted = data;
        if (inserted === null) {
            throw new Error(`${inputType} browser input has no text`);
        }

        if (
            inputType === 'insertFromDrop'
            || inputType === 'insertFromYank'
        ) {
            await settle(session.dispatch({
                kind: 'paste-text',
                target,
                text: inserted,
                source: 'external-text',
            }), true);
            return;
        }
        if (inputType === 'insertCompositionText') {
            await settle(session.dispatch({
                kind: 'commit-composition',
                target,
                text: inserted,
            }), true);
            return;
        }
        if (
            inputType !== 'insertText'
            && inputType !== 'insertReplacementText'
        ) {
            throw new Error(`Unsupported browser input type: ${inputType}`);
        }

        const pairedCloser = start === end && inserted.length === 1
            ? (
                autoPairBrackets
                    ? ({ '(': ')', '[': ']', '{': '}' } as const)[
                        inserted as '(' | '[' | '{'
                    ]
                    : undefined
            ) ?? (
                autoPairQuotes
                    ? ({ '"': '"', "'": "'" } as const)[
                        inserted as '"' | "'"
                    ]
                    : undefined
            ) ?? (
                autoPairMarkdown
                    ? ({ '*': '*', '_': '_', '~': '~', '`': '`', '$': '$' } as const)[
                        inserted as '*' | '_' | '~' | '`' | '$'
                    ]
                    : undefined
            )
            : undefined;
        if (
            start === end
            && inserted.length === 1
            && (
                (autoPairBrackets && ')]}'.includes(inserted))
                || (autoPairQuotes && `"'`.includes(inserted))
                || (autoPairMarkdown && '*_~`$'.includes(inserted))
            )
            && modelText().slice(start, start + 1) === inserted
        ) {
            const caret = Object.freeze({
                anchor: Object.freeze({
                    offset: start + 1,
                    affinity: 'next' as const,
                }),
                focus: Object.freeze({
                    offset: start + 1,
                    affinity: 'next' as const,
                }),
            });
            await selectSession(caret);
            restoreSelectionIfCommitted(caret);
            publishSelection();
            return;
        }
        if (pairedCloser !== undefined) {
            await settle(session.dispatch({
                kind: 'insert-text',
                target,
                text: inserted + pairedCloser,
            }), false);
            const caret = Object.freeze({
                anchor: Object.freeze({
                    offset: start + inserted.length,
                    affinity: 'next' as const,
                }),
                focus: Object.freeze({
                    offset: start + inserted.length,
                    affinity: 'next' as const,
                }),
            });
            await selectSession(caret);
            restoreSelectionIfCommitted(caret);
            publishSelection();
            return;
        }

        await settle(session.dispatch(start === end
            ? { kind: 'insert-text', target, text: inserted }
            : { kind: 'replace-text', target, text: inserted }), true);
    };

    const enqueueBrowserInput = (operation: () => Promise<void>): void => {
        const generation = ++browserInputGeneration;
        browserInputIdle = false;
        pendingBrowserInput = pendingBrowserInput
            .then(operation)
            .catch((error: unknown) => {
                browserInputFailure ??= error;
                // A SourceOnly revision mounts no WYSIWYG, so a queued op
                // refused in that state is the view declining its own
                // housekeeping — there is no user gesture to report against.
                if (session.snapshot().kind === 'complete')
                    options.onBrowserInputFailure?.(error);
            })
            .finally(() => {
                if (browserInputGeneration === generation) {
                    browserInputIdle = true;
                    if (destroying) {
                        deferredBrowserSelection = false;
                        return;
                    }
                    if (deferredBrowserSelection) {
                        deferredBrowserSelection = false;
                        synchronizeBrowserSelection();
                    }
                }
            });
    };

    const closeImageSelector = (restoreEditorFocus: boolean): void => {
        imageSelectorWrapper?.remove();
        imageSelectorWrapper = null;
        selectedImageSrc = null;
        for (const selected of host.querySelectorAll<HTMLElement>(
            'img.document-view-image[data-document-selected="true"]',
        )) {
            selected.removeAttribute('data-document-selected');
        }
        if (restoreEditorFocus)
            focus();
    };

    const showImageSelector = (
        target: ModelSelection,
        initial: Readonly<{
            src: string;
            alt: string;
            title: string;
        }>,
        targetNodeId?: string,
        anchor?: HTMLElement,
    ): void => {
        const snapshot = completeSnapshot();
        if (snapshot.projection !== 'marked')
            throw new Error('Image editing requires the editable Markup view');

        const ownedTarget: ModelSelection = Object.freeze({
            ...target,
            anchor: Object.freeze({ ...target.anchor }),
            focus: Object.freeze({ ...target.focus }),
        });
        dismissTransientTools();
        if (anchor !== undefined) {
            anchor.dataset.documentSelected = 'true';
            selectedImageSrc = anchor.getAttribute('src') ?? '';
        }

        const document = host.ownerDocument;
        const wrapper = document.createElement('div');
        wrapper.className = 'document-view-float-wrapper';
        wrapper.setAttribute('contenteditable', 'false');
        wrapper.style.position = 'fixed';
        wrapper.style.opacity = '1';
        if (targetNodeId !== undefined)
            wrapper.dataset.targetNodeId = targetNodeId;

        const form = document.createElement('form');
        form.className = 'document-view-image-selector';
        form.setAttribute('role', 'dialog');
        form.setAttribute('aria-modal', 'false');
        form.dataset.localeKey = 'Edit Image';
        form.setAttribute('aria-label', translate('Edit Image'));
        form.noValidate = true;

        const heading = document.createElement('div');
        heading.className = 'document-view-image-selector-heading';
        heading.dataset.localeKey = 'Edit Image';
        heading.dataset.localeText = 'true';
        heading.setAttribute('aria-label', translate('Edit Image'));
        heading.textContent = translate('Edit Image');
        form.appendChild(heading);

        const field = (
            localeKey: string,
            className: string,
            value: string,
            fieldName: 'src' | 'alt' | 'title',
        ): HTMLInputElement => {
            const label = document.createElement('label');
            label.className = 'document-view-image-selector-field';
            const caption = document.createElement('span');
            caption.dataset.localeKey = localeKey;
            caption.dataset.localeText = 'true';
            caption.setAttribute('aria-label', translate(localeKey));
            caption.textContent = translate(localeKey);
            const input = document.createElement('input');
            input.type = 'text';
            input.name = fieldName;
            input.className = className;
            input.value = value;
            input.dataset.imageField = fieldName;
            input.dataset.localeKey = localeKey;
            input.setAttribute('aria-label', translate(localeKey));
            input.setAttribute('contenteditable', 'false');
            input.autocomplete = 'off';
            if (fieldName === 'src') {
                input.required = true;
                input.inputMode = 'url';
            }
            label.append(caption, input);
            form.appendChild(label);
            return input;
        };

        const src = field(
            'Image link or local path',
            'src',
            initial.src,
            'src',
        );
        const alt = field('Alt text', 'alt', initial.alt, 'alt');
        const title = field(
            'Image title',
            'title',
            initial.title,
            'title',
        );

        const actions = document.createElement('div');
        actions.className = 'document-view-image-selector-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.dataset.imageCommand = 'cancel';
        cancel.dataset.localeKey = 'Cancel';
        cancel.dataset.localeText = 'true';
        cancel.setAttribute('aria-label', translate('Cancel'));
        cancel.textContent = translate('Cancel');
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.dataset.imageCommand = 'submit';
        submit.dataset.localeKey = 'Embed Image';
        submit.dataset.localeText = 'true';
        submit.setAttribute('aria-label', translate('Embed Image'));
        submit.textContent = translate('Embed Image');
        actions.append(cancel, submit);
        form.appendChild(actions);
        wrapper.appendChild(form);

        cancel.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeImageSelector(true);
        });
        form.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape')
                return;

            event.preventDefault();
            event.stopPropagation();
            closeImageSelector(true);
        });
        form.addEventListener('click', event => event.stopPropagation());
        let submitting = false;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextSrc = src.value.trim();
            if (submitting || nextSrc.length === 0) {
                src.focus();
                return;
            }

            submitting = true;
            submit.disabled = true;
            enqueueBrowserInput(async () => {
                try {
                    await settle(session.dispatch({
                        kind: 'insert-image',
                        target: ownedTarget,
                        src: nextSrc,
                        alt: alt.value,
                        ...(title.value.length === 0
                            ? {}
                            : { title: title.value }),
                    }), true);
                    focus();
                }
                finally {
                    submitting = false;
                    if (wrapper.isConnected)
                        submit.disabled = false;
                }
            });
        });

        const window = document.defaultView;
        host.appendChild(wrapper);
        const bounds = anchor?.getBoundingClientRect()
            ?? host.getBoundingClientRect();
        const selectorBounds = wrapper.getBoundingClientRect();
        const selectorWidth = selectorBounds.width || 320;
        const selectorHeight = selectorBounds.height || 224;
        const leftLimit = Math.max(
            8,
            (window?.innerWidth ?? 360) - selectorWidth - 8,
        );
        const topLimit = Math.max(
            8,
            (window?.innerHeight ?? 240) - selectorHeight - 8,
        );
        wrapper.style.left = `${String(Math.max(
            8,
            Math.min(bounds.left, leftLimit),
        ))}px`;
        wrapper.style.top = `${String(Math.max(
            8,
            Math.min(bounds.bottom + 6, topLimit),
        ))}px`;
        imageSelectorWrapper = wrapper;
        // Opened from an existing image, the selector is a companion panel:
        // focus stays on the document so Space previews the selected image and
        // Escape works against the host. Only the insert-new path (menu/IPC,
        // no anchor) starts the user inside the src field.
        if (anchor === undefined) {
            src.focus();
            window?.requestAnimationFrame(() => {
                if (imageSelectorWrapper === wrapper && wrapper.isConnected)
                    src.focus();
            });
        }
    };

    const openImageSelector = async (): Promise<void> => {
        await pendingSelection;
        await commitSelection();
        const snapshot = completeSnapshot();
        showImageSelector(
            snapshot.selection,
            Object.freeze({ src: '', alt: '', title: '' }),
        );
    };

    const isImageSelectorEvent = (event: Event): boolean => {
        const target = event.target;
        return target instanceof Element
            && target.closest('.document-view-image-selector') !== null;
    };

    const handleDocumentMouseDown = (event: MouseEvent): void => {
        const wrapper = imageSelectorWrapper;
        if (wrapper === null)
            return;

        const target = event.target;
        if (target instanceof Node && wrapper.contains(target))
            return;

        closeImageSelector(false);
    };

    const handleBeforeInput = (event: InputEvent): void => {
        if (isImageSelectorEvent(event))
            return;

        // Native contenteditable mutation would make the DOM a competing
        // document authority. Cancel first, then let only a committed session
        // snapshot repaint it.
        event.preventDefault();
        let range: Readonly<{ start: number; end: number }>;
        try {
            range = documentCoreInputRange(host, event);
        }
        catch (error) {
            enqueueBrowserInput(() => Promise.reject(error));
            return;
        }
        const { inputType } = event;
        const data = inputType === 'insertFromPaste'
            ? null
            : event.data
                ?? event.dataTransfer?.getData('text/plain')
                ?? null;
        // While queued browser inputs are still publishing, the mounted DOM —
        // including any selection a settling repaint restored — names a
        // pre-edit publication (the invariant handleBrowserSelection defers
        // on). The session is the selection authority: a chained input
        // resolves its target from the settled session selection when it
        // dequeues — the queue serializes, so the previous commit has
        // published by then. The view predicts no position it then submits
        // (G39: the old width table was wrong by two on CRLF documents).
        const chained = !browserInputIdle;
        if (inputType === 'insertCompositionText') {
            compositionDraft = Object.freeze({
                range: compositionDraft?.range ?? (chained ? null : range),
                text: data ?? '',
            });
            return;
        }
        enqueueBrowserInput(() => commitBrowserInput(
            inputType,
            data,
            chained ? sessionCaretRange() : range,
        ));
    };

    const handleCompositionStart = (event: CompositionEvent): void => {
        if (isImageSelectorEvent(event))
            return;

        compositionDraft = null;
    };

    const handleCompositionEnd = (event: CompositionEvent): void => {
        if (isImageSelectorEvent(event))
            return;

        const draft = compositionDraft;
        compositionDraft = null;
        if (draft === null) {
            enqueueBrowserInput(() => Promise.reject(
                new Error('Composition ended without a browser input target'),
            ));
            return;
        }
        const text = event.data || draft.text;
        enqueueBrowserInput(() => commitBrowserInput(
            'insertCompositionText',
            text,
            draft.range ?? sessionCaretRange(),
        ));
    };

    const handleDocumentToolKeydown = (event: KeyboardEvent): void => {
        if (isImageSelectorEvent(event))
            return;

        if (quickInsertOverlay !== null) {
            const items = [
                ...quickInsertOverlay.querySelectorAll<HTMLButtonElement>(
                    '.document-view-quick-insert-item',
                ),
            ];
            if (
                items.length > 0
                && (
                    event.key === 'ArrowDown'
                    || event.key === 'ArrowUp'
                    || event.key === 'Home'
                    || event.key === 'End'
                )
            ) {
                event.preventDefault();
                event.stopPropagation();
                quickInsertActiveIndex = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                        ? items.length - 1
                        : (
                            quickInsertActiveIndex
                            + (event.key === 'ArrowDown' ? 1 : -1)
                            + items.length
                        ) % items.length;
                items.forEach((item, index) => {
                    item.setAttribute(
                        'aria-selected',
                        index === quickInsertActiveIndex ? 'true' : 'false',
                    );
                });
                const active = items[quickInsertActiveIndex];
                if (active !== undefined) {
                    host.setAttribute('aria-activedescendant', active.id);
                    quickInsertOverlay.querySelector('[role="listbox"]')
                        ?.setAttribute('aria-activedescendant', active.id);
                    active.scrollIntoView({ block: 'nearest' });
                }
                return;
            }
            if (event.key === 'Enter' && items.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                items[quickInsertActiveIndex]?.click();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                clearQuickInsert();
                return;
            }
            if (event.key === 'Tab') {
                clearQuickInsert();
                return;
            }
        }

        if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
            // Tab indents / Shift+Tab outdents the list item under a collapsed
            // caret; outside a list the browser default stands. The engine owns
            // the decision — the DOM check only scopes the key grab.
            const selection = host.ownerDocument.getSelection();
            const origin = selection?.anchorNode ?? null;
            const listItem = origin === null
                ? null
                : (origin instanceof Element ? origin : origin.parentElement)
                    ?.closest('li') ?? null;
            if (
                listItem !== null
                && host.contains(listItem)
                && selection !== null
                && selection.isCollapsed
                && session.snapshot().kind === 'complete'
            ) {
                event.preventDefault();
                event.stopPropagation();
                const direction = event.shiftKey ? 'decrease' : 'increase';
                enqueueBrowserInput(async () => {
                    const range = documentCoreSelectionRange(host);
                    await setListIndentation(range.start, direction);
                });
                return;
            }
        }

        if (
            selectedImageSrc === null
            || (event.key !== ' ' && event.key !== 'Spacebar')
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        for (const listener of interactionListeners) {
            listener(Object.freeze({
                kind: 'preview-image',
                src: selectedImageSrc,
                trigger: 'keyboard',
            }));
        }
    };

    const synchronizeBrowserSelection = (): void => {
        if (destroying || restoringBrowserSelection)
            return;
        if (!documentCoreSelectionIsMounted(host))
            return;

        const range = documentCoreSelectionRange(host);
        const ignored = ignoredProgrammaticSelection;
        ignoredProgrammaticSelection = null;
        const current = activeSelection();
        if (
            ignored !== null
            && ignored.range.start === range.start
            && ignored.range.end === range.end
            && ignored.anchor === current.anchor.offset
            && ignored.focus === current.focus.offset
        ) {
            return;
        }
        if (
            current.anchor.offset === range.start
            && current.focus.offset === range.end
        ) {
            return;
        }
        void selectSession({
            anchor: { offset: range.start, affinity: 'next' },
            focus: {
                offset: range.end,
                affinity: range.start === range.end ? 'next' : 'previous',
            },
        }).then(publishSelection, () => undefined);
    };

    const handleBrowserSelection = (): void => {
        if (restoringBrowserSelection)
            return;
        if (!browserInputIdle) {
            // The mounted range still names the pre-edit publication. Read it
            // only after the admitted input publishes and restores its
            // authoritative browser selection.
            deferredBrowserSelection = true;
            return;
        }
        synchronizeBrowserSelection();
    };

    const settled = async (): Promise<void> => {
        let observedBrowserInput: Promise<void>;
        let observedSelection: Promise<void>;
        do {
            observedBrowserInput = pendingBrowserInput;
            observedSelection = pendingSelection;
            await Promise.all([observedBrowserInput, observedSelection]);
        } while (
            observedBrowserInput !== pendingBrowserInput
            || observedSelection !== pendingSelection
        );
        while (pendingImageResolutions.size > 0) {
            await Promise.allSettled([...pendingImageResolutions]);
        }
        if (browserInputFailure !== undefined) {
            const failure = browserInputFailure;
            browserInputFailure = undefined;
            throw failure;
        }
        if (selectionFailure !== undefined) {
            const failure = selectionFailure;
            selectionFailure = undefined;
            throw failure;
        }
    };

    const destroy = (): Promise<void> => {
        if (destroyPromise !== null)
            return destroyPromise;

        destroying = true;
        deferredBrowserSelection = false;
        host.removeEventListener('beforeinput', handleBeforeInput);
        host.removeEventListener('compositionstart', handleCompositionStart);
        host.removeEventListener('compositionend', handleCompositionEnd);
        host.removeEventListener('click', handleTableCellClick);
        host.removeEventListener('pointerdown', handleTablePointerDown);
        host.removeEventListener('pointerover', handleTablePointerOver);
        host.removeEventListener('pointerup', handleTablePointerUp);
        host.removeEventListener('copy', handleClipboardCopy);
        host.removeEventListener('cut', handleClipboardCut);
        host.removeEventListener('paste', handleClipboardPaste);
        host.removeEventListener('keydown', handleDocumentToolKeydown);
        host.ownerDocument.removeEventListener(
            'selectionchange',
            handleBrowserSelection,
        );
        host.ownerDocument.removeEventListener(
            'mousedown',
            handleDocumentMouseDown,
        );
        for (const request of pendingTableShapeRequests)
            request.abort();
        pendingTableShapeRequests.clear();
        dismissTransientTools();
        forgetDocumentCoreTextPublication(host);
        imageRenderGeneration += 1;
        headingElements = new Map();
        host.removeAttribute('contenteditable');
        host.removeAttribute('role');
        host.removeAttribute('aria-multiline');
        host.removeAttribute('aria-readonly');
        host.removeAttribute('aria-expanded');
        listeners.clear();
        interactionListeners.clear();
        trackChangeRejectionListeners.clear();
        selectionListeners.clear();
        destroyPromise = (async () => {
            let observedBrowserInput: Promise<void>;
            let observedSelection: Promise<void>;
            let observedImages: readonly Promise<void>[];
            do {
                observedBrowserInput = pendingBrowserInput;
                observedSelection = pendingSelection;
                observedImages = [...pendingImageResolutions];
                await Promise.allSettled([
                    observedBrowserInput,
                    observedSelection,
                    ...observedImages,
                ]);
            } while (
                observedBrowserInput !== pendingBrowserInput
                || observedSelection !== pendingSelection
                || pendingImageResolutions.size > 0
            );
            // Pending work is fail-closed once destruction begins. Repeat the
            // teardown for non-publication async work such as image resolution.
            dismissTransientTools();
            forgetDocumentCoreTextPublication(host);
            headingElements = new Map();
            host.removeAttribute('contenteditable');
            host.removeAttribute('role');
            host.removeAttribute('aria-multiline');
            host.removeAttribute('aria-readonly');
            host.removeAttribute('aria-expanded');
            await session.close();
        })();
        return destroyPromise;
    };

    host.setAttribute('contenteditable', 'true');
    host.setAttribute('role', 'textbox');
    host.setAttribute('aria-multiline', 'true');
    host.setAttribute('autocorrect', 'false');
    host.setAttribute('autocomplete', 'off');
    host.addEventListener('beforeinput', handleBeforeInput);
    host.addEventListener('compositionstart', handleCompositionStart);
    host.addEventListener('compositionend', handleCompositionEnd);
    host.addEventListener('click', handleTableCellClick);
    host.addEventListener('pointerdown', handleTablePointerDown);
    host.addEventListener('pointerover', handleTablePointerOver);
    host.addEventListener('pointerup', handleTablePointerUp);
    host.addEventListener('copy', handleClipboardCopy);
    host.addEventListener('cut', handleClipboardCut);
    host.addEventListener('paste', handleClipboardPaste);
    host.addEventListener('keydown', handleDocumentToolKeydown);
    host.ownerDocument.addEventListener(
        'selectionchange',
        handleBrowserSelection,
    );
    host.ownerDocument.addEventListener(
        'mousedown',
        handleDocumentMouseDown,
    );
    render();

    return {
        authorCriticMarkup,
        blur,
        commitSelection,
        deleteRange,
        destroy,
        dispatchIntent,
        executeCommand,
        domNode,
        focus,
        dismissTransientTools,
        openImageSelector,
        requestTable,
        insertTableRow,
        pasteImage,
        reconfigureMarkdownOptions,
        setFocusMode,
        setLocale,
        setListIndentation,
        supports,
        pasteFromClipboard,
        pasteSourceClipboard,
        replaceRange,
        replaceCurrentMatches,
        cutSource,
        editSource,
        insertSourceImage,
        replaceWordAt,
        redo,
        search,
        setSearchDecorations,
        selectAll,
        snapshot: () => session.snapshot(),
        getMarkdown,
        getMarkdownSync,
        getReviewIndex,
        getProjection,
        getSelection,
        getSelectionContext,
        getTrackChanges,
        hasFocus,
        modelText,
        onChange,
        render,
        getTOC,
        resolveHeadingElement,
        attachDocument,
        setOptions,
        setProjection,
        setSelection,
        getSourceSelection,
        setSourceSelection,
        selectSource,
        setCursorByOffset,
        subscribeInteraction,
        subscribeTrackChangeRejection,
        subscribeSelection,
        settled,
        typeText,
        undo,
    };
}
