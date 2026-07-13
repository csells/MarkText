import type { ICriticMarkupRange, TCriticMarkupToken } from './parser';
import type {
    TCriticMarkupDecision,
    TCriticMarkupProjection,
} from './reviewContract';
import { ExcludedRanges } from './excludedRanges';
import {
    decodeCriticMarkupPayloadEscapes,
    scanCriticMarkup,
} from './parser';

export type {
    TCriticMarkupDecision,
    TCriticMarkupProjection,
} from './reviewContract';

/** Return the text represented by one semantic item in the requested view. */
export function projectCriticMarkupToken(
    token: TCriticMarkupToken,
    projection: TCriticMarkupProjection,
): string {
    if (projection === 'marked')
        return token.raw;

    let projected: string;
    switch (token.type) {
        case 'addition':
            projected = projection === 'revised' ? token.content : '';
            break;
        case 'deletion':
            projected = projection === 'original' ? token.content : '';
            break;
        case 'substitution':
            projected = projection === 'original'
                ? token.oldContent
                : token.newContent;
            break;
        case 'highlight':
            projected = token.content;
            break;
        case 'comment':
            projected = '';
            break;
    }

    return decodeCriticMarkupPayloadEscapes(token, projected);
}

/** Resolve one review item without reparsing or changing adjacent Markdown. */
export function resolveCriticMarkupToken(
    token: TCriticMarkupToken,
    decision: TCriticMarkupDecision,
): string {
    return projectCriticMarkupToken(
        token,
        decision === 'accept' ? 'revised' : 'original',
    );
}

interface IProjectionRangeTask {
    start: number;
    end: number;
    tokens: readonly TCriticMarkupToken[];
    owner: TCriticMarkupToken | null;
}

export interface IProjectedCriticMarkupSourceSegment {
    range: ICriticMarkupRange;
    /** Deepest retained semantic item owning this source slice. */
    owner: TCriticMarkupToken | null;
}

type TSourceRangeProjection
    = | Exclude<TCriticMarkupProjection, 'marked'>
        | 'comments'
        | 'union';

function projectedContentRanges(
    token: TCriticMarkupToken,
    projection: TSourceRangeProjection,
): Array<{ start: number; end: number }> {
    if (projection === 'comments') {
        return token.type === 'comment'
            ? [token.contentRange]
            : [token.range];
    }

    if (projection === 'union') {
        switch (token.type) {
            case 'substitution':
                return [token.oldRange, token.newRange];
            case 'comment':
                return [token.contentRange];
            default:
                return [token.contentRange];
        }
    }

    switch (token.type) {
        case 'addition':
            return projection === 'revised'
                ? [token.contentRange]
                : [];
        case 'deletion':
            return projection === 'original'
                ? [token.contentRange]
                : [];
        case 'substitution':
            return [projection === 'original'
                ? token.oldRange
                : token.newRange];
        case 'highlight':
            return [token.contentRange];
        case 'comment':
            return [];
    }
}

function pushSourceRange(
    result: IProjectedCriticMarkupSourceSegment[],
    start: number,
    end: number,
    owner: TCriticMarkupToken | null,
): void {
    if (start >= end)
        return;

    const previous = result.at(-1);
    if (previous?.range.end === start && previous.owner === owner) {
        previous.range.end = end;
        return;
    }

    result.push({ range: { start, end }, owner });
}

/**
 * Return the canonical source slices retained by one projection. The explicit
 * task stack keeps arbitrary supported nesting off the JavaScript call stack;
 * the ranges also let Markdown adapters map projected syntax back to source.
 */
export function projectedCriticMarkupSourceRanges(
    sourceLength: number,
    projection: TCriticMarkupProjection,
    tokens: readonly TCriticMarkupToken[],
): ICriticMarkupRange[] {
    if (projection === 'marked')
        return sourceLength ? [{ start: 0, end: sourceLength }] : [];

    return sourceRanges(projectedSourceSegments(
        sourceLength,
        projection,
        tokens,
    ));
}

export function projectedCriticMarkupSourceSegments(
    sourceLength: number,
    projection: Exclude<TCriticMarkupProjection, 'marked'>,
    tokens: readonly TCriticMarkupToken[],
): IProjectedCriticMarkupSourceSegment[] {
    return projectedSourceSegments(sourceLength, projection, tokens);
}

/**
 * Retain both visible arms of every change while removing CriticMarkup marker
 * bytes. This parser-only projection supplies one native union AST whose node
 * ranges can own structural marker trivia without merging trees by content.
 */
export function projectedCriticMarkupUnionSourceSegments(
    sourceLength: number,
    tokens: readonly TCriticMarkupToken[],
): IProjectedCriticMarkupSourceSegment[] {
    return projectedSourceSegments(sourceLength, 'union', tokens);
}

/**
 * Union only the supplied item envelopes. Nested CriticMarkup remains raw so
 * an outer structural carrier can coexist with independently reviewable
 * inline descendants in its native leaf state.
 */
export function projectedCriticMarkupShallowUnionSourceSegments(
    sourceLength: number,
    tokens: readonly TCriticMarkupToken[],
): IProjectedCriticMarkupSourceSegment[] {
    return projectedSourceSegments(
        sourceLength,
        'union',
        tokens,
        new Set(tokens),
    );
}

/**
 * Union exactly the selected semantic token forest. A selected parent exposes
 * its content; selected descendants recurse, while unselected descendants
 * remain byte-raw inside that content.
 */
export function projectedCriticMarkupSelectedUnionSourceSegments(
    sourceLength: number,
    roots: readonly TCriticMarkupToken[],
    selected: ReadonlySet<TCriticMarkupToken>,
): IProjectedCriticMarkupSourceSegment[] {
    return projectedSourceSegments(
        sourceLength,
        'union',
        roots.filter(token => selected.has(token)),
        selected,
    );
}

/**
 * Keep the complete marked document but expose every nested comment body in
 * place of its markers. Original/Revised cover the other semantic arms; this
 * bounded companion view gives Markdown inside otherwise-hidden comments a
 * real parser context without reparsing each nested payload.
 */
export function projectedCriticMarkupCommentSourceRanges(
    sourceLength: number,
    tokens: readonly TCriticMarkupToken[],
): ICriticMarkupRange[] {
    return sourceRanges(projectedSourceSegments(
        sourceLength,
        'comments',
        tokens,
    ));
}

export function projectedCriticMarkupCommentSourceSegments(
    sourceLength: number,
    tokens: readonly TCriticMarkupToken[],
): IProjectedCriticMarkupSourceSegment[] {
    return projectedSourceSegments(sourceLength, 'comments', tokens);
}

function sourceRanges(
    segments: readonly IProjectedCriticMarkupSourceSegment[],
): ICriticMarkupRange[] {
    const result: ICriticMarkupRange[] = [];
    for (const segment of segments) {
        const previous = result.at(-1);
        if (previous?.end === segment.range.start)
            previous.end = segment.range.end;
        else
            result.push({ ...segment.range });
    }
    return result;
}

function firstRangeEndingAfter(
    ranges: readonly Readonly<ICriticMarkupRange>[],
    offset: number,
): number {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (ranges[middle].end <= offset)
            low = middle + 1;
        else
            high = middle;
    }

    return low;
}

function projectedSourceSegments(
    sourceLength: number,
    projection: TSourceRangeProjection,
    tokens: readonly TCriticMarkupToken[],
    selectedUnionTokens?: ReadonlySet<TCriticMarkupToken>,
): IProjectedCriticMarkupSourceSegment[] {
    return projectedRangeSourceSegments(
        { start: 0, end: sourceLength },
        projection,
        tokens,
        null,
        selectedUnionTokens,
    );
}

function projectedRangeSourceSegments(
    range: Readonly<ICriticMarkupRange>,
    projection: TSourceRangeProjection,
    tokens: readonly TCriticMarkupToken[],
    owner: TCriticMarkupToken | null,
    selectedUnionTokens?: ReadonlySet<TCriticMarkupToken>,
): IProjectedCriticMarkupSourceSegment[] {
    const result: IProjectedCriticMarkupSourceSegment[] = [];
    const pending: IProjectionRangeTask[] = [{
        start: range.start,
        end: range.end,
        tokens,
        owner,
    }];

    while (pending.length) {
        const task = pending.pop()!;
        if (!task.tokens.length) {
            pushSourceRange(
                result,
                task.start,
                task.end,
                task.owner,
            );
            continue;
        }

        const operations: Array<
            | { kind: 'source'; start: number; end: number }
            | { kind: 'range'; value: IProjectionRangeTask }
        > = [];
        let cursor = task.start;

        for (const token of task.tokens) {
            if (token.range.start < task.start || token.range.end > task.end)
                continue;

            if (cursor < token.range.start) {
                operations.push({
                    kind: 'source',
                    start: cursor,
                    end: token.range.start,
                });
            }
            const ranges = projectedContentRanges(token, projection);
            for (const range of ranges) {
                operations.push({
                    kind: 'range',
                    value: {
                        start: range.start,
                        end: range.end,
                        tokens: selectedUnionTokens
                            ? (token.nested ?? []).filter(nested =>
                                    selectedUnionTokens.has(nested))
                            : token.nested ?? [],
                        owner: token,
                    },
                });
            }
            cursor = token.range.end;
        }
        if (cursor < task.end) {
            operations.push({
                kind: 'source',
                start: cursor,
                end: task.end,
            });
        }

        for (let index = operations.length - 1; index >= 0; index--) {
            const operation = operations[index];
            if (operation.kind === 'range') {
                pending.push(operation.value);
            }
            else {
                // Source operations are already in output order. Defer them
                // through a zero-token range so the LIFO task stack preserves
                // ordering without a recursive return frame.
                pending.push({
                    start: operation.start,
                    end: operation.end,
                    tokens: [],
                    owner: task.owner,
                });
            }
        }
    }

    return result;
}

function assertProjectionRange(
    source: string,
    range: Readonly<ICriticMarkupRange>,
): void {
    if (
        !Number.isInteger(range.start)
        || !Number.isInteger(range.end)
        || range.start < 0
        || range.end < range.start
        || range.end > source.length
    ) {
        throw new RangeError(
            `CriticMarkup projection range [${range.start}, ${range.end}) is outside a source of length ${source.length}.`,
        );
    }
}

function materializeProjectedSourceSegments(
    source: string,
    segments: readonly IProjectedCriticMarkupSourceSegment[],
    excludedRanges: ExcludedRanges,
): string {
    excludedRanges.assertSourceLength(source.length);
    const result: string[] = [];

    for (const { range, owner } of segments) {
        if (!owner) {
            result.push(source.slice(range.start, range.end));
            continue;
        }

        let cursor = range.start;
        const firstOpaque = firstRangeEndingAfter(
            excludedRanges.ranges,
            cursor,
        );
        for (
            let index = firstOpaque;
            index < excludedRanges.ranges.length;
            index++
        ) {
            const opaque = excludedRanges.ranges[index];
            if (range.end <= opaque.start)
                break;
            if (cursor < opaque.start) {
                result.push(decodeCriticMarkupPayloadEscapes(
                    owner,
                    source.slice(cursor, Math.min(opaque.start, range.end)),
                ));
            }
            const opaqueStart = Math.max(cursor, opaque.start);
            const opaqueEnd = Math.min(range.end, opaque.end);
            if (opaqueStart < opaqueEnd)
                result.push(source.slice(opaqueStart, opaqueEnd));
            if (opaqueEnd > cursor)
                cursor = opaqueEnd;
            if (range.end <= cursor)
                break;
        }
        if (cursor < range.end) {
            result.push(decodeCriticMarkupPayloadEscapes(
                owner,
                source.slice(cursor, range.end),
            ));
        }
    }

    return result.join('');
}

function retainedItemSourceSegments(
    range: Readonly<ICriticMarkupRange>,
    token: TCriticMarkupToken,
): IProjectedCriticMarkupSourceSegment[] {
    const result: IProjectedCriticMarkupSourceSegment[] = [];
    let cursor = range.start;

    for (const nested of token.nested ?? []) {
        if (nested.range.start < range.start || nested.range.end > range.end)
            continue;
        pushSourceRange(result, cursor, nested.range.start, token);
        // Resolving one item must not silently resolve its children. Their
        // complete marked syntax remains byte-raw for a later review action.
        pushSourceRange(
            result,
            nested.range.start,
            nested.range.end,
            null,
        );
        cursor = nested.range.end;
    }
    pushSourceRange(result, cursor, range.end, token);

    return result;
}

/**
 * Project a canonical source subrange without rescanning it. `tokens` must be
 * the already-parsed semantic items directly contained by the requested
 * range; parser-excluded slices remain byte-for-byte opaque.
 */
export function projectCriticMarkupSourceRange(
    source: string,
    range: Readonly<ICriticMarkupRange>,
    projection: TCriticMarkupProjection,
    tokens: readonly TCriticMarkupToken[],
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): string {
    assertProjectionRange(source, range);
    excludedRanges.assertSourceLength(source.length);
    if (projection === 'marked')
        return source.slice(range.start, range.end);

    return materializeProjectedSourceSegments(
        source,
        projectedRangeSourceSegments(range, projection, tokens, null),
        excludedRanges,
    );
}

/**
 * Project one parsed item from its canonical document source. Unlike the
 * grammar-only token helper, this path preserves parser-excluded payload
 * slices exactly. Nested review items remain marked and independently
 * resolvable when their containing arm survives the decision.
 */
export function projectCriticMarkupItem(
    source: string,
    token: TCriticMarkupToken,
    projection: TCriticMarkupProjection,
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): string {
    assertProjectionRange(source, token.range);
    excludedRanges.assertSourceLength(source.length);
    if (projection === 'marked')
        return source.slice(token.range.start, token.range.end);

    const ranges = projectedContentRanges(token, projection);
    if (ranges.length > 1) {
        throw new TypeError(
            'A review projection selected more than one CriticMarkup payload arm.',
        );
    }
    const [range] = ranges;
    if (!range)
        return '';

    return materializeProjectedSourceSegments(
        source,
        retainedItemSourceSegments(range, token),
        excludedRanges,
    );
}

/** Project every semantic CriticMarkup item in a complete Markdown source. */
export function projectCriticMarkupSource(
    source: string,
    projection: TCriticMarkupProjection,
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): string {
    if (projection === 'marked')
        return source;

    return projectCriticMarkupTokens(
        source,
        projection,
        scanCriticMarkup(source, excludedRanges),
        excludedRanges,
    );
}

/** Project from an already-parsed root token forest without rescanning. */
export function projectCriticMarkupTokens(
    source: string,
    projection: TCriticMarkupProjection,
    tokens: readonly TCriticMarkupToken[],
    excludedRanges: ExcludedRanges = ExcludedRanges.empty(source.length),
): string {
    if (projection === 'marked')
        return source;

    const segments = projectedCriticMarkupSourceSegments(
        source.length,
        projection,
        tokens,
    );
    return materializeProjectedSourceSegments(
        source,
        segments,
        excludedRanges,
    );
}
