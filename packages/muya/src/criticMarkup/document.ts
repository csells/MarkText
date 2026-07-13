import type { TMappedTextPath } from '../mapped-range';
import type {
    IMappedTextSpan,
    MappedText,
    TBoundaryAffinity,
    TLocalOffset,
    TLocalRange,
    TSourceOffset,
    TSourceRange,
} from '../mappedText';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type {
    ICriticMarkupInlineStateBinding,
    ICriticMarkupStateBindingGraph,
    TCriticMarkupBlockStateBinding,
} from '../state/markdownToState';
import type {
    CriticMarkupAnalysis,
    TCriticMarkupAnalysisProfile,
    TCriticMarkupContextCoverage,
    TCriticMarkupDocumentToken,
} from './analysis';
import type { ExcludedRanges } from './excludedRanges';
import type {
    TCriticMarkupDecision,
    TCriticMarkupProjection,
} from './project';
import {
    HalfOpenIntervalIndex,
    MappedPathIndex,
    mappedPathsEqual,
} from '../mapped-range';
import {
    localOffset as mappedLocalOffset,
    localRange as mappedLocalRange,
    sourceRange as mappedSourceRange,
} from '../mappedText';
import {
    projectCriticMarkupItem,
    projectCriticMarkupSourceRange,
} from './project';

export type {
    ICriticMarkupDocumentContentToken,
    ICriticMarkupDocumentMarker,
    ICriticMarkupDocumentSubstitutionToken,
    TCriticMarkupDocumentToken,
} from './analysis';

export type TCriticMarkupFragmentRole = 'only' | 'start' | 'middle' | 'end';
export type TCriticMarkupFragmentArm = 'content' | 'old' | 'new' | 'comment';
export type TCriticMarkupMarkerName = 'open' | 'separator' | 'close';

export interface ICriticMarkupContentFragmentSegment {
    readonly kind: 'content';
    readonly arm: TCriticMarkupFragmentArm;
    readonly localRange: TLocalRange;
    readonly sourceRange: TSourceRange;
}

export interface ICriticMarkupMarkerFragmentSegment {
    readonly kind: 'marker';
    readonly marker: TCriticMarkupMarkerName;
    readonly localRange: TLocalRange;
    readonly sourceRange: TSourceRange;
}

export type TCriticMarkupFragmentSegment
    = | ICriticMarkupContentFragmentSegment
        | ICriticMarkupMarkerFragmentSegment;

export interface ICriticMarkupDocumentFragment<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly path: Readonly<Path>;
    readonly role: TCriticMarkupFragmentRole;
    readonly localRange: TLocalRange;
    readonly sourceRange: TSourceRange;
    readonly segments: readonly TCriticMarkupFragmentSegment[];
}

export interface ICriticMarkupStructuralContentFragment<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly kind: 'content';
    readonly path: Readonly<Path>;
    readonly role: TCriticMarkupFragmentRole;
    readonly arm: TCriticMarkupFragmentArm;
    readonly sourceRange: TSourceRange;
}

export interface ICriticMarkupStructuralBoundaryFragment<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly kind: 'boundary';
    readonly path: Readonly<Path>;
    readonly edge: 'before' | 'after';
    readonly sourceOffset: TSourceOffset;
}

export type ICriticMarkupStructuralFragment<
    Path extends TMappedTextPath = TMarkdownStatePath,
> = ICriticMarkupStructuralContentFragment<Path>
    | ICriticMarkupStructuralBoundaryFragment<Path>;

export interface ICriticMarkupDocumentItem<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    /** Session-local identity. It is never serialized into Markdown. */
    readonly id: string;
    readonly parentId: string | null;
    readonly depth: number;
    readonly syntax: TCriticMarkupDocumentToken;
    readonly fragments: readonly ICriticMarkupDocumentFragment<Path>[];
    readonly structuralFragments: readonly ICriticMarkupStructuralFragment<Path>[];
}

/**
 * One canonical item/fragment pair in parser order for a rendered block path.
 * Render adapters consume this index; they must not rediscover fragments by
 * walking every document item on each render.
 */
export interface ICriticMarkupDocumentFragmentInput<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly item: ICriticMarkupDocumentItem<Path>;
    readonly fragment: ICriticMarkupDocumentFragment<Path>;
}

export interface ICriticMarkupStructuralFragmentInput<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly item: ICriticMarkupDocumentItem<Path>;
    readonly fragment: ICriticMarkupStructuralFragment<Path>;
}

type TCriticMarkupSemanticSourceSegment
    = | {
        kind: 'content';
        arm: TCriticMarkupFragmentArm;
        sourceRange: TSourceRange;
    }
    | {
        kind: 'marker';
        marker: TCriticMarkupMarkerName;
        sourceRange: TSourceRange;
    };

export interface ICriticMarkupLocalPosition<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    path: Path;
    offset: TLocalOffset;
}

export interface ICriticMarkupSelectionEndpoint {
    path: TMarkdownStatePath;
    offset: number;
}

interface IMutableDocumentFragment<Path extends TMappedTextPath> {
    readonly path: Path;
    localStart: number;
    localEnd: number;
    readonly segments: TCriticMarkupFragmentSegment[];
}

interface ICriticMarkupItemBuilder<Path extends TMappedTextPath> {
    readonly id: string;
    readonly parentId: string | null;
    readonly depth: number;
    readonly syntax: TCriticMarkupDocumentToken;
    readonly fragmentsByPath: MappedPathIndex<
        Path,
        IMutableDocumentFragment<Path>
    >;
    readonly fragments: IMutableDocumentFragment<Path>[];
}

interface ISemanticSegmentEvent<Path extends TMappedTextPath> {
    readonly item: ICriticMarkupItemBuilder<Path>;
    readonly segment: TCriticMarkupSemanticSourceSegment;
}

type IPathItemIndexEntry<Path extends TMappedTextPath>
    = ICriticMarkupDocumentFragmentInput<Path>;

const EMPTY_FRAGMENT_INPUTS: readonly never[] = Object.freeze([]);

/** Freeze a semantic forest iteratively so adversarial nesting cannot overflow. */
function deepFreezeSemanticGraph<T>(root: T): T {
    const pending: object[] = [];
    const seen = new WeakSet<object>();
    if (root !== null && typeof root === 'object')
        pending.push(root as object);

    while (pending.length) {
        const current = pending.pop()!;
        if (seen.has(current))
            continue;
        seen.add(current);
        for (const value of Object.values(current)) {
            if (value !== null && typeof value === 'object')
                pending.push(value);
        }
        Object.freeze(current);
    }
    return root;
}

function rangesIntersect(
    left: TSourceRange,
    right: TSourceRange,
): boolean {
    return left.start < right.end && right.start < left.end;
}

function intersectRanges(
    left: TSourceRange,
    right: TSourceRange,
): TSourceRange | null {
    if (!rangesIntersect(left, right))
        return null;

    return mappedSourceRange(
        Math.max(left.start, right.start),
        Math.min(left.end, right.end),
    );
}

function sourceRangeOf<Path extends TMappedTextPath>(
    span: IMappedTextSpan<Path>,
): TSourceRange {
    return mappedSourceRange(span.sourceStart, span.sourceEnd);
}

function localRangeFor<Path extends TMappedTextPath>(
    span: IMappedTextSpan<Path>,
    sourceRange: TSourceRange,
): TLocalRange {
    return mappedLocalRange(
        span.localStart + sourceRange.start - span.sourceStart,
        span.localStart + sourceRange.end - span.sourceStart,
    );
}

function semanticSegments(
    token: TCriticMarkupDocumentToken,
): TCriticMarkupSemanticSourceSegment[] {
    const marker = (
        name: TCriticMarkupMarkerName,
        sourceRange: TSourceRange,
    ): TCriticMarkupSemanticSourceSegment => ({
        kind: 'marker',
        marker: name,
        sourceRange,
    });
    const content = (
        arm: TCriticMarkupFragmentArm,
        sourceRange: TSourceRange,
    ): TCriticMarkupSemanticSourceSegment => ({
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
        content(token.type === 'comment' ? 'comment' : 'content', token.contentRange),
        marker('close', token.markers.close.range),
    ];
}

function itemBuilders<Path extends TMappedTextPath>(
    tokens: readonly TCriticMarkupDocumentToken[],
): ICriticMarkupItemBuilder<Path>[] {
    const result: ICriticMarkupItemBuilder<Path>[] = [];
    const pending: Array<{
        syntax: TCriticMarkupDocumentToken;
        parentId: string | null;
        depth: number;
    }> = [];
    for (let index = tokens.length - 1; index >= 0; index--) {
        pending.push({
            syntax: tokens[index],
            parentId: null,
            depth: 0,
        });
    }

    while (pending.length) {
        const { syntax, parentId, depth } = pending.pop()!;
        const id = `critic-${syntax.range.start}-${syntax.range.end}`;
        result.push({
            id,
            parentId,
            depth,
            syntax,
            fragmentsByPath: new MappedPathIndex(),
            fragments: [],
        });
        if (syntax.nested?.length) {
            for (
                let index = syntax.nested.length - 1;
                index >= 0;
                index--
            ) {
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

function segmentEvents<Path extends TMappedTextPath>(
    builders: readonly ICriticMarkupItemBuilder<Path>[],
): ISemanticSegmentEvent<Path>[] {
    const events: ISemanticSegmentEvent<Path>[] = [];
    for (const item of builders) {
        for (const segment of semanticSegments(item.syntax)) {
            if (segment.sourceRange.start < segment.sourceRange.end)
                events.push({ item, segment });
        }
    }

    return events;
}

function sameSemanticSegment(
    left: TCriticMarkupFragmentSegment,
    right: TCriticMarkupFragmentSegment,
): boolean {
    if (left.kind !== right.kind)
        return false;
    if (left.kind === 'marker' && right.kind === 'marker')
        return left.marker === right.marker;
    if (left.kind === 'content' && right.kind === 'content')
        return left.arm === right.arm;
    return false;
}

function mutableFragment<Path extends TMappedTextPath>(
    item: ICriticMarkupItemBuilder<Path>,
    path: Path,
): IMutableDocumentFragment<Path> {
    const existing = item.fragmentsByPath.get(path);
    if (existing)
        return existing;

    const created: IMutableDocumentFragment<Path> = {
        path,
        localStart: Number.POSITIVE_INFINITY,
        localEnd: Number.NEGATIVE_INFINITY,
        segments: [],
    };
    item.fragmentsByPath.set(path, created);
    item.fragments.push(created);
    return created;
}

function appendFragmentSegment<Path extends TMappedTextPath>(
    event: ISemanticSegmentEvent<Path>,
    span: IMappedTextSpan<Path>,
): void {
    const sourceRange = intersectRanges(
        sourceRangeOf(span),
        event.segment.sourceRange,
    );
    if (!sourceRange)
        return;

    const fragment = mutableFragment(event.item, span.path);
    const localRange = localRangeFor(span, sourceRange);
    const segment: TCriticMarkupFragmentSegment = event.segment.kind === 'marker'
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
    const previous = fragment.segments.at(-1);
    if (
        previous
        && sameSemanticSegment(previous, segment)
        && previous.localRange.end === segment.localRange.start
        && previous.sourceRange.end === segment.sourceRange.start
    ) {
        fragment.segments[fragment.segments.length - 1] = {
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
        fragment.segments.push(segment);
    }
    if (localRange.start < fragment.localStart)
        fragment.localStart = localRange.start;
    if (localRange.end > fragment.localEnd)
        fragment.localEnd = localRange.end;
}

/**
 * Intersect every mapped identity span with the active semantic segments in
 * one monotonic source sweep. Work is proportional to input events, spans,
 * and the fragment segments that the immutable document must actually store.
 */
function buildFragmentsByItem<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    builders: readonly ICriticMarkupItemBuilder<Path>[],
): void {
    const events = segmentEvents(builders);
    const eventsByStart = [...events].sort((left, right) =>
        left.segment.sourceRange.start - right.segment.sourceRange.start
        || left.segment.sourceRange.end - right.segment.sourceRange.end);
    const eventsByEnd = [...events].sort((left, right) =>
        left.segment.sourceRange.end - right.segment.sourceRange.end
        || left.segment.sourceRange.start - right.segment.sourceRange.start);
    const active = new Set<ISemanticSegmentEvent<Path>>();
    let startIndex = 0;
    let endIndex = 0;

    for (const span of mappedText.sourceMap.spans) {
        if (span.sourceStart === span.sourceEnd)
            continue;
        while (
            endIndex < eventsByEnd.length
            && eventsByEnd[endIndex].segment.sourceRange.end <= span.sourceStart
        ) {
            active.delete(eventsByEnd[endIndex]);
            endIndex++;
        }
        while (
            startIndex < eventsByStart.length
            && eventsByStart[startIndex].segment.sourceRange.start < span.sourceEnd
        ) {
            const event = eventsByStart[startIndex++];
            if (span.sourceStart < event.segment.sourceRange.end)
                active.add(event);
        }
        for (const event of active)
            appendFragmentSegment(event, span);
    }
}

function finalizedFragments<Path extends TMappedTextPath>(
    builder: ICriticMarkupItemBuilder<Path>,
): ICriticMarkupDocumentFragment<Path>[] {
    const fragments = builder.fragments.map((fragment) => {
        const first = fragment.segments[0];
        const last = fragment.segments.at(-1);
        if (!first || !last) {
            throw new TypeError(
                'Mapped CriticMarkup fragment has no semantic segments.',
            );
        }
        return {
            path: fragment.path,
            role: 'only' as const,
            localRange: mappedLocalRange(
                fragment.localStart,
                fragment.localEnd,
            ),
            sourceRange: mappedSourceRange(
                first.sourceRange.start,
                last.sourceRange.end,
            ),
            segments: fragment.segments,
        };
    }).sort((left, right) =>
        left.sourceRange.start - right.sourceRange.start
        || left.sourceRange.end - right.sourceRange.end);

    return fragments.map((fragment, index) => ({
        ...fragment,
        role: fragments.length === 1
            ? 'only'
            : index === 0
                ? 'start'
                : index === fragments.length - 1
                    ? 'end'
                    : 'middle',
    }));
}

function structuralArmRanges(
    token: TCriticMarkupDocumentToken,
): Array<{
    arm: TCriticMarkupFragmentArm;
    range: TSourceRange;
}> {
    if (token.type === 'comment')
        return [{ arm: 'comment', range: token.contentRange }];
    if (token.type === 'substitution') {
        return [
            { arm: 'old', range: token.oldRange },
            { arm: 'new', range: token.newRange },
        ];
    }
    return [{ arm: 'content', range: token.contentRange }];
}

interface IValidatedNativeBlockBinding<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly contentSourceRange: TSourceRange;
}

interface INativeInlineLeaf<Path extends TMappedTextPath> {
    readonly path: Path;
    readonly spans: readonly IMappedTextSpan<Path>[];
}

interface IValidatedNativeInlineBinding<Path extends TMappedTextPath> {
    readonly binding: ICriticMarkupInlineStateBinding;
    readonly path: Path;
    readonly localRange: TLocalRange;
    readonly sourceRange: TSourceRange;
    readonly segments: readonly TCriticMarkupFragmentSegment[];
}

const NATIVE_BINDING_ROLES = new Set<TCriticMarkupFragmentRole>([
    'only',
    'start',
    'middle',
    'end',
]);

function isRuntimeArray(value: unknown): boolean {
    return Array.isArray(value);
}

function nativeInlineLeaves<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
): MappedPathIndex<TMappedTextPath, INativeInlineLeaf<Path>> {
    const mutable = new MappedPathIndex<
        TMappedTextPath,
        { path: Path; spans: IMappedTextSpan<Path>[] }
    >();
    for (const span of mappedText.sourceMap.spans) {
        const existing = mutable.get(span.path);
        if (existing) {
            existing.spans.push(span);
        }
        else {
            mutable.set(span.path, {
                path: span.path,
                spans: [span],
            });
        }
    }

    const result = new MappedPathIndex<
        TMappedTextPath,
        INativeInlineLeaf<Path>
    >();
    for (const [path, leaf] of mutable.entries()) {
        result.set(path, {
            path: leaf.path,
            spans: Object.freeze(leaf.spans),
        });
    }
    return result;
}

function validateNativeInlineRange(
    range: { readonly start: number; readonly end: number },
    maximum: number,
    itemId: string,
    label: string,
): void {
    if (
        !Number.isSafeInteger(range.start)
        || !Number.isSafeInteger(range.end)
        || range.start < 0
        || range.end <= range.start
        || maximum < range.end
    ) {
        throw new RangeError(
            `Native inline CriticMarkup binding ${itemId} has an invalid ${label} range.`,
        );
    }
}

function assertExactNativeInlineMapping<Path extends TMappedTextPath>(
    leaf: INativeInlineLeaf<Path>,
    localRange: { readonly start: number; readonly end: number },
    sourceRange: { readonly start: number; readonly end: number },
    itemId: string,
): void {
    if (
        localRange.end - localRange.start
        !== sourceRange.end - sourceRange.start
    ) {
        throw new RangeError(
            `Native inline CriticMarkup binding ${itemId} has unequal mapped range lengths.`,
        );
    }

    let localCursor = localRange.start;
    let sourceCursor = sourceRange.start;
    for (const span of leaf.spans) {
        if (span.localEnd <= localCursor)
            continue;
        if (localRange.end <= localCursor)
            break;
        if (
            span.localStart > localCursor
            || span.localEnd <= localCursor
        ) {
            break;
        }
        const mappedSource = span.sourceStart
            + localCursor
            - span.localStart;
        if (mappedSource !== sourceCursor)
            break;
        const length = Math.min(
            localRange.end - localCursor,
            span.localEnd - localCursor,
        );
        localCursor += length;
        sourceCursor += length;
    }
    if (
        localCursor !== localRange.end
        || sourceCursor !== sourceRange.end
    ) {
        throw new RangeError(
            `Native inline CriticMarkup binding ${itemId} is not an exact mapped leaf range.`,
        );
    }
}

function nativeMarkerRange(
    token: TCriticMarkupDocumentToken,
    marker: TCriticMarkupMarkerName,
): TSourceRange | null {
    if (marker === 'open')
        return token.markers.open.range;
    if (marker === 'close')
        return token.markers.close.range;
    return token.type === 'substitution'
        ? token.markers.separator.range
        : null;
}

function containsRange(
    container: { readonly start: number; readonly end: number },
    nested: { readonly start: number; readonly end: number },
): boolean {
    return container.start <= nested.start && nested.end <= container.end;
}

function validateNativeInlineBinding<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    leaves: MappedPathIndex<TMappedTextPath, INativeInlineLeaf<Path>>,
    builder: ICriticMarkupItemBuilder<Path>,
    binding: ICriticMarkupInlineStateBinding,
): IValidatedNativeInlineBinding<Path> {
    if (binding.criticType !== builder.syntax.type) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} has type ${binding.criticType}, expected ${builder.syntax.type}.`,
        );
    }
    if (!NATIVE_BINDING_ROLES.has(binding.role)) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} has an invalid role.`,
        );
    }
    const armRange = structuralArmRanges(builder.syntax)
        .find(candidate => candidate.arm === binding.arm)?.range;
    if (!armRange) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} names an invalid semantic arm.`,
        );
    }

    const leaf = leaves.get(binding.path);
    if (!leaf) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} path has no mapped text leaf.`,
        );
    }
    const localMaximum = leaf.spans.at(-1)?.localEnd ?? 0;
    validateNativeInlineRange(
        binding.localRange,
        localMaximum,
        binding.itemId,
        'leaf-local',
    );
    validateNativeInlineRange(
        binding.sourceRange,
        mappedText.text.length,
        binding.itemId,
        'source',
    );
    if (!containsRange(builder.syntax.range, binding.sourceRange)) {
        throw new RangeError(
            `Native inline CriticMarkup binding ${binding.itemId} escapes its semantic item.`,
        );
    }
    if (!isRuntimeArray(binding.segments) || !binding.segments.length) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${binding.itemId} has no segments.`,
        );
    }

    const segments: TCriticMarkupFragmentSegment[] = [];
    let localCursor = binding.localRange.start;
    let sourceCursor = binding.sourceRange.start;
    for (const segment of binding.segments) {
        validateNativeInlineRange(
            segment.localRange,
            localMaximum,
            binding.itemId,
            'segment-local',
        );
        validateNativeInlineRange(
            segment.sourceRange,
            mappedText.text.length,
            binding.itemId,
            'segment-source',
        );
        if (
            segment.localRange.start < localCursor
            || segment.sourceRange.start < sourceCursor
            || !containsRange(binding.localRange, segment.localRange)
            || !containsRange(binding.sourceRange, segment.sourceRange)
        ) {
            throw new RangeError(
                `Native inline CriticMarkup binding ${binding.itemId} has unordered segment envelopes.`,
            );
        }
        assertExactNativeInlineMapping(
            leaf,
            segment.localRange,
            segment.sourceRange,
            binding.itemId,
        );

        if (segment.kind === 'marker') {
            const markerRange = nativeMarkerRange(
                builder.syntax,
                segment.marker,
            );
            if (!markerRange || !containsRange(markerRange, segment.sourceRange)) {
                throw new RangeError(
                    `Native inline CriticMarkup binding ${binding.itemId} has a marker outside its semantic range.`,
                );
            }
            segments.push({
                kind: 'marker',
                marker: segment.marker,
                localRange: mappedLocalRange(
                    segment.localRange.start,
                    segment.localRange.end,
                ),
                sourceRange: mappedSourceRange(
                    segment.sourceRange.start,
                    segment.sourceRange.end,
                ),
            });
        }
        else if (segment.kind === 'content') {
            if (
                segment.arm !== binding.arm
                || !containsRange(armRange, segment.sourceRange)
            ) {
                throw new RangeError(
                    `Native inline CriticMarkup binding ${binding.itemId} has content outside its semantic arm.`,
                );
            }
            segments.push({
                kind: 'content',
                arm: segment.arm,
                localRange: mappedLocalRange(
                    segment.localRange.start,
                    segment.localRange.end,
                ),
                sourceRange: mappedSourceRange(
                    segment.sourceRange.start,
                    segment.sourceRange.end,
                ),
            });
        }
        else {
            const unexpected: never = segment;
            throw new TypeError(
                `Unknown native inline CriticMarkup segment: ${String(unexpected)}.`,
            );
        }
        localCursor = segment.localRange.end;
        sourceCursor = segment.sourceRange.end;
    }

    return {
        binding,
        path: leaf.path,
        localRange: mappedLocalRange(
            binding.localRange.start,
            binding.localRange.end,
        ),
        sourceRange: mappedSourceRange(
            binding.sourceRange.start,
            binding.sourceRange.end,
        ),
        segments,
    };
}

function groupedNativeInlineRole<Path extends TMappedTextPath>(
    bindings: readonly IValidatedNativeInlineBinding<Path>[],
): TCriticMarkupFragmentRole {
    const [first] = bindings;
    const last = bindings.at(-1);
    if (!first || !last)
        throw new TypeError('Native inline CriticMarkup fragment group is empty.');
    if (bindings.length === 1)
        return first.binding.role;
    if (bindings.some(binding => binding.binding.role === 'only')) {
        throw new TypeError(
            `Native inline CriticMarkup binding ${first.binding.itemId} links an only fragment.`,
        );
    }
    for (let index = 0; index < bindings.length; index++) {
        const role = bindings[index].binding.role;
        if (
            (role === 'start' && index !== 0)
            || (role === 'end' && index !== bindings.length - 1)
        ) {
            throw new TypeError(
                `Native inline CriticMarkup binding ${first.binding.itemId} has unordered linked roles.`,
            );
        }
    }
    if (first.binding.role === 'end' || last.binding.role === 'start') {
        throw new TypeError(
            `Native inline CriticMarkup binding ${first.binding.itemId} has invalid linked roles.`,
        );
    }
    if (first.binding.role === 'start' && last.binding.role === 'end')
        return 'only';
    if (first.binding.role === 'start')
        return 'start';
    if (last.binding.role === 'end')
        return 'end';
    return 'middle';
}

function inlineFragmentsFromNativeBindings<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    builders: readonly ICriticMarkupItemBuilder<Path>[],
    graph: ICriticMarkupStateBindingGraph,
): ReadonlyMap<string, readonly ICriticMarkupDocumentFragment<Path>[]> {
    if (!isRuntimeArray(graph.inline)) {
        throw new TypeError(
            'Native CriticMarkup state binding graph has no inline bindings.',
        );
    }
    const leaves = nativeInlineLeaves(mappedText);
    const buildersById = new Map(builders.map(builder => [builder.id, builder]));
    const groupsById = new Map<
        string,
        MappedPathIndex<
            TMappedTextPath,
            { path: Path; bindings: IValidatedNativeInlineBinding<Path>[] }
        >
    >();
    for (const binding of graph.inline) {
        const builder = buildersById.get(binding.itemId);
        if (!builder) {
            throw new TypeError(
                `Native inline binding references unknown CriticMarkup item ${binding.itemId}.`,
            );
        }
        const validated = validateNativeInlineBinding(
            mappedText,
            leaves,
            builder,
            binding,
        );
        let groups = groupsById.get(builder.id);
        if (!groups) {
            groups = new MappedPathIndex();
            groupsById.set(builder.id, groups);
        }
        const group = groups.get(validated.path);
        if (group) {
            group.bindings.push(validated);
        }
        else {
            groups.set(validated.path, {
                path: validated.path,
                bindings: [validated],
            });
        }
    }

    const fragmentsById = new Map<
        string,
        readonly ICriticMarkupDocumentFragment<Path>[]
    >();
    for (const builder of builders) {
        const groups = groupsById.get(builder.id);
        if (!groups)
            continue;
        const fragments: ICriticMarkupDocumentFragment<Path>[] = [];
        for (const group of groups.values()) {
            const first = group.bindings[0];
            const last = group.bindings.at(-1);
            if (!first || !last)
                throw new TypeError('Native inline binding group is empty.');
            if (
                group.bindings.length > 1
                && builder.syntax.type !== 'substitution'
            ) {
                throw new TypeError(
                    `Native inline CriticMarkup binding ${builder.id} links a non-substitution item.`,
                );
            }
            for (let index = 1; index < group.bindings.length; index++) {
                const previous = group.bindings[index - 1];
                const current = group.bindings[index];
                if (
                    current.localRange.start < previous.localRange.end
                    || current.sourceRange.start < previous.sourceRange.end
                ) {
                    throw new RangeError(
                        `Native inline CriticMarkup binding ${builder.id} has unlinked fragment envelopes.`,
                    );
                }
            }
            fragments.push({
                path: group.path,
                role: groupedNativeInlineRole(group.bindings),
                localRange: mappedLocalRange(
                    first.localRange.start,
                    last.localRange.end,
                ),
                sourceRange: mappedSourceRange(
                    first.sourceRange.start,
                    last.sourceRange.end,
                ),
                segments: group.bindings.flatMap(binding =>
                    binding.segments),
            });
        }
        fragmentsById.set(builder.id, fragments);
    }
    return fragmentsById;
}

function validateNativeBlockBinding<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    builder: ICriticMarkupItemBuilder<Path>,
    binding: TCriticMarkupBlockStateBinding,
): IValidatedNativeBlockBinding<Path> {
    if (binding.criticType !== builder.syntax.type) {
        throw new TypeError(
            `Native CriticMarkup binding ${binding.itemId} has type ${binding.criticType}, expected ${builder.syntax.type}.`,
        );
    }
    if (!NATIVE_BINDING_ROLES.has(binding.role)) {
        throw new TypeError(
            `Native CriticMarkup binding ${binding.itemId} has an invalid role.`,
        );
    }

    const { start, end } = binding.sourceRange;
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end)
        || start < 0
        || end < start
        || mappedText.text.length < end
    ) {
        throw new RangeError(
            `Native CriticMarkup binding ${binding.itemId} is outside the mapped revision.`,
        );
    }
    if (start < builder.syntax.range.start || builder.syntax.range.end < end) {
        throw new RangeError(
            `Native CriticMarkup binding ${binding.itemId} escapes its semantic item.`,
        );
    }

    const localStart = binding.localRange.start;
    const localEnd = binding.localRange.end;
    if (
        !Number.isSafeInteger(localStart)
        || !Number.isSafeInteger(localEnd)
        || localStart < 0
        || localEnd < localStart
        || end - start < localEnd
    ) {
        throw new RangeError(
            `Native CriticMarkup binding ${binding.itemId} has an invalid fragment-local range.`,
        );
    }
    const contentSourceRange = mappedSourceRange(
        start + localStart,
        start + localEnd,
    );
    const armRange = structuralArmRanges(builder.syntax)
        .find(candidate => candidate.arm === binding.arm)?.range;
    if (!armRange) {
        throw new TypeError(
            `Native CriticMarkup binding ${binding.itemId} names an invalid semantic arm.`,
        );
    }
    if (
        contentSourceRange.start < armRange.start
        || armRange.end < contentSourceRange.end
    ) {
        throw new RangeError(
            `Native CriticMarkup binding ${binding.itemId} content is outside its semantic arm.`,
        );
    }
    if (
        binding.kind === 'content'
        && contentSourceRange.start === contentSourceRange.end
    ) {
        throw new RangeError(
            `Native CriticMarkup content binding ${binding.itemId} is empty.`,
        );
    }
    if (
        binding.kind === 'boundary'
        && contentSourceRange.start !== contentSourceRange.end
    ) {
        throw new RangeError(
            `Native CriticMarkup boundary binding ${binding.itemId} is not zero-width.`,
        );
    }

    const mappedNode = mappedText.sourceMap.nodes.find(node =>
        mappedPathsEqual(node.path, binding.path));
    if (!mappedNode) {
        throw new TypeError(
            `Native CriticMarkup binding ${binding.itemId} path has no node in the mapped revision.`,
        );
    }
    const nodeRange = mappedText.sourceMap.nodeRange(mappedNode.path);
    if (!nodeRange) {
        throw new TypeError(
            `Native CriticMarkup binding ${binding.itemId} path has no complete node range.`,
        );
    }
    if (
        binding.kind === 'content'
        && (
            nodeRange.start < contentSourceRange.start
            || contentSourceRange.end < nodeRange.end
        )
    ) {
        throw new RangeError(
            `Native CriticMarkup binding ${binding.itemId} node is outside its native content range.`,
        );
    }

    return { path: mappedNode.path, contentSourceRange };
}

function structuralFragmentsFromNativeBindings<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    builders: readonly ICriticMarkupItemBuilder<Path>[],
    graph: ICriticMarkupStateBindingGraph,
): ReadonlyMap<string, readonly ICriticMarkupStructuralFragment<Path>[]> {
    if (!isRuntimeArray(graph.block)) {
        throw new TypeError(
            'Native CriticMarkup state binding graph has no block bindings.',
        );
    }
    const buildersById = new Map(builders.map(builder => [builder.id, builder]));
    const fragmentsById = new Map<
        string,
        ICriticMarkupStructuralFragment<Path>[]
    >();
    for (const binding of graph.block) {
        const builder = buildersById.get(binding.itemId);
        if (!builder) {
            throw new TypeError(
                `Native binding references unknown CriticMarkup item ${binding.itemId}.`,
            );
        }
        const validated = validateNativeBlockBinding(
            mappedText,
            builder,
            binding,
        );
        const fragments = fragmentsById.get(builder.id) ?? [];
        if (binding.kind === 'content') {
            fragments.push({
                kind: 'content',
                path: validated.path,
                role: binding.role,
                arm: binding.arm,
                sourceRange: mappedSourceRange(
                    binding.sourceRange.start,
                    binding.sourceRange.end,
                ),
            });
        }
        else if (binding.kind === 'boundary') {
            fragments.push({
                kind: 'boundary',
                path: validated.path,
                edge: binding.edge,
                sourceOffset: validated.contentSourceRange.start,
            });
        }
        else {
            const unexpected: never = binding;
            throw new TypeError(
                `Unknown native CriticMarkup binding kind: ${String(unexpected)}.`,
            );
        }
        fragmentsById.set(builder.id, fragments);
    }
    return fragmentsById;
}

function flattenItems<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    tokens: readonly TCriticMarkupDocumentToken[],
    nativeBindings?: ICriticMarkupStateBindingGraph,
): ICriticMarkupDocumentItem<Path>[] {
    const builders = itemBuilders<Path>(tokens);
    const nativeInlineFragments = nativeBindings
        ? inlineFragmentsFromNativeBindings(
                mappedText,
                builders,
                nativeBindings,
            )
        : null;
    if (!nativeInlineFragments)
        buildFragmentsByItem(mappedText, builders);
    const nativeStructuralFragments = nativeBindings
        ? structuralFragmentsFromNativeBindings(
                mappedText,
                builders,
                nativeBindings,
            )
        : null;
    if (nativeInlineFragments && nativeStructuralFragments) {
        const missing = builders.find(builder =>
            !nativeInlineFragments.has(builder.id)
            && !nativeStructuralFragments.has(builder.id));
        if (missing) {
            throw new TypeError(
                `Native CriticMarkup state binding graph does not account for semantic item ${missing.id}.`,
            );
        }
    }
    return builders.map(builder => ({
        id: builder.id,
        parentId: builder.parentId,
        depth: builder.depth,
        syntax: builder.syntax,
        fragments: nativeInlineFragments
            ? nativeInlineFragments.get(builder.id) ?? []
            : finalizedFragments(builder),
        structuralFragments: nativeStructuralFragments
            ? nativeStructuralFragments.get(builder.id) ?? []
            : [],
    }));
}

function itemIndexes<Path extends TMappedTextPath>(items: readonly ICriticMarkupDocumentItem<Path>[]): {
    itemsById: ReadonlyMap<string, ICriticMarkupDocumentItem<Path>>;
    itemsByParent: ReadonlyMap<
        string | null,
        readonly ICriticMarkupDocumentItem<Path>[]
    >;
    itemsByPath: MappedPathIndex<
        Path,
        HalfOpenIntervalIndex<IPathItemIndexEntry<Path>>
    >;
    fragmentPaths: readonly Path[];
    structuralItemsByPath: MappedPathIndex<
        Path,
        readonly ICriticMarkupStructuralFragmentInput<Path>[]
    >;
    structuralFragmentPaths: readonly Path[];
} {
    const itemsById = new Map<string, ICriticMarkupDocumentItem<Path>>();
    const itemsByParent = new Map<string | null, ICriticMarkupDocumentItem<Path>[]>();
    const entriesByPath = new MappedPathIndex<Path, IPathItemIndexEntry<Path>[]>();
    const structuralItemsByPath = new MappedPathIndex<
        Path,
        ICriticMarkupStructuralFragmentInput<Path>[]
    >();

    for (const item of items) {
        itemsById.set(item.id, item);
        const siblings = itemsByParent.get(item.parentId) ?? [];
        siblings.push(item);
        itemsByParent.set(item.parentId, siblings);
        for (const fragment of item.fragments) {
            const entries = entriesByPath.get(fragment.path) ?? [];
            entries.push(Object.freeze({ item, fragment }));
            entriesByPath.set(fragment.path, entries);
        }
        for (const fragment of item.structuralFragments) {
            const entries = structuralItemsByPath.get(fragment.path) ?? [];
            entries.push(Object.freeze({ item, fragment }));
            structuralItemsByPath.set(fragment.path, entries);
        }
    }

    const itemsByPath = new MappedPathIndex<
        Path,
        HalfOpenIntervalIndex<IPathItemIndexEntry<Path>>
    >();
    for (const [path, entries] of entriesByPath.entries()) {
        entries.sort((left, right) =>
            left.fragment.localRange.start - right.fragment.localRange.start
            || left.item.depth - right.item.depth
            || right.fragment.localRange.end - left.fragment.localRange.end);
        itemsByPath.set(path, new HalfOpenIntervalIndex(entries.map(entry => ({
            start: entry.fragment.localRange.start,
            end: entry.fragment.localRange.end,
            value: entry,
        }))));
    }
    const frozenStructuralItemsByPath = new MappedPathIndex<
        Path,
        readonly ICriticMarkupStructuralFragmentInput<Path>[]
    >();
    for (const [path, entries] of structuralItemsByPath.entries())
        frozenStructuralItemsByPath.set(path, Object.freeze(entries));

    return {
        itemsById,
        itemsByParent: new Map([...itemsByParent].map(([parentId, children]) => [
            parentId,
            Object.freeze(children),
        ])),
        itemsByPath,
        fragmentPaths: Object.freeze([...itemsByPath.paths()]),
        structuralItemsByPath: frozenStructuralItemsByPath,
        structuralFragmentPaths: Object.freeze([
            ...structuralItemsByPath.paths(),
        ]),
    };
}

export class CriticMarkupDocument<
    Path extends TMappedTextPath = TMarkdownStatePath,
> {
    readonly analysis: CriticMarkupAnalysis;

    readonly items: readonly ICriticMarkupDocumentItem<Path>[];
    readonly roots: readonly TCriticMarkupDocumentToken[];
    readonly mappedText: MappedText<Path>;

    readonly markdown: string;

    readonly excludedRanges: ExcludedRanges;

    readonly #itemsById: ReadonlyMap<
        string,
        ICriticMarkupDocumentItem<Path>
    >;

    readonly #itemsByParent: ReadonlyMap<
        string | null,
        readonly ICriticMarkupDocumentItem<Path>[]
    >;

    readonly #itemsByPath: MappedPathIndex<
        Path,
        HalfOpenIntervalIndex<IPathItemIndexEntry<Path>>
    >;

    readonly #sourceIntervals: HalfOpenIntervalIndex<ICriticMarkupDocumentItem<Path>>;

    readonly #fragmentPaths: readonly Path[];
    readonly #structuralItemsByPath: MappedPathIndex<
        Path,
        readonly ICriticMarkupStructuralFragmentInput<Path>[]
    >;
    readonly #structuralFragmentPaths: readonly Path[];

    constructor(
        analysis: CriticMarkupAnalysis,
        source: MappedText<Path>,
        parserProfile: TCriticMarkupAnalysisProfile,
        contextCoverage: TCriticMarkupContextCoverage,
        nativeBindings?: ICriticMarkupStateBindingGraph,
    ) {
        if (analysis.source !== source.text) {
            throw new TypeError(
                'CriticMarkup analysis belongs to a different source revision.',
            );
        }
        analysis.assertParserProfile(parserProfile);
        analysis.assertContextCoverage(contextCoverage);
        this.analysis = analysis;
        this.mappedText = source;
        this.markdown = source.text;
        this.excludedRanges = analysis.excludedRanges;

        const items = flattenItems(
            this.mappedText,
            analysis.roots,
            nativeBindings,
        );
        const indexes = itemIndexes(items);
        this.roots = analysis.roots;
        this.items = deepFreezeSemanticGraph(items);
        this.#itemsById = indexes.itemsById;
        this.#itemsByParent = indexes.itemsByParent;
        this.#itemsByPath = indexes.itemsByPath;
        this.#fragmentPaths = indexes.fragmentPaths;
        this.#structuralItemsByPath = indexes.structuralItemsByPath;
        this.#structuralFragmentPaths = indexes.structuralFragmentPaths;
        this.#sourceIntervals = new HalfOpenIntervalIndex(items.map(item => ({
            start: item.syntax.range.start,
            end: item.syntax.range.end,
            value: item,
        })));
        Object.freeze(this);
    }

    itemById(id: string): ICriticMarkupDocumentItem<Path> | null {
        return this.#itemsById.get(id) ?? null;
    }

    childrenOf(parentId: string | null): readonly ICriticMarkupDocumentItem<Path>[] {
        return this.#itemsByParent.get(parentId) ?? [];
    }

    /**
     * Return the revision-cached, parser-ordered fragments for one live block.
     * The returned view is backed by the document's path index and is stable
     * for the lifetime of this immutable document.
     */
    fragmentsForPath(
        path: Path,
    ): readonly ICriticMarkupDocumentFragmentInput<Path>[] {
        return this.#itemsByPath.get(path)?.values() ?? EMPTY_FRAGMENT_INPUTS;
    }

    /** Every block path with at least one fragment, in parser order. */
    pathsWithFragments(): readonly Path[] {
        return this.#fragmentPaths;
    }

    structuralFragmentsForPath(
        path: Path,
    ): readonly ICriticMarkupStructuralFragmentInput<Path>[] {
        return this.#structuralItemsByPath.get(path)
            ?? EMPTY_FRAGMENT_INPUTS;
    }

    pathsWithStructuralFragments(): readonly Path[] {
        return this.#structuralFragmentPaths;
    }

    itemsContainingSourceRange(
        range: TSourceRange,
    ): readonly ICriticMarkupDocumentItem<Path>[] {
        return this.#sourceIntervals.containingRange(range.start, range.end).reverse();
    }

    itemIntersectingSourceRange(
        range: TSourceRange,
    ): ICriticMarkupDocumentItem<Path> | null {
        if (range.start === range.end) {
            return this.#sourceIntervals.containing(range.start)
                .reverse()
                .find(item => item.syntax.range.start < range.start) ?? null;
        }
        return this.#sourceIntervals.overlapping(range.start, range.end)
            .at(-1) ?? null;
    }

    itemStartingAtSourceOffset(
        sourceOffset: TSourceOffset,
    ): ICriticMarkupDocumentItem<Path> | null {
        return this.#sourceIntervals.startingAt(sourceOffset).at(-1) ?? null;
    }

    itemsContainedBySourceRange(
        range: TSourceRange,
    ): readonly ICriticMarkupDocumentItem<Path>[] {
        return this.#sourceIntervals.containedBy(range.start, range.end);
    }

    itemAt(
        path: Path,
        offset: TLocalOffset,
    ): ICriticMarkupDocumentItem<Path> | null {
        return this.#itemsByPath.get(path)?.containing(offset).at(-1)?.item
            ?? null;
    }

    itemContaining(
        path: Path,
        range: TLocalRange,
    ): ICriticMarkupDocumentItem<Path> | null {
        if (range.start === range.end)
            return this.itemAt(path, range.start);

        return this.#itemsByPath.get(path)?.containingRange(range.start, range.end).at(-1)?.item ?? null;
    }

    /**
     * Translate one live selection into the canonical source domain and
     * reject it when any part belongs to Markdown-owned literal syntax or an
     * existing CriticMarkup item. Commands must use this query instead of
     * maintaining a second inline-token context classifier.
     */
    authoringRange(
        this: CriticMarkupDocument<TMarkdownStatePath>,
        anchor: ICriticMarkupSelectionEndpoint,
        focus: ICriticMarkupSelectionEndpoint,
    ): TSourceRange | null {
        this.analysis.assertContextCoverage('complete');
        const anchorOffset = this.sourceOffsetAt(
            anchor.path,
            mappedLocalOffset(anchor.offset),
        );
        const focusOffset = this.sourceOffsetAt(
            focus.path,
            mappedLocalOffset(focus.offset),
        );
        if (anchorOffset === null || focusOffset === null)
            return null;

        const range = mappedSourceRange(
            Math.min(anchorOffset, focusOffset),
            Math.max(anchorOffset, focusOffset),
        );
        if (
            this.excludedRanges.overlaps(range)
            || this.itemIntersectingSourceRange(range) !== null
        ) {
            return null;
        }

        return range;
    }

    /**
     * Project one indexed item from this document's canonical source and
     * parser context. This is the resolution path for UI commands; the
     * grammar-only token helper cannot preserve Markdown-owned opaque slices.
     */
    projectItem(
        id: string,
        projection: TCriticMarkupProjection,
    ): string {
        const item = this.itemById(id);
        if (!item)
            throw new TypeError(`Unknown CriticMarkup document item: ${id}.`);

        return projectCriticMarkupItem(
            this.analysis.source,
            item.syntax,
            projection,
            this.excludedRanges,
        );
    }

    resolveItem(id: string, decision: TCriticMarkupDecision): string {
        return this.projectItem(
            id,
            decision === 'accept' ? 'revised' : 'original',
        );
    }

    /**
     * Project an exact canonical-source slice through this document's parsed
     * semantic forest. This is the authority for plain-text containers such
     * as image alternatives: render adapters supply coordinates but never
     * rescan CriticMarkup or reconstruct Markdown context locally.
     */
    projectSourceRange(
        range: TSourceRange,
        projection: TCriticMarkupProjection,
    ): string {
        const containedIds = new Set<string>();
        const directTokens: TCriticMarkupDocumentToken[] = [];
        for (const item of this.itemsContainedBySourceRange(range)) {
            if (!item.parentId || !containedIds.has(item.parentId))
                directTokens.push(item.syntax);
            containedIds.add(item.id);
        }

        return projectCriticMarkupSourceRange(
            this.analysis.source,
            range,
            projection,
            directTokens,
            this.excludedRanges,
        );
    }

    /** Resolve one live leaf-local range into this document's source domain. */
    sourceRangeForLocalRange(
        path: Path,
        range: TLocalRange,
    ): TSourceRange {
        return this.sourceRangeForLocalEndpoints(
            { path, offset: range.start },
            { path, offset: range.end },
        );
    }

    /** Resolve ordered live selection endpoints into the canonical source. */
    sourceRangeForLocalEndpoints(
        start: ICriticMarkupLocalPosition<Path>,
        end: ICriticMarkupLocalPosition<Path>,
    ): TSourceRange {
        const sourceStart = this.sourceOffsetAt(
            start.path,
            start.offset,
            'next',
        );
        const sourceEnd = this.sourceOffsetAt(
            end.path,
            end.offset,
            'previous',
        );
        if (sourceStart === null || sourceEnd === null) {
            throw new RangeError(
                'CriticMarkup selection endpoints are not mapped to canonical Markdown.',
            );
        }
        if (sourceEnd < sourceStart) {
            throw new RangeError(
                'CriticMarkup selection endpoints are not in source order.',
            );
        }

        return mappedSourceRange(sourceStart, sourceEnd);
    }

    /** Project a live leaf-local slice without leaving the mapped domain. */
    projectLocalRange(
        path: Path,
        range: TLocalRange,
        projection: TCriticMarkupProjection,
    ): string {
        return this.projectSourceRange(
            this.sourceRangeForLocalRange(path, range),
            projection,
        );
    }

    project(projection: TCriticMarkupProjection): string {
        return this.analysis.project(projection);
    }

    sourceOffsetAt(
        path: Path,
        localOffset: TLocalOffset,
        affinity?: TBoundaryAffinity,
    ): TSourceOffset | null {
        return this.mappedText.sourceMap.localToSource(
            path,
            localOffset,
            affinity,
        );
    }

    localPositionAt(
        sourceOffset: TSourceOffset,
        affinity?: TBoundaryAffinity,
    ): ICriticMarkupLocalPosition<Path> | null {
        const position = this.mappedText.sourceMap.sourceToLocal(
            sourceOffset,
            affinity,
        );
        return position
            ? { path: position.path, offset: position.offset }
            : null;
    }
}

export function createCriticMarkupDocument<
    Path extends TMappedTextPath = TMarkdownStatePath,
>(
    analysis: CriticMarkupAnalysis,
    source: MappedText<Path>,
    parserProfile: TCriticMarkupAnalysisProfile = Object.freeze({
        kind: 'grammar-only',
    }),
    contextCoverage: TCriticMarkupContextCoverage = 'grammar-only',
    nativeBindings?: ICriticMarkupStateBindingGraph,
): CriticMarkupDocument<Path> {
    return new CriticMarkupDocument(
        analysis,
        source,
        parserProfile,
        contextCoverage,
        nativeBindings,
    );
}
