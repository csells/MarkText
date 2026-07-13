import type { CriticMarkupDocument } from '../../criticMarkup/document';
import type { TSourceRange } from '../../mappedText';
import type { ILexOption } from './types';
import { Marked } from 'marked';
import { EXPORT_DOMPURIFY_CONFIG } from '../../config';
import { sanitize } from '../index';
import { projectCriticMarkupMarkdown } from './criticMarkupDocument';
import cjkEmStrongExtension from './extensions/cjkEmStrong';
import criticMarkupDocumentExtension from './extensions/criticMarkupDocument';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import superSubScriptExtension from './extensions/superSubscript';
import fm, { frontMatterRender } from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

export interface ICriticMarkupClipboardContext {
    readonly document: CriticMarkupDocument;
    readonly sourceRange: TSourceRange;
    readonly leadingMarkdown: string;
    readonly trailingMarkdown: string;
}

function canonicalClipboardSlice(
    src: string,
    context: ICriticMarkupClipboardContext,
): string {
    const {
        document,
        sourceRange,
        leadingMarkdown,
        trailingMarkdown,
    } = context;
    const canonical = document.markdown.slice(
        sourceRange.start,
        sourceRange.end,
    );
    if (`${leadingMarkdown}${canonical}${trailingMarkdown}` !== src) {
        throw new RangeError(
            'Clipboard Markdown does not match its canonical CriticMarkup source range.',
        );
    }

    return canonical;
}

function contextualSourceBinding(
    parserSource: string,
    context: ICriticMarkupClipboardContext,
) {
    const canonical = context.document.markdown.slice(
        context.sourceRange.start,
        context.sourceRange.end,
    );
    const parserStart = context.leadingMarkdown.length;
    const parserEnd = parserStart + canonical.length;
    if (
        parserSource.slice(parserStart, parserEnd) !== canonical
        || parserSource.slice(0, parserStart) !== context.leadingMarkdown
        || parserSource.slice(parserEnd) !== context.trailingMarkdown
    ) {
        throw new RangeError(
            'Rendered clipboard Markdown differs from its explicit canonical source mapping.',
        );
    }

    return {
        source: context.document.markdown,
        parserMappings: [{
            parserStart,
            parserEnd,
            sourceStart: context.sourceRange.start,
            sourceEnd: context.sourceRange.end,
        }],
        literalRanges: context.document.excludedRanges.ranges,
    };
}

function projectClipboardMarkdown(
    src: string,
    options: ILexOption,
    context?: ICriticMarkupClipboardContext,
): string {
    if (
        !options.criticMarkup
        || options.criticMarkupProjection === 'marked'
    ) {
        return src;
    }

    return context
        ? `${context.leadingMarkdown}${context.document.projectSourceRange(
            context.sourceRange,
            options.criticMarkupProjection ?? 'marked',
        )}${context.trailingMarkdown}`
        : projectCriticMarkupMarkdown(
                src,
                options.criticMarkupProjection ?? 'marked',
                options,
            );
}

export function getClipBoardHtml(
    src: string,
    options: ILexOption = {},
    criticMarkupContext?: ICriticMarkupClipboardContext,
) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const {
        criticMarkup,
        criticMarkupProjection,
        footnote,
        frontMatter,
        math,
        isGitlabCompatibilityEnabled,
        superSubScript,
    } = options;
    let html = '';
    const clipboardSource = src;
    const canonicalSlice = criticMarkupContext
        ? canonicalClipboardSlice(src, criticMarkupContext)
        : src;
    const contextualItems = criticMarkupContext?.document
        .itemsContainedBySourceRange(criticMarkupContext.sourceRange) ?? [];
    const renderContextualReviewItems = contextualItems.length > 0;
    src = criticMarkupProjection === 'marked'
        && criticMarkupContext
        ? clipboardSource
        : canonicalSlice;
    const canonicalSource = criticMarkupContext?.document.markdown ?? src;
    let parserSourceOffset = 0;

    // Resolve the full document before front-matter extraction. Otherwise a
    // body-leading thematic break can be reinterpreted as front matter after
    // the true header has been removed.
    src = projectClipboardMarkdown(src, options, criticMarkupContext);

    // Use a fresh Marked instance per call to avoid polluting the global
    // `marked` singleton — `.use({ walkTokens })` chains rather than replaces,
    // and the global is shared with anything else in the bundle that imports
    // `marked`.
    const marked = new Marked();

    marked.use({
        walkTokens: walkTokens({ math, isGitlabCompatibilityEnabled }),
    });

    // CJK-as-punctuation emphasis flanking (marktext/marktext#4307); keeps the
    // clipboard HTML consistent with the static / export render path.
    marked.use(cjkEmStrongExtension());

    if (math) {
        marked.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (superSubScript)
        marked.use(superSubScriptExtension());

    if (footnote)
        marked.use(footnoteExtension());

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            parserSourceOffset = token.raw.length;
            src = newSrc;
        }
    }

    if (
        criticMarkup
        && criticMarkupProjection === 'marked'
        && (!criticMarkupContext || renderContextualReviewItems)
    ) {
        marked.use(criticMarkupDocumentExtension(src, {
            parserOptions: options,
            ...(criticMarkupContext
                ? {
                        sourceBinding: contextualSourceBinding(
                            src,
                            criticMarkupContext,
                        ),
                        analysis: criticMarkupContext.document.analysis,
                    }
                : parserSourceOffset
                    ? {
                            sourceBinding: {
                                source: canonicalSource,
                                parserOffset: parserSourceOffset,
                                literalRanges: [{
                                    start: 0,
                                    end: parserSourceOffset,
                                }],
                            },
                        }
                    : {}),
        }));
    }

    html += marked.parse(src, options);

    return html;
}

export function getSanitizeClipboardHtml(
    src: string,
    options: ILexOption = {},
    criticMarkupContext?: ICriticMarkupClipboardContext,
) {
    const html = getClipBoardHtml(src, options, criticMarkupContext);

    return sanitizeClipboardHtml(html);
}

/** Sanitize already-rendered rich clipboard HTML at its final write boundary. */
export function sanitizeClipboardHtml(html: string): string {
    return sanitize(html, EXPORT_DOMPURIFY_CONFIG, false) as string;
}
