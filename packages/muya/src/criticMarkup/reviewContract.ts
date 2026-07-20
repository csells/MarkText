/**
 * Dependency-free public contract for CriticMarkup Review integrations.
 *
 * Keep this module declaration-only: embedders can type-check against the
 * actual Muya-owned protocol without pulling the editor's DOM-heavy source
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

export interface ICriticMarkupTarget {
    readonly path: readonly (string | number)[];
    readonly start: number;
    readonly end: number;
    readonly raw: string;
    /** Canonical whole-document offsets, present on native document items. */
    readonly sourceStart?: number;
    readonly sourceEnd?: number;
}

export type TCriticMarkupFocusTarget = string | ICriticMarkupTarget;

export interface ICriticMarkupCommandState {
    readonly canCreateAddition: boolean;
    readonly canCreateDeletion: boolean;
    readonly canCreateSubstitution: boolean;
    readonly canCreateHighlight: boolean;
    readonly canCreateComment: boolean;
    readonly canResolveCurrent: boolean;
    readonly canResolveAll: boolean;
    readonly trackChanges: boolean;
    readonly projection: TCriticMarkupProjection;
}

export interface ICriticMarkupReviewItem extends ICriticMarkupTarget {
    readonly id: string;
    readonly type: TCriticMarkupType;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly content?: string;
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
}

/** Complete, serializable Review state published by one Muya revision. */
export interface ICriticMarkupReviewSnapshot
    extends ICriticMarkupCommandState {
    readonly items: readonly ICriticMarkupReviewItem[];
    readonly currentItemId: string | null;
}

export interface ICriticMarkupReviewOptions {
    criticMarkupProjection?: TCriticMarkupProjection;
    criticMarkupTrackChanges?: boolean;
}

/** Canonical command surface, usable independently of event subscriptions. */
export interface ICriticMarkupReviewActions {
    createCriticMarkup: (input: TCriticMarkupAuthorInput) => boolean;
    focusCriticMarkup: (
        target: TCriticMarkupFocusTarget,
    ) => ICriticMarkupReviewItem | null;
    navigateCriticMarkup: (
        direction: TCriticMarkupNavigationDirection,
    ) => ICriticMarkupReviewItem | null;
    resolveCriticMarkup: (
        decision: TCriticMarkupDecision,
        target?: ICriticMarkupTarget,
    ) => boolean;
    resolveAllCriticMarkup: (decision: TCriticMarkupDecision) => number;
    editCriticMarkupComment: (
        target: ICriticMarkupTarget,
        text: string,
    ) => boolean;
    commitAuthoringSelection: () => void;
    getCriticMarkupReviewSnapshot: () => ICriticMarkupReviewSnapshot;
    setOptions: (options: ICriticMarkupReviewOptions, forceRender?: boolean) => void;
}

/** Compiler-checked protocol shared by Muya and its desktop embedder. */
export interface ICriticMarkupReviewEditor
    extends ICriticMarkupReviewActions {
    getCriticMarkupCommentAtPoint: (
        clientX: number,
        clientY: number,
    ) => ICriticMarkupReviewItem | null;
    on: (
        event: 'critic-markup-review-change',
        listener: (snapshot: ICriticMarkupReviewSnapshot) => void,
    ) => void;
    off: (
        event: 'critic-markup-review-change',
        listener: (snapshot: ICriticMarkupReviewSnapshot) => void,
    ) => void;
}
