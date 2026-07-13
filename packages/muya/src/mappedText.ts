import type { TMappedTextPath } from './mapped-range';
import {
    lowerBound,
    MappedPathIndex,
    mappedPathsEqual,
    upperBound,
} from './mapped-range';

export type {
    TBrandedMappedTextPath,
    TMappedTextPath,
} from './mapped-range';
export { mappedTextPath } from './mapped-range';

declare const LOCAL_OFFSET_BRAND: unique symbol;
declare const SOURCE_OFFSET_BRAND: unique symbol;

/** UTF-16 offset in one mapped leaf's local text. */
export type TLocalOffset = number & {
    readonly [LOCAL_OFFSET_BRAND]: 'local-offset';
};

/** UTF-16 offset in the complete serialized source. */
export type TSourceOffset = number & {
    readonly [SOURCE_OFFSET_BRAND]: 'source-offset';
};

/** Which identity span owns a position separated by generated source text. */
export type TBoundaryAffinity = 'previous' | 'next';

export interface IMappedTextSpan<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly localStart: TLocalOffset;
    readonly localEnd: TLocalOffset;
    readonly sourceStart: TSourceOffset;
    readonly sourceEnd: TSourceOffset;
}

export interface IMappedTextNode<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly sourceStart: TSourceOffset;
    readonly sourceEnd: TSourceOffset;
}

export interface IMappedTextBoundary<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly localOffset: TLocalOffset;
    readonly sourceOffset: TSourceOffset;
}

export interface ILocalPosition<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly offset: TLocalOffset;
}

export interface ISourceRange {
    readonly start: TSourceOffset;
    readonly end: TSourceOffset;
}

/** Half-open UTF-16 range in one mapped leaf's local text. */
export interface ILocalRange {
    readonly start: TLocalOffset;
    readonly end: TLocalOffset;
}

export type TLocalRange = Readonly<ILocalRange>;
export type TSourceRange = Readonly<ISourceRange>;

interface IMutablePathLookupIndex<Path extends TMappedTextPath> {
    readonly spans: IMappedTextSpan<Path>[];
    readonly firstSpanByLocalEnd: Map<number, IMappedTextSpan<Path>>;
    readonly lastSpanByLocalEnd: Map<number, IMappedTextSpan<Path>>;
    readonly firstBoundaryByLocalOffset: Map<
        number,
        IMappedTextBoundary<Path>
    >;
    readonly lastBoundaryByLocalOffset: Map<
        number,
        IMappedTextBoundary<Path>
    >;
}

interface IPathLookupIndex<Path extends TMappedTextPath> {
    readonly spans: readonly IMappedTextSpan<Path>[];
    readonly firstSpanByLocalEnd: ReadonlyMap<
        number,
        IMappedTextSpan<Path>
    >;
    readonly lastSpanByLocalEnd: ReadonlyMap<
        number,
        IMappedTextSpan<Path>
    >;
    readonly firstBoundaryByLocalOffset: ReadonlyMap<
        number,
        IMappedTextBoundary<Path>
    >;
    readonly lastBoundaryByLocalOffset: ReadonlyMap<
        number,
        IMappedTextBoundary<Path>
    >;
    readonly range: ISourceRange | null;
}

function assertOffset(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0)
        throw new RangeError(`${label} must be a non-negative integer.`);
}

/** Brand a checked leaf-local UTF-16 offset. */
export function localOffset(value: number): TLocalOffset {
    assertOffset(value, 'Local offset');

    return value as TLocalOffset;
}

/** Brand a checked serialized-source UTF-16 offset. */
export function sourceOffset(value: number): TSourceOffset {
    assertOffset(value, 'Source offset');

    return value as TSourceOffset;
}

/** Enter the checked leaf-local half-open range domain. */
export function localRange(start: number, end: number): TLocalRange {
    if (end < start)
        throw new RangeError('Local range end must not precede its start.');

    return Object.freeze({
        start: localOffset(start),
        end: localOffset(end),
    });
}

/** Enter the checked serialized-source half-open range domain. */
export function sourceRange(start: number, end: number): TSourceRange {
    if (end < start)
        throw new RangeError('Source range end must not precede its start.');

    return Object.freeze({
        start: sourceOffset(start),
        end: sourceOffset(end),
    });
}

function clonePath<Path extends TMappedTextPath>(path: Path): Path {
    // A spread clone preserves a branded tuple's ordered scalar members, but
    // TypeScript cannot express that generic tuple relationship through
    // Object.freeze. Keep the unsafe boundary isolated in this named helper.
    // eslint-disable-next-line no-restricted-syntax
    return Object.freeze([...path]) as unknown as Path;
}

function freezeSpan<Path extends TMappedTextPath>(
    span: IMappedTextSpan<Path>,
): IMappedTextSpan<Path> {
    return Object.freeze({
        path: clonePath(span.path),
        localStart: localOffset(span.localStart),
        localEnd: localOffset(span.localEnd),
        sourceStart: sourceOffset(span.sourceStart),
        sourceEnd: sourceOffset(span.sourceEnd),
    });
}

function freezeNode<Path extends TMappedTextPath>(
    node: IMappedTextNode<Path>,
): IMappedTextNode<Path> {
    return Object.freeze({
        path: clonePath(node.path),
        sourceStart: sourceOffset(node.sourceStart),
        sourceEnd: sourceOffset(node.sourceEnd),
    });
}

function freezeBoundary<Path extends TMappedTextPath>(
    boundary: IMappedTextBoundary<Path>,
): IMappedTextBoundary<Path> {
    return Object.freeze({
        path: clonePath(boundary.path),
        localOffset: localOffset(boundary.localOffset),
        sourceOffset: sourceOffset(boundary.sourceOffset),
    });
}

function freezeRange(start: number, end: number): ISourceRange {
    return Object.freeze({
        start: sourceOffset(start),
        end: sourceOffset(end),
    });
}

function mutablePathLookup<Path extends TMappedTextPath>(
    indexes: MappedPathIndex<Path, IMutablePathLookupIndex<Path>>,
    path: Path,
): IMutablePathLookupIndex<Path> {
    const existing = indexes.get(path);
    if (existing)
        return existing;

    const created: IMutablePathLookupIndex<Path> = {
        spans: [],
        firstSpanByLocalEnd: new Map(),
        lastSpanByLocalEnd: new Map(),
        firstBoundaryByLocalOffset: new Map(),
        lastBoundaryByLocalOffset: new Map(),
    };
    indexes.set(path, created);

    return created;
}

function buildPathLookupIndexes<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
    boundaries: readonly IMappedTextBoundary<Path>[],
): MappedPathIndex<Path, IPathLookupIndex<Path>> {
    const mutable = new MappedPathIndex<Path, IMutablePathLookupIndex<Path>>();

    for (const span of spans) {
        const index = mutablePathLookup(mutable, span.path);
        index.spans.push(span);
        if (!index.firstSpanByLocalEnd.has(span.localEnd))
            index.firstSpanByLocalEnd.set(span.localEnd, span);
        index.lastSpanByLocalEnd.set(span.localEnd, span);
    }
    for (const boundary of boundaries) {
        const index = mutablePathLookup(mutable, boundary.path);
        if (!index.firstBoundaryByLocalOffset.has(boundary.localOffset)) {
            index.firstBoundaryByLocalOffset.set(
                boundary.localOffset,
                boundary,
            );
        }
        index.lastBoundaryByLocalOffset.set(
            boundary.localOffset,
            boundary,
        );
    }

    const indexes = new MappedPathIndex<Path, IPathLookupIndex<Path>>();
    for (const [path, index] of mutable.entries()) {
        const first = index.spans[0];
        const last = index.spans.at(-1);
        indexes.set(path, Object.freeze({
            spans: Object.freeze(index.spans),
            firstSpanByLocalEnd: index.firstSpanByLocalEnd,
            lastSpanByLocalEnd: index.lastSpanByLocalEnd,
            firstBoundaryByLocalOffset: index.firstBoundaryByLocalOffset,
            lastBoundaryByLocalOffset: index.lastBoundaryByLocalOffset,
            range: first && last
                ? freezeRange(first.sourceStart, last.sourceEnd)
                : null,
        }));
    }

    return indexes;
}

function buildFirstBoundaryBySourceOffset<Path extends TMappedTextPath>(
    boundaries: readonly IMappedTextBoundary<Path>[],
): ReadonlyMap<number, IMappedTextBoundary<Path>> {
    const index = new Map<number, IMappedTextBoundary<Path>>();
    for (const boundary of boundaries) {
        if (!index.has(boundary.sourceOffset))
            index.set(boundary.sourceOffset, boundary);
    }

    return index;
}

function buildFirstSpanBySourceEnd<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
): ReadonlyMap<number, IMappedTextSpan<Path>> {
    const index = new Map<number, IMappedTextSpan<Path>>();
    for (const span of spans) {
        if (!index.has(span.sourceEnd))
            index.set(span.sourceEnd, span);
    }

    return index;
}

function buildNodeRangeIndex<Path extends TMappedTextPath>(
    nodes: readonly IMappedTextNode<Path>[],
): MappedPathIndex<Path, ISourceRange> {
    const extrema = new MappedPathIndex<Path, { start: number; end: number }>();
    for (const node of nodes) {
        const existing = extrema.get(node.path);
        if (existing) {
            existing.start = Math.min(existing.start, node.sourceStart);
            existing.end = Math.max(existing.end, node.sourceEnd);
        }
        else {
            extrema.set(node.path, {
                start: node.sourceStart,
                end: node.sourceEnd,
            });
        }
    }

    const index = new MappedPathIndex<Path, ISourceRange>();
    for (const [path, range] of extrema.entries())
        index.set(path, freezeRange(range.start, range.end));

    return index;
}

type TSpanCoordinate = 'localStart' | 'sourceStart' | 'sourceEnd';

function lastSpanAtOrBefore<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
    offset: number,
    coordinate: TSpanCoordinate,
): IMappedTextSpan<Path> | undefined {
    const index = upperBound(spans, offset, span => span[coordinate]);
    return index === 0 ? undefined : spans[index - 1];
}

function firstSpanAtOrAfter<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
    offset: number,
    coordinate: 'sourceStart',
): IMappedTextSpan<Path> | undefined {
    return spans[lowerBound(spans, offset, span => span[coordinate])];
}

function validateSpans<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
): void {
    let previousSourceEnd = 0;
    const previousByPath = new MappedPathIndex<
        Path,
        { localEnd: number; sourceEnd: number }
    >();

    for (const [index, span] of spans.entries()) {
        assertOffset(span.localStart, 'Mapped local start');
        assertOffset(span.localEnd, 'Mapped local end');
        assertOffset(span.sourceStart, 'Mapped source start');
        assertOffset(span.sourceEnd, 'Mapped source end');

        const localLength = span.localEnd - span.localStart;
        const sourceLength = span.sourceEnd - span.sourceStart;
        if (localLength < 0 || sourceLength < 0) {
            throw new RangeError(
                'Mapped text spans must use forward half-open ranges.',
            );
        }
        if (localLength !== sourceLength) {
            throw new TypeError(
                'Mapped text spans must map equal-length ranges.',
            );
        }
        if (index > 0 && span.sourceStart < previousSourceEnd) {
            throw new RangeError(
                'Mapped text source spans must be ordered and non-overlapping.',
            );
        }

        const previous = previousByPath.get(span.path);
        if (
            previous
            && (
                span.localStart < previous.localEnd
                || span.sourceStart < previous.sourceEnd
            )
        ) {
            throw new RangeError(
                'Mapped spans for one path must be ordered and non-overlapping.',
            );
        }

        previousSourceEnd = span.sourceEnd;
        previousByPath.set(span.path, {
            localEnd: span.localEnd,
            sourceEnd: span.sourceEnd,
        });
    }
}

/**
 * Collapse representation-only fragmentation without crossing a path or a
 * generated-source/local gap. The two half-open identity mappings are exactly
 * equivalent to their union only when both coordinate domains are adjacent.
 */
function coalesceIdentitySpans<Path extends TMappedTextPath>(
    spans: readonly IMappedTextSpan<Path>[],
): IMappedTextSpan<Path>[] {
    const result: IMappedTextSpan<Path>[] = [];
    for (const span of spans) {
        const previous = result.at(-1);
        if (
            previous
            && mappedPathsEqual(previous.path, span.path)
            && previous.localEnd === span.localStart
            && previous.sourceEnd === span.sourceStart
        ) {
            result[result.length - 1] = {
                path: previous.path,
                localStart: previous.localStart,
                localEnd: span.localEnd,
                sourceStart: previous.sourceStart,
                sourceEnd: span.sourceEnd,
            };
        }
        else {
            result.push(span);
        }
    }

    return result;
}

/**
 * Immutable bidirectional index for identity-mapped source spans.
 * Structural source text is deliberately absent from the index.
 */
export class SourceMap<Path extends TMappedTextPath> {
    readonly spans: readonly IMappedTextSpan<Path>[];
    readonly nodes: readonly IMappedTextNode<Path>[];
    readonly boundaries: readonly IMappedTextBoundary<Path>[];

    readonly #pathLookupIndexes: MappedPathIndex<
        Path,
        IPathLookupIndex<Path>
    >;

    readonly #firstBoundaryBySourceOffset: ReadonlyMap<
        number,
        IMappedTextBoundary<Path>
    >;

    readonly #firstSpanBySourceEnd: ReadonlyMap<
        number,
        IMappedTextSpan<Path>
    >;

    readonly #nodeRangeByPath: MappedPathIndex<Path, ISourceRange>;

    constructor(
        spans: readonly IMappedTextSpan<Path>[],
        nodes: readonly IMappedTextNode<Path>[] = [],
        boundaries: readonly IMappedTextBoundary<Path>[] = [],
    ) {
        validateSpans(spans);
        this.spans = Object.freeze(
            coalesceIdentitySpans(spans).map(freezeSpan),
        );
        this.nodes = Object.freeze(nodes.map(freezeNode));
        this.boundaries = Object.freeze(boundaries.map(freezeBoundary));
        this.#pathLookupIndexes = buildPathLookupIndexes(
            this.spans,
            this.boundaries,
        );
        this.#firstBoundaryBySourceOffset
            = buildFirstBoundaryBySourceOffset(this.boundaries);
        this.#firstSpanBySourceEnd = buildFirstSpanBySourceEnd(this.spans);
        this.#nodeRangeByPath = buildNodeRangeIndex(this.nodes);

        Object.freeze(this);
    }

    localToSource(
        path: Path,
        offset: TLocalOffset,
        affinity?: TBoundaryAffinity,
    ): TSourceOffset | null {
        assertOffset(offset, 'Local offset');
        const index = this.#pathLookupIndexes.get(path);
        if (!index)
            return null;

        const firstBoundary = index.firstBoundaryByLocalOffset.get(offset);
        const lastBoundary = index.lastBoundaryByLocalOffset.get(offset);

        if (affinity === 'previous') {
            const previous = index.lastSpanByLocalEnd.get(offset);
            if (previous)
                return previous.sourceEnd;
        }

        // An explicit serializer boundary is the compatibility/default owner:
        // existing editing operations insert before generated escapes. Named
        // `next` affinity deliberately asks for the following identity span.
        if (firstBoundary && affinity !== 'next')
            return firstBoundary.sourceOffset;

        // Prefer the span beginning at a shared local boundary. This maps a
        // caret after generated structure (for example a blockquote prefix)
        // into the following identity span rather than before the structure.
        const containing = lastSpanAtOrBefore(
            index.spans,
            offset,
            'localStart',
        );
        if (containing && offset < containing.localEnd) {
            return sourceOffset(
                containing.sourceStart + offset - containing.localStart,
            );
        }

        if (lastBoundary)
            return lastBoundary.sourceOffset;

        // Preserve empty mapped nodes and the terminal caret of a mapped leaf.
        const terminal = index.firstSpanByLocalEnd.get(offset);
        if (terminal)
            return terminal.sourceEnd;

        return null;
    }

    sourceToLocal(
        offset: TSourceOffset,
        affinity?: TBoundaryAffinity,
    ): ILocalPosition<Path> | null {
        assertOffset(offset, 'Source offset');

        const containing = lastSpanAtOrBefore(
            this.spans,
            offset,
            'sourceStart',
        );
        if (containing && offset < containing.sourceEnd) {
            return {
                path: containing.path,
                offset: localOffset(
                    containing.localStart + offset - containing.sourceStart,
                ),
            };
        }

        const boundary = this.#firstBoundaryBySourceOffset.get(offset);
        if (boundary) {
            return {
                path: boundary.path,
                offset: boundary.localOffset,
            };
        }

        if (affinity) {
            const previous = lastSpanAtOrBefore(
                this.spans,
                offset,
                'sourceEnd',
            );
            const next = firstSpanAtOrAfter(
                this.spans,
                offset,
                'sourceStart',
            );
            const adjacent = affinity === 'previous'
                ? previous ?? next
                : next ?? previous;
            if (adjacent) {
                const usePrevious = affinity === 'previous'
                    ? previous !== undefined
                    : next === undefined;
                return usePrevious
                    ? {
                            path: adjacent.path,
                            offset: adjacent.localEnd,
                        }
                    : {
                            path: adjacent.path,
                            offset: adjacent.localStart,
                        };
            }
        }

        // Preserve empty mapped nodes and the terminal caret of a mapped leaf.
        const terminal = this.#firstSpanBySourceEnd.get(offset);
        if (terminal) {
            return {
                path: terminal.path,
                offset: terminal.localEnd,
            };
        }

        return null;
    }

    rangeForPath(path: Path): ISourceRange | null {
        return this.#pathLookupIndexes.get(path)?.range ?? null;
    }

    nodeRange(path: Path): ISourceRange | null {
        return this.#nodeRangeByPath.get(path) ?? null;
    }
}

/** Immutable text paired with its source map. */
export class MappedText<Path extends TMappedTextPath> {
    readonly sourceMap: SourceMap<Path>;

    constructor(
        readonly text: string,
        spans: readonly IMappedTextSpan<Path>[] = [],
        nodes: readonly IMappedTextNode<Path>[] = [],
        boundaries: readonly IMappedTextBoundary<Path>[] = [],
    ) {
        const sourceMap = new SourceMap(spans, nodes, boundaries);
        const outsideSource = sourceMap.spans.find(span =>
            span.sourceEnd > text.length);
        if (outsideSource) {
            throw new RangeError(
                'Mapped text span is outside the serialized source.',
            );
        }
        const outsideNode = sourceMap.nodes.find(node =>
            node.sourceEnd > text.length || node.sourceStart > node.sourceEnd);
        if (outsideNode)
            throw new RangeError('Mapped node range is outside the serialized source.');
        const outsideBoundary = sourceMap.boundaries.find(boundary =>
            boundary.sourceOffset > text.length);
        if (outsideBoundary)
            throw new RangeError('Mapped boundary is outside the serialized source.');

        this.sourceMap = sourceMap;
        Object.freeze(this);
    }

    withNode(path: Path): MappedText<Path> {
        return new MappedText(
            this.text,
            this.sourceMap.spans,
            [
                ...this.sourceMap.nodes,
                {
                    path,
                    sourceStart: sourceOffset(0),
                    sourceEnd: sourceOffset(this.text.length),
                },
            ],
            this.sourceMap.boundaries,
        );
    }

    static concat<Path extends TMappedTextPath>(
        parts: readonly MappedText<Path>[],
    ): MappedText<Path> {
        const textParts: string[] = [];
        const spans: IMappedTextSpan<Path>[] = [];
        const nodes: IMappedTextNode<Path>[] = [];
        const boundaries: IMappedTextBoundary<Path>[] = [];
        let sourceLength = 0;

        for (const part of parts) {
            textParts.push(part.text);
            for (const span of part.sourceMap.spans) {
                spans.push({
                    ...span,
                    sourceStart: sourceOffset(span.sourceStart + sourceLength),
                    sourceEnd: sourceOffset(span.sourceEnd + sourceLength),
                });
            }
            for (const node of part.sourceMap.nodes) {
                nodes.push({
                    ...node,
                    sourceStart: sourceOffset(node.sourceStart + sourceLength),
                    sourceEnd: sourceOffset(node.sourceEnd + sourceLength),
                });
            }
            for (const boundary of part.sourceMap.boundaries) {
                boundaries.push({
                    ...boundary,
                    sourceOffset: sourceOffset(
                        boundary.sourceOffset + sourceLength,
                    ),
                });
            }
            sourceLength += part.text.length;
        }

        return new MappedText(textParts.join(''), spans, nodes, boundaries);
    }

    slice(
        start: TSourceOffset,
        end: TSourceOffset = sourceOffset(this.text.length),
    ): MappedText<Path> {
        assertOffset(start, 'Slice start');
        assertOffset(end, 'Slice end');
        if (end < start || end > this.text.length) {
            throw new RangeError(
                'Mapped text slice must be a forward range inside the source.',
            );
        }

        const spans: IMappedTextSpan<Path>[] = [];
        const nodes: IMappedTextNode<Path>[] = [];
        const boundaries: IMappedTextBoundary<Path>[] = [];
        for (const span of this.sourceMap.spans) {
            if (span.sourceStart === span.sourceEnd) {
                if (start <= span.sourceStart && span.sourceStart <= end) {
                    spans.push({
                        ...span,
                        sourceStart: sourceOffset(span.sourceStart - start),
                        sourceEnd: sourceOffset(span.sourceEnd - start),
                    });
                }
                continue;
            }

            const clippedStart = Math.max(span.sourceStart, start);
            const clippedEnd = Math.min(span.sourceEnd, end);
            if (clippedStart >= clippedEnd)
                continue;

            const localStart = span.localStart
                + clippedStart
                - span.sourceStart;
            spans.push({
                path: span.path,
                localStart: localOffset(localStart),
                localEnd: localOffset(localStart + clippedEnd - clippedStart),
                sourceStart: sourceOffset(clippedStart - start),
                sourceEnd: sourceOffset(clippedEnd - start),
            });
        }

        for (const node of this.sourceMap.nodes) {
            const clippedStart = Math.max(node.sourceStart, start);
            const clippedEnd = Math.min(node.sourceEnd, end);
            if (clippedStart > clippedEnd)
                continue;
            nodes.push({
                path: node.path,
                sourceStart: sourceOffset(clippedStart - start),
                sourceEnd: sourceOffset(clippedEnd - start),
            });
        }
        for (const boundary of this.sourceMap.boundaries) {
            if (start <= boundary.sourceOffset && boundary.sourceOffset <= end) {
                boundaries.push({
                    ...boundary,
                    sourceOffset: sourceOffset(boundary.sourceOffset - start),
                });
            }
        }

        return new MappedText(
            this.text.slice(start, end),
            spans,
            nodes,
            boundaries,
        );
    }
}

/** Mutable construction boundary for immutable mapped text values. */
export class MappedTextWriter<Path extends TMappedTextPath> {
    private readonly _parts: string[] = [];
    private readonly _spans: IMappedTextSpan<Path>[] = [];
    private readonly _boundaries: IMappedTextBoundary<Path>[] = [];
    private _sourceLength = 0;

    appendPlain(text: string): this {
        this._parts.push(text);
        this._sourceLength += text.length;

        return this;
    }

    appendMapped(
        text: string,
        path: Path,
        start: TLocalOffset,
    ): this {
        assertOffset(start, 'Mapped local start');
        const sourceStart = this._sourceLength;
        this._parts.push(text);
        this._sourceLength += text.length;
        this._spans.push({
            path,
            localStart: start,
            localEnd: localOffset(start + text.length),
            sourceStart: sourceOffset(sourceStart),
            sourceEnd: sourceOffset(this._sourceLength),
        });

        return this;
    }

    appendBoundary(path: Path, offset: TLocalOffset): this {
        assertOffset(offset, 'Mapped local boundary');
        this._boundaries.push({
            path,
            localOffset: offset,
            sourceOffset: sourceOffset(this._sourceLength),
        });

        return this;
    }

    build(): MappedText<Path> {
        return new MappedText(
            this._parts.join(''),
            this._spans,
            [],
            this._boundaries,
        );
    }
}
