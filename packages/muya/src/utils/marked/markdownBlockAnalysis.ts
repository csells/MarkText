import type {
    MarkedExtension,
    MarkedParseTrace,
    TokensList,
} from 'marked';
import type { CriticMarkupDocument } from '../../criticMarkup/document';
import type { IExcludedRange } from '../../criticMarkup/excludedRanges';
import type {
    PreparedMarkdownSourceContext,
} from './criticMarkupSourceContext';
import type { ICriticMarkupInlineLeaf } from './locatedMarkdown';
import type { IFrontmatterToken, ILexOption } from './types';
import {
    createMarkedProvenanceBinding,
    Marked,
    markedDocumentOffset,
    MarkedSourceDocument,
} from 'marked';
import { ExcludedRanges } from '../../criticMarkup/excludedRanges';
import {
    prepareMarkdownSourceContext,
} from './criticMarkupSourceContext';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import superSubScriptExtension from './extensions/superSubscript';
import fm from './frontMatter';
import { analyzeLocatedMarkdownContext } from './locatedMarkdown';
import { DEFAULT_OPTIONS } from './options';

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

export function prepareBlockLexer(
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
    for (const extension of extensions)
        marked.use(extension);

    return { marked, options: effective };
}

export function frontMatterPrefix(
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
