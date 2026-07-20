import type {
    ICriticMarkupItem,
} from './commandSnapshot';
import type {
    ICriticMarkupCommandState,
    ICriticMarkupReviewItem,
    ICriticMarkupReviewSnapshot,
} from './reviewContract';
import { parserOwnedCommandItemContentIsEmpty } from './commandItemMetadata';
import { indexCommentAnchors } from './commentAnchors';

export type {
    ICriticMarkupReviewItem,
    ICriticMarkupReviewSnapshot,
} from './reviewContract';

const REVIEW_ITEM_SOURCES = new WeakMap<
    ICriticMarkupReviewItem,
    ICriticMarkupItem
>();
const REVIEW_ITEM_ANCHORS = new WeakMap<
    ICriticMarkupReviewItem,
    ICriticMarkupItem
>();

function reviewItemSource(item: ICriticMarkupReviewItem): ICriticMarkupItem {
    const source = REVIEW_ITEM_SOURCES.get(item);
    if (!source) {
        throw new TypeError(
            'CriticMarkup Review item has no command-item authority.',
        );
    }
    return source;
}

function reviewContentGetter(
    this: ICriticMarkupReviewItem,
): string | undefined {
    return reviewItemSource(this).content;
}

function reviewOldContentGetter(
    this: ICriticMarkupReviewItem,
): string | undefined {
    return reviewItemSource(this).oldContent;
}

function reviewNewContentGetter(
    this: ICriticMarkupReviewItem,
): string | undefined {
    return reviewItemSource(this).newContent;
}

function reviewAnchorTextGetter(
    this: ICriticMarkupReviewItem,
): string | undefined {
    return REVIEW_ITEM_ANCHORS.get(this)?.content;
}

function reviewItem(item: ICriticMarkupItem): ICriticMarkupReviewItem {
    const review = {
        id: item.id,
        type: item.type,
        path: [...item.path],
        start: item.start,
        end: item.end,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        raw: item.raw,
    } as ICriticMarkupReviewItem;
    REVIEW_ITEM_SOURCES.set(review, item);
    if (item.type === 'substitution') {
        Object.defineProperties(review, {
            oldContent: {
                configurable: false,
                enumerable: true,
                get: reviewOldContentGetter,
            },
            newContent: {
                configurable: false,
                enumerable: true,
                get: reviewNewContentGetter,
            },
        });
    }
    else {
        Object.defineProperty(review, 'content', {
            configurable: false,
            enumerable: true,
            get: reviewContentGetter,
        });
    }
    return review;
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
    const { anchorByCommentId, commentByAnchorId } = indexCommentAnchors(items);

    const reviewItems: ICriticMarkupReviewItem[] = [];
    for (const item of items) {
        if (commentByAnchorId.has(item.id))
            continue;
        const base = reviewItem(item);
        const anchor = anchorByCommentId.get(item.id);
        const anchorIsEmpty = anchor
            ? parserOwnedCommandItemContentIsEmpty(anchor)
                ?? (anchor.type !== 'substitution' && anchor.content === '')
            : false;
        if (anchor && !anchorIsEmpty) {
            REVIEW_ITEM_ANCHORS.set(base, anchor);
            Object.defineProperties(base, {
                anchorId: {
                    configurable: false,
                    enumerable: true,
                    value: anchor.id,
                },
                anchorText: {
                    configurable: false,
                    enumerable: true,
                    get: reviewAnchorTextGetter,
                },
            });
        }
        reviewItems.push(base);
    }

    // A caret in the anchor resolves to the anchor highlight; surface it as the
    // comment it belongs to so the comment card is the one marked active.
    const currentId = currentItem?.id ?? null;
    const currentItemId = currentId !== null
        ? commentByAnchorId.get(currentId)?.id ?? currentId
        : null;

    return {
        ...commandState,
        items: reviewItems,
        currentItemId,
    };
}
