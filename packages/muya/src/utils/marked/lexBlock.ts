import type { Token } from 'marked';
import type { CriticMarkupDocument } from '../../criticMarkup/document';
import type {
    PreparedMarkdownSourceContext,
} from './criticMarkupSourceContext';
import type { ICriticMarkupInlineLeaf } from './locatedMarkdown';
import type { IMarkdownBlockSourceAnalysis } from './markdownBlockAnalysis';
import type { ILexOption, TLexedToken } from './types';
import { plainMarkdown } from '../../state/markdownSourceMap';
import { replaceArrayRange } from '../arrayMutation';
import compatibleTaskList from './compatibleTaskList';
import { parseCriticMarkupDocument } from './criticMarkupDocument';
import {
    prepareNativeCriticMarkupExtension,
} from './extensions/nativeCriticMarkup';
import {
    analyzeMarkdownBlockSourceWithExtensions,
    frontMatterPrefix,

    prepareBlockLexer,
} from './markdownBlockAnalysis';
import { DEFAULT_OPTIONS } from './options';
import walkTokens, { walkLexedTokens } from './walkTokens';

export {
    analyzeMarkdownBlockSourceWithExtensions,
    type IMarkdownBlockSourceAnalysis,
} from './markdownBlockAnalysis';

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

/** Ordinary editor lexing. No source-provenance graph is allocated. */
export function lexBlock(
    source: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexBlockResult {
    const prepared = prepareBlockLexer(options);
    const prefix = frontMatterPrefix(source, prepared.options.frontMatter);
    if (prepared.options.criticMarkup) {
        const analysis = analyzeMarkdownBlockSource(source, prepared.options);
        // Marked's own token union and Muya's lexed-token union describe the
        // same runtime graph; this boundary is where the two type worlds meet.
        // eslint-disable-next-line no-restricted-syntax
        const parserTokens = analysis.tokens as unknown as TLexedToken[];
        (parserTokens as TLexedToken[] & {
            criticMarkupDocument?: CriticMarkupDocument;
        }).criticMarkupDocument = analysis.criticMarkupDocument ?? undefined;
        if (prefix.token)
            parserTokens.unshift(prefix.token);
        const normalized = compatibleTaskList(parserTokens) as TLexedToken[];
        replaceArrayRange(parserTokens, 0, parserTokens.length, normalized);
        walkLexedTokens(
            parserTokens,
            walkTokens(prepared.options),
            prepared.marked.defaults.extensions?.childTokens,
        );
        return lexBlockResult(parserTokens, analysis.inlineLeaves);
    }
    let tokens: Token[] = prefix.token ? [prefix.token] : [];
    const parserTokens = new prepared.marked.Lexer(
        prepared.marked.defaults,
    ).lex(prefix.parserSource);
    replaceArrayRange(tokens, tokens.length, 0, parserTokens);
    tokens = compatibleTaskList(tokens);
    walkLexedTokens(
        tokens,
        walkTokens(prepared.options),
        prepared.marked.defaults.extensions?.childTokens,
    );
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
        const isPureListBlock = (fragment: string): boolean => {
            if (!fragment)
                return false;
            // The fragment is probed out of context; its shared leading
            // indentation encodes the ENCLOSING nesting level, not an
            // indented code block, so strip it before lexing.
            const lines = fragment.split('\n');
            let dedent = Number.POSITIVE_INFINITY;
            for (const line of lines) {
                if (line.trim().length) {
                    const indent = line.length - line.trimStart().length;
                    dedent = indent < dedent ? indent : dedent;
                }
            }
            if (!Number.isFinite(dedent))
                dedent = 0;
            const dedented = dedent
                ? lines.map(line =>
                        line.trim().length ? line.slice(dedent) : line)
                        .join('\n')
                : fragment;
            const parsed = analyzeMarkdownBlockSourceWithExtensions(
                dedented,
                { ...effective, criticMarkup: false },
                [],
            );
            return parsed.tokens.some(token => token.type === 'list')
                && parsed.tokens.every(token =>
                    token.type === 'list' || token.type === 'space');
        };
        const native = prepareNativeCriticMarkupExtension(
            document,
            isStructuralBlock,
            isPureListBlock,
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
