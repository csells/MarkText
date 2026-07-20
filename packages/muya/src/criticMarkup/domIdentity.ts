import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
} from './document';

/**
 * Authenticate every parser-owned CriticMarkup identity on a DOM ancestry,
 * ordered from the deepest grammar item outward. A nested non-comment mark can
 * still sit inside a comment anchor, so point queries must not discard the
 * authenticated outer identities after finding the innermost one.
 */
export function criticMarkupItemsFromDomTarget(
    document: CriticMarkupDocument,
    root: Element,
    target: Element | null,
): readonly ICriticMarkupDocumentItem[] {
    if (!target || !root.contains(target))
        return [];

    const items: ICriticMarkupDocumentItem[] = [];
    const seen = new Set<string>();
    let current: Element | null = target;
    while (current && root.contains(current)) {
        const identities = [
            current.getAttribute('data-critic-id'),
            current.getAttribute('data-critic-structural-id'),
        ];
        for (const rawIds of identities) {
            for (const id of rawIds?.trim().split(/\s+/).filter(Boolean) ?? []) {
                if (seen.has(id))
                    continue;
                const item = document.itemById(id);
                if (!item) {
                    throw new TypeError(
                        `CriticMarkup DOM identity ${id} is stale for this revision.`,
                    );
                }
                seen.add(id);
                items.push(item);
            }
        }
        if (current === root)
            break;
        current = current.parentElement;
    }

    return items.sort((left, right) => right.depth - left.depth);
}

/** Resolve the deepest parser-owned CriticMarkup identity represented by DOM. */
export function deepestCriticMarkupItemId(
    document: CriticMarkupDocument,
    root: Element,
    target: Element | null,
): string | null {
    return criticMarkupItemsFromDomTarget(document, root, target)[0]?.id ?? null;
}
