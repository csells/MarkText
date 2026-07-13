import type {
    MarkedParseTrace,
    TMarkedInvocationId,
    Token,
    Tokens,
} from 'marked';
import type { ICriticMarkupRange } from '../../criticMarkup/parser';
import type { IMappedTextSpan } from '../../mappedText';
import type { IMarkdownSourceMapPiece } from '../../state/stateToMarkdown';
import type {
    ICriticMarkupParseSession,
} from './criticMarkupParseSession';
import type {
    IPreparedMarkdownSourceContext,
    PreparedCriticMarkupSourceContext,
} from './criticMarkupSourceContext';
import type { IMarkedSourceView, TMarkedParserPath } from './markedSourceView';
import { MarkedSourceView as ParserSourceView } from 'marked';
import { ExcludedRanges } from '../../criticMarkup/excludedRanges';
import { upperBound } from '../../mapped-range';
import {
    localOffset,
    MappedText,
    sourceOffset,
} from '../../mappedText';
import { replaceArrayRange } from '../arrayMutation';
import {
    abandonCriticMarkupParseSession,
    beginCriticMarkupParseSession,
    completeCriticMarkupParseSession,
} from './criticMarkupParseSession';
import {
    markedParserPath,
    markedProvenanceSourceView,
    sliceView,
    sourceMapPieces,
    sourceRange,
} from './markedSourceView';

export type { TMarkedParserPath } from './markedSourceView';
export { markedParserPath } from './markedSourceView';

export interface ICriticMarkupInlineLeaf {
    path: TMarkedParserPath;
    text: string;
    pieces: IMarkdownSourceMapPiece[];
    tokens: Token[];
    locatedTokens: ICriticMarkupLocatedInlineToken[];
    replaceTokens: (tokens: Token[]) => void;
    plainTextProjections: ICriticMarkupPlainTextProjection[];
}

export interface ICriticMarkupLocatedInlineToken {
    token: Token;
    localRange: ICriticMarkupRange;
    children: ICriticMarkupLocatedInlineToken[];
}

export interface ICriticMarkupPlainTextProjection {
    localRange: ICriticMarkupRange;
    sourceRange: ICriticMarkupRange;
}

interface ILocatedMarkdownContextAnalysis<
    SourceContext extends IPreparedMarkdownSourceContext,
> {
    /** Frozen source/profile/candidate identity that selected this token tree. */
    readonly sourceContext: SourceContext;
    /** Exact immutable source revision that the located token tree describes. */
    readonly source: string;
    /** Source-located parser leaves without laundering their path identity. */
    readonly mappedText: MappedText<TMarkedParserPath>;
    readonly literalRanges: readonly ICriticMarkupRange[];
    readonly inlineLeaves: readonly ICriticMarkupInlineLeaf[];
}

export interface ICriticMarkupContextAnalysis
    extends ILocatedMarkdownContextAnalysis<PreparedCriticMarkupSourceContext> {}

export interface ICriticMarkupContextSourceBinding {
    /** Full canonical Markdown whose coordinates the analysis must expose. */
    source: string;
    /** Offset at which one contiguous tokenized parser source begins. */
    parserOffset?: number;
    /**
     * Exact parser-source slices that correspond to canonical source. Bytes
     * outside these slices are generated clipboard/container structure.
     */
    parserMappings?: readonly ICriticMarkupParserSourceMapping[];
    /** Canonical parser-owned literal ranges from the prepared document. */
    literalRanges: readonly ICriticMarkupRange[];
}

export interface ICriticMarkupParserSourceMapping {
    readonly parserStart: number;
    readonly parserEnd: number;
    readonly sourceStart: number;
    readonly sourceEnd: number;
}

interface ILocatedMarkedToken {
    token: Token;
    view: IMarkedSourceView;
    /** Lazily populated exactly once when this token owns parser children. */
    children: ILocatedMarkedToken[] | null;
}

interface ITraversalResult {
    literalRanges: ICriticMarkupRange[];
    inlineLeaves: ICriticMarkupInlineLeaf[];
    activeInlineLeaf: ICriticMarkupInlineLeaf | null;
    trace: MarkedParseTrace<IPreparedMarkdownSourceContext>;
}

type TTokenLevel = 'block' | 'inline';

const LITERAL_TOKEN_TYPES = new Set([
    'code',
    'codespan',
    'def',
    'frontmatter',
    'html',
    'inlineMath',
    'multiplemath',
    'subscript',
    'superscript',
]);

function tokenSourceView(
    trace: MarkedParseTrace<IPreparedMarkdownSourceContext>,
    token: Token,
): IMarkedSourceView | null {
    const consumptions = trace.sourceConsumptions(token);
    if (consumptions.length) {
        return markedProvenanceSourceView(ParserSourceView.concat(
            consumptions.map(consumption => consumption.source),
            trace.input.document,
        ));
    }

    const childArrays: Token[][] = [];
    if (token.type === 'list') {
        for (const item of (token as Tokens.List).items)
            childArrays.push(item.tokens);
    }
    else {
        const children = (token as Tokens.Generic).tokens;
        if (Array.isArray(children))
            childArrays.push(children);
    }
    const inputs = childArrays.flatMap(children =>
        trace.invocationsForTokens(children).map(invocation => invocation.input));
    return inputs.length
        ? markedProvenanceSourceView(ParserSourceView.concat(
                inputs,
                trace.input.document,
            ))
        : null;
}

function locateChildren(
    trace: MarkedParseTrace<IPreparedMarkdownSourceContext>,
    children: readonly Token[],
): ILocatedMarkedToken[] {
    return children.flatMap((token) => {
        const view = tokenSourceView(trace, token);
        if (!view) {
            if (token.type === 'checkbox')
                return [];
            throw new TypeError(
                `Marked token ${token.type} has no parser-owned source provenance.`,
            );
        }
        return [{ token, view, children: null }];
    });
}

function sourceChildren(
    node: ILocatedMarkedToken,
    result: ITraversalResult,
): ILocatedMarkedToken[] {
    if (node.children)
        return node.children;
    const children = (node.token as Tokens.Generic).tokens;
    node.children = Array.isArray(children)
        ? locateChildren(result.trace, children)
        : [];
    return node.children;
}

function sourcePieceContaining(
    pieces: readonly IMarkdownSourceMapPiece[],
    offset: number,
): IMarkdownSourceMapPiece | null {
    const candidateIndex = upperBound(
        pieces,
        offset,
        piece => piece.sourceStart,
    ) - 1;
    const candidate = pieces[candidateIndex];
    return candidate
        && candidate.sourceStart <= offset
        && offset < candidate.sourceEnd
        ? candidate
        : null;
}

function localRangeForSourceRange(
    leaf: ICriticMarkupInlineLeaf,
    range: ICriticMarkupRange,
): ICriticMarkupRange {
    const startPiece = sourcePieceContaining(leaf.pieces, range.start);
    const finalOffset = range.end - 1;
    const endPiece = sourcePieceContaining(leaf.pieces, finalOffset);
    if (!startPiece || !endPiece)
        throw new RangeError('Source range is not covered by its owning inline leaf.');
    return {
        start: startPiece.localStart + range.start - startPiece.sourceStart,
        end: endPiece.localStart + range.end - endPiece.sourceStart,
    };
}

function pushRange(
    ranges: ICriticMarkupRange[],
    view: IMarkedSourceView,
    start = 0,
    end = view.text.length,
) {
    for (const piece of sourceMapPieces(sliceView(view, start, end))) {
        ranges.push({
            start: piece.sourceStart,
            end: piece.sourceEnd,
        });
    }
}

/**
 * Parser transformations may remove container prefixes from a literal token's
 * mapped view. The token nevertheless owns the complete canonical interval
 * between its first and last parser-owned byte: CriticMarkup must not become
 * semantic merely because a blockquote/list prefix created mapping gaps.
 */
function pushEnvelopeRange(
    ranges: ICriticMarkupRange[],
    view: IMarkedSourceView,
    start = 0,
    end = view.text.length,
) {
    const range = sourceRange(view, start, end);
    if (range)
        ranges.push(range);
}
function locatedInlineTree(
    nodes: readonly ILocatedMarkedToken[],
    leaf: ICriticMarkupInlineLeaf,
    result: ITraversalResult,
    leafInvocationId: TMarkedInvocationId,
): ICriticMarkupLocatedInlineToken[] {
    return nodes.map((node) => {
        const direct = result.trace.tokenConsumptions(node.token)
            .filter(consumption =>
                consumption.invocationId === leafInvocationId);
        const source = direct.length ? null : sourceRange(node.view);
        if (!direct.length && !source) {
            throw new RangeError(
                `Marked token ${node.token.type} has an empty source range.`,
            );
        }
        const localRange = direct.length
            ? {
                    start: direct[0].range.start,
                    end: direct.at(-1)!.range.end,
                }
            : localRangeForSourceRange(leaf, source!);
        return {
            token: node.token,
            localRange,
            children: node.token.type === 'image'
                ? []
                : locatedInlineTree(
                        optionalSourceChildren(node, result) ?? [],
                        leaf,
                        result,
                        leafInvocationId,
                    ),
        };
    });
}

function recordInlineLeaf(
    nodes: ILocatedMarkedToken[],
    ownerTokens: Token[],
    replaceOwnerTokens: (tokens: Token[]) => void,
    result: ITraversalResult,
) {
    if (!nodes.length)
        return;
    const tokens = ownerTokens;
    const invocation = result.trace.inlineInvocation(tokens);
    const parserView = markedProvenanceSourceView(invocation.input);
    const leaf: ICriticMarkupInlineLeaf = {
        path: markedParserPath(['marked', result.inlineLeaves.length, 'text']),
        text: parserView.text,
        pieces: sourceMapPieces(parserView),
        tokens,
        locatedTokens: [],
        plainTextProjections: [],
        replaceTokens(nextTokens) {
            leaf.tokens = nextTokens;
            replaceOwnerTokens(nextTokens);
        },
    };
    leaf.locatedTokens = locatedInlineTree(
        nodes,
        leaf,
        result,
        invocation.id,
    );
    result.inlineLeaves.push(leaf);

    const previousLeaf = result.activeInlineLeaf;
    result.activeInlineLeaf = leaf;
    visitLocated(nodes, result, 'inline');
    result.activeInlineLeaf = previousLeaf;
}

function sourceRangesForViews(
    views: readonly IMarkedSourceView[],
): ICriticMarkupRange[] {
    return views.flatMap(view => sourceMapPieces(view).map(piece => ({
        start: piece.sourceStart,
        end: piece.sourceEnd,
    }))).sort((left, right) => left.start - right.start || left.end - right.end);
}

function pushLiteralComplement(
    ranges: ICriticMarkupRange[],
    parent: IMarkedSourceView,
    visible: readonly IMarkedSourceView[],
) {
    const visibleRanges = sourceRangesForViews(visible);
    for (const parentRange of sourceRangesForViews([parent])) {
        let cursor = parentRange.start;
        for (const child of visibleRanges) {
            if (child.end <= cursor)
                continue;
            if (parentRange.end <= child.start)
                break;
            if (cursor < child.start) {
                ranges.push({
                    start: cursor,
                    end: Math.min(child.start, parentRange.end),
                });
            }
            cursor = Math.max(cursor, Math.min(child.end, parentRange.end));
            if (cursor >= parentRange.end)
                break;
        }
        if (cursor < parentRange.end)
            ranges.push({ start: cursor, end: parentRange.end });
    }
}

function optionalSourceChildren(
    node: ILocatedMarkedToken,
    result: ITraversalResult,
): ILocatedMarkedToken[] | null {
    const children = (node.token as Tokens.Generic).tokens;
    if (!Array.isArray(children))
        return [];
    const located: ILocatedMarkedToken[] = [];
    for (const token of children) {
        const view = tokenSourceView(result.trace, token);
        if (!view)
            return null;
        located.push({ token, view, children: null });
    }
    node.children = located;
    return located;
}

function visitLinkOrImage(node: ILocatedMarkedToken, result: ITraversalResult) {
    const token = node.token as Tokens.Link | Tokens.Image;
    const view = node.view;
    const children = optionalSourceChildren(node, result);
    if (!children) {
        pushEnvelopeRange(result.literalRanges, view);
        return;
    }
    const childViews = children.map(child => child.view);
    pushLiteralComplement(result.literalRanges, view, childViews);
    if (token.type === 'image') {
        const childRanges = sourceRangesForViews(childViews);
        if (childRanges.length) {
            const source = {
                start: childRanges[0].start,
                end: childRanges.at(-1)!.end,
            };
            const leaf = result.activeInlineLeaf;
            if (!leaf)
                throw new TypeError('Marked image alternative has no owning inline leaf.');
            leaf.plainTextProjections.push({
                sourceRange: source,
                localRange: localRangeForSourceRange(leaf, source),
            });
        }
        visitLocated(children, result, 'inline');
        return;
    }
    visitLocated(children, result, 'inline');
}

function visitTable(token: Tokens.Table, result: ITraversalResult) {
    const cells = [...token.header, ...token.rows.flat()];
    for (const cell of cells) {
        if (!cell.text)
            continue;
        recordInlineLeaf(
            locateChildren(result.trace, cell.tokens),
            cell.tokens,
            (tokens) => { cell.tokens = tokens; },
            result,
        );
    }
}

type TLocatedTokenVisitor = (node: ILocatedMarkedToken, result: ITraversalResult) => void;

const INLINE_OWNER_VISITOR: TLocatedTokenVisitor = (node, result) => {
    const owner = node.token as Tokens.Generic & { tokens?: Token[] };
    if (Array.isArray(owner.tokens)) {
        recordInlineLeaf(
            sourceChildren(node, result),
            owner.tokens,
            (tokens) => { owner.tokens = tokens; },
            result,
        );
    }
};

const BLOCK_VISITORS: Readonly<Partial<Record<string, TLocatedTokenVisitor>>> = {
    paragraph: INLINE_OWNER_VISITOR,
    heading: INLINE_OWNER_VISITOR,
    text: INLINE_OWNER_VISITOR,
    blockquote(node, result) {
        const children = (node.token as Tokens.Generic).tokens;
        if (Array.isArray(children)) {
            node.children = locateChildren(result.trace, children);
            visitLocated(node.children, result, 'block');
        }
    },
    list(node, result) {
        const children = (node.token as Tokens.List).items;
        node.children = children.map((token) => {
            const invocations = result.trace.invocationsForTokens(token.tokens)
                .filter(invocation => invocation.level === 'block');
            if (!invocations.length) {
                throw new TypeError(
                    'Marked list item has no parser-owned child invocation.',
                );
            }
            return {
                token,
                view: markedProvenanceSourceView(ParserSourceView.concat(
                    invocations.map(invocation => invocation.input),
                    result.trace.input.document,
                )),
                children: null,
            };
        });
        visitLocated(node.children, result, 'block');
    },
    list_item(node, result) {
        const children = (node.token as Tokens.Generic).tokens;
        if (Array.isArray(children)) {
            node.children = locateChildren(result.trace, children);
            visitLocated(node.children, result, 'block');
        }
    },
    footnote(node, result) {
        const owner = node.token as Tokens.Generic & { identifier?: unknown; tokens?: Token[] };
        if (Array.isArray(owner.tokens)) {
            node.children = locateChildren(result.trace, owner.tokens);
            visitLocated(node.children, result, 'block');
        }
    },
    table(node, result) {
        visitTable(node.token as Tokens.Table, result);
    },
};

function visitBlock(node: ILocatedMarkedToken, result: ITraversalResult) {
    const visitor = BLOCK_VISITORS[node.token.type];
    if (visitor)
        visitor(node, result);
    else
        visitLocated(sourceChildren(node, result), result, 'block');
}

function visitInline(node: ILocatedMarkedToken, result: ITraversalResult) {
    if (node.token.type === 'link' || node.token.type === 'image')
        visitLinkOrImage(node, result);
    else
        visitLocated(sourceChildren(node, result), result, 'inline');
}

function visitLocated(
    nodes: readonly ILocatedMarkedToken[],
    result: ITraversalResult,
    level: TTokenLevel,
) {
    for (const node of nodes) {
        if (node.token.type === 'parser_residue')
            continue;
        if (LITERAL_TOKEN_TYPES.has(node.token.type)) {
            pushEnvelopeRange(result.literalRanges, node.view);
            continue;
        }
        if (level === 'block')
            visitBlock(node, result);
        else
            visitInline(node, result);
    }
}

function assertParserSourceMapping(
    mapping: ICriticMarkupParserSourceMapping,
    previous: ICriticMarkupParserSourceMapping | undefined,
    parserSource: string,
    canonicalSource: string,
    allowEmpty: boolean,
): void {
    const values = [
        mapping.parserStart,
        mapping.parserEnd,
        mapping.sourceStart,
        mapping.sourceEnd,
    ];
    if (
        values.some(value => !Number.isInteger(value))
        || mapping.parserStart < (previous?.parserEnd ?? 0)
        || mapping.sourceStart < (previous?.sourceEnd ?? 0)
        || mapping.parserStart < 0
        || mapping.parserEnd < mapping.parserStart
        || (mapping.parserEnd === mapping.parserStart && !allowEmpty)
        || parserSource.length < mapping.parserEnd
        || mapping.sourceStart < 0
        || mapping.sourceEnd < mapping.sourceStart
        || canonicalSource.length < mapping.sourceEnd
        || mapping.parserEnd - mapping.parserStart
        !== mapping.sourceEnd - mapping.sourceStart
        || parserSource.slice(mapping.parserStart, mapping.parserEnd)
        !== canonicalSource.slice(mapping.sourceStart, mapping.sourceEnd)
    ) {
        throw new RangeError(
            'Located Markdown parser mapping is invalid for its canonical source.',
        );
    }
}

function parserSourceMappings(
    parserSource: string,
    sourceBinding?: ICriticMarkupContextSourceBinding,
): readonly ICriticMarkupParserSourceMapping[] {
    if (!sourceBinding) {
        return [{
            parserStart: 0,
            parserEnd: parserSource.length,
            sourceStart: 0,
            sourceEnd: parserSource.length,
        }];
    }

    const hasOffset = sourceBinding.parserOffset !== undefined;
    const hasMappings = sourceBinding.parserMappings !== undefined;
    if (hasOffset === hasMappings) {
        throw new TypeError(
            'Located Markdown source binding requires exactly one mapping form.',
        );
    }

    const mappings: ICriticMarkupParserSourceMapping[] = [];
    if (sourceBinding.parserMappings) {
        for (const mapping of sourceBinding.parserMappings)
            mappings.push(mapping);
    }
    else {
        const parserOffset = sourceBinding.parserOffset;
        if (parserOffset === undefined) {
            throw new TypeError(
                'Located Markdown source offset is missing.',
            );
        }
        if (parserOffset + parserSource.length !== sourceBinding.source.length) {
            throw new RangeError(
                'Located Markdown parser source is not at its declared canonical offset.',
            );
        }
        mappings.push({
            parserStart: 0,
            parserEnd: parserSource.length,
            sourceStart: parserOffset,
            sourceEnd: parserOffset + parserSource.length,
        });
    }
    if (!mappings.length)
        throw new RangeError('Located Markdown source binding is empty.');

    const allowEmptyMapping
        = sourceBinding.parserMappings === undefined
            && parserSource.length === 0;
    for (let index = 0; index < mappings.length; index++) {
        assertParserSourceMapping(
            mappings[index],
            mappings[index - 1],
            parserSource,
            sourceBinding.source,
            allowEmptyMapping,
        );
    }

    return mappings;
}

export function analyzeLocatedMarkdownContext<
    SourceContext extends IPreparedMarkdownSourceContext,
>(
    sourceContext: SourceContext,
    source: string,
    tokens: Token[],
    trace: MarkedParseTrace<SourceContext>,
    level: TTokenLevel = 'block',
    sourceBinding?: ICriticMarkupContextSourceBinding,
): ILocatedMarkdownContextAnalysis<SourceContext> {
    const canonicalSource = sourceContext.source;
    if (sourceBinding && sourceBinding.source !== canonicalSource) {
        throw new TypeError(
            'Located Markdown source is detached from its prepared parser context.',
        );
    }
    if (
        trace.tokens !== tokens
        || trace.level !== level
        || trace.input.document.id !== sourceContext
        || trace.input.document.text !== canonicalSource
        || trace.input.text !== source
    ) {
        throw new TypeError(
            'Located Markdown provenance differs from its parser context.',
        );
    }
    // Validate the declared parser/canonical partition. Coordinates below are
    // already canonical because the Lexer trace carries the mapped input.
    if (sourceBinding)
        parserSourceMappings(source, sourceBinding);
    const result: ITraversalResult = {
        literalRanges: [],
        inlineLeaves: [],
        activeInlineLeaf: null,
        trace: trace as MarkedParseTrace<IPreparedMarkdownSourceContext>,
    };
    for (const residue of trace.residues) {
        const view = markedProvenanceSourceView(residue.source);
        if (residue.coverage === 'source-envelope')
            pushEnvelopeRange(result.literalRanges, view);
        else
            pushRange(result.literalRanges, view);
    }
    const rootNodes = locateChildren(result.trace, tokens);
    if (level === 'inline') {
        recordInlineLeaf(
            rootNodes,
            tokens,
            nextTokens => replaceArrayRange(
                tokens,
                0,
                tokens.length,
                nextTokens,
            ),
            result,
        );
    }
    else {
        visitLocated(rootNodes, result, level);
    }
    const spans: IMappedTextSpan<TMarkedParserPath>[]
        = result.inlineLeaves.flatMap(leaf => leaf.pieces.map(piece => ({
            path: leaf.path,
            localStart: localOffset(piece.localStart),
            localEnd: localOffset(piece.localEnd),
            sourceStart: sourceOffset(piece.sourceStart),
            sourceEnd: sourceOffset(piece.sourceEnd),
        })));
    return Object.freeze({
        sourceContext,
        source: canonicalSource,
        mappedText: new MappedText(canonicalSource, spans),
        literalRanges: Object.freeze(ExcludedRanges.from(canonicalSource.length, [
            ...(sourceBinding?.literalRanges ?? []),
            ...result.literalRanges,
        ])
            .ranges
            .map(range => ({ ...range }))),
        inlineLeaves: Object.freeze(result.inlineLeaves),
    });
}

export function analyzeCriticMarkupContext(
    session: ICriticMarkupParseSession,
    level: TTokenLevel = session.level,
    sourceBinding?: ICriticMarkupContextSourceBinding,
): ICriticMarkupContextAnalysis {
    if (level !== session.level) {
        throw new TypeError(
            'CriticMarkup parser session cannot be relabeled to another lexer mode.',
        );
    }
    const provenance = beginCriticMarkupParseSession(session);
    try {
        const result = analyzeLocatedMarkdownContext(
            provenance.sourceContext,
            provenance.parserSource,
            provenance.tokens,
            provenance.trace,
            level,
            sourceBinding,
        );
        completeCriticMarkupParseSession(session);
        return result;
    }
    catch (error) {
        abandonCriticMarkupParseSession(session);
        throw error;
    }
}
