import type { Tokens } from 'marked';
import type { TCriticMarkupDocumentToken } from '../../../criticMarkup/analysis';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
} from '../../../criticMarkup/document';
import {
    exceedsCriticMarkupParseDepthBudget,
} from '../../../criticMarkup/renderPolicy';
import { upperBound } from '../../../mapped-range';
import { sourceRange } from '../../../mappedText';
import { sourceLineIndex } from './criticMarkupPlanIndex';

export interface ICriticMarkupFragmentPlan {
    readonly item: ICriticMarkupDocumentItem;
    readonly level: 'block' | 'inline';
    readonly arm: Tokens.CriticMarkupFragment['arm'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    readonly range: Tokens.CriticMarkupRange;
    readonly contentRange: Tokens.CriticMarkupRange;
    readonly before: readonly Tokens.CriticMarkupMarker[];
    readonly after: readonly Tokens.CriticMarkupMarker[];
    /**
     * A per-line piece of a mixed (inline-anchored, block-spanning) item.
     * Its markers stay literal in the text, the line may begin with block
     * syntax the inline lexer never sees, and its content clamps to the
     * hosting leaf's view.
     */
    readonly literalLine?: boolean;
}

export function itemMarkerRanges(
    item: ICriticMarkupDocumentItem,
): Tokens.CriticMarkupRange[] {
    const { syntax } = item;
    return (syntax.type === 'substitution'
        ? [
                syntax.markers.open.range,
                syntax.markers.separator.range,
                syntax.markers.close.range,
            ]
        : [syntax.markers.open.range, syntax.markers.close.range])
        .map(range => ({ start: range.start, end: range.end }));
}

export function criticMarkerRanges(
    document: CriticMarkupDocument,
): Tokens.CriticMarkupRange[] {
    return document.items.flatMap((item) => {
        const { syntax } = item;
        return syntax.type === 'substitution'
            ? [
                    syntax.markers.open.range,
                    syntax.markers.separator.range,
                    syntax.markers.close.range,
                ]
            : [syntax.markers.open.range, syntax.markers.close.range];
    }).map(range => ({ start: range.start, end: range.end })).sort((left, right) => left.start - right.start || right.end - left.end);
}

function criticParserInvisibleRanges(
    document: CriticMarkupDocument,
    markerRanges: readonly Tokens.CriticMarkupRange[],
): readonly Tokens.CriticMarkupRange[] {
    return coalescedRanges([
        ...markerRanges,
        ...document.items
            .filter(item => item.syntax.type === 'comment')
            .map(item => item.syntax.range),
    ]);
}

function coalescedRanges(
    sourceRanges: readonly Tokens.CriticMarkupRange[],
): readonly Tokens.CriticMarkupRange[] {
    return [...sourceRanges]
        .sort((left, right) => left.start - right.start)
        .reduce<Tokens.CriticMarkupRange[]>((ranges, range) => {
            const previous = ranges.at(-1);
            if (previous && range.start <= previous.end) {
                ranges[ranges.length - 1] = {
                    start: previous.start,
                    end: Math.max(previous.end, range.end),
                };
            }
            else {
                ranges.push({ start: range.start, end: range.end });
            }
            return ranges;
        }, []);
}

function sourceWithoutRanges(
    source: string,
    ranges: readonly Tokens.CriticMarkupRange[],
    start: number,
    end: number,
): string {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (ranges[middle].end <= start)
            low = middle + 1;
        else
            high = middle;
    }
    let result = '';
    let cursor = start;
    for (let index = low; index < ranges.length; index++) {
        const invisible = ranges[index];
        if (end <= invisible.start)
            break;
        result += source.slice(
            cursor,
            Math.max(cursor, Math.min(invisible.start, end)),
        );
        cursor = Math.max(cursor, Math.min(invisible.end, end));
    }
    return result + source.slice(cursor, end);
}

interface IProjectedLineTail {
    readonly source: string;
    readonly structural: boolean;
}

interface IProjectedLineContext {
    readonly isLineStartAt: (sourceOffset: number) => boolean;
    readonly isLineEndAt: (sourceOffset: number) => boolean;
    readonly precedingLinesAt: (
        sourceOffset: number,
        maximumLines: number,
    ) => string;
    readonly followingLineAt: (
        sourceOffset: number,
    ) => IProjectedLineTail;
}

/**
 * Index physical source offsets into the Markdown projection produced by
 * deleting parser-invisible ranges. Line queries must operate in that
 * projection: a hidden multiline comment contributes neither its newlines
 * nor a block boundary. Building the projection once also lets every item at
 * one collapsed boundary share the same following-line slice and structural
 * probe.
 */
function projectedLineContext(
    source: string,
    invisibleRanges: readonly Tokens.CriticMarkupRange[],
    isStructuralBlock: (source: string) => boolean,
): IProjectedLineContext {
    const removedThrough: number[] = [];
    let removed = 0;
    for (const range of invisibleRanges) {
        removed += range.end - range.start;
        removedThrough.push(removed);
    }
    const projected = sourceWithoutRanges(
        source,
        invisibleRanges,
        0,
        source.length,
    );
    const lines = sourceLineIndex(projected);
    const precedingCache = new Map<string, string>();
    const followingCache = new Map<number, IProjectedLineTail>();
    const projectedOffsetAt = (sourceOffset: number): number => {
        const rangeIndex = upperBound(
            invisibleRanges,
            sourceOffset,
            range => range.start,
        ) - 1;
        if (rangeIndex < 0)
            return sourceOffset;
        const range = invisibleRanges[rangeIndex];
        const removedBefore = rangeIndex > 0
            ? removedThrough[rangeIndex - 1]
            : 0;
        return sourceOffset <= range.end
            ? range.start - removedBefore
            : sourceOffset - removedThrough[rangeIndex];
    };

    return Object.freeze({
        isLineStartAt: (sourceOffset: number) => {
            const offset = projectedOffsetAt(sourceOffset);
            return offset === 0 || projected[offset - 1] === '\n';
        },
        isLineEndAt: (sourceOffset: number) => {
            const offset = projectedOffsetAt(sourceOffset);
            return offset === projected.length
                || projected[offset] === '\n'
                || (
                    projected[offset] === '\r'
                    && projected[offset + 1] === '\n'
                );
        },
        precedingLinesAt: (sourceOffset: number, maximumLines: number) => {
            const offset = projectedOffsetAt(sourceOffset);
            const key = `${offset}:${maximumLines}`;
            const cached = precedingCache.get(key);
            if (cached !== undefined)
                return cached;
            let contextStart = offset;
            for (let step = 0; step < maximumLines; step++) {
                if (contextStart === 0)
                    break;
                const previousLineStart = lines.lineStartAt(contextStart - 1);
                if (!/\S/.test(projected.slice(
                    previousLineStart,
                    contextStart,
                ))) {
                    break;
                }
                contextStart = previousLineStart;
            }
            const context = projected.slice(contextStart, offset);
            precedingCache.set(key, context);
            return context;
        },
        followingLineAt: (sourceOffset: number) => {
            const offset = projectedOffsetAt(sourceOffset);
            const cached = followingCache.get(offset);
            if (cached)
                return cached;
            const lineEnd = lines.lineEndAt(offset);
            const lineSource = projected.slice(offset, lineEnd);
            const result = Object.freeze({
                source: lineSource,
                structural: isStructuralBlock(lineSource),
            });
            followingCache.set(offset, result);
            return result;
        },
    });
}

export function marker(
    name: Tokens.CriticMarkupMarker['name'],
    value: TCriticMarkupDocumentToken['markers']['open'],
): Tokens.CriticMarkupMarker {
    return Object.freeze({
        name,
        raw: value.raw,
        range: Object.freeze({
            start: value.range.start,
            end: value.range.end,
        }),
    });
}

export function fragmentPlans(
    document: CriticMarkupDocument,
    isStructuralBlock: (source: string) => boolean,
    armAbsorbsFollowing: (arm: string, following: string) => boolean,
): readonly ICriticMarkupFragmentPlan[] {
    const plans: ICriticMarkupFragmentPlan[] = [];
    const allMarkerRanges = criticMarkerRanges(document)
        .slice()
        .sort((left, right) => left.start - right.start);
    // A structural arm's lazy-continuation probe must see semantic Markdown,
    // not Critic delimiters or a following comment body: neither can continue
    // the arm's final native block. Coalesce those grammar-invisible ranges so
    // each same-line query starts with one binary search.
    const parserInvisibleRanges = criticParserInvisibleRanges(
        document,
        allMarkerRanges,
    );
    const markerOnlyInvisibleRanges = coalescedRanges(allMarkerRanges);
    // A comment body is active Markdown only while planning that comment or
    // one of its descendants. Outside that subtree, Original/Revised hide the
    // complete sibling comment and it cannot prevent a real line boundary.
    const commentProjectionItemIds = new Set<string>();
    for (const item of document.items) {
        if (
            item.syntax.type === 'comment'
            || (
                item.parentId !== null
                && commentProjectionItemIds.has(item.parentId)
            )
        ) {
            commentProjectionItemIds.add(item.id);
        }
    }
    const lineIndex = sourceLineIndex(document.markdown);
    const ordinaryLineContext = projectedLineContext(
        document.markdown,
        parserInvisibleRanges,
        isStructuralBlock,
    );
    const commentLineContext = projectedLineContext(
        document.markdown,
        markerOnlyInvisibleRanges,
        isStructuralBlock,
    );
    const lineContextFor = (commentsVisible: boolean) => commentsVisible
        ? commentLineContext
        : ordinaryLineContext;
    const effectiveLineStart = (
        offset: number,
        commentsVisible: boolean,
    ): boolean => lineContextFor(commentsVisible).isLineStartAt(offset);
    const effectiveLineEnd = (
        offset: number,
        commentsVisible: boolean,
    ): boolean => lineContextFor(commentsVisible).isLineEndAt(offset);
    const nestedCoverageContext = (
        range: Tokens.CriticMarkupRange,
        envelopeEndsLine: boolean,
    ): {
        readonly level: 'block' | 'inline';
        readonly structuralSources: readonly string[];
    } => {
        const mappedRange = sourceRange(range.start, range.end);
        const ownsStructuralBoundary = (source: string): boolean =>
            isStructuralBlock(source)
            && (envelopeEndsLine || /\r?\n$/.test(source));
        const projections = [
            document.projectSourceRange(
                mappedRange,
                'original',
            ),
            document.projectSourceRange(
                mappedRange,
                'revised',
            ),
            document.projectCommentSourceRange(
                mappedRange,
                'original',
            ),
            document.projectCommentSourceRange(
                mappedRange,
                'revised',
            ),
        ];
        const structuralSources = projections.filter(ownsStructuralBoundary);
        if (structuralSources.length) {
            return {
                level: 'block',
                structuralSources,
            };
        }

        // A structural-looking descendant does not establish block context
        // by itself. One complete clean or hidden-comment view of this exact
        // range must own the structural boundary.
        return {
            level: 'inline',
            structuralSources,
        };
    };
    // A single-line nest deeper than the parse budget must not lower its
    // covered arms as block fragments: block lowering would recurse the
    // Markdown block lexer into its nesting budget and swallow the line as
    // parser residue. Forcing the planned levels inline keeps the line one
    // paragraph whose literal text carries the excess, so the render-depth
    // machinery caps presentation with its own diagnostic. Items are in
    // depth-first order, so each root precedes its whole subtree.
    const overBudgetSingleLineNests = new Set<string>();
    {
        let rootId: string | null = null;
        let rootSingleLine = false;
        for (const item of document.items) {
            if (item.parentId === null) {
                rootId = item.id;
                rootSingleLine = lineIndex.lineEndAt(item.syntax.range.start)
                    >= item.syntax.range.end;
            }
            if (
                rootId !== null
                && rootSingleLine
                && exceedsCriticMarkupParseDepthBudget(item.depth)
            ) {
                overBudgetSingleLineNests.add(rootId);
            }
        }
    }
    let inlineNestRootId: string | null = null;
    for (const item of document.items) {
        if (item.parentId === null) {
            inlineNestRootId = overBudgetSingleLineNests.has(item.id)
                ? item.id
                : null;
        }
        // Beyond the parse depth budget an item receives no parser
        // fragments: its exact bytes stay literal content inside the
        // deepest planned fragment, while the canonical document keeps the
        // item at full depth.
        if (exceedsCriticMarkupParseDepthBudget(item.depth))
            continue;
        const forceInlineNest = inlineNestRootId !== null;
        const token = item.syntax;
        const commentsVisible = item.parentId !== null
            && commentProjectionItemIds.has(item.parentId);
        const projectedLines = lineContextFor(commentsVisible);
        const open = marker('open', token.markers.open);
        const close = marker('close', token.markers.close);
        const itemPlans: ICriticMarkupFragmentPlan[] = [];
        let forceLiteralLines = false;
        const appendArm = (
            arm: ICriticMarkupFragmentPlan['arm'],
            contentRange: Tokens.CriticMarkupRange,
            envelopeStart: number,
            envelopeEnd: number,
            before: readonly Tokens.CriticMarkupMarker[],
            after: readonly Tokens.CriticMarkupMarker[],
            effectiveLineStart: boolean,
            nestedCoversContent: boolean,
            closingMarkerMayRejoinText: boolean,
        ) => {
            const segments: Array<{
                level: 'block' | 'inline';
                start: number;
                end: number;
            }> = [];
            const armSource = document.markdown.slice(
                contentRange.start,
                contentRange.end,
            );
            // An item opening at line start whose first content line would
            // lazily continue the preceding block (a paragraph line after a
            // list item or paragraph) cannot hold as block coverage — the
            // parser merges the line into that block. Lower the whole item
            // as per-line literal pieces instead.
            if (
                effectiveLineStart
                && contentRange.start < contentRange.end
                && !forceLiteralLines
                // Later arms live in their own isolated parser context —
                // only the item's first line can see preceding source.
                && lineIndex.lineStartAt(envelopeStart)
                === lineIndex.lineStartAt(token.range.start)
            ) {
                const precedingContext = projectedLines.precedingLinesAt(
                    envelopeStart,
                    8,
                );
                if (precedingContext.length) {
                    const strippedArm = armSource.replace(
                        /^(?:[ \t]*\r?\n)*/,
                        '',
                    );
                    const lineEnd = strippedArm.indexOf('\n');
                    const firstContentLine = lineEnd < 0
                        ? strippedArm
                        : strippedArm.slice(0, lineEnd);
                    if (
                        /\S/.test(precedingContext)
                        && /\S/.test(firstContentLine)
                        && armAbsorbsFollowing(
                            precedingContext,
                            firstContentLine,
                        )
                    ) {
                        forceLiteralLines = true;
                    }
                }
            }
            if (!/\S/.test(armSource) && armSource.includes('\n')) {
                // A whitespace arm containing a line break that both starts
                // and ends at a line boundary is a pure block separator: it
                // lowers as one block plan whose markers split onto the
                // surrounding native tokens. Opened mid-line or closing
                // into trailing text, the payload has no block seam to
                // ride — it stays an inline fragment preserving its bytes.
                segments.push({
                    level: effectiveLineStart && effectiveLineEnd(
                        contentRange.end,
                        commentsVisible,
                    )
                        ? 'block'
                        : 'inline',
                    start: contentRange.start,
                    end: contentRange.end,
                });
                segments.forEach((segment, index) => {
                    itemPlans.push({
                        item,
                        arm,
                        role: 'middle',
                        range: {
                            start: index === 0 ? envelopeStart : segment.start,
                            end: index === segments.length - 1
                                ? envelopeEnd
                                : segment.end,
                        },
                        contentRange: {
                            start: segment.start,
                            end: segment.end,
                        },
                        before: index === 0 ? before : [],
                        after: index === segments.length - 1 ? after : [],
                        level: segment.level,
                    });
                });
                return;
            }
            let cursor = contentRange.start;
            const envelopeEndsLine = effectiveLineEnd(
                contentRange.end,
                commentsVisible,
            );
            const followingLine = () => projectedLines.followingLineAt(
                envelopeEnd,
            );
            const rejoinsInlineContext = contentRange.start < contentRange.end
                ? !isStructuralBlock(document.markdown.slice(
                        contentRange.start,
                        contentRange.end,
                    ))
                : effectiveLineStart
                    && followingLine().source.length > 0
                    && !followingLine().structural;
            if (
                effectiveLineStart
                && !envelopeEndsLine
                && !nestedCoversContent
                && closingMarkerMayRejoinText
                && !rejoinsInlineContext
                && contentRange.start < contentRange.end
                && armAbsorbsFollowing(armSource, followingLine().source)
            ) {
                // A structural arm whose final block lazily absorbs the
                // closing line's trailing text cannot hold as coverage —
                // the parser merges them into one block. Lower the whole
                // item as per-line literal pieces instead.
                forceLiteralLines = true;
            }
            if (
                effectiveLineStart
                && !envelopeEndsLine
                && !nestedCoversContent
                && closingMarkerMayRejoinText
                && rejoinsInlineContext
                // A blank line is a real block boundary: such payloads must
                // split per line so nested items can anchor inside one line.
                && !/\n[ \t]*\n/.test(armSource)
            ) {
                // A marker that rejoins ordinary text on its closing line is
                // still part of that paragraph's inline/lazy-continuation
                // context, even when its payload owns a physical line.
                segments.push({
                    level: 'inline',
                    start: contentRange.start,
                    end: contentRange.end,
                });
                cursor = contentRange.end;
            }
            else if (
                effectiveLineStart
                && envelopeEndsLine
                && !nestedCoversContent
                && token.type !== 'comment'
                && contentRange.start < contentRange.end
                && !/^[ \t]*\r?\n/.test(armSource)
                // A paragraph-first payload remains mixed even when a later
                // block is structural; only a structurally anchored first
                // line can own the complete native block span.
                && projectedLines.followingLineAt(contentRange.start).structural
                && !rejoinsInlineContext
            ) {
                // Critic close markers and hidden sibling comments may sit
                // between a structural payload and its projected line ending.
                // When the payload starts on the opener's physical line, it
                // owns the complete native block span even if later blocks
                // follow before the flush close. An opener-own-line payload
                // keeps its leading boundary trivia on the segmented path.
                segments.push({
                    level: 'block',
                    start: contentRange.start,
                    end: contentRange.end,
                });
                cursor = contentRange.end;
            }
            else if (nestedCoversContent) {
                const nestedContext = nestedCoverageContext(
                    contentRange,
                    envelopeEndsLine,
                );
                const followingRewritesNestedBlock
                    = nestedContext.level === 'block'
                        && nestedContext.structuralSources.some(source =>
                            armAbsorbsFollowing(
                                source,
                                followingLine().source,
                            ));
                if (effectiveLineStart && followingRewritesNestedBlock) {
                    // The transparent block and same-line tail form one native
                    // lazy continuation. Route the complete enclosing item
                    // through the existing literal-line rewrite so descendant
                    // block plans cannot escape and split its marker envelope.
                    forceLiteralLines = true;
                }
                else {
                    segments.push({
                        level: effectiveLineStart
                            ? nestedContext.level
                            : 'inline',
                        start: contentRange.start,
                        end: contentRange.end,
                    });
                    cursor = contentRange.end;
                }
            }
            else if (!effectiveLineStart) {
                const firstNewline = document.markdown.indexOf('\n', cursor);
                if (firstNewline < 0 || firstNewline >= contentRange.end) {
                    segments.push({
                        level: 'inline',
                        start: cursor,
                        end: contentRange.end,
                    });
                    cursor = contentRange.end;
                }
                else {
                    segments.push({
                        level: 'inline',
                        start: cursor,
                        end: firstNewline,
                    });
                    cursor = firstNewline + 1;
                }
            }
            const finalNewline
                = lineIndex.lineStartAt(contentRange.end) - 1;
            const blockEnd = finalNewline >= cursor
                ? finalNewline + 1
                : cursor;
            if (cursor < blockEnd) {
                segments.push({
                    level: 'block',
                    start: cursor,
                    end: blockEnd,
                });
                cursor = blockEnd;
            }
            if (cursor < contentRange.end) {
                segments.push({
                    level: 'inline',
                    start: cursor,
                    end: contentRange.end,
                });
            }
            if (!segments.length) {
                segments.push({
                    level: effectiveLineStart ? 'block' : 'inline',
                    start: contentRange.start,
                    end: contentRange.end,
                });
            }
            segments.forEach((segment, index) => {
                itemPlans.push({
                    item,
                    arm,
                    role: 'middle',
                    range: {
                        start: index === 0 ? envelopeStart : segment.start,
                        end: index === segments.length - 1
                            ? envelopeEnd
                            : segment.end,
                    },
                    contentRange: {
                        start: segment.start,
                        end: segment.end,
                    },
                    before: index === 0 ? before : [],
                    after: index === segments.length - 1 ? after : [],
                    level: segment.level,
                });
            });
        };
        if (token.type === 'substitution') {
            const separator = marker('separator', token.markers.separator);
            const nestedCovers = (range: Tokens.CriticMarkupRange) => {
                const nested = (token.nested ?? [])
                    .filter(child =>
                        range.start <= child.range.start
                        && child.range.end <= range.end)
                    .sort((left, right) => left.range.start - right.range.start);
                let cursor = range.start;
                for (const child of nested) {
                    if (child.range.start !== cursor)
                        return false;
                    cursor = child.range.end;
                }
                return nested.length > 0 && cursor === range.end;
            };
            appendArm('old', token.oldRange, token.range.start, token.markers.separator.range.end, [open], [separator], effectiveLineStart(token.oldRange.start, commentsVisible), !forceInlineNest && nestedCovers(token.oldRange), false);
            appendArm('new', token.newRange, token.newRange.start, token.range.end, [], [close], effectiveLineStart(token.newRange.start, commentsVisible), !forceInlineNest && nestedCovers(token.newRange), true);
        }
        else {
            const nested = [...(token.nested ?? [])]
                .sort((left, right) => left.range.start - right.range.start);
            let nestedCursor = token.contentRange.start;
            for (const child of nested) {
                if (child.range.start !== nestedCursor)
                    break;
                nestedCursor = child.range.end;
            }
            appendArm(
                token.type === 'comment' ? 'comment' : 'content',
                token.contentRange,
                token.range.start,
                token.range.end,
                [open],
                [close],
                effectiveLineStart(token.contentRange.start, commentsVisible),
                !forceInlineNest
                && nested.length > 0
                && nestedCursor === token.contentRange.end,
                true,
            );
        }
        if (
            (itemPlans.some(plan => plan.level === 'inline')
                && itemPlans.some(plan => plan.level === 'block'))
            || (forceLiteralLines
                && itemPlans.some(plan => plan.level === 'block'))
        ) {
            // A mixed item anchors inside a line and spans blocks. Every
            // block segment becomes per-line literal inline pieces bound in
            // whichever leaf hosts that line.
            const rewritten: typeof itemPlans = [];
            for (const plan of itemPlans) {
                if (plan.level !== 'block') {
                    rewritten.push({ ...plan, literalLine: true });
                    continue;
                }
                const pieces: Array<{ start: number; end: number }> = [];
                let lineStart = plan.contentRange.start;
                while (lineStart < plan.contentRange.end) {
                    let lineEnd = document.markdown.indexOf('\n', lineStart);
                    if (lineEnd < 0 || lineEnd > plan.contentRange.end)
                        lineEnd = plan.contentRange.end;
                    if (lineEnd > lineStart)
                        pieces.push({ start: lineStart, end: lineEnd });
                    lineStart = lineEnd + 1;
                }
                if (!pieces.length) {
                    pieces.push({
                        start: plan.contentRange.start,
                        end: plan.contentRange.start,
                    });
                }
                pieces.forEach((piece, index) => rewritten.push({
                    ...plan,
                    level: 'inline',
                    literalLine: true,
                    range: {
                        start: index === 0 && plan.before.length
                            ? plan.range.start
                            : piece.start,
                        end: index === pieces.length - 1 && plan.after.length
                            ? plan.range.end
                            : piece.end,
                    },
                    contentRange: piece,
                    before: index === 0 ? plan.before : [],
                    after: index === pieces.length - 1 ? plan.after : [],
                }));
            }
            itemPlans.length = 0;
            for (const plan of rewritten)
                itemPlans.push(plan);
        }
        itemPlans.sort((left, right) => left.range.start - right.range.start);
        itemPlans.forEach((plan, index) => plans.push(Object.freeze({
            ...plan,
            role: itemPlans.length === 1
                ? 'only'
                : index === 0
                    ? 'start'
                    : index === itemPlans.length - 1 ? 'end' : 'middle',
            range: Object.freeze({ ...plan.range }),
            contentRange: Object.freeze({ ...plan.contentRange }),
            before: Object.freeze([...plan.before]),
            after: Object.freeze([...plan.after]),
        })));
    }
    return Object.freeze(plans.sort((left, right) =>
        left.range.start - right.range.start
        || right.range.end - left.range.end));
}
