/**
 * Source-adjacent `{==anchor==}{>>comment<<}` pairs are one logical Review
 * item even though the CriticMarkup grammar correctly keeps both native items.
 * Keep that derived, revision-local relationship in one index so navigation,
 * snapshots, and commands cannot disagree about which comment owns an anchor.
 */
export interface ICommentAnchorCandidate {
    readonly id: string;
    readonly type: string;
    readonly sourceStart?: number;
    readonly sourceEnd?: number;
}

export interface ICommentAnchorIndex<T extends ICommentAnchorCandidate> {
    readonly anchorByCommentId: ReadonlyMap<string, T>;
    readonly commentByAnchorId: ReadonlyMap<string, T>;
}

export function indexCommentAnchors<T extends ICommentAnchorCandidate>(
    items: readonly T[],
): ICommentAnchorIndex<T> {
    const highlightByEnd = new Map<number, T>();
    for (const item of items) {
        if (item.type === 'highlight' && item.sourceEnd !== undefined)
            highlightByEnd.set(item.sourceEnd, item);
    }

    const anchorByCommentId = new Map<string, T>();
    const commentByAnchorId = new Map<string, T>();
    for (const item of items) {
        if (item.type !== 'comment' || item.sourceStart === undefined)
            continue;
        const anchor = highlightByEnd.get(item.sourceStart);
        if (!anchor)
            continue;
        anchorByCommentId.set(item.id, anchor);
        commentByAnchorId.set(anchor.id, item);
    }

    return { anchorByCommentId, commentByAnchorId };
}
