import type { ICriticMarkupBindingGraph } from '../../criticMarkup/bindingGraph';
import type {
    ICriticMarkupCandidateIdentity,
    ICriticMarkupRange,
    TCriticMarkupToken,
} from '../../criticMarkup/parser';
import type {
    IProjectedCriticMarkupSourceSegment,
    TCriticMarkupProjection,
} from '../../criticMarkup/project';
import type { TMappedTextPath } from '../../mapped-range';
import type { MappedText } from '../../mappedText';
import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type {
    PreparedCriticMarkupSourceContext,
    TCriticMarkupParserOptions,
} from './criticMarkupSourceContext';
import type {
    ICriticMarkupContextAnalysis,
    TMarkedParserPath,
} from './locatedMarkdown';
import type { ILexOption } from './types';
import { CriticMarkupAnalysis } from '../../criticMarkup/analysis';
import {
    emptyCriticMarkupBindingGraph,

} from '../../criticMarkup/bindingGraph';
import { createCriticMarkupDocument } from '../../criticMarkup/document';
import { ExcludedRanges } from '../../criticMarkup/excludedRanges';
import {
    grammarCriticMarkupBindingGraph,
} from '../../criticMarkup/grammarBindings';
import {
    assertCriticMarkupCandidateIdentity,
    prepareCriticMarkupCandidateIdentity,
    prepareCriticMarkupNoCandidateScanResult,
    scanCriticMarkupCandidate,
} from '../../criticMarkup/parser';
import {
    projectedCriticMarkupCommentSourceSegments,
    projectedCriticMarkupSourceSegments,
} from '../../criticMarkup/project';
import { lowerBound, upperBound } from '../../mapped-range';
import { plainMarkdown } from '../../state/markdownSourceMap';
import {
    criticMarkupParserProfile,
    snapshotCriticMarkupParserOptions,
} from './criticMarkupSourceContext';
import {
    analyzeMarkdownBlockSourceWithExtensions,
} from './markdownBlockAnalysis';

export {
    criticMarkupParserProfile,
    prepareCriticMarkupSourceContext,
    PreparedCriticMarkupSourceContext,
    snapshotCriticMarkupParserOptions,
} from './criticMarkupSourceContext';

function appendValues<T>(target: T[], values: readonly T[]): void {
    for (const value of values)
        target.push(value);
}

interface ICriticMarkupLiteralContext {
    readonly source: string;
    readonly literalRanges: readonly ICriticMarkupRange[];
}

function exclusionsCover(
    covering: ExcludedRanges,
    required: ExcludedRanges,
): boolean {
    covering.assertSourceLength(required.sourceLength);
    let coveringIndex = 0;
    for (const range of required.ranges) {
        while (
            coveringIndex < covering.ranges.length
            && covering.ranges[coveringIndex].end <= range.start
        ) {
            coveringIndex++;
        }
        const candidate = covering.ranges[coveringIndex];
        if (
            !candidate
            || candidate.start > range.start
            || candidate.end < range.end
        ) {
            return false;
        }
    }
    return true;
}

/**
 * One complete Marked-context parse bound to its exact mapped source and the
 * already-frozen source/profile/candidate identity that selected the parse.
 */
export class PreparedCriticMarkupDocumentContext {
    private constructor(
        readonly mappedText: MappedText<TMarkedParserPath>,
        readonly excludedRanges: ExcludedRanges,
        readonly parserOptions: TCriticMarkupParserOptions,
        readonly parserProfile: PreparedCriticMarkupSourceContext['parserProfile'],
        readonly contextCoverage: 'complete',
        readonly candidateIdentity: ICriticMarkupCandidateIdentity,
        readonly analysis: CriticMarkupAnalysis | null,
        readonly bindings: ICriticMarkupBindingGraph<TMarkedParserPath>,
    ) {
        Object.freeze(this);
    }

    get hasCandidateOpener(): boolean {
        return this.candidateIdentity.hasCandidateOpener;
    }

    static bind(
        context: ICriticMarkupContextAnalysis,
    ): PreparedCriticMarkupDocumentContext {
        const { sourceContext } = context;
        if (
            context.source !== sourceContext.source
            || context.source !== context.mappedText.text
        ) {
            throw new TypeError(
                'Located Markdown context is detached from its prepared mapped source.',
            );
        }
        const excludedRanges = ExcludedRanges.from(
            context.source.length,
            context.literalRanges,
        );
        if (sourceContext.analysis) {
            sourceContext.analysis.assertContextCoverage('complete');
            if (!exclusionsCover(
                sourceContext.analysis.excludedRanges,
                excludedRanges,
            )) {
                throw new TypeError(
                    'Prepared CriticMarkup analysis does not cover the located literal ranges.',
                );
            }
        }

        // When Critic syntax stayed transparent to this Markdown parse, the
        // located token graph carries no fragment tokens, so the artifact
        // emits its topology here: the same revision's analysis ranges
        // intersected with this parse's own leaf provenance. A parse whose
        // token graph already carries fragment tokens keeps that emission.
        const analysis = sourceContext.analysis;
        const bindings = context.bindings.inline.length
            || !analysis
            || !analysis.roots.length
            ? context.bindings
            : grammarCriticMarkupBindingGraph(analysis, context.mappedText);

        return new PreparedCriticMarkupDocumentContext(
            context.mappedText,
            excludedRanges,
            sourceContext.parserOptions,
            sourceContext.parserProfile,
            'complete',
            sourceContext.candidateIdentity,
            sourceContext.analysis,
            bindings,
        );
    }
}

export function prepareCriticMarkupDocumentContext(
    context: ICriticMarkupContextAnalysis,
): PreparedCriticMarkupDocumentContext {
    return PreparedCriticMarkupDocumentContext.bind(context);
}

/**
 * Parse the canonical Markdown document into one CriticMarkup annotation
 * model. Markdown is lexed first with CriticMarkup disabled so its native
 * code/link/HTML/math contexts define literal ranges. The grammar runs one
 * provisional scan; its roots are reused when projection analysis leaves the
 * normalized ranges unchanged, otherwise one final scan establishes correct
 * Markdown/grammar precedence.
 */
export function parseCriticMarkupDocument(
    sourceMap: TTrackedMarkdown,
    options?: ILexOption,
): import('../../criticMarkup/document').CriticMarkupDocument;
export function parseCriticMarkupDocument(
    sourceMap: TTrackedMarkdown,
    options: ILexOption = {},
) {
    return parseDocument(sourceMap, options, false, 'semantic-only');
}

/**
 * Build the same canonical document while also materializing Markdown-owned
 * literal ranges when the source has no Critic opener yet. Authoring and
 * Track Changes need this form to decide whether a proposed new marker would
 * land inside code, links, HTML, math, or another parser-owned context. Normal
 * display parsing keeps the grammar-owned no-opener fast path above.
 */
export function parseCriticMarkupContextDocument(
    sourceMap: TTrackedMarkdown,
    options?: ILexOption,
    candidateAnalysis?: CriticMarkupAnalysis,
): import('../../criticMarkup/document').CriticMarkupDocument;
export function parseCriticMarkupContextDocument(
    sourceMap: TTrackedMarkdown,
    options: ILexOption = {},
    candidateAnalysis?: CriticMarkupAnalysis,
) {
    if (candidateAnalysis) {
        if (candidateAnalysis.source !== sourceMap.text) {
            throw new TypeError(
                'Candidate CriticMarkup analysis belongs to a different source revision.',
            );
        }
        candidateAnalysis.assertParserProfile(
            criticMarkupParserProfile(options),
        );
    }
    return parseDocument(
        sourceMap,
        options,
        true,
        'semantic-only',
        undefined,
        candidateAnalysis?.candidateIdentity,
    );
}

/**
 * Build the canonical static document from the source-located token tree that
 * the active Marked instance already produced. The raw source is never lexed
 * a second time merely to rediscover the same Markdown context.
 */
export function parseCriticMarkupDocumentFromContext(
    prepared: PreparedCriticMarkupDocumentContext,
) {
    if (prepared.analysis) {
        return createCriticMarkupDocument(
            prepared.analysis,
            prepared.mappedText,
            prepared.parserProfile,
            prepared.contextCoverage,
            prepared.bindings,
        );
    }
    // The located parse already emitted this context's binding graph; the
    // grammar scan below only reconstructs the analysis for the same
    // exclusions and revision.
    return parseDocument(
        prepared.mappedText,
        prepared.parserOptions,
        true,
        prepared.bindings,
        {
            source: prepared.mappedText.text,
            literalRanges: prepared.excludedRanges.ranges,
        },
        prepared.candidateIdentity,
    );
}

function parseDocument<Path extends TMappedTextPath>(
    sourceMap: MappedText<Path>,
    options: ILexOption,
    analyzeWithoutOpener: boolean,
    topology: ICriticMarkupBindingGraph<Path> | 'semantic-only',
    context?: ICriticMarkupLiteralContext,
    knownCandidateIdentity?: ICriticMarkupCandidateIdentity,
) {
    const source = sourceMap.text;
    const parserOptions = snapshotCriticMarkupParserOptions(options);
    const parserProfile = criticMarkupParserProfile(parserOptions);
    const candidateIdentity = knownCandidateIdentity
        ?? prepareCriticMarkupCandidateIdentity(source);
    assertCriticMarkupCandidateIdentity(candidateIdentity, source);
    const hasOpener = candidateIdentity.hasCandidateOpener;
    const contextCoverage = hasOpener || analyzeWithoutOpener
        ? 'complete' as const
        : 'none' as const;
    if (!hasOpener && !analyzeWithoutOpener) {
        const scanResult = prepareCriticMarkupNoCandidateScanResult(
            source,
            ExcludedRanges.empty(source.length),
            candidateIdentity,
        );
        return createCriticMarkupDocument(
            CriticMarkupAnalysis.fromMarkdownScan(
                scanResult,
                parserProfile.key,
                contextCoverage,
            ),
            sourceMap,
            parserProfile,
            contextCoverage,
            emptyCriticMarkupBindingGraph<Path>(),
        );
    }

    if (context?.source !== undefined && context.source !== source) {
        throw new TypeError(
            'Located Markdown context belongs to a different source revision.',
        );
    }

    const literalRanges = context?.literalRanges
        ?? criticMarkupLiteralRanges(source, parserOptions);
    const baseExcluded = ExcludedRanges.from(source.length, literalRanges);
    const baseScan = hasOpener
        ? scanCriticMarkupCandidate(
                source,
                baseExcluded,
                candidateIdentity,
            )
        : prepareCriticMarkupNoCandidateScanResult(
                source,
                baseExcluded,
                candidateIdentity,
            );
    const projectionLiteralRanges = criticMarkupProjectionLiteralRanges(
        source,
        parserOptions,
        baseScan.roots,
    );
    const excludedRanges = ExcludedRanges.from(source.length, [
        ...literalRanges,
        ...projectionLiteralRanges,
    ]);
    const finalScan = baseExcluded.equals(excludedRanges)
        ? baseScan
        : scanCriticMarkupCandidate(
                source,
                excludedRanges,
                candidateIdentity,
            );

    // Grammar-scan parses own no topology of their own: item-bearing
    // documents are either explicitly semantic-only (projection, validation,
    // extension planning) or carry the binding graph the located parser
    // artifact emitted for this exact context — including the derived graph
    // for parses that kept Critic syntax transparent. An openerless parse
    // binds an exact empty graph so authoring-context lookups over clean
    // revisions stay available.
    const analysis = CriticMarkupAnalysis.fromMarkdownScan(
        finalScan,
        parserProfile.key,
        contextCoverage,
    );
    const bindings = !finalScan.roots.length
        ? emptyCriticMarkupBindingGraph<Path>()
        : topology === 'semantic-only' || topology.inline.length
            ? topology
            : grammarCriticMarkupBindingGraph(analysis, sourceMap);
    return createCriticMarkupDocument(
        analysis,
        sourceMap,
        parserProfile,
        contextCoverage,
        bindings,
    );
}

interface IProjectedSourceSpan {
    projectedStart: number;
    projectedEnd: number;
    sourceStart: number;
    sourceEnd: number;
    owner: TCriticMarkupToken | null;
}

interface IProjectedMarkdownView {
    markdown: string;
    spans: readonly IProjectedSourceSpan[];
    ownerBounds: ReadonlyMap<TCriticMarkupToken, ICriticMarkupRange>;
    parentByToken: ReadonlyMap<TCriticMarkupToken, TCriticMarkupToken | null>;
    tokensBySource: readonly TCriticMarkupToken[];
}

interface ITokenHierarchy {
    parentByToken: ReadonlyMap<TCriticMarkupToken, TCriticMarkupToken | null>;
    preorder: readonly TCriticMarkupToken[];
    tokensBySource: readonly TCriticMarkupToken[];
}

/**
 * Critic delimiters can change the flanking bytes seen by Markdown (for
 * example `$` immediately after a substitution's separator). Parse the two
 * complete semantic projections once each, then envelope their literal spans
 * back over removed canonical marker gaps. This gives every nesting depth its
 * true visible Markdown context with a constant number of Markdown parses.
 */
function criticMarkupProjectionLiteralRanges(
    source: string,
    options: ILexOption,
    roots: readonly TCriticMarkupToken[],
): ICriticMarkupRange[] {
    if (!roots.length)
        return [];

    const hierarchy = tokenHierarchy(roots);
    const views = (['original', 'revised'] as const).map(projection =>
        projectedMarkdownView(source, projection, roots, hierarchy));
    const commentView = mappedMarkdownView(
        source,
        projectedCriticMarkupCommentSourceSegments(source.length, roots),
        hierarchy,
    );
    if (commentView.markdown !== source)
        views.push(commentView);

    const literalRangesByMarkdown = new Map<
        string,
        readonly ICriticMarkupRange[]
    >();
    return views.flatMap((view) => {
        if (!view.markdown)
            return [];

        let literalRanges = literalRangesByMarkdown.get(view.markdown);
        if (!literalRanges) {
            literalRanges = criticMarkupLiteralRanges(view.markdown, options);
            literalRangesByMarkdown.set(view.markdown, literalRanges);
        }
        return literalRanges.flatMap(range =>
            sourceLiteralRanges(view, range));
    });
}

function projectedMarkdownView(
    source: string,
    projection: 'original' | 'revised',
    roots: readonly TCriticMarkupToken[],
    hierarchy: ITokenHierarchy,
): IProjectedMarkdownView {
    return mappedMarkdownView(
        source,
        projectedCriticMarkupSourceSegments(
            source.length,
            projection,
            roots,
        ),
        hierarchy,
    );
}

function mappedMarkdownView(
    source: string,
    segments: readonly IProjectedCriticMarkupSourceSegment[],
    hierarchy: ITokenHierarchy,
): IProjectedMarkdownView {
    const parts: string[] = [];
    const spans: IProjectedSourceSpan[] = [];
    const ownerBounds = new Map<TCriticMarkupToken, ICriticMarkupRange>();
    let projectedOffset = 0;

    for (const { range, owner } of segments) {
        const text = source.slice(range.start, range.end);
        parts.push(text);
        spans.push({
            projectedStart: projectedOffset,
            projectedEnd: projectedOffset + text.length,
            sourceStart: range.start,
            sourceEnd: range.end,
            owner,
        });
        if (owner) {
            const bounds = ownerBounds.get(owner);
            if (bounds) {
                bounds.end = projectedOffset + text.length;
            }
            else {
                ownerBounds.set(owner, {
                    start: projectedOffset,
                    end: projectedOffset + text.length,
                });
            }
        }
        projectedOffset += text.length;
    }

    for (let index = hierarchy.preorder.length - 1; index >= 0; index--) {
        const token = hierarchy.preorder[index];
        const bounds = ownerBounds.get(token);
        const parent = hierarchy.parentByToken.get(token);
        if (!bounds || !parent)
            continue;

        const parentBounds = ownerBounds.get(parent);
        if (parentBounds) {
            if (bounds.start < parentBounds.start)
                parentBounds.start = bounds.start;
            if (bounds.end > parentBounds.end)
                parentBounds.end = bounds.end;
        }
        else {
            ownerBounds.set(parent, { ...bounds });
        }
    }

    return {
        markdown: parts.join(''),
        spans,
        ownerBounds,
        parentByToken: hierarchy.parentByToken,
        tokensBySource: hierarchy.tokensBySource,
    };
}

function tokenHierarchy(
    roots: readonly TCriticMarkupToken[],
): ITokenHierarchy {
    const parentByToken = new Map<
        TCriticMarkupToken,
        TCriticMarkupToken | null
    >();
    const preorder: TCriticMarkupToken[] = [];
    const pending: Array<{
        token: TCriticMarkupToken;
        parent: TCriticMarkupToken | null;
    }> = [];
    for (let index = roots.length - 1; index >= 0; index--)
        pending.push({ token: roots[index], parent: null });

    while (pending.length) {
        const { token, parent } = pending.pop()!;
        preorder.push(token);
        parentByToken.set(token, parent);
        if (token.nested) {
            for (let index = token.nested.length - 1; index >= 0; index--) {
                pending.push({
                    token: token.nested[index],
                    parent: token,
                });
            }
        }
    }

    const tokensBySource = [...preorder].sort((left, right) =>
        left.range.start - right.range.start
        || right.range.end - left.range.end);

    return { parentByToken, preorder, tokensBySource };
}

function tokensStartingInRange(
    tokens: readonly TCriticMarkupToken[],
    start: number,
    end: number,
): TCriticMarkupToken[] {
    const first = lowerBound(tokens, start, token => token.range.start);

    const result: TCriticMarkupToken[] = [];
    for (let index = first; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.range.start >= end)
            break;
        result.push(token);
    }

    return result;
}

interface ISourceLiteralMapping {
    sourceRange: ICriticMarkupRange;
    firstOwner: TCriticMarkupToken | null;
    lastOwner: TCriticMarkupToken | null;
    ownedRanges: ICriticMarkupRange[];
}

function firstProjectedSpanEndingAfter(
    spans: readonly IProjectedSourceSpan[],
    offset: number,
): number {
    return upperBound(spans, offset, span => span.projectedEnd);
}

function markerRanges(token: TCriticMarkupToken): ICriticMarkupRange[] {
    return token.type === 'substitution'
        ? [
                token.markers.open.range,
                token.markers.separator.range,
                token.markers.close.range,
            ]
        : [token.markers.open.range, token.markers.close.range];
}

function mapProjectedLiteralRange(
    view: IProjectedMarkdownView,
    projectedRange: ICriticMarkupRange,
): ISourceLiteralMapping {
    const { spans } = view;
    let sourceStart = Number.POSITIVE_INFINITY;
    let sourceEnd = Number.NEGATIVE_INFINITY;
    let firstOwner: TCriticMarkupToken | null = null;
    let lastOwner: TCriticMarkupToken | null = null;
    const ownedRanges: ICriticMarkupRange[] = [];
    const first = firstProjectedSpanEndingAfter(spans, projectedRange.start);
    for (let index = first; index < spans.length; index++) {
        const span = spans[index];
        if (span.projectedStart >= projectedRange.end)
            break;

        const clippedStart = Math.max(
            span.projectedStart,
            projectedRange.start,
        );
        const clippedEnd = Math.min(
            span.projectedEnd,
            projectedRange.end,
        );
        if (clippedStart >= clippedEnd)
            continue;

        const mappedStart = span.sourceStart
            + clippedStart
            - span.projectedStart;
        const mappedEnd = span.sourceStart
            + clippedEnd
            - span.projectedStart;
        if (mappedStart < sourceStart)
            sourceStart = mappedStart;
        if (mappedEnd > sourceEnd)
            sourceEnd = mappedEnd;
        if (sourceStart === mappedStart)
            firstOwner = span.owner;
        lastOwner = span.owner;
        if (span.owner) {
            appendValues(ownedRanges, subtractRanges(
                { start: mappedStart, end: mappedEnd },
                markerRanges(span.owner),
            ));
        }
    }

    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) {
        throw new RangeError(
            `Projected Markdown literal range [${projectedRange.start}, ${projectedRange.end}) has no canonical source span.`,
        );
    }

    return {
        sourceRange: { start: sourceStart, end: sourceEnd },
        firstOwner,
        lastOwner,
        ownedRanges,
    };
}

function protectedBoundaryTokens(
    view: IProjectedMarkdownView,
    owners: readonly (TCriticMarkupToken | null)[],
): Set<TCriticMarkupToken> {
    const protectedTokens = new Set<TCriticMarkupToken>();
    for (const boundaryOwner of owners) {
        let token = boundaryOwner;
        while (token) {
            protectedTokens.add(token);
            token = view.parentByToken.get(token) ?? null;
        }
    }

    return protectedTokens;
}

function nestedProtectedLiteralRanges(
    view: IProjectedMarkdownView,
    semanticTokens: ReadonlySet<TCriticMarkupToken>,
    protectedTokens: ReadonlySet<TCriticMarkupToken>,
    projectedRange: ICriticMarkupRange,
    sourceRange: ICriticMarkupRange,
): ICriticMarkupRange[] {
    const result: ICriticMarkupRange[] = [];
    for (const owner of semanticTokens) {
        if (protectedTokens.has(owner))
            continue;
        let ancestor = view.parentByToken.get(owner) ?? null;
        while (ancestor && !protectedTokens.has(ancestor))
            ancestor = view.parentByToken.get(ancestor) ?? null;
        if (!ancestor)
            continue;

        const bounds = view.ownerBounds.get(owner);
        const fullyInsideLiteral = bounds
            ? projectedRange.start < bounds.start
            && bounds.end < projectedRange.end
            : sourceRange.start < owner.range.start
                && owner.range.end < sourceRange.end;
        if (fullyInsideLiteral)
            result.push(owner.range);
    }

    return result;
}

function sourceLiteralRanges(
    view: IProjectedMarkdownView,
    projectedRange: ICriticMarkupRange,
): ICriticMarkupRange[] {
    const mapping = mapProjectedLiteralRange(view, projectedRange);
    const { sourceRange } = mapping;
    const protectedTokens = protectedBoundaryTokens(view, [
        mapping.firstOwner,
        mapping.lastOwner,
    ]);
    // A literal range can become contiguous only after a root item is omitted
    // (for example `<span>{++visible++}</span>` in Original view), or can span
    // several sibling items whose payloads jointly form Markdown (for example
    // three additions forming `$x$`). Never let that projected contiguity turn
    // a sibling/omitted semantic item into literal source. Cut every token in
    // the canonical envelope out first; only a descendant wholly owned by a
    // protected boundary item may be restored as literal below.
    const semanticTokens = new Set([
        ...protectedTokens,
        ...tokensStartingInRange(
            view.tokensBySource,
            sourceRange.start,
            sourceRange.end,
        ),
    ]);
    const result = subtractRanges(
        sourceRange,
        [...semanticTokens].map(token => token.range),
    );
    appendValues(result, nestedProtectedLiteralRanges(
        view,
        semanticTokens,
        protectedTokens,
        projectedRange,
        sourceRange,
    ));

    // Boundary owners are subtracted above so a projected literal can never
    // swallow their Critic delimiters. Restore only the exact retained source
    // slices that the Markdown parser actually classified as literal. This is
    // essential when an item's payload itself becomes a code/math/link
    // context: its literal backslashes are data, not grammar escape bytes.
    return mergeRanges([...result, ...mapping.ownedRanges]);
}

function mergeRanges(
    ranges: readonly ICriticMarkupRange[],
): ICriticMarkupRange[] {
    const result: ICriticMarkupRange[] = [];
    for (const range of [...ranges].sort((left, right) =>
        left.start - right.start || left.end - right.end)) {
        const previous = result.at(-1);
        if (previous && range.start <= previous.end)
            previous.end = Math.max(previous.end, range.end);
        else if (range.start < range.end)
            result.push({ ...range });
    }

    return result;
}

function subtractRanges(
    source: ICriticMarkupRange,
    removed: readonly ICriticMarkupRange[],
): ICriticMarkupRange[] {
    const normalized = [...removed]
        .sort((left, right) =>
            left.start - right.start || left.end - right.end);
    const result: ICriticMarkupRange[] = [];
    let cursor = source.start;

    for (const range of normalized) {
        if (range.end <= cursor || source.end <= range.start)
            continue;
        if (cursor < range.start) {
            result.push({
                start: cursor,
                end: Math.min(range.start, source.end),
            });
        }
        if (range.end > cursor)
            cursor = range.end;
        if (source.end <= cursor)
            break;
    }
    if (cursor < source.end)
        result.push({ start: cursor, end: source.end });

    return result;
}

function criticMarkupLiteralRanges(
    source: string,
    options: ILexOption,
) {
    // criticMarkup is disabled here, so the critic-free analyzer core is
    // exactly the parse analyzeMarkdownBlockSource would have run.
    return analyzeMarkdownBlockSourceWithExtensions(source, {
        ...options,
        criticMarkup: false,
        criticMarkupProjection: 'marked',
    }, []).literalRanges;
}

export function projectCriticMarkupMarkdown(
    source: string,
    projection: TCriticMarkupProjection,
    options: ILexOption = {},
): string {
    if (projection === 'marked')
        return source;
    const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
    if (!candidateIdentity.hasCandidateOpener)
        return source;

    return parseDocument(
        plainMarkdown(source),
        options,
        false,
        'semantic-only',
        undefined,
        candidateIdentity,
    ).project(projection);
}
