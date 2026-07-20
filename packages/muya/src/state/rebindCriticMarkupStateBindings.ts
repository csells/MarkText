import type {
    ICriticMarkupInlineStateBinding,
    ICriticMarkupStateBindingGraph,
    TCriticMarkupBlockStateBinding,
    TCriticMarkupInlineStateBindingSegment,
} from './criticMarkupStateBindings';
import type {
    TMarkdownStatePath,
    TTrackedMarkdown,
} from './markdownSourceMap';
import {
    HalfOpenIntervalIndex,
    lowerBound,
    MappedPathIndex,
    mappedPathsEqual,
    upperBound,
} from '../mapped-range';

interface IExactMappedRange {
    readonly path: TMarkdownStatePath;
    readonly start: number;
    readonly end: number;
}

interface IReboundSegment {
    readonly path: TMarkdownStatePath;
    readonly segment: TCriticMarkupInlineStateBindingSegment;
}

interface INodeCarrier {
    readonly path: TMarkdownStatePath;
    readonly start: number;
    readonly end: number;
}

interface IContentCarrierQuery {
    readonly start: number;
    readonly end: number;
}

type TBoundaryCarrierLookup
    = | Readonly<{ kind: 'none' | 'ambiguous' }>
        | Readonly<{
            kind: 'found';
            chain: readonly INodeCarrier[];
        }>;

function firstSpanEndingAfter(
    mapped: TTrackedMarkdown,
    sourceStart: number,
): number {
    const spans = mapped.sourceMap.spans;
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (spans[middle].sourceEnd <= sourceStart)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

/** Map one source interval only when one live leaf owns every byte exactly. */
function exactMappedRange(
    mapped: TTrackedMarkdown,
    sourceStart: number,
    sourceEnd: number,
): IExactMappedRange | null {
    if (
        !Number.isSafeInteger(sourceStart)
        || !Number.isSafeInteger(sourceEnd)
        || sourceStart < 0
        || sourceEnd <= sourceStart
        || mapped.text.length < sourceEnd
    ) {
        return null;
    }

    const spans = mapped.sourceMap.spans;
    let index = firstSpanEndingAfter(mapped, sourceStart);
    let sourceCursor = sourceStart;
    let localCursor = -1;
    let path: TMarkdownStatePath | null = null;
    let localStart = -1;

    while (sourceCursor < sourceEnd) {
        const span = spans[index++];
        if (!span || span.sourceStart > sourceCursor)
            return null;
        const nextLocal = span.localStart
            + sourceCursor
            - span.sourceStart;
        if (path === null) {
            path = span.path;
            localStart = nextLocal;
            localCursor = nextLocal;
        }
        else if (
            !mappedPathsEqual(path, span.path)
            || nextLocal !== localCursor
        ) {
            return null;
        }
        const length = Math.min(sourceEnd, span.sourceEnd) - sourceCursor;
        if (length <= 0)
            return null;
        sourceCursor += length;
        localCursor += length;
    }

    return path === null
        ? null
        : { path, start: localStart, end: localCursor };
}

function assertOriginalRange(
    mapped: TTrackedMarkdown,
    binding: ICriticMarkupInlineStateBinding,
    sourceStart: number,
    sourceEnd: number,
    localStart: number,
    localEnd: number,
): void {
    const exact = exactMappedRange(mapped, sourceStart, sourceEnd);
    if (
        !exact
        || !mappedPathsEqual(exact.path, binding.path)
        || exact.start !== localStart
        || exact.end !== localEnd
    ) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} is detached from its parser state revision.`,
        );
    }
}

function rebindSegment(
    target: TTrackedMarkdown,
    binding: ICriticMarkupInlineStateBinding,
    segment: TCriticMarkupInlineStateBindingSegment,
): IReboundSegment {
    const exact = exactMappedRange(
        target,
        segment.sourceRange.start,
        segment.sourceRange.end,
    );
    if (!exact) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} cannot bind exactly to the live state revision.`,
        );
    }
    const ranges = {
        localRange: Object.freeze({ start: exact.start, end: exact.end }),
        sourceRange: segment.sourceRange,
    };
    return {
        path: exact.path,
        segment: Object.freeze(segment.kind === 'marker'
            ? { ...ranges, kind: segment.kind, marker: segment.marker }
            : { ...ranges, kind: segment.kind, arm: segment.arm }),
    };
}

function rebindInline(
    source: TTrackedMarkdown,
    target: TTrackedMarkdown,
    binding: ICriticMarkupInlineStateBinding,
): ICriticMarkupInlineStateBinding {
    for (const segment of binding.segments) {
        assertOriginalRange(
            source,
            binding,
            segment.sourceRange.start,
            segment.sourceRange.end,
            segment.localRange.start,
            segment.localRange.end,
        );
    }

    const rebound = binding.segments.map(segment =>
        rebindSegment(target, binding, segment));
    const first = rebound[0];
    const last = rebound.at(-1);
    if (
        !first
        || !last
        || rebound.some(value =>
            !mappedPathsEqual(value.path, first.path))
    ) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} cannot bind exactly to the live state revision.`,
        );
    }
    return Object.freeze({
        path: first.path,
        itemId: binding.itemId,
        criticType: binding.criticType,
        arm: binding.arm,
        role: binding.role,
        localRange: Object.freeze({
            start: first.segment.localRange.start,
            end: last.segment.localRange.end,
        }),
        sourceRange: binding.sourceRange,
        segments: Object.freeze(rebound.map(value => value.segment)),
    });
}

function pathHasPrefix(
    path: TMarkdownStatePath,
    prefix: TMarkdownStatePath,
): boolean {
    return prefix.length <= path.length
        && prefix.every((component, index) => component === path[index]);
}

function canonicalNodeCarriers(mapped: TTrackedMarkdown): INodeCarrier[] {
    const byPath = new MappedPathIndex<
        TMarkdownStatePath,
        { path: TMarkdownStatePath; start: number; end: number }
    >();
    for (const node of mapped.sourceMap.nodes) {
        if (node.path.length === 0)
            continue;
        const existing = byPath.get(node.path);
        if (existing) {
            existing.start = Math.min(existing.start, node.sourceStart);
            existing.end = Math.max(existing.end, node.sourceEnd);
        }
        else {
            byPath.set(node.path, {
                path: node.path,
                start: node.sourceStart,
                end: node.sourceEnd,
            });
        }
    }
    return [...byPath.values()];
}

function strictCarrierChain(
    candidates: readonly INodeCarrier[],
): readonly INodeCarrier[] | null {
    if (!candidates.length)
        return null;
    const ordered = [...candidates].sort((left, right) =>
        left.path.length - right.path.length);
    for (let index = 1; index < ordered.length; index++) {
        const outer = ordered[index - 1].path;
        const inner = ordered[index].path;
        if (
            outer.length >= inner.length
            || !pathHasPrefix(inner, outer)
        ) {
            return null;
        }
    }
    return ordered;
}

/** Indexed structural ownership for one exact serialized state revision. */
class NodeCarrierIndex {
    private readonly _nonempty: HalfOpenIntervalIndex<INodeCarrier>;
    private readonly _emptyByOffset = new Map<number, INodeCarrier[]>();
    private readonly _byStart: readonly INodeCarrier[];
    private readonly _byEnd: readonly INodeCarrier[];

    constructor(mapped: TTrackedMarkdown) {
        const carriers = canonicalNodeCarriers(mapped);
        const nonempty = carriers.filter(carrier =>
            carrier.start < carrier.end);
        this._nonempty = new HalfOpenIntervalIndex(nonempty.map(carrier => ({
            start: carrier.start,
            end: carrier.end,
            value: carrier,
        })));
        for (const carrier of carriers) {
            if (carrier.start !== carrier.end)
                continue;
            const atOffset = this._emptyByOffset.get(carrier.start) ?? [];
            atOffset.push(carrier);
            this._emptyByOffset.set(carrier.start, atOffset);
        }
        this._byStart = Object.freeze([...carriers].sort((left, right) =>
            left.start - right.start));
        this._byEnd = Object.freeze([...carriers].sort((left, right) =>
            left.end - right.end));
    }

    content(start: number, end: number): readonly INodeCarrier[] | null {
        if (start < 0 || end <= start)
            return null;
        return strictCarrierChain(this._nonempty.containingRange(start, end));
    }

    private _atBoundary(
        offset: number,
        edge: 'before' | 'after',
    ): TBoundaryCarrierLookup {
        const empty = this._emptyByOffset.get(offset) ?? [];
        const adjacent = edge === 'before'
            ? this._nonempty.containing(offset)
            : offset > 0
                ? this._nonempty.containingRange(offset - 1, offset)
                : [];
        if (empty.length) {
            // An exact zero-width state is stronger ownership than an
            // unrelated sibling that merely starts at the same source edge.
            // Keep only its structural ancestors; multiple zero-width sibling
            // candidates remain incomparable and therefore fail closed.
            const related = adjacent.filter(candidate =>
                empty.some(owner => pathHasPrefix(owner.path, candidate.path)));
            const chain = strictCarrierChain([...related, ...empty]);
            return chain
                ? { kind: 'found', chain }
                : { kind: 'ambiguous' };
        }
        if (!adjacent.length)
            return { kind: 'none' };
        const chain = strictCarrierChain(adjacent);
        return chain
            ? { kind: 'found', chain }
            : { kind: 'ambiguous' };
    }

    boundary(
        offset: number,
        edge: 'before' | 'after',
    ): readonly INodeCarrier[] | null {
        const direct = this._atBoundary(offset, edge);
        if (direct.kind === 'found')
            return direct.chain;
        if (direct.kind === 'ambiguous')
            return null;

        const following = (): TBoundaryCarrierLookup => {
            const index = lowerBound(
                this._byStart,
                offset,
                carrier => carrier.start,
            );
            const next = this._byStart[index];
            if (!next)
                return { kind: 'none' };
            return this._atBoundary(next.start, edge);
        };
        const preceding = (): TBoundaryCarrierLookup => {
            const index = upperBound(
                this._byEnd,
                offset,
                carrier => carrier.end,
            ) - 1;
            const previous = this._byEnd[index];
            if (!previous)
                return { kind: 'none' };
            return this._atBoundary(previous.end, edge);
        };
        const primary = edge === 'before' ? following() : preceding();
        if (primary.kind === 'found')
            return primary.chain;
        if (primary.kind === 'ambiguous')
            return null;
        const secondary = edge === 'before' ? preceding() : following();
        return secondary.kind === 'found' ? secondary.chain : null;
    }

    forBinding(
        binding: TCriticMarkupBlockStateBinding,
        contentQuery?: IContentCarrierQuery,
    ): readonly INodeCarrier[] | null {
        if (binding.kind === 'boundary') {
            if (binding.localRange.start !== binding.localRange.end)
                return null;
            const point
                = binding.sourceRange.start + binding.localRange.start;
            if (
                point < binding.sourceRange.start
                || binding.sourceRange.end < point
            ) {
                return null;
            }
            return this.boundary(
                point,
                binding.edge,
            );
        }
        return contentQuery
            ? this.content(contentQuery.start, contentQuery.end)
            : null;
    }
}

function contentCarrierQuery(
    binding: TCriticMarkupBlockStateBinding,
    sourceNode: { readonly start: number; readonly end: number },
): IContentCarrierQuery | null {
    if (binding.kind !== 'content')
        return null;
    const semanticStart
        = binding.sourceRange.start + binding.localRange.start;
    const semanticEnd = binding.sourceRange.start + binding.localRange.end;
    const start = Math.max(semanticStart, sourceNode.start);
    const end = Math.min(semanticEnd, sourceNode.end);
    return start < end ? { start, end } : null;
}

function rebindBlock(
    source: TTrackedMarkdown,
    target: TTrackedMarkdown,
    sourceIndex: NodeCarrierIndex,
    targetIndex: NodeCarrierIndex,
    binding: TCriticMarkupBlockStateBinding,
): TCriticMarkupBlockStateBinding {
    const sourceNode = source.sourceMap.nodeRange(binding.path);
    if (!sourceNode) {
        throw new TypeError(
            `Native block CriticMarkup binding ${binding.itemId} is detached from its parser state revision.`,
        );
    }
    const contentQuery = contentCarrierQuery(binding, sourceNode);
    const sourceChain = sourceIndex.forBinding(binding, contentQuery ?? undefined);
    const sourceRank = sourceChain
        ? sourceChain.findIndex(carrier =>
                mappedPathsEqual(carrier.path, binding.path))
        : -1;
    if (!sourceChain || sourceRank === -1) {
        throw new TypeError(
            `Native block CriticMarkup binding ${binding.itemId} has no parser-owned carrier.`,
        );
    }
    const rankFromInnermost = sourceChain.length - 1 - sourceRank;
    const targetChain = targetIndex.forBinding(
        binding,
        contentQuery ?? undefined,
    );
    const targetCarrier = targetChain?.at(-1 - rankFromInnermost);
    if (!targetCarrier) {
        throw new TypeError(
            `Native block CriticMarkup binding ${binding.itemId} cannot bind to the live state revision.`,
        );
    }
    if (!target.sourceMap.nodeRange(targetCarrier.path)) {
        throw new TypeError(
            `Native block CriticMarkup binding ${binding.itemId} has no live state node.`,
        );
    }
    return Object.freeze({ ...binding, path: targetCarrier.path });
}

/**
 * Transplant parser-owned inline topology onto another exact-source state map.
 *
 * The native parser remains the sole classifier: item identity, type, arm,
 * role, and segment meaning all come from its authenticated graph. Only
 * state-local coordinates are rebound, and every source byte must map
 * contiguously to one live text leaf or the operation fails closed.
 */
export function rebindCriticMarkupStateBindings(
    graph: ICriticMarkupStateBindingGraph,
    source: TTrackedMarkdown,
    target: TTrackedMarkdown,
): ICriticMarkupStateBindingGraph {
    if (source.text !== target.text) {
        throw new TypeError(
            'CriticMarkup state bindings require one exact source revision.',
        );
    }
    const sourceIndex = new NodeCarrierIndex(source);
    const targetIndex = new NodeCarrierIndex(target);
    return Object.freeze({
        block: Object.freeze(graph.block.map(binding =>
            rebindBlock(
                source,
                target,
                sourceIndex,
                targetIndex,
                binding,
            ))),
        inline: Object.freeze(graph.inline.map(binding =>
            rebindInline(source, target, binding))),
    });
}
