import type {
    CriticMarkupAnalysis,
    TCriticMarkupAnalysisProfile,
} from '../../criticMarkup/analysis';
import type { ICriticMarkupCandidateIdentity } from '../../criticMarkup/parser';
import type { ILexOption } from './types';
import { prepareCriticMarkupCandidateIdentity } from '../../criticMarkup/parser';
import { DEFAULT_OPTIONS } from './options';

export type TCriticMarkupParserOptions = Readonly<Required<Pick<
    ILexOption,
    | 'breaks'
    | 'footnote'
    | 'math'
    | 'frontMatter'
    | 'gfm'
    | 'pedantic'
    | 'superSubScript'
    | 'isGitlabCompatibilityEnabled'
    | 'maxBlockNesting'
>>>;

export interface IPreparedMarkdownSourceContext {
    readonly source: string;
    readonly parserOptions: TCriticMarkupParserOptions;
    readonly parserProfile: Extract<
        TCriticMarkupAnalysisProfile,
        { kind: 'markdown' }
    >;
    assertSourceAndParserOptions: (source: string, options: unknown) => void;
}

function parserProfileOptions(value: unknown): ILexOption {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
        return {};

    const result: ILexOption = {};
    const keys = [
        'breaks',
        'footnote',
        'math',
        'frontMatter',
        'gfm',
        'pedantic',
        'superSubScript',
        'isGitlabCompatibilityEnabled',
    ] as const;
    for (const key of keys) {
        const option = Reflect.get(value, key);
        if (option === undefined)
            continue;
        if (typeof option !== 'boolean') {
            throw new TypeError(
                `CriticMarkup parser option ${key} must be boolean.`,
            );
        }
        result[key] = option;
    }
    const maxBlockNesting = Reflect.get(value, 'maxBlockNesting');
    if (maxBlockNesting !== undefined) {
        if (
            !Number.isSafeInteger(maxBlockNesting)
            || maxBlockNesting < 0
        ) {
            throw new TypeError(
                'CriticMarkup parser option maxBlockNesting must be a non-negative safe integer.',
            );
        }
        result.maxBlockNesting = maxBlockNesting;
    }
    return result;
}

export function snapshotCriticMarkupParserOptions(
    options: ILexOption,
): TCriticMarkupParserOptions {
    return Object.freeze({
        breaks: options.breaks ?? DEFAULT_OPTIONS.breaks,
        footnote: options.footnote ?? DEFAULT_OPTIONS.footnote,
        math: options.math ?? DEFAULT_OPTIONS.math,
        frontMatter: options.frontMatter ?? DEFAULT_OPTIONS.frontMatter,
        gfm: options.gfm ?? DEFAULT_OPTIONS.gfm,
        maxBlockNesting:
            options.maxBlockNesting ?? DEFAULT_OPTIONS.maxBlockNesting,
        pedantic: options.pedantic ?? DEFAULT_OPTIONS.pedantic,
        superSubScript:
            options.superSubScript ?? DEFAULT_OPTIONS.superSubScript,
        isGitlabCompatibilityEnabled:
            options.isGitlabCompatibilityEnabled
            ?? DEFAULT_OPTIONS.isGitlabCompatibilityEnabled,
    });
}

function criticMarkupParserProfileKey(
    options: TCriticMarkupParserOptions,
): string {
    return JSON.stringify({
        breaks: options.breaks,
        footnote: options.footnote,
        math: options.math,
        frontMatter: options.frontMatter,
        gfm: options.gfm,
        maxBlockNesting: options.maxBlockNesting,
        pedantic: options.pedantic,
        superSubScript: options.superSubScript,
        isGitlabCompatibilityEnabled: options.isGitlabCompatibilityEnabled,
    });
}

function parserProfileFromSnapshot(
    options: TCriticMarkupParserOptions,
): Extract<TCriticMarkupAnalysisProfile, { kind: 'markdown' }> {
    return Object.freeze({
        kind: 'markdown',
        key: criticMarkupParserProfileKey(options),
    });
}

function assertSourceAndParserOptions(
    context: IPreparedMarkdownSourceContext,
    source: string,
    options: unknown,
): void {
    if (source !== context.source) {
        throw new TypeError(
            'Markdown token source differs from its prepared source context.',
        );
    }
    const actualProfile = parserProfileFromSnapshot(
        snapshotCriticMarkupParserOptions({
            ...context.parserOptions,
            ...parserProfileOptions(options),
        }),
    );
    if (actualProfile.key !== context.parserProfile.key) {
        throw new TypeError(
            'Markdown token parser options differ from the prepared parser profile.',
        );
    }
}

/** Source/profile provenance for Marked parses that do not need Critic state. */
export class PreparedMarkdownSourceContext
implements IPreparedMarkdownSourceContext {
    private constructor(
        readonly source: string,
        readonly parserOptions: TCriticMarkupParserOptions,
        readonly parserProfile: Extract<
            TCriticMarkupAnalysisProfile,
            { kind: 'markdown' }
        >,
    ) {
        Object.freeze(this);
    }

    static prepare(
        source: string,
        options: ILexOption,
    ): PreparedMarkdownSourceContext {
        const parserOptions = snapshotCriticMarkupParserOptions(options);
        return new PreparedMarkdownSourceContext(
            source,
            parserOptions,
            parserProfileFromSnapshot(parserOptions),
        );
    }

    assertSourceAndParserOptions(source: string, options: unknown): void {
        assertSourceAndParserOptions(this, source, options);
    }
}

export function prepareMarkdownSourceContext(
    source: string,
    options: ILexOption,
): PreparedMarkdownSourceContext {
    return PreparedMarkdownSourceContext.prepare(source, options);
}

export function criticMarkupParserProfile(
    options: ILexOption,
): Extract<TCriticMarkupAnalysisProfile, { kind: 'markdown' }> {
    return parserProfileFromSnapshot(
        snapshotCriticMarkupParserOptions(options),
    );
}

/**
 * Immutable source/profile/candidate/analysis identity established before
 * Marked token traversal. Located context receives this exact object and the
 * final document binder cannot substitute a second profile afterward.
 */
export class PreparedCriticMarkupSourceContext
implements IPreparedMarkdownSourceContext {
    private constructor(
        readonly source: string,
        readonly parserOptions: TCriticMarkupParserOptions,
        readonly parserProfile: Extract<
            TCriticMarkupAnalysisProfile,
            { kind: 'markdown' }
        >,
        readonly candidateIdentity: ICriticMarkupCandidateIdentity,
        readonly analysis: CriticMarkupAnalysis | null,
    ) {
        Object.freeze(this);
    }

    get hasCandidateOpener(): boolean {
        return this.candidateIdentity.hasCandidateOpener;
    }

    static prepare(
        source: string,
        options: ILexOption,
        analysis?: CriticMarkupAnalysis,
    ): PreparedCriticMarkupSourceContext {
        const parserOptions = snapshotCriticMarkupParserOptions(options);
        const parserProfile = parserProfileFromSnapshot(parserOptions);
        const candidateIdentity = analysis?.candidateIdentity
            ?? prepareCriticMarkupCandidateIdentity(source);
        if (analysis) {
            if (analysis.source !== source) {
                throw new TypeError(
                    'Prepared CriticMarkup analysis belongs to different static Markdown.',
                );
            }
            analysis.assertParserProfile(parserProfile);
            if (candidateIdentity.hasCandidateOpener)
                analysis.assertContextCoverage('complete');
        }

        return new PreparedCriticMarkupSourceContext(
            source,
            parserOptions,
            parserProfile,
            candidateIdentity,
            analysis ?? null,
        );
    }

    assertSourceAndParserOptions(
        source: string,
        options: unknown,
    ): void {
        assertSourceAndParserOptions(this, source, options);
    }
}

export function prepareCriticMarkupSourceContext(
    source: string,
    options: ILexOption,
    analysis?: CriticMarkupAnalysis,
): PreparedCriticMarkupSourceContext {
    return PreparedCriticMarkupSourceContext.prepare(source, options, analysis);
}
