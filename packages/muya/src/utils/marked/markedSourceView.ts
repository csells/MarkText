import type { MarkedSourceView } from 'marked';
import type { TBrandedMappedTextPath } from '../../mapped-range';
import type {
    IMappedTextBoundary,
    IMappedTextSpan,
} from '../../mappedText';
import type { IMarkdownSourceMapPiece } from '../../state/stateToMarkdown';
import {
    lowerBound,
    mappedTextPath,
    upperBound,
} from '../../mapped-range';
import { localOffset, SourceMap, sourceOffset } from '../../mappedText';

export type TMarkedParserPath = TBrandedMappedTextPath<'marked-parser-path'>;

export function markedParserPath(path: readonly (string | number)[]): TMarkedParserPath {
    return mappedTextPath<'marked-parser-path'>(path);
}

const PARSER_VIEW_PATH = markedParserPath(['marked-parser-view']);

/** Exact parser-facing bytes plus their identity back to the Markdown source. */
export interface IMarkedSourceView {
    text: string;
    sourceMap: SourceMap<TMarkedParserPath>;
}

export interface ISourceRange {
    start: number;
    end: number;
}

/** Convert parser-owned provenance without reconstructing token source. */
export function markedProvenanceSourceView(
    view: MarkedSourceView<object>,
): IMarkedSourceView {
    return {
        text: view.text,
        sourceMap: new SourceMap(
            view.spans.map(span => ({
                path: PARSER_VIEW_PATH,
                localStart: localOffset(span.viewStart),
                localEnd: localOffset(span.viewEnd),
                sourceStart: sourceOffset(span.documentStart),
                sourceEnd: sourceOffset(span.documentEnd),
            })),
            [],
            view.boundaries.map(boundary => ({
                path: PARSER_VIEW_PATH,
                localOffset: localOffset(boundary.viewOffset),
                sourceOffset: sourceOffset(boundary.documentOffset),
            })),
        ),
    };
}

export function sliceView(
    view: IMarkedSourceView,
    start: number,
    end: number,
): IMarkedSourceView {
    return sliceViewFromSpan(view, start, end).view;
}

interface ISlicedMarkedSourceView {
    view: IMarkedSourceView;
    /** First parent span that can overlap a later slice beginning at `end`. */
    nextSpan: number;
}

function assertSliceRange(
    view: IMarkedSourceView,
    start: number,
    end: number,
): void {
    if (
        !Number.isInteger(start)
        || !Number.isInteger(end)
        || start < 0
        || end < start
        || end > view.text.length
    ) {
        throw new RangeError(
            'Marked source-view slice must be a forward range inside its text.',
        );
    }
}

function firstSpanEndingAfterLocal(
    spans: readonly IMappedTextSpan<TMarkedParserPath>[],
    offset: number,
): number {
    return upperBound(spans, offset, span => span.localEnd);
}

/** Clip an indexed local range, optionally resuming a monotonic token walk. */
function sliceViewFromSpan(
    view: IMarkedSourceView,
    start: number,
    end: number,
    fromSpan?: number,
): ISlicedMarkedSourceView {
    assertSliceRange(view, start, end);
    const parentSpans = view.sourceMap.spans;
    let index = fromSpan === undefined
        ? firstSpanEndingAfterLocal(parentSpans, start)
        : fromSpan;
    while (index < parentSpans.length && parentSpans[index].localEnd <= start)
        index++;

    const spans: IMappedTextSpan<TMarkedParserPath>[] = [];
    if (start === end) {
        return {
            view: {
                text: '',
                sourceMap: new SourceMap(spans),
            },
            nextSpan: index,
        };
    }
    while (index < parentSpans.length) {
        const span = parentSpans[index];
        if (span.localStart >= end)
            break;
        const clippedStart = Math.max(span.localStart, start);
        const clippedEnd = Math.min(span.localEnd, end);
        if (clippedStart >= clippedEnd) {
            index++;
            continue;
        }
        spans.push({
            path: PARSER_VIEW_PATH,
            localStart: localOffset(clippedStart - start),
            localEnd: localOffset(clippedEnd - start),
            sourceStart: sourceOffset(span.sourceStart + clippedStart - span.localStart),
            sourceEnd: sourceOffset(span.sourceStart + clippedEnd - span.localStart),
        });
        if (end < span.localEnd)
            break;
        index++;
    }

    const boundaries: IMappedTextBoundary<TMarkedParserPath>[] = [];
    const parentBoundaries = view.sourceMap.boundaries ?? [];
    const firstBoundary = lowerBound(
        parentBoundaries,
        start,
        boundary => boundary.localOffset,
    );
    if (
        spans[0]?.localStart !== 0
        && parentBoundaries[firstBoundary]?.localOffset !== start
        && typeof view.sourceMap.localToSource === 'function'
    ) {
        const mappedStart = view.sourceMap.localToSource(
            PARSER_VIEW_PATH,
            localOffset(start),
            'previous',
        ) ?? view.sourceMap.localToSource(
            PARSER_VIEW_PATH,
            localOffset(start),
            'next',
        );
        if (mappedStart !== null) {
            boundaries.push({
                path: PARSER_VIEW_PATH,
                localOffset: localOffset(0),
                sourceOffset: mappedStart,
            });
        }
    }
    for (
        let boundaryIndex = firstBoundary;
        boundaryIndex < parentBoundaries.length
        && parentBoundaries[boundaryIndex].localOffset <= end;
        boundaryIndex++
    ) {
        const boundary = parentBoundaries[boundaryIndex];
        boundaries.push({
            path: PARSER_VIEW_PATH,
            localOffset: localOffset(boundary.localOffset - start),
            sourceOffset: boundary.sourceOffset,
        });
    }

    return {
        view: {
            text: view.text.slice(start, end),
            sourceMap: new SourceMap(spans, [], boundaries),
        },
        nextSpan: index,
    };
}

export function concatViews(views: readonly IMarkedSourceView[]): IMarkedSourceView {
    const spans: IMappedTextSpan<TMarkedParserPath>[] = [];
    const boundaries: IMappedTextBoundary<TMarkedParserPath>[] = [];
    let localBase = 0;
    for (const view of views) {
        for (const span of view.sourceMap.spans) {
            spans.push({
                path: PARSER_VIEW_PATH,
                localStart: localOffset(span.localStart + localBase),
                localEnd: localOffset(span.localEnd + localBase),
                sourceStart: span.sourceStart,
                sourceEnd: span.sourceEnd,
            });
        }
        for (const boundary of view.sourceMap.boundaries) {
            boundaries.push({
                path: PARSER_VIEW_PATH,
                localOffset: localOffset(
                    boundary.localOffset + localBase,
                ),
                sourceOffset: boundary.sourceOffset,
            });
        }
        localBase += view.text.length;
    }
    return {
        text: views.map(view => view.text).join(''),
        sourceMap: new SourceMap(spans, [], boundaries),
    };
}

export function sourceMapPieces(view: IMarkedSourceView): IMarkdownSourceMapPiece[] {
    const pieces: IMarkdownSourceMapPiece[] = [];
    for (const span of view.sourceMap.spans) {
        const previous = pieces.at(-1);
        if (previous && previous.localEnd === span.localStart
            && previous.sourceEnd === span.sourceStart) {
            previous.localEnd = span.localEnd;
            previous.sourceEnd = span.sourceEnd;
        }
        else {
            pieces.push({
                localStart: span.localStart,
                localEnd: span.localEnd,
                sourceStart: span.sourceStart,
                sourceEnd: span.sourceEnd,
            });
        }
    }
    return pieces;
}

export function sourceRange(
    view: IMarkedSourceView,
    start = 0,
    end = view.text.length,
): ISourceRange | null {
    if (start >= end)
        return null;
    const mappedStart = view.sourceMap.localToSource(
        PARSER_VIEW_PATH,
        localOffset(start),
        'next',
    );
    const mappedEnd = view.sourceMap.localToSource(
        PARSER_VIEW_PATH,
        localOffset(end),
        'previous',
    );
    if (mappedStart === null || mappedEnd === null)
        throw new RangeError('Marked source view does not cover the requested range.');
    return { start: mappedStart, end: mappedEnd };
}
