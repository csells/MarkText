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
    return {
        ...commandState,
        items: items.map(reviewItem),
        currentItemId: currentItem?.id ?? null,
    };
}
