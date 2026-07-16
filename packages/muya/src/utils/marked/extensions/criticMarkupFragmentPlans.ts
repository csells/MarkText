import type { Tokens } from 'marked';
import type { TCriticMarkupDocumentToken } from '../../../criticMarkup/analysis';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
} from '../../../criticMarkup/document';
import {
    exceedsCriticMarkupParseDepthBudget,
} from '../../../criticMarkup/renderPolicy';
import {
    criticMarkupMarkerIndex,
    sourceLineIndex,
} from './criticMarkupPlanIndex';

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
): readonly ICriticMarkupFragmentPlan[] {
    const plans: ICriticMarkupFragmentPlan[] = [];
    const markerIndex = criticMarkupMarkerIndex(criticMarkerRanges(document));
    const lineIndex = sourceLineIndex(document.markdown);
    const effectiveLineStart = (offset: number): boolean => {
        let cursor = lineIndex.lineStartAt(offset);
        while (cursor < offset) {
            const covering = markerIndex.startingAt(cursor);
            if (!covering || covering.end > offset)
                return false;
            cursor = covering.end;
        }
        return cursor === offset;
    };
    const effectiveLineEnd = (offset: number): boolean => {
        const lineEnd = lineIndex.lineEndAt(offset);
        let cursor = offset;
        while (cursor < lineEnd) {
            const covering = markerIndex.startingAt(cursor);
            if (!covering || covering.end > lineEnd)
                return false;
            cursor = covering.end;
        }
        return cursor === lineEnd;
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
        const open = marker('open', token.markers.open);
        const close = marker('close', token.markers.close);
        const itemPlans: ICriticMarkupFragmentPlan[] = [];
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
            if (!/\S/.test(armSource) && armSource.includes('\n')) {
                // A whitespace arm containing a line break is a pure block
                // separator: it lowers as one block plan whose markers split
                // onto the surrounding native tokens.
                segments.push({
                    level: 'block',
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
            const envelopeEndsLine = effectiveLineEnd(envelopeEnd);
            const physicalLineEnd = document.markdown.indexOf(
                '\n',
                envelopeEnd,
            );
            const followingLineSource = document.markdown.slice(
                envelopeEnd,
                physicalLineEnd < 0
                    ? document.markdown.length
                    : physicalLineEnd,
            );
            const rejoinsInlineContext = contentRange.start < contentRange.end
                ? !isStructuralBlock(document.markdown.slice(
                        contentRange.start,
                        contentRange.end,
                    ))
                : followingLineSource.length > 0
                    && !isStructuralBlock(followingLineSource);
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
            else if (nestedCoversContent) {
                segments.push({
                    level: 'block',
                    start: contentRange.start,
                    end: contentRange.end,
                });
                cursor = contentRange.end;
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
            appendArm('old', token.oldRange, token.range.start, token.markers.separator.range.end, [open], [separator], effectiveLineStart(token.range.start), !forceInlineNest && nestedCovers(token.oldRange), false);
            appendArm('new', token.newRange, token.newRange.start, token.range.end, [], [close], effectiveLineStart(token.markers.separator.range.start), !forceInlineNest && nestedCovers(token.newRange), true);
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
                effectiveLineStart(token.range.start),
                !forceInlineNest
                && nested.length > 0
                && nestedCursor === token.contentRange.end,
                true,
            );
        }
        if (
            itemPlans.some(plan => plan.level === 'inline')
            && itemPlans.some(plan => plan.level === 'block')
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
