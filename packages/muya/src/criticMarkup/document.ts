import type { TMappedTextPath } from '../mapped-range';
import type {
    MappedText,
    TBoundaryAffinity,
    TLocalOffset,
    TLocalRange,
    TSourceOffset,
    TSourceRange,
} from '../mappedText';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type {
    CriticMarkupAnalysis,
    TCriticMarkupAnalysisProfile,
    TCriticMarkupContextCoverage,
    TCriticMarkupDocumentToken,
} from './analysis';
import type { ICriticMarkupBindingGraph } from './bindingGraph';
import type { ExcludedRanges } from './excludedRanges';
import type {
    ICriticMarkupDocumentFragment,
    ICriticMarkupDocumentItem,
    ICriticMarkupStructuralFragment,
} from './nativeBindingTopology';
import type {
    TCriticMarkupDecision,
    TCriticMarkupProjection,
} from './project';
import {
    HalfOpenIntervalIndex,
    MappedPathIndex,
} from '../mapped-range';
import {
    localOffset as mappedLocalOffset,
    sourceRange as mappedSourceRange,
} from '../mappedText';
import { grammarCriticMarkupBindingGraph } from './grammarBindings';
import {
    EMPTY_FRAGMENT_INPUTS,
    flattenItems,
    flattenSemanticItems,
} from './nativeBindingTopology';
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

export type {
    ICriticMarkupContentFragmentSegment,
    ICriticMarkupDocumentFragment,
    ICriticMarkupDocumentItem,
    ICriticMarkupMarkerFragmentSegment,
    ICriticMarkupStructuralBoundaryFragment,
    ICriticMarkupStructuralContentFragment,
    ICriticMarkupStructuralFragment,
    TCriticMarkupFragmentArm,
    TCriticMarkupFragmentRole,
    TCriticMarkupFragmentSegment,
    TCriticMarkupMarkerName,
} from './nativeBindingTopology';

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

type IPathItemIndexEntry<Path extends TMappedTextPath>
    = ICriticMarkupDocumentFragmentInput<Path>;

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
    // A nested item's structural carrier is also owned by every ancestor
    // item: the shared native block presents both identities. Ancestors are
    // prepended (outermost first) unless they already bind that path.
    for (const item of items) {
        if (item.parentId === null || !item.structuralFragments.length)
            continue;
        const ancestors: ICriticMarkupDocumentItem<Path>[] = [];
        let parentId: string | null = item.parentId;
        while (parentId !== null) {
            const parent = itemsById.get(parentId);
            if (!parent) {
                throw new TypeError(
                    `Nested CriticMarkup item ${item.id} has unknown parent ${parentId}.`,
                );
            }
            ancestors.unshift(parent);
            parentId = parent.parentId;
        }
        for (const fragment of item.structuralFragments) {
            const entries = structuralItemsByPath.get(fragment.path) ?? [];
            const present = new Set(entries.map(entry => entry.item.id));
            const inherited = ancestors
                .filter(ancestor => !present.has(ancestor.id))
                .map(ancestor => Object.freeze({ item: ancestor, fragment }));
            if (inherited.length) {
                structuralItemsByPath.set(
                    fragment.path,
                    [...inherited, ...entries],
                );
            }
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
    readonly #semanticOnly: boolean;

    constructor(
        analysis: CriticMarkupAnalysis,
        source: MappedText<Path>,
        parserProfile: TCriticMarkupAnalysisProfile,
        contextCoverage: TCriticMarkupContextCoverage,
        nativeBindings: ICriticMarkupBindingGraph<Path> | 'semantic-only',
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
        this.#semanticOnly = nativeBindings === 'semantic-only';

        const items = nativeBindings === 'semantic-only'
            ? flattenSemanticItems<Path>(analysis.roots)
            : flattenItems(
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

    /**
     * Semantic-only documents carry no authenticated parser topology, so
     * every fragment, live-path, and source↔local lookup refuses instead of
     * answering from inference. Semantic queries (items, projection,
     * source-domain ranges) stay available.
     */
    #requireNativeBindings(api: string): void {
        if (this.#semanticOnly) {
            throw new TypeError(
                `CriticMarkupDocument.${api} requires native bindings; this document is semantic-only.`,
            );
        }
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
        this.#requireNativeBindings('fragmentsForPath');
        return this.#itemsByPath.get(path)?.values() ?? EMPTY_FRAGMENT_INPUTS;
    }

    /** Every block path with at least one fragment, in parser order. */
    pathsWithFragments(): readonly Path[] {
        this.#requireNativeBindings('pathsWithFragments');
        return this.#fragmentPaths;
    }

    structuralFragmentsForPath(
        path: Path,
    ): readonly ICriticMarkupStructuralFragmentInput<Path>[] {
        this.#requireNativeBindings('structuralFragmentsForPath');
        return this.#structuralItemsByPath.get(path)
            ?? EMPTY_FRAGMENT_INPUTS;
    }

    pathsWithStructuralFragments(): readonly Path[] {
        this.#requireNativeBindings('pathsWithStructuralFragments');
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
        this.#requireNativeBindings('itemAt');
        return this.#itemsByPath.get(path)?.containing(offset).at(-1)?.item
            ?? this.#structuralItemEnclosing(path);
    }

    itemContaining(
        path: Path,
        range: TLocalRange,
    ): ICriticMarkupDocumentItem<Path> | null {
        this.#requireNativeBindings('itemContaining');
        if (range.start === range.end)
            return this.itemAt(path, range.start);

        return this.#itemsByPath.get(path)
            ?.containingRange(range.start, range.end)
            .at(-1)
            ?.item
            ?? this.#structuralItemEnclosing(path);
    }

    /**
     * The deepest structural item whose native carrier is this path or one
     * of its ancestors. A position inside a structurally covered block
     * belongs to that block's annotation even without an inline fragment.
     */
    #structuralItemEnclosing(
        path: Path,
    ): ICriticMarkupDocumentItem<Path> | null {
        for (let length = path.length; length > 0; length--) {
            // A path prefix stays inside the same branded path domain.
            // eslint-disable-next-line no-restricted-syntax
            const prefix = path.slice(0, length) as unknown as Path;
            const fragments = this.structuralFragmentsForPath(prefix);
            const deepest = fragments.at(-1);
            if (deepest) {
                const item = this.#itemsById.get(deepest.item.id);
                if (!item) {
                    throw new TypeError(
                        `Structural CriticMarkup fragment names unknown item ${deepest.item.id}.`,
                    );
                }
                return item;
            }
        }
        return null;
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
        this.#requireNativeBindings('authoringRange');
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
        this.#requireNativeBindings('sourceRangeForLocalRange');
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
        this.#requireNativeBindings('sourceRangeForLocalEndpoints');
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
        this.#requireNativeBindings('projectLocalRange');
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
        this.#requireNativeBindings('sourceOffsetAt');
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
        this.#requireNativeBindings('localPositionAt');
        const position = this.mappedText.sourceMap.sourceToLocal(
            sourceOffset,
            affinity,
        );
        return position
            ? { path: position.path, offset: position.offset }
            : null;
    }
}

export type TCriticMarkupDocumentBindings<
    Path extends TMappedTextPath = TMarkdownStatePath,
> = ICriticMarkupBindingGraph<Path> | 'semantic-only';

export function createCriticMarkupDocument<
    Path extends TMappedTextPath = TMarkdownStatePath,
>(
    analysis: CriticMarkupAnalysis,
    source: MappedText<Path>,
    parserProfile: TCriticMarkupAnalysisProfile = Object.freeze({
        kind: 'grammar-only',
    }),
    contextCoverage: TCriticMarkupContextCoverage = 'grammar-only',
    nativeBindings: TCriticMarkupDocumentBindings<Path> | 'grammar' = 'grammar',
): CriticMarkupDocument<Path> {
    if (nativeBindings === 'grammar') {
        // Only the grammar-only profile may derive topology from grammar
        // ranges; a Markdown-aware parse must hand over its own graph (an
        // empty forest is exact for any profile).
        if (parserProfile.kind !== 'grammar-only' && analysis.roots.length) {
            throw new TypeError(
                'Parser-context CriticMarkup documents require explicit native bindings.',
            );
        }
        nativeBindings = grammarCriticMarkupBindingGraph(analysis, source);
    }
    return new CriticMarkupDocument(
        analysis,
        source,
        parserProfile,
        contextCoverage,
        nativeBindings,
    );
}
