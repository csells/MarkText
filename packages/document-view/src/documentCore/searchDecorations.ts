import { searchDecorationSegments } from './documentCoreInputAdapter';

/**
 * Presentation-only search-match decoration.
 *
 * Matches paint as attribute-free spans wrapped around the rendered text —
 * `document-view-highlight` for the active match, `document-view-selection`
 * for the rest — so the input adapter's offset math sees them as transparent
 * inline carriers: no model attributes, identical textContent. Painting never
 * touches the session and never fires a document change.
 */

const DECORATION_SELECTOR =
    'span.document-view-highlight, span.document-view-selection';

export function clearSearchDecorations(host: HTMLElement): void {
    const parents = new Set<Node>();
    for (const span of host.querySelectorAll(DECORATION_SELECTOR)) {
        const parent = span.parentNode;
        if (!parent)
            continue;
        while (span.firstChild)
            parent.insertBefore(span.firstChild, span);
        span.remove();
        parents.add(parent);
    }
    // Merge the text nodes the unwrap left behind so repeated repaints do not
    // fragment runs and offset math stays over canonical text.
    for (const parent of parents)
        parent.normalize();
}

export function paintSearchDecorations(
    host: HTMLElement,
    ranges: readonly Readonly<{ start: number; end: number }>[],
    activeIndex: number,
): void {
    clearSearchDecorations(host);
    ranges.forEach((range, index) => {
        // Segments are resolved per range against the current DOM, so slices
        // wrapped for earlier ranges are already accounted for by the walk.
        const segments = searchDecorationSegments(host, range);
        // Apply in reverse document order so splitting a shared text node
        // cannot invalidate an earlier segment's offsets.
        for (const segment of [...segments].reverse()) {
            const { node, start, end } = segment;
            const middle = start === 0 ? node : node.splitText(start);
            if (end - start < middle.data.length)
                middle.splitText(end - start);
            const span = node.ownerDocument.createElement('span');
            span.className = index === activeIndex
                ? 'document-view-highlight'
                : 'document-view-selection';
            middle.parentNode?.replaceChild(span, middle);
            span.appendChild(middle);
        }
    });
}
