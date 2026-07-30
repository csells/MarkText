/**
 * Dependency-free public contract for CriticMarkup Review integrations.
 *
 * Keep this module declaration-only: embedders can type-check against the
 * actual view protocol without pulling the desktop's DOM-heavy source
 * graph into their TypeScript program.
 */

export type TCriticMarkupType
    = | 'addition'
        | 'deletion'
        | 'substitution'
        | 'highlight'
        | 'comment';

export type TCriticMarkupAuthorType = TCriticMarkupType;
export type TCriticMarkupNavigationDirection = 'next' | 'previous';
export type TCriticMarkupProjection = 'marked' | 'original' | 'revised';
export type TCriticMarkupDecision = 'accept' | 'reject';
export type TCriticMarkupMarkerName = 'open' | 'separator' | 'close';

export type TCriticMarkupAuthorInput
    = | { type: 'addition' }
        | { type: 'deletion' }
        | { type: 'substitution'; replacement: string }
        | { type: 'highlight' }
        | { type: 'comment'; comment: string };

/** Exact parser identity required by every item-targeted Review command. */
export interface ICriticMarkupCommandTarget {
    readonly revisionId: string;
    readonly nodeId: string;
}

/** Serializable presentation only; never accepted as command authority. */
export interface ICriticMarkupReviewItem {
    readonly id: string;
    readonly type: TCriticMarkupType;
    readonly path: readonly (string | number)[];
    readonly start: number;
    readonly end: number;
    readonly raw: string;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly content?: string;
    /**
     * Exact canonical payload bytes between the annotation's markers,
     * parser-owned. This is what a payload editor must prefill and
     * round-trip byte-identically — `content` on a comment is a projection
     * render and loses any CriticMarkup nested in the payload.
     */
    readonly payloadSource: string;
    readonly oldContent?: string;
    readonly newContent?: string;
    /**
     * A comment's anchor highlight, folded in so the pair reads as one item.
     * `anchorId` is the `{==…==}` highlight's id (so Remove can delete the
     * pair); `anchorText` is its highlighted text (the card's context preview).
     * Absent on non-comment items and on a point comment with no anchor.
     */
    readonly anchorId?: string;
    readonly anchorText?: string;
    /**
     * True when the annotation sits inside a Comment payload: quoted
     * reviewer prose, not an actionable change. The engine rejects every
     * resolution gesture on it, and a Review surface must not arm one.
     */
    readonly withinCommentPayload?: boolean;
}

export interface ICriticMarkupCommandState {
    readonly canCreateAddition: boolean;
    readonly canCreateDeletion: boolean;
    readonly canCreateSubstitution: boolean;
    readonly canCreateHighlight: boolean;
    readonly canCreateComment: boolean;
    readonly canNavigate: boolean;
    readonly canResolveCurrent: boolean;
    readonly canResolveAll: boolean;
    /** True when any Highlight or Comment is removable in bulk. */
    readonly canRemoveAllAnnotations: boolean;
    readonly trackChanges: boolean;
    readonly projection: TCriticMarkupProjection;
}

/** Complete, serializable Review state published by one document revision. */
export interface ICriticMarkupReviewSnapshot
    extends ICriticMarkupCommandState {
    readonly revisionId: string;
    readonly items: readonly ICriticMarkupReviewItem[];
    readonly currentItemId: string | null;
}

export interface ICriticMarkupReviewOptions {
    criticMarkupProjection?: TCriticMarkupProjection;
    criticMarkupTrackChanges?: boolean;
}

/** Canonical command surface, usable independently of event subscriptions. */
export interface ICriticMarkupReviewActions {
    createCriticMarkup: (
        input: TCriticMarkupAuthorInput,
    ) => Promise<boolean>;
    focusCriticMarkup: (
        target: ICriticMarkupCommandTarget,
    ) => ICriticMarkupReviewItem | null;
    navigateCriticMarkup: (
        direction: TCriticMarkupNavigationDirection,
    ) => ICriticMarkupReviewItem | null;
    resolveCriticMarkup: (
        decision: TCriticMarkupDecision,
        target: ICriticMarkupCommandTarget,
    ) => Promise<boolean>;
    resolveAllCriticMarkup: (
        decision: TCriticMarkupDecision,
    ) => Promise<number>;
    /**
     * Resolve every Highlight and Comment at once — highlights unwrap to
     * their text, comments are removed. Returns how many were resolved.
     */
    removeAllCriticMarkupAnnotations: () => Promise<number>;
    editCriticMarkupComment: (
        target: ICriticMarkupCommandTarget,
        text: string,
    ) => Promise<boolean>;
    commitAuthoringSelection: () => void | Promise<void>;
    getCriticMarkupReviewSnapshot: () => ICriticMarkupReviewSnapshot;
    configure: (options: ICriticMarkupReviewOptions) => Promise<void>;
}

/** Compiler-checked protocol shared by the view and its desktop host. */
export interface ICriticMarkupReviewEditor
    extends ICriticMarkupReviewActions {
    getCriticMarkupCommentAtPoint: (
        clientX: number,
        clientY: number,
    ) => ICriticMarkupReviewItem | null;
    subscribeReview: (
        listener: (snapshot: ICriticMarkupReviewSnapshot) => void,
    ) => Readonly<{ dispose: () => void }>;
}
