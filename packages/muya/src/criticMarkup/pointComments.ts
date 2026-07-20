import type { TCriticMarkupDocumentToken } from './analysis';

/**
 * Preserve every maximal parser-owned comment subtree inside a disappearing
 * semantic item. A retained comment's raw source already contains its own
 * descendants, so traversal stops there to keep each note exactly once.
 */
export function nestedPointCommentSource(
    owner: TCriticMarkupDocumentToken,
): string {
    const pending = [...(owner.nested ?? [])].reverse();
    let preserved = '';
    while (pending.length) {
        const item = pending.pop()!;
        if (item.type === 'comment') {
            preserved += item.raw;
            continue;
        }
        const nested = item.nested ?? [];
        for (let index = nested.length - 1; index >= 0; index--)
            pending.push(nested[index]);
    }
    return preserved;
}
