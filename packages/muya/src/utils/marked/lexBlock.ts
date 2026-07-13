import type {
    MarkedExtension,
    MarkedParseTrace,
    Token,
    TokensList,
} from 'marked';
import type { IExcludedRange } from '../../criticMarkup/excludedRanges';
import type {
    PreparedMarkdownSourceContext,
} from './criticMarkupSourceContext';
import type { CriticMarkupDocument } from '../../criticMarkup/document';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import {
    createMarkedProvenanceBinding,
    Marked,
    markedDocumentOffset,
    MarkedSourceDocument,
} from 'marked';
import { ExcludedRanges } from '../../criticMarkup/excludedRanges';
import { plainMarkdown } from '../../state/markdownSourceMap';
import { replaceArrayRange } from '../arrayMutation';
import compatibleTaskList from './compatibleTaskList';
import {
    prepareMarkdownSourceContext,
} from './criticMarkupSourceContext';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import superSubScriptExtension from './extensions/superSubscript';
import fm from './frontMatter';
import type { ICriticMarkupInlineLeaf } from './locatedMarkdown';
import { analyzeLocatedMarkdownContext } from './locatedMarkdown';
import { parseCriticMarkupDocument } from './criticMarkupDocument';
import {
    prepareNativeCriticMarkupExtension,
} from './extensions/nativeCriticMarkup';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

interface IPreparedBlockLexer {
    readonly marked: Marked;
    readonly options: ILexOption;
}

export interface IMarkdownBlockSourceAnalysis {
    readonly sourceContext: PreparedMarkdownSourceContext;
    readonly parserSource: string;
    readonly tokens: TokensList;
    readonly trace: MarkedParseTrace<PreparedMarkdownSourceContext>;
    readonly literalRanges: readonly IExcludedRange[];
    /** Exact parser-local/canonical mappings for every inline token owner. */
    readonly inlineLeaves: readonly ICriticMarkupInlineLeaf[];
    readonly criticMarkupDocument: CriticMarkupDocument | null;
}

/** Muya parse result with its exact revision-owned inline provenance. */
export type TLexBlockResult = TLexedToken[] & {
    readonly criticMarkupInlineLeaves: readonly ICriticMarkupInlineLeaf[];
};

function lexBlockResult(
    tokens: TLexedToken[],
    inlineLeaves: readonly ICriticMarkupInlineLeaf[],
): TLexBlockResult {
    return Object.assign(tokens, {
        criticMarkupInlineLeaves: inlineLeaves,
    });
}

function prepareBlockLexer(
    options: ILexOption,
    extensions: readonly MarkedExtension[] = [],
): IPreparedBlockLexer {
    const effective = Object.assign({}, DEFAULT_OPTIONS, options);
    const marked = new Marked();
    marked.options({
        breaks: effective.breaks,
        gfm: effective.gfm,
        maxBlockNesting: effective.maxBlockNesting,
        pedantic: effective.pedantic,
    });

    if (effective.math) {
        marked.use(mathExtension({
            throwOnError: false,
            useKatexRender: false,
        }));
    }
    if (effective.footnote)
        marked.use(footnoteExtension());
    if (effective.superSubScript)
        marked.use(superSubScriptExtension());
    if (extensions.length)
        marked.use(...extensions);

    return { marked, options: effective };
}

function frontMatterPrefix(
    source: string,
    enabled: boolean | undefined,
): {
    readonly token?: IFrontmatterToken;
    readonly parserSource: string;
    readonly parserOffset: number;
} {
    if (!enabled) {
        return {
            parserSource: source,
            parserOffset: 0,
        };
    }
    const result = fm(source);
    return result.token
        ? {
                token: result.token,
                parserSource: result.src,
                parserOffset: result.token.raw.length,
            }
        : {
                parserSource: source,
                parserOffset: 0,
            };
}

/** Ordinary editor lexing. No source-provenance graph is allocated. */
export function lexBlock(
    source: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexBlockResult {
    const prepared = prepareBlockLexer(options);
    const prefix = frontMatterPrefix(source, prepared.options.frontMatter);
    if (prepared.options.criticMarkup) {
        const analysis = analyzeMarkdownBlockSource(source, prepared.options);
        const parserTokens = analysis.tokens as unknown as TLexedToken[];
        (parserTokens as TLexedToken[] & {
            criticMarkupDocument?: CriticMarkupDocument;
        }).criticMarkupDocument = analysis.criticMarkupDocument ?? undefined;
        if (prefix.token)
            parserTokens.unshift(prefix.token);
        const normalized = compatibleTaskList(parserTokens) as TLexedToken[];
        replaceArrayRange(parserTokens, 0, parserTokens.length, normalized);
        prepared.marked.walkTokens(
            parserTokens,
            walkTokens(prepared.options),
        );
        return lexBlockResult(parserTokens, analysis.inlineLeaves);
    }
    let tokens: Token[] = prefix.token ? [prefix.token] : [];
    const parserTokens = new prepared.marked.Lexer(
        prepared.marked.defaults,
    ).lex(prefix.parserSource);
    replaceArrayRange(tokens, tokens.length, 0, parserTokens);
    tokens = compatibleTaskList(tokens);
    prepared.marked.walkTokens(tokens, walkTokens(prepared.options));
    return lexBlockResult(
        tokens as TLexedToken[],
        Object.freeze([]),
    );
}

/**
 * Explicit parser-context parse. It consumes located source truth before any
 * Muya token normalizer is allowed to mutate the native Marked graph.
 */
export function analyzeMarkdownBlockSource(
    source: string,
    options: ILexOption = DEFAULT_OPTIONS,
    preparedSourceContext?: PreparedMarkdownSourceContext,
): IMarkdownBlockSourceAnalysis {
    const effective = Object.assign({}, DEFAULT_OPTIONS, options);
    if (effective.criticMarkup) {
        const document = parseCriticMarkupDocument(
            plainMarkdown(source),
            { ...effective, criticMarkup: false },
        );
        const isStructuralBlock = (fragment: string): boolean => {
            if (!fragment)
                return false;
            const parsed = analyzeMarkdownBlockSourceWithExtensions(
                fragment,
                { ...effective, criticMarkup: false },
                [],
            );
            return parsed.tokens.some(token =>
                token.type !== 'paragraph'
                && token.type !== 'text'
                && token.type !== 'space');
        };
        const native = prepareNativeCriticMarkupExtension(
            document,
            isStructuralBlock,
        );
        const parsed = analyzeMarkdownBlockSourceWithExtensions(
            source,
            effective,
            document.roots.length ? [native.extension] : [],
            preparedSourceContext,
            native.useTransparentParserView
                ? native.transparentMarkerRanges
                : [],
        );
        return Object.freeze({
            ...parsed,
            criticMarkupDocument: document,
        });
    }
    return analyzeMarkdownBlockSourceWithExtensions(
        source,
        effective,
        [],
        preparedSourceContext,
    );
}

/**
 * Run the source-provenanced block parser with parser-level extensions that
 * must participate in the final semantic token graph. Context-discovery
 * parses use `analyzeMarkdownBlockSource`; native syntax adapters use this
 * entry only after their canonical source analysis has been prepared.
 */
export function analyzeMarkdownBlockSourceWithExtensions(
    source: string,
    options: ILexOption,
    extensions: readonly MarkedExtension[],
    preparedSourceContext?: PreparedMarkdownSourceContext,
    transparentRanges: readonly IExcludedRange[] = [],
): IMarkdownBlockSourceAnalysis {
    const prepared = prepareBlockLexer(options, extensions);
    const sourceContext = preparedSourceContext
        ?? prepareMarkdownSourceContext(source, prepared.options);
    sourceContext.assertSourceAndParserOptions(source, prepared.options);
    const prefix = frontMatterPrefix(source, prepared.options.frontMatter);
    const sourceDocument = new MarkedSourceDocument(sourceContext, source);
    const parserStart = prefix.parserOffset;
    const parserEnd = prefix.parserOffset + prefix.parserSource.length;
    let parserView = sourceDocument.slice(
        markedDocumentOffset(parserStart),
        markedDocumentOffset(parserEnd),
    );
    if (transparentRanges.length) {
        const parts = [];
        let cursor = parserStart;
        for (const range of transparentRanges) {
            if (range.end <= parserStart || parserEnd <= range.start)
                continue;
            if (range.start < cursor || parserEnd < range.end) {
                throw new RangeError(
                    'Native CriticMarkup marker ranges must be ordered inside parser source.',
                );
            }
            if (cursor < range.start) {
                parts.push(sourceDocument.slice(
                    markedDocumentOffset(cursor),
                    markedDocumentOffset(range.start),
                ));
            }
            cursor = range.end;
        }
        if (cursor < parserEnd) {
            parts.push(sourceDocument.slice(
                markedDocumentOffset(cursor),
                markedDocumentOffset(parserEnd),
            ));
        }
        parserView = parts.length
            ? sourceDocument.compose(parts)
            : sourceDocument.replacement(
                    '',
                    markedDocumentOffset(parserStart),
                    markedDocumentOffset(parserEnd),
                );
    }
    const provenance = createMarkedProvenanceBinding(parserView);
    prepared.marked.use(provenance.extension);
    const tokens = new prepared.marked.Lexer(
        prepared.marked.defaults,
    ).lex(parserView.text);
    const trace = provenance.claim(tokens);
    const located = analyzeLocatedMarkdownContext(
        sourceContext,
        parserView.text,
        tokens,
        trace,
        'block',
    );
    trace.assertUnchanged();
    const literalRanges = ExcludedRanges.from(source.length, [
        ...(prefix.parserOffset
            ? [{ start: 0, end: prefix.parserOffset }]
            : []),
        ...located.literalRanges,
    ]).ranges.map(range => Object.freeze({ ...range }));

    return Object.freeze({
        sourceContext,
        parserSource: parserView.text,
        tokens,
        trace,
        literalRanges: Object.freeze(literalRanges),
        inlineLeaves: located.inlineLeaves,
        criticMarkupDocument: null,
    });
}
