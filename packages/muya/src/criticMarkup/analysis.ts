import type { TSourceRange } from '../mappedText';
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
        for (const value of Object.values(current)) {
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
    roots: readonly TCriticMarkupToken[],
): TCriticMarkupDocumentToken[] {
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
        const semantic: TCriticMarkupDocumentToken = token.type === 'substitution'
            ? {
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
                }
            : {
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
 * normalized literal ranges and the once-materialized branded semantic forest;
 * document adapters may bind it to any exact-source mapped coordinate space.
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
                authenticated.roots,
            )),
            Object.freeze({ kind: 'markdown', key: parserProfileKey }),
            contextCoverage,
            authenticated.candidateIdentity,
        );
    }

    assertParserProfile(expected: TCriticMarkupAnalysisProfile): void {
        const actual = this.parserProfile;
        if (
            actual.kind !== expected.kind
            || (
                actual.kind === 'markdown'
                && expected.kind === 'markdown'
                && actual.key !== expected.key
            )
        ) {
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
