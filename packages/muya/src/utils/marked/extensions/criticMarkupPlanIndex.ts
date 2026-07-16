import type { MarkedSourceView, Tokens } from 'marked';
import { upperBound } from '../../../mapped-range';

/**
 * Per-parser-artifact lookup structures for the native CriticMarkup
 * adapter. Marker ranges, plan starts, and line boundaries are computed
 * once per prepared extension; every per-token and per-cursor query is an
 * exact map hit or a binary search instead of a scan of the complete set.
 */

export interface ICriticMarkupMarkerIndex {
    /** All marker ranges in ascending source order. */
    readonly ranges: readonly Tokens.CriticMarkupRange[];
    startingAt: (offset: number) => Tokens.CriticMarkupRange | undefined;
    endingAt: (offset: number) => Tokens.CriticMarkupRange | undefined;
}

export function criticMarkupMarkerIndex(
    ranges: readonly Tokens.CriticMarkupRange[],
): ICriticMarkupMarkerIndex {
    const byStart = new Map<number, Tokens.CriticMarkupRange>();
    const byEnd = new Map<number, Tokens.CriticMarkupRange>();
    for (const range of ranges) {
        byStart.set(range.start, range);
        byEnd.set(range.end, range);
    }
    return Object.freeze({
        ranges,
        startingAt: (offset: number) => byStart.get(offset),
        endingAt: (offset: number) => byEnd.get(offset),
    });
}

export interface ISourceLineIndex {
    /** Offset of the first byte of the line containing `offset`. */
    lineStartAt: (offset: number) => number;
    /** Offset of the `\n` terminating the line, or the source length. */
    lineEndAt: (offset: number) => number;
}

interface IViewOffsetIndex {
    readonly spans: MarkedSourceView<object>['spans'];
    readonly boundaryByDocument: ReadonlyMap<number, number>;
    /** First byte of the view's document envelope, or null when empty. */
    readonly documentStart: number | null;
    /** One past the last byte of the view's document envelope. */
    readonly documentEnd: number | null;
}

const viewOffsetIndexes = new WeakMap<object, IViewOffsetIndex>();

function viewOffsetIndexFor(
    view: MarkedSourceView<object>,
): IViewOffsetIndex {
    const existing = viewOffsetIndexes.get(view);
    if (existing)
        return existing;
    const boundaryByDocument = new Map<number, number>();
    for (const boundary of view.boundaries)
        boundaryByDocument.set(boundary.documentOffset, boundary.viewOffset);
    const index: IViewOffsetIndex = Object.freeze({
        spans: view.spans,
        boundaryByDocument,
        documentStart: view.spans.length
            ? view.spans[0].documentStart
            : null,
        documentEnd: view.spans.length
            ? view.spans[view.spans.length - 1].documentEnd
            : null,
    });
    viewOffsetIndexes.set(view, index);
    return index;
}

/**
 * Map one canonical document offset into a recursive parser view. Spans are
 * consulted by binary search over their ascending document envelopes; exact
 * boundary offsets (zero-width cuts) resolve through a prebuilt map. The
 * per-view index is memoized on the immutable view object.
 */
export function viewOffsetForDocumentOffset(
    view: MarkedSourceView<object>,
    documentOffset: number,
): number | null {
    const index = viewOffsetIndexFor(view);
    const { spans } = index;
    // First span whose documentEnd >= documentOffset — earlier spans end
    // before the offset, later spans start after it, so this is the only
    // candidate and matches the previous first-match scan order.
    const candidate = spans[upperBound(
        spans,
        documentOffset - 1,
        span => span.documentEnd,
    )];
    if (
        candidate
        && candidate.documentStart <= documentOffset
        && documentOffset <= candidate.documentEnd
    ) {
        return candidate.viewStart + documentOffset - candidate.documentStart;
    }
    return index.boundaryByDocument.get(documentOffset) ?? null;
}

/** The document envelope [start, end] this view was cut from, if any. */
export function viewDocumentEnvelope(
    view: MarkedSourceView<object>,
): { readonly start: number; readonly end: number } | null {
    const index = viewOffsetIndexFor(view);
    return index.documentStart === null || index.documentEnd === null
        ? null
        : { start: index.documentStart, end: index.documentEnd };
}

export function sourceLineIndex(source: string): ISourceLineIndex {
    const newlines: number[] = [];
    for (let index = source.indexOf('\n'); index >= 0;
        index = source.indexOf('\n', index + 1)) {
        newlines.push(index);
    }
    return Object.freeze({
        lineStartAt: (offset: number) => {
            const before = upperBound(
                newlines,
                offset - 1,
                newline => newline,
            );
            return before > 0 ? newlines[before - 1] + 1 : 0;
        },
        lineEndAt: (offset: number) => {
            const at = upperBound(newlines, offset - 1, newline => newline);
            return at < newlines.length ? newlines[at] : source.length;
        },
    });
}
