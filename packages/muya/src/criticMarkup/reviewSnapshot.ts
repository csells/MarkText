import type {
    ICriticMarkupItem,
} from './commands';
import type {
    ICriticMarkupCommandState,
    ICriticMarkupReviewItem,
    ICriticMarkupReviewSnapshot,
} from './reviewContract';

export type {
    ICriticMarkupReviewItem,
    ICriticMarkupReviewSnapshot,
} from './reviewContract';

function reviewItem(item: ICriticMarkupItem): ICriticMarkupReviewItem {
    return {
        id: item.id,
        type: item.type,
        path: [...item.path],
        start: item.start,
        end: item.end,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        raw: item.raw,
        ...(item.content !== undefined ? { content: item.content } : {}),
        ...(item.oldContent !== undefined
            ? { oldContent: item.oldContent }
            : {}),
        ...(item.newContent !== undefined
            ? { newContent: item.newContent }
            : {}),
    };
}

export function createCriticMarkupReviewSnapshot(
    items: readonly ICriticMarkupItem[],
    currentItem: ICriticMarkupItem | null,
    commandState: ICriticMarkupCommandState,
): ICriticMarkupReviewSnapshot {
    // A comment's anchor is the highlight ending exactly where the comment
    // begins (the gapless `{==sel==}{>>note<<}` the app emits). Fold the pair
    // into a single comment item: the anchor highlight is dropped as a separate
    // entry, and its id/text ride on the comment so the sidebar can preview the
    // anchored text and Remove can delete the pair together.
    const highlightByEnd = new Map<number, ICriticMarkupItem>();
    for (const item of items) {
        if (item.type === 'highlight' && item.sourceEnd !== undefined)
            highlightByEnd.set(item.sourceEnd, item);
    }
    const anchorByComment = new Map<string, ICriticMarkupItem>();
    const commentByAnchor = new Map<string, string>();
    for (const item of items) {
        if (item.type !== 'comment' || item.sourceStart === undefined)
            continue;
        const anchor = highlightByEnd.get(item.sourceStart);
        if (anchor) {
            anchorByComment.set(item.id, anchor);
            commentByAnchor.set(anchor.id, item.id);
        }
    }

    const reviewItems: ICriticMarkupReviewItem[] = [];
    for (const item of items) {
        if (commentByAnchor.has(item.id))
            continue;
        const base = reviewItem(item);
        const anchor = anchorByComment.get(item.id);
        reviewItems.push(anchor
            ? { ...base, anchorId: anchor.id, anchorText: anchor.content }
            : base);
    }

    // A caret in the anchor resolves to the anchor highlight; surface it as the
    // comment it belongs to so the comment card is the one marked active.
    const currentId = currentItem?.id ?? null;
    const currentItemId = currentId !== null
        ? commentByAnchor.get(currentId) ?? currentId
        : null;

    return {
        ...commandState,
        items: reviewItems,
        currentItemId,
    };
}
