import type { TMappedTextPath } from '../mapped-range';
import type {
    IMappedTextSpan,
    MappedText,
    TLocalRange,
    TSourceOffset,
    TSourceRange,
} from '../mappedText';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type { TCriticMarkupDocumentToken } from './analysis';
import type {
    ICriticMarkupBindingGraph,
    ICriticMarkupInlineBinding,
    TCriticMarkupBlockBinding,
} from './bindingGraph';
import type { ICriticMarkupSemanticItemNode } from './grammarBindings';
import {
    MappedPathIndex,
    mappedPathsEqual,
} from '../mapped-range';
import {
    localRange as mappedLocalRange,
    sourceRange as mappedSourceRange,
} from '../mappedText';
import { criticMarkupSemanticItemNodes } from './grammarBindings';
import { exceedsCriticMarkupParseDepthBudget } from './renderPolicy';

/**
 * Native parser-binding validation and fragment assembly. This module
 * authenticates a parser-owned binding graph against one exact mapped
 * revision and materializes the immutable fragment topology that
 * CriticMarkupDocument indexes; the document itself never re-derives
 * topology from spans.
 */

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

type ICriticMarkupItemBuilder = ICriticMarkupSemanticItemNode;

export const EMPTY_FRAGMENT_INPUTS: readonly never[] = Object.freeze([]);

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
    readonly binding: ICriticMarkupInlineBinding<Path>;
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
    builder: ICriticMarkupItemBuilder,
    binding: ICriticMarkupInlineBinding<Path>,
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
        .find(candidate => candidate.arm === binding.arm)
        ?.range;
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
    builders: readonly ICriticMarkupItemBuilder[],
    graph: ICriticMarkupBindingGraph<Path>,
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
                && !group.bindings.every(candidate =>
                    candidate.binding.arm === first.binding.arm)
            ) {
                // One arm may split across soft line breaks inside a single
                // leaf; only substitutions may link fragments of DIFFERENT
                // arms on one path.
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
    builder: ICriticMarkupItemBuilder,
    binding: TCriticMarkupBlockBinding<Path>,
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
        .find(candidate => candidate.arm === binding.arm)
        ?.range;
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
    if (binding.kind === 'content') {
        // Every semantic byte the node owns must be a byte of the bound
        // arm. Whitespace pieces may fall outside it: the state model
        // re-owns the node's line terminator and displaced spacing trivia
        // across the woven critic markers (a flush close weaves inside the
        // terminator, so the terminator piece sits past the arm's end).
        for (const piece of mappedText.sourceMap.nodes) {
            if (!mappedPathsEqual(piece.path, mappedNode.path))
                continue;
            const leftOverhangEnd = Math.min(
                piece.sourceEnd,
                contentSourceRange.start,
            );
            const rightOverhangStart = Math.max(
                piece.sourceStart,
                contentSourceRange.end,
            );
            const overhang = mappedText.text.slice(
                piece.sourceStart,
                leftOverhangEnd,
            ) + mappedText.text.slice(rightOverhangStart, piece.sourceEnd);
            if (!/^[ \t\r\n]*$/.test(overhang)) {
                throw new RangeError(
                    `Native CriticMarkup binding ${binding.itemId} node is outside its native content range.`,
                );
            }
        }
    }

    return { path: mappedNode.path, contentSourceRange };
}

function structuralFragmentsFromNativeBindings<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    builders: readonly ICriticMarkupItemBuilder[],
    graph: ICriticMarkupBindingGraph<Path>,
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

/** True when every semantic arm of the item carries only whitespace. */
function isWhitespaceOnlyItem(
    source: string,
    syntax: TCriticMarkupDocumentToken,
): boolean {
    const armRanges = syntax.type === 'substitution'
        ? [syntax.oldRange, syntax.newRange]
        : [syntax.contentRange];
    return armRanges.every(range =>
        !/\S/.test(source.slice(range.start, range.end)));
}

export function flattenItems<Path extends TMappedTextPath>(
    mappedText: MappedText<Path>,
    tokens: readonly TCriticMarkupDocumentToken[],
    nativeBindings: ICriticMarkupBindingGraph<Path>,
): ICriticMarkupDocumentItem<Path>[] {
    const builders = criticMarkupSemanticItemNodes(tokens);
    const nativeInlineFragments = inlineFragmentsFromNativeBindings(
        mappedText,
        builders,
        nativeBindings,
    );
    const nativeStructuralFragments = structuralFragmentsFromNativeBindings(
        mappedText,
        builders,
        nativeBindings,
    );
    // A spanless mapped text renders nothing, so zero fragments is the exact
    // topology for every item; completeness is only provable against leaves.
    const missing = mappedText.sourceMap.spans.length === 0
        ? undefined
        : builders.find(builder =>
                !nativeInlineFragments.has(builder.id)
                && !nativeStructuralFragments.has(builder.id)
                // Items beyond the parse depth budget are fragment-free by
                // documented policy — their bytes stay literal inside the
                // deepest planned fragment — not by inference failure.
                && !exceedsCriticMarkupParseDepthBudget(builder.depth)
                // Whitespace-only forms (separators, zero-width markers) have
                // no renderable content; path domains without boundary
                // carriers (the marked parser domain) legitimately leave them
                // fragment-free.
                && !isWhitespaceOnlyItem(mappedText.text, builder.syntax));
    if (missing) {
        throw new TypeError(
            `Native CriticMarkup state binding graph does not account for semantic item ${missing.id}.`,
        );
    }
    return builders.map(builder => ({
        id: builder.id,
        parentId: builder.parentId,
        depth: builder.depth,
        syntax: builder.syntax,
        fragments: nativeInlineFragments.get(builder.id) ?? [],
        structuralFragments:
            nativeStructuralFragments.get(builder.id) ?? [],
    }));
}

export function flattenSemanticItems<Path extends TMappedTextPath>(
    tokens: readonly TCriticMarkupDocumentToken[],
): ICriticMarkupDocumentItem<Path>[] {
    return criticMarkupSemanticItemNodes(tokens).map(builder => ({
        id: builder.id,
        parentId: builder.parentId,
        depth: builder.depth,
        syntax: builder.syntax,
        fragments: EMPTY_FRAGMENT_INPUTS,
        structuralFragments: EMPTY_FRAGMENT_INPUTS,
    }));
}
