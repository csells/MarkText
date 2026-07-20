import type { TSourceRange } from '../mappedText';
import type { IExcludedRange } from './excludedRanges';
import type {
    ICriticMarkupCandidateIdentity,
    ICriticMarkupRange,
    ICriticMarkupScanResult,
    TCriticMarkupToken,
} from './parser';
import type { TCriticMarkupProjection } from './project';
import { sourceRange } from '../mappedText';
import { ExcludedRanges } from './excludedRanges';
import {
    assertCriticMarkupCandidateIdentity,
    authenticateCriticMarkupScanResult,
    decodeCriticMarkupPayloadEscapes,
    prepareCriticMarkupCandidateIdentity,
    prepareCriticMarkupNoCandidateScanResult,
    scanCriticMarkupCandidate,
} from './parser';
import { projectCriticMarkupTokens } from './project';

export interface ICriticMarkupDocumentMarker {
    readonly raw: string;
    readonly range: TSourceRange;
}

export interface ICriticMarkupDocumentContentToken {
    readonly type: 'addition' | 'deletion' | 'highlight' | 'comment';
    readonly raw: string;
    readonly content: string;
    /** User-visible payload after grammar-owned protective escapes decode. */
    readonly semanticContent: string;
    readonly range: TSourceRange;
    readonly contentRange: TSourceRange;
    readonly markers: Readonly<{
        open: ICriticMarkupDocumentMarker;
        close: ICriticMarkupDocumentMarker;
    }>;
    readonly nested?: readonly TCriticMarkupDocumentToken[];
}

export interface ICriticMarkupDocumentSubstitutionToken {
    readonly type: 'substitution';
    readonly raw: string;
    readonly oldContent: string;
    readonly newContent: string;
    /** User-visible arms after grammar-owned protective escapes decode. */
    readonly semanticOldContent: string;
    readonly semanticNewContent: string;
    readonly range: TSourceRange;
    readonly oldRange: TSourceRange;
    readonly newRange: TSourceRange;
    readonly markers: Readonly<{
        open: ICriticMarkupDocumentMarker;
        separator: ICriticMarkupDocumentMarker;
        close: ICriticMarkupDocumentMarker;
    }>;
    readonly nested?: readonly TCriticMarkupDocumentToken[];
}

/** Parser semantics materialized in the canonical branded source domain. */
export type TCriticMarkupDocumentToken
    = | ICriticMarkupDocumentContentToken
        | ICriticMarkupDocumentSubstitutionToken;

export interface ICriticMarkupSemanticPayloadView {
    readonly text: string;
    /** Parser-owned child syntax copied opaquely into the editable view. */
    readonly nestedRanges: readonly Readonly<IExcludedRange>[];
    /** Markdown literal syntax copied opaquely into the editable view. */
    readonly literalRanges: readonly Readonly<IExcludedRange>[];
}

interface IPayloadOpaqueRange {
    readonly kind: 'nested' | 'literal';
    readonly start: number;
    readonly end: number;
}

type TSemanticPayloadArm = 'content' | 'old' | 'new';

interface ISemanticPayloadPlan {
    readonly payloadRange: Readonly<IExcludedRange>;
    readonly opaque: readonly Readonly<IPayloadOpaqueRange>[];
}

interface IDocumentSemanticPayloadAuthority {
    readonly source: string;
    readonly excludedRanges: ExcludedRanges;
    readonly plans: Readonly<Partial<
        Record<TSemanticPayloadArm, ISemanticPayloadPlan>
    >>;
}

const DOCUMENT_SEMANTIC_PAYLOADS = new WeakMap<
    TCriticMarkupDocumentToken,
    IDocumentSemanticPayloadAuthority
>();
const SEMANTIC_PAYLOAD_VIEW_CACHE = new WeakMap<
    ISemanticPayloadPlan,
    ICriticMarkupSemanticPayloadView
>();

function containsRange(
    outer: Readonly<IExcludedRange>,
    inner: Readonly<IExcludedRange>,
): boolean {
    return outer.start <= inner.start && inner.end <= outer.end;
}

function rangesOverlap(
    left: Readonly<IExcludedRange>,
    right: Readonly<IExcludedRange>,
): boolean {
    return left.start < right.end && right.start < left.end;
}

type TSemanticPayloadToken = TCriticMarkupToken | TCriticMarkupDocumentToken;

function rangesEqual(
    left: Readonly<IExcludedRange>,
    right: Readonly<IExcludedRange>,
): boolean {
    return left.start === right.start && left.end === right.end;
}

function assertSemanticPayloadArm(
    token: TSemanticPayloadToken,
    payloadRange: Readonly<IExcludedRange>,
): void {
    const raw = token.type === 'substitution'
        ? rangesEqual(token.oldRange, payloadRange)
            ? token.oldContent
            : rangesEqual(token.newRange, payloadRange)
                ? token.newContent
                : null
        : rangesEqual(token.contentRange, payloadRange)
            ? token.content
            : null;
    if (
        !Number.isInteger(payloadRange.start)
        || !Number.isInteger(payloadRange.end)
        || raw === null
        || payloadRange.start < token.range.start
        || token.range.end < payloadRange.end
        || payloadRange.end < payloadRange.start
        || payloadRange.end - payloadRange.start !== raw.length
    ) {
        throw new RangeError(
            'CriticMarkup semantic payload range is not an exact token arm.',
        );
    }
}

function assertUntrustedSemanticPayloadSource(
    source: string,
    token: TSemanticPayloadToken,
    payloadRange: Readonly<IExcludedRange>,
): void {
    assertSemanticPayloadArm(token, payloadRange);
    const raw = token.type === 'substitution'
        ? rangesEqual(token.oldRange, payloadRange)
            ? token.oldContent
            : token.newContent
        : token.content;
    if (source.slice(payloadRange.start, payloadRange.end) !== raw) {
        throw new TypeError(
            'CriticMarkup semantic payload token belongs to a different source revision.',
        );
    }
}

function nestedPayloadRanges(
    token: TSemanticPayloadToken,
    payloadRange: Readonly<IExcludedRange>,
): IPayloadOpaqueRange[] {
    const nested: IPayloadOpaqueRange[] = [];
    for (const child of token.nested ?? []) {
        if (!rangesOverlap(payloadRange, child.range))
            continue;
        if (!containsRange(payloadRange, child.range)) {
            throw new RangeError(
                'Nested CriticMarkup crosses a semantic payload boundary.',
            );
        }
        nested.push({
            kind: 'nested',
            start: child.range.start,
            end: child.range.end,
        });
    }
    return nested.sort((left, right) =>
        left.start - right.start || left.end - right.end);
}

function literalPayloadRanges(
    payloadRange: Readonly<IExcludedRange>,
    nested: readonly IPayloadOpaqueRange[],
    excludedRanges: ExcludedRanges,
): IPayloadOpaqueRange[] {
    const literal: IPayloadOpaqueRange[] = [];
    let nestedIndex = 0;
    for (
        let index = excludedRanges.firstIndexEndingAfter(payloadRange.start);
        index < excludedRanges.ranges.length;
    ) {
        const range = excludedRanges.ranges[index];
        if (payloadRange.end <= range.start)
            break;
        if (!containsRange(payloadRange, range)) {
            throw new RangeError(
                'Markdown literal syntax crosses a CriticMarkup payload boundary.',
            );
        }
        while (
            nestedIndex < nested.length
            && nested[nestedIndex].end <= range.start
        ) {
            nestedIndex++;
        }
        const child = nested[nestedIndex];
        if (child && containsRange(child, range)) {
            // Every exclusion owned by this direct child is already preserved
            // by the child's one opaque range. Jump over the whole child
            // instead of revisiting each descendant literal at every ancestor.
            const nextIndex = excludedRanges.firstIndexEndingAfter(child.end);
            const next = excludedRanges.ranges[nextIndex];
            if (next && next.start < child.end) {
                throw new RangeError(
                    'Markdown literal syntax crosses nested CriticMarkup.',
                );
            }
            nestedIndex++;
            index = nextIndex;
            continue;
        }
        if (child && rangesOverlap(child, range)) {
            throw new RangeError(
                'Markdown literal syntax partially overlaps nested CriticMarkup.',
            );
        }
        literal.push({ kind: 'literal', start: range.start, end: range.end });
        index++;
    }
    return literal;
}

function orderedPayloadRanges(
    nested: readonly IPayloadOpaqueRange[],
    literal: readonly IPayloadOpaqueRange[],
): IPayloadOpaqueRange[] {
    const opaque = [...nested, ...literal].sort((left, right) =>
        left.start - right.start || left.end - right.end);
    for (let index = 1; index < opaque.length; index++) {
        if (opaque[index].start < opaque[index - 1].end) {
            throw new RangeError(
                'CriticMarkup semantic payload opaque ranges overlap.',
            );
        }
    }
    return opaque;
}

function planSemanticPayload(
    token: TSemanticPayloadToken,
    payloadRange: Readonly<IExcludedRange>,
    excludedRanges: ExcludedRanges,
): ISemanticPayloadPlan {
    assertSemanticPayloadArm(token, payloadRange);
    const nested = nestedPayloadRanges(token, payloadRange);
    const literal = literalPayloadRanges(
        payloadRange,
        nested,
        excludedRanges,
    );
    const opaque = orderedPayloadRanges(nested, literal).map(range =>
        Object.freeze({ ...range }));

    return Object.freeze({
        payloadRange: Object.freeze({
            start: payloadRange.start,
            end: payloadRange.end,
        }),
        opaque: Object.freeze(opaque),
    });
}

function materializeSemanticPayload(
    source: string,
    token: TSemanticPayloadToken,
    plan: ISemanticPayloadPlan,
): ICriticMarkupSemanticPayloadView {
    const { payloadRange, opaque } = plan;
    const parts: string[] = [];
    const nestedRanges: IExcludedRange[] = [];
    const literalRanges: IExcludedRange[] = [];
    let sourceCursor = payloadRange.start;
    let viewLength = 0;
    const append = (value: string): void => {
        parts.push(value);
        viewLength += value.length;
    };
    for (const range of opaque) {
        if (sourceCursor < range.start) {
            append(decodeCriticMarkupPayloadEscapes(
                token,
                source.slice(sourceCursor, range.start),
            ));
        }
        const start = viewLength;
        append(source.slice(range.start, range.end));
        const viewRange = Object.freeze({ start, end: viewLength });
        (range.kind === 'nested' ? nestedRanges : literalRanges)
            .push(viewRange);
        sourceCursor = range.end;
    }
    if (sourceCursor < payloadRange.end) {
        append(decodeCriticMarkupPayloadEscapes(
            token,
            source.slice(sourceCursor, payloadRange.end),
        ));
    }

    return Object.freeze({
        text: parts.join(''),
        nestedRanges: Object.freeze(nestedRanges),
        literalRanges: Object.freeze(literalRanges),
    });
}

function materializedSemanticPayload(
    source: string,
    token: TSemanticPayloadToken,
    plan: ISemanticPayloadPlan,
): ICriticMarkupSemanticPayloadView {
    const cached = SEMANTIC_PAYLOAD_VIEW_CACHE.get(plan);
    if (cached)
        return cached;

    const materialized = materializeSemanticPayload(source, token, plan);
    SEMANTIC_PAYLOAD_VIEW_CACHE.set(plan, materialized);
    return materialized;
}

function semanticPayloadArm(
    token: TSemanticPayloadToken,
    payloadRange: Readonly<IExcludedRange>,
): TSemanticPayloadArm | null {
    if (token.type !== 'substitution') {
        return rangesEqual(token.contentRange, payloadRange)
            ? 'content'
            : null;
    }
    if (rangesEqual(token.oldRange, payloadRange))
        return 'old';
    return rangesEqual(token.newRange, payloadRange) ? 'new' : null;
}

function documentSemanticPayload(
    token: TCriticMarkupDocumentToken,
    arm: TSemanticPayloadArm,
): ICriticMarkupSemanticPayloadView {
    const authority = DOCUMENT_SEMANTIC_PAYLOADS.get(token);
    const plan = authority?.plans[arm];
    if (!authority || !plan) {
        throw new TypeError(
            `CriticMarkup document token has no ${arm} semantic payload authority.`,
        );
    }
    return materializedSemanticPayload(authority.source, token, plan);
}

function semanticContentGetter(
    this: ICriticMarkupDocumentContentToken,
): string {
    return documentSemanticPayload(this, 'content').text;
}

function semanticOldContentGetter(
    this: ICriticMarkupDocumentSubstitutionToken,
): string {
    return documentSemanticPayload(this, 'old').text;
}

function semanticNewContentGetter(
    this: ICriticMarkupDocumentSubstitutionToken,
): string {
    return documentSemanticPayload(this, 'new').text;
}

/**
 * Materialize one parser-owned payload arm for Review UI and editing.
 * Grammar escapes decode only in semantic prose. Nested CriticMarkup and
 * Markdown literal ranges remain byte-exact opaque islands, and their ranges
 * are translated into the materialized coordinate domain for safe editing.
 */
export function criticMarkupSemanticPayloadView(
    source: string,
    token: TCriticMarkupToken | TCriticMarkupDocumentToken,
    payloadRange: Readonly<IExcludedRange>,
    excludedRanges: ExcludedRanges,
): ICriticMarkupSemanticPayloadView {
    excludedRanges.assertSourceLength(source.length);
    const authority = DOCUMENT_SEMANTIC_PAYLOADS.get(
        token as TCriticMarkupDocumentToken,
    );
    const arm = semanticPayloadArm(token, payloadRange);
    if (authority) {
        if (
            authority.source !== source
            || authority.excludedRanges !== excludedRanges
        ) {
            throw new TypeError(
                'CriticMarkup document token belongs to a different semantic authority.',
            );
        }
        assertSemanticPayloadArm(token, payloadRange);
        const plan = arm === null ? undefined : authority.plans[arm];
        if (!plan) {
            throw new TypeError(
                'CriticMarkup document token has no semantic payload authority for this arm.',
            );
        }
        return materializedSemanticPayload(source, token, plan);
    }
    assertUntrustedSemanticPayloadSource(source, token, payloadRange);
    const plan = planSemanticPayload(token, payloadRange, excludedRanges);
    return materializedSemanticPayload(source, token, plan);
}

export type TCriticMarkupAnalysisProfile
    = | Readonly<{ kind: 'grammar-only' }>
        | Readonly<{ kind: 'markdown'; key: string }>;

export type TCriticMarkupContextCoverage
    = 'grammar-only' | 'none' | 'complete';

const GRAMMAR_ONLY_PROFILE: TCriticMarkupAnalysisProfile = Object.freeze({
    kind: 'grammar-only',
});
const ANALYSIS_CONSTRUCTION_AUTHORITY = Symbol(
    'CriticMarkupAnalysis construction authority',
);

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
        for (const key of Reflect.ownKeys(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (!descriptor || !('value' in descriptor))
                continue;
            const { value } = descriptor;
            if (value !== null && typeof value === 'object')
                pending.push(value);
        }
        Object.freeze(current);
    }
    return root;
}

/** Enter the canonical serialized-source domain from grammar coordinates. */
function grammarSourceRange(range: ICriticMarkupRange): TSourceRange {
    return sourceRange(range.start, range.end);
}

/**
 * Materialize the scanner forest once in branded source coordinates. The
 * supplied roots must already belong to the analysis's final literal ranges;
 * resolving Markdown/grammar precedence remains the parser adapter's job.
 */
function materializeDocumentTokens(
    source: string,
    excludedRanges: ExcludedRanges,
    roots: readonly TCriticMarkupToken[],
): TCriticMarkupDocumentToken[] {
    excludedRanges.assertSourceLength(source.length);
    const materialized = new Map<TCriticMarkupToken, TCriticMarkupDocumentToken>();
    const pending: Array<{ token: TCriticMarkupToken; visited: boolean }> = [];
    for (let index = roots.length - 1; index >= 0; index--)
        pending.push({ token: roots[index], visited: false });

    while (pending.length) {
        const { token, visited } = pending.pop()!;
        if (!visited) {
            pending.push({ token, visited: true });
            for (let index = (token.nested?.length ?? 0) - 1; index >= 0; index--)
                pending.push({ token: token.nested![index], visited: false });
            continue;
        }

        const nested = token.nested?.map((child) => {
            const semanticChild = materialized.get(child);
            if (!semanticChild) {
                throw new TypeError(
                    'CriticMarkup semantic child was not materialized before its parent.',
                );
            }
            return semanticChild;
        });
        const marker = (value: TCriticMarkupToken['markers']['open']): ICriticMarkupDocumentMarker => ({
            raw: value.raw,
            range: grammarSourceRange(value.range),
        });
        let semantic: TCriticMarkupDocumentToken;
        if (token.type === 'substitution') {
            const oldPlan = planSemanticPayload(
                token,
                token.oldRange,
                excludedRanges,
            );
            const newPlan = planSemanticPayload(
                token,
                token.newRange,
                excludedRanges,
            );
            const base: Omit<
                ICriticMarkupDocumentSubstitutionToken,
                'semanticOldContent' | 'semanticNewContent'
            > = {
                type: token.type,
                raw: token.raw,
                oldContent: token.oldContent,
                newContent: token.newContent,
                range: grammarSourceRange(token.range),
                oldRange: grammarSourceRange(token.oldRange),
                newRange: grammarSourceRange(token.newRange),
                markers: {
                    open: marker(token.markers.open),
                    separator: marker(token.markers.separator),
                    close: marker(token.markers.close),
                },
                ...(nested ? { nested } : {}),
            };
            semantic = Object.defineProperties(base, {
                semanticOldContent: {
                    configurable: false,
                    enumerable: true,
                    get: semanticOldContentGetter,
                },
                semanticNewContent: {
                    configurable: false,
                    enumerable: true,
                    get: semanticNewContentGetter,
                },
            }) as ICriticMarkupDocumentSubstitutionToken;
            DOCUMENT_SEMANTIC_PAYLOADS.set(semantic, Object.freeze({
                source,
                excludedRanges,
                plans: Object.freeze({ old: oldPlan, new: newPlan }),
            }));
        }
        else {
            const contentPlan = planSemanticPayload(
                token,
                token.contentRange,
                excludedRanges,
            );
            const base: Omit<
                ICriticMarkupDocumentContentToken,
                'semanticContent'
            > = {
                type: token.type,
                raw: token.raw,
                content: token.content,
                range: grammarSourceRange(token.range),
                contentRange: grammarSourceRange(token.contentRange),
                markers: {
                    open: marker(token.markers.open),
                    close: marker(token.markers.close),
                },
                ...(nested ? { nested } : {}),
            };
            semantic = Object.defineProperty(base, 'semanticContent', {
                configurable: false,
                enumerable: true,
                get: semanticContentGetter,
            }) as ICriticMarkupDocumentContentToken;
            DOCUMENT_SEMANTIC_PAYLOADS.set(semantic, Object.freeze({
                source,
                excludedRanges,
                plans: Object.freeze({ content: contentPlan }),
            }));
        }
        materialized.set(token, semantic);
    }

    return roots.map((root) => {
        const semanticRoot = materialized.get(root);
        if (!semanticRoot)
            throw new TypeError('CriticMarkup semantic root was not materialized.');
        return semanticRoot;
    });
}

/**
 * Immutable parser analysis for exactly one Markdown source revision. It owns
 * normalized literal ranges and a branded semantic forest whose validated
 * payload views materialize once on demand; document adapters may bind it to
 * any exact-source mapped coordinate space.
 */
export class CriticMarkupAnalysis {
    private constructor(
        authority: typeof ANALYSIS_CONSTRUCTION_AUTHORITY,
        readonly source: string,
        readonly excludedRanges: ExcludedRanges,
        readonly roots: readonly TCriticMarkupDocumentToken[],
        readonly parserProfile: TCriticMarkupAnalysisProfile,
        readonly contextCoverage: TCriticMarkupContextCoverage,
        readonly candidateIdentity: ICriticMarkupCandidateIdentity,
    ) {
        if (authority !== ANALYSIS_CONSTRUCTION_AUTHORITY) {
            throw new TypeError(
                'CriticMarkup analysis requires an authenticated scanner result.',
            );
        }
        excludedRanges.assertSourceLength(source.length);
        assertCriticMarkupCandidateIdentity(candidateIdentity, source);
        Object.freeze(this);
    }

    get hasCandidateOpener(): boolean {
        return this.candidateIdentity.hasCandidateOpener;
    }

    /** Analyze a grammar-only source with one scanner invocation. */
    static analyzeGrammar(
        source: string,
        excludedRanges: ExcludedRanges = ExcludedRanges.empty(
            source.length,
        ),
    ): CriticMarkupAnalysis {
        const candidateIdentity = prepareCriticMarkupCandidateIdentity(source);
        const scanResult = candidateIdentity.hasCandidateOpener
            ? scanCriticMarkupCandidate(
                    source,
                    excludedRanges,
                    candidateIdentity,
                )
            : prepareCriticMarkupNoCandidateScanResult(
                    source,
                    excludedRanges,
                    candidateIdentity,
                );
        const authenticated = authenticateCriticMarkupScanResult(scanResult);
        return new CriticMarkupAnalysis(
            ANALYSIS_CONSTRUCTION_AUTHORITY,
            authenticated.source,
            authenticated.excludedRanges,
            deepFreezeSemanticGraph(materializeDocumentTokens(
                authenticated.source,
                authenticated.excludedRanges,
                authenticated.roots,
            )),
            GRAMMAR_ONLY_PROFILE,
            'grammar-only',
            authenticated.candidateIdentity,
        );
    }

    /**
     * Complete a scanner result after the Markdown adapter has finalized its
     * projection-aware literal ranges. The source is never scanned here.
     */
    static fromMarkdownScan(
        scanResult: ICriticMarkupScanResult,
        parserProfileKey: string,
        contextCoverage: Exclude<
            TCriticMarkupContextCoverage,
            'grammar-only'
        >,
    ): CriticMarkupAnalysis {
        const authenticated = authenticateCriticMarkupScanResult(scanResult);
        return new CriticMarkupAnalysis(
            ANALYSIS_CONSTRUCTION_AUTHORITY,
            authenticated.source,
            authenticated.excludedRanges,
            deepFreezeSemanticGraph(materializeDocumentTokens(
                authenticated.source,
                authenticated.excludedRanges,
                authenticated.roots,
            )),
            Object.freeze({ kind: 'markdown', key: parserProfileKey }),
            contextCoverage,
            authenticated.candidateIdentity,
        );
    }

    matchesParserProfile(expected: TCriticMarkupAnalysisProfile): boolean {
        const actual = this.parserProfile;
        return actual.kind === expected.kind
            && !(
                actual.kind === 'markdown'
                && expected.kind === 'markdown'
                && actual.key !== expected.key
            );
    }

    assertParserProfile(expected: TCriticMarkupAnalysisProfile): void {
        if (!this.matchesParserProfile(expected)) {
            throw new TypeError(
                'CriticMarkup analysis belongs to a different parser profile.',
            );
        }
    }

    assertContextCoverage(required: TCriticMarkupContextCoverage): void {
        const actual = this.contextCoverage;
        const satisfied = required === 'none'
            ? actual === 'none' || actual === 'complete'
            : actual === required;
        if (!satisfied) {
            throw new TypeError(
                `CriticMarkup analysis has ${actual} context coverage, not ${required}.`,
            );
        }
    }

    project(projection: TCriticMarkupProjection): string {
        return projectCriticMarkupTokens(
            this.source,
            projection,
            this.roots,
            this.excludedRanges,
        );
    }
}
