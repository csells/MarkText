import type { TMappedTextPath } from '../mapped-range';
import type {
    IMappedTextSpan,
    MappedText,
    TSourceRange,
} from '../mappedText';
import type {
    CriticMarkupAnalysis,
    TCriticMarkupDocumentToken,
} from './analysis';
import type {
    ICriticMarkupBindingGraph,
    ICriticMarkupInlineBinding,
    TCriticMarkupInlineBindingSegment,
} from './bindingGraph';
import { MappedPathIndex } from '../mapped-range';
import {
    localRange as mappedLocalRange,
    sourceRange as mappedSourceRange,
} from '../mappedText';

type TCriticMarkupSemanticArm = ICriticMarkupInlineBinding['arm'];
type TCriticMarkupSemanticMarker
    = Extract<TCriticMarkupInlineBindingSegment, { kind: 'marker' }>['marker'];

type TSemanticSourceSegment
    = | {
        readonly kind: 'content';
        readonly arm: TCriticMarkupSemanticArm;
        readonly sourceRange: TSourceRange;
    }
    | {
        readonly kind: 'marker';
        readonly marker: TCriticMarkupSemanticMarker;
        readonly sourceRange: TSourceRange;
    };

export interface ICriticMarkupSemanticItemNode {
    readonly id: string;
    readonly parentId: string | null;
    readonly depth: number;
    readonly syntax: TCriticMarkupDocumentToken;
}

type ISemanticItemNode = ICriticMarkupSemanticItemNode;

interface ISemanticSegmentEvent {
    readonly item: ISemanticItemNode;
    readonly segment: TSemanticSourceSegment;
}

interface IMutableLeafRun<Path extends TMappedTextPath> {
    readonly path: Path;
    localStart: number;
    localEnd: number;
    readonly segments: TCriticMarkupInlineBindingSegment[];
}

interface IMutableItemAccumulator<Path extends TMappedTextPath> {
    readonly item: ISemanticItemNode;
    readonly runsByPath: MappedPathIndex<Path, IMutableLeafRun<Path>>;
    readonly runs: IMutableLeafRun<Path>[];
}

function semanticSegments(
    token: TCriticMarkupDocumentToken,
): TSemanticSourceSegment[] {
    const marker = (
        name: TCriticMarkupSemanticMarker,
        sourceRange: TSourceRange,
    ): TSemanticSourceSegment => ({
        kind: 'marker',
        marker: name,
        sourceRange,
    });
    const content = (
        arm: TCriticMarkupSemanticArm,
        sourceRange: TSourceRange,
    ): TSemanticSourceSegment => ({
        kind: 'content',
        arm,
        sourceRange,
    });

    if (token.type === 'substitution') {
        return [
            marker('open', token.markers.open.range),
            content('old', token.oldRange),
            marker('separator', token.markers.separator.range),
            content('new', token.newRange),
            marker('close', token.markers.close.range),
        ];
    }

    return [
        marker('open', token.markers.open.range),
        content(
            token.type === 'comment' ? 'comment' : 'content',
            token.contentRange,
        ),
        marker('close', token.markers.close.range),
    ];
}

/** Depth-first semantic item identities shared with the document builder. */
export function criticMarkupSemanticItemNodes(
    tokens: readonly TCriticMarkupDocumentToken[],
): ICriticMarkupSemanticItemNode[] {
    const result: ICriticMarkupSemanticItemNode[] = [];
    const pending: Array<{
        syntax: TCriticMarkupDocumentToken;
        parentId: string | null;
        depth: number;
    }> = [];
    for (let index = tokens.length - 1; index >= 0; index--)
        pending.push({ syntax: tokens[index], parentId: null, depth: 0 });

    while (pending.length) {
        const { syntax, parentId, depth } = pending.pop()!;
        const id = `critic-${syntax.range.start}-${syntax.range.end}`;
        result.push({ id, parentId, depth, syntax });
        if (syntax.nested?.length) {
            for (let index = syntax.nested.length - 1; index >= 0; index--) {
                pending.push({
                    syntax: syntax.nested[index],
                    parentId: id,
                    depth: depth + 1,
                });
            }
        }
    }

    return result;
}

function segmentEvents(
    items: readonly ISemanticItemNode[],
): ISemanticSegmentEvent[] {
    const events: ISemanticSegmentEvent[] = [];
    for (const item of items) {
        for (const segment of semanticSegments(item.syntax)) {
            if (segment.sourceRange.start < segment.sourceRange.end)
                events.push({ item, segment });
        }
    }

    return events;
}

function intersectSpanRange(
    span: IMappedTextSpan<TMappedTextPath>,
    range: TSourceRange,
): TSourceRange | null {
    const start = span.sourceStart > range.start
        ? span.sourceStart
        : range.start;
    const end = span.sourceEnd < range.end ? span.sourceEnd : range.end;
    return start < end ? mappedSourceRange(start, end) : null;
}

function sameSemanticSegment(
    left: TCriticMarkupInlineBindingSegment,
    right: TCriticMarkupInlineBindingSegment,
): boolean {
    if (left.kind === 'marker' && right.kind === 'marker')
        return left.marker === right.marker;
    if (left.kind === 'content' && right.kind === 'content')
        return left.arm === right.arm;
    return false;
}

function mutableRun<Path extends TMappedTextPath>(
    accumulator: IMutableItemAccumulator<Path>,
    path: Path,
): IMutableLeafRun<Path> {
    const existing = accumulator.runsByPath.get(path);
    if (existing)
        return existing;

    const created: IMutableLeafRun<Path> = {
        path,
        localStart: Number.POSITIVE_INFINITY,
        localEnd: Number.NEGATIVE_INFINITY,
        segments: [],
    };
    accumulator.runsByPath.set(path, created);
    accumulator.runs.push(created);
    return created;
}

function appendRunSegment<Path extends TMappedTextPath>(
    accumulator: IMutableItemAccumulator<Path>,
    event: ISemanticSegmentEvent,
    span: IMappedTextSpan<Path>,
): void {
    const sourceRange = intersectSpanRange(span, event.segment.sourceRange);
    if (!sourceRange)
        return;

    const run = mutableRun(accumulator, span.path);
    const localRange = mappedLocalRange(
        span.localStart + sourceRange.start - span.sourceStart,
        span.localStart + sourceRange.end - span.sourceStart,
    );
    const segment: TCriticMarkupInlineBindingSegment
        = event.segment.kind === 'marker'
            ? {
                    kind: 'marker',
                    marker: event.segment.marker,
                    localRange,
                    sourceRange,
                }
            : {
                    kind: 'content',
                    arm: event.segment.arm,
                    localRange,
                    sourceRange,
                };
    const previous = run.segments.at(-1);
    if (
        previous
        && sameSemanticSegment(previous, segment)
        && previous.localRange.end === segment.localRange.start
        && previous.sourceRange.end === segment.sourceRange.start
    ) {
        run.segments[run.segments.length - 1] = {
            ...previous,
            localRange: mappedLocalRange(
                previous.localRange.start,
                segment.localRange.end,
            ),
            sourceRange: mappedSourceRange(
                previous.sourceRange.start,
                segment.sourceRange.end,
            ),
        };
    }
    else {
        run.segments.push(segment);
    }
    if (localRange.start < run.localStart)
        run.localStart = localRange.start;
    if (localRange.end > run.localEnd)
        run.localEnd = localRange.end;
}

function defaultArm(
    syntax: TCriticMarkupDocumentToken,
): TCriticMarkupSemanticArm {
    if (syntax.type === 'comment')
        return 'comment';
    return syntax.type === 'substitution' ? 'old' : 'content';
}

/**
 * Split one mapped leaf run into arm-consistent bindings. Marker segments are
 * arm-neutral and stay with the active run; a content segment whose arm
 * differs from the active arm starts the next binding. Only substitutions
 * carry two arms, so ordinary items always produce one binding per leaf.
 */
function bindingsForRun<Path extends TMappedTextPath>(
    item: ISemanticItemNode,
    run: IMutableLeafRun<Path>,
): Array<Omit<ICriticMarkupInlineBinding<Path>, 'role'>> {
    const groups: TCriticMarkupInlineBindingSegment[][] = [];
    let current: TCriticMarkupInlineBindingSegment[] = [];
    let currentArm: TCriticMarkupSemanticArm | null = null;
    for (const segment of run.segments) {
        if (segment.kind === 'content') {
            if (currentArm !== null && segment.arm !== currentArm) {
                groups.push(current);
                current = [];
            }
            currentArm = segment.arm;
        }
        current.push(segment);
    }
    if (current.length)
        groups.push(current);

    let groupArm: TCriticMarkupSemanticArm | null = null;
    return groups.map((segments) => {
        const first = segments[0];
        const last = segments.at(-1);
        if (!first || !last) {
            throw new TypeError(
                'Grammar CriticMarkup binding run has no semantic segments.',
            );
        }
        groupArm = segments.find(
            (segment): segment is Extract<
                TCriticMarkupInlineBindingSegment,
                { kind: 'content' }
            > => segment.kind === 'content',
        )?.arm ?? groupArm ?? defaultArm(item.syntax);
        return {
            path: run.path,
            itemId: item.id,
            criticType: item.syntax.type,
            arm: groupArm,
            localRange: mappedLocalRange(
                first.localRange.start,
                last.localRange.end,
            ),
            sourceRange: mappedSourceRange(
                first.sourceRange.start,
                last.sourceRange.end,
            ),
            segments: Object.freeze(segments),
        };
    });
}

/**
 * Materialize the parser-owned binding graph for one grammar-only analysis.
 *
 * The grammar is the sole parser artifact for grammar-only profiles, so its
 * exact marker and arm ranges — intersected with the mapped identity spans in
 * one monotonic source sweep — are the topology authority. Work is
 * proportional to input events, spans, and the segments the graph must store.
 * Parser-context (Markdown-aware) documents never derive topology here; they
 * require the binding graph emitted by their own located parse.
 */
export function grammarCriticMarkupBindingGraph<
    Path extends TMappedTextPath,
>(
    analysis: CriticMarkupAnalysis,
    mappedText: MappedText<Path>,
): ICriticMarkupBindingGraph<Path> {
    const items = criticMarkupSemanticItemNodes(analysis.roots);
    const accumulators = new Map<string, IMutableItemAccumulator<Path>>();
    for (const item of items) {
        accumulators.set(item.id, {
            item,
            runsByPath: new MappedPathIndex(),
            runs: [],
        });
    }

    const events = segmentEvents(items);
    const eventsByStart = [...events].sort((left, right) =>
        left.segment.sourceRange.start - right.segment.sourceRange.start
        || left.segment.sourceRange.end - right.segment.sourceRange.end);
    const eventsByEnd = [...events].sort((left, right) =>
        left.segment.sourceRange.end - right.segment.sourceRange.end
        || left.segment.sourceRange.start - right.segment.sourceRange.start);
    const active = new Set<ISemanticSegmentEvent>();
    let startIndex = 0;
    let endIndex = 0;

    for (const span of mappedText.sourceMap.spans) {
        if (span.sourceStart === span.sourceEnd)
            continue;
        while (
            endIndex < eventsByEnd.length
            && eventsByEnd[endIndex].segment.sourceRange.end
            <= span.sourceStart
        ) {
            active.delete(eventsByEnd[endIndex]);
            endIndex++;
        }
        while (
            startIndex < eventsByStart.length
            && eventsByStart[startIndex].segment.sourceRange.start
            < span.sourceEnd
        ) {
            const event = eventsByStart[startIndex++];
            if (span.sourceStart < event.segment.sourceRange.end)
                active.add(event);
        }
        for (const event of active) {
            appendRunSegment(
                accumulators.get(event.item.id)!,
                event,
                span,
            );
        }
    }

    const inline: ICriticMarkupInlineBinding<Path>[] = [];
    for (const item of items) {
        const accumulator = accumulators.get(item.id)!;
        const partial = accumulator.runs
            .flatMap(run => bindingsForRun(item, run))
            .sort((left, right) =>
                left.sourceRange.start - right.sourceRange.start
                || left.sourceRange.end - right.sourceRange.end);
        for (let index = 0; index < partial.length; index++) {
            inline.push(Object.freeze({
                ...partial[index],
                role: partial.length === 1
                    ? 'only' as const
                    : index === 0
                        ? 'start' as const
                        : index === partial.length - 1
                            ? 'end' as const
                            : 'middle' as const,
            }));
        }
    }

    return Object.freeze({
        block: Object.freeze([]),
        inline: Object.freeze(inline),
    });
}
