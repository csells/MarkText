import type {
    MarkedExtension,
    MarkedSourceView,
    Token,
    Tokens,
    TokensList,
} from 'marked';
import type {
    ICriticMarkupDocumentItem,
    CriticMarkupDocument,
} from '../../../criticMarkup/document';
import type { TCriticMarkupDocumentToken } from '../../../criticMarkup/analysis';
import {
    markedViewOffset,
} from 'marked';

interface ICriticMarkupFragmentPlan {
    readonly item: ICriticMarkupDocumentItem;
    readonly level: 'block' | 'inline';
    readonly arm: Tokens.CriticMarkupFragment['arm'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    readonly range: Tokens.CriticMarkupRange;
    readonly contentRange: Tokens.CriticMarkupRange;
    readonly before: readonly Tokens.CriticMarkupMarker[];
    readonly after: readonly Tokens.CriticMarkupMarker[];
}

export interface IPreparedNativeCriticMarkupExtension {
    readonly extension: MarkedExtension;
    readonly transparentMarkerRanges: readonly Tokens.CriticMarkupRange[];
    readonly useTransparentParserView: boolean;
}

function itemMarkerRanges(
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

function criticMarkerRanges(
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
    }).map(range => ({ start: range.start, end: range.end }))
        .sort((left, right) => left.start - right.start || right.end - left.end);
}

function criticTokenType(
    type: TCriticMarkupDocumentToken['type'],
): Tokens.CriticMarkupFragment['type'] {
    switch (type) {
        case 'addition': return 'critic_addition';
        case 'deletion': return 'critic_deletion';
        case 'substitution': return 'critic_substitution';
        case 'highlight': return 'critic_highlight';
        case 'comment': return 'critic_comment';
        default: return unexpectedCriticType(type);
    }
}

function unexpectedCriticType(value: never): never {
    throw new TypeError(`Unknown CriticMarkup type: ${String(value)}.`);
}

function marker(
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

function arms(
    token: TCriticMarkupDocumentToken,
): readonly Tokens.CriticMarkupArm[] {
    if (token.type === 'substitution') {
        return Object.freeze([
            Object.freeze({
                name: 'old' as const,
                raw: token.oldContent,
                range: Object.freeze({
                    start: token.oldRange.start,
                    end: token.oldRange.end,
                }),
            }),
            Object.freeze({
                name: 'new' as const,
                raw: token.newContent,
                range: Object.freeze({
                    start: token.newRange.start,
                    end: token.newRange.end,
                }),
            }),
        ]);
    }
    return Object.freeze([Object.freeze({
        name: token.type === 'comment' ? 'comment' as const : 'content' as const,
        raw: token.content,
        range: Object.freeze({
            start: token.contentRange.start,
            end: token.contentRange.end,
        }),
    })]);
}

function semanticItem(
    item: ICriticMarkupDocumentItem,
): Tokens.CriticMarkupItem {
    const { syntax } = item;
    return Object.freeze({
        id: item.id,
        parentId: item.parentId,
        depth: item.depth,
        criticType: syntax.type,
        raw: syntax.raw,
        range: Object.freeze({
            start: syntax.range.start,
            end: syntax.range.end,
        }),
        markers: Object.freeze({
            open: marker('open', syntax.markers.open),
            ...(syntax.type === 'substitution'
                ? { separator: marker('separator', syntax.markers.separator) }
                : {}),
            close: marker('close', syntax.markers.close),
        }),
        arms: arms(syntax),
    });
}

function semanticDocument(
    document: CriticMarkupDocument,
): Tokens.CriticMarkupDocument {
    const items = document.items.map(semanticItem);
    return Object.freeze({
        roots: Object.freeze(document.childrenOf(null).map(item => item.id)),
        items: Object.freeze(items),
    });
}

function fragmentPlans(
    document: CriticMarkupDocument,
    isStructuralBlock: (source: string) => boolean,
): readonly ICriticMarkupFragmentPlan[] {
    const plans: ICriticMarkupFragmentPlan[] = [];
    const markerRanges = criticMarkerRanges(document);
    const effectiveLineStart = (offset: number): boolean => {
        const lineStart = document.markdown.lastIndexOf('\n', offset - 1) + 1;
        let cursor = lineStart;
        while (cursor < offset) {
            const covering = markerRanges.find(range =>
                range.start === cursor && range.end <= offset);
            if (!covering)
                return false;
            cursor = covering.end;
        }
        return cursor === offset;
    };
    const effectiveLineEnd = (offset: number): boolean => {
        const physicalEnd = document.markdown.indexOf('\n', offset);
        const lineEnd = physicalEnd < 0
            ? document.markdown.length
            : physicalEnd;
        let cursor = offset;
        while (cursor < lineEnd) {
            const covering = markerRanges.find(range =>
                range.start === cursor && range.end <= lineEnd);
            if (!covering)
                return false;
            cursor = covering.end;
        }
        return cursor === lineEnd;
    };
    for (const item of document.items) {
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
            const finalNewline = document.markdown.lastIndexOf(
                '\n',
                contentRange.end - 1,
            );
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
            appendArm('old', token.oldRange, token.range.start,
                token.markers.separator.range.end, [open], [separator],
                effectiveLineStart(token.range.start),
                nestedCovers(token.oldRange),
                false);
            appendArm('new', token.newRange, token.newRange.start,
                token.range.end, [], [close],
                effectiveLineStart(token.markers.separator.range.start),
                nestedCovers(token.newRange),
                true);
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
                nested.length > 0 && nestedCursor === token.contentRange.end,
                true,
            );
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

function viewOffsetForDocumentOffset(
    view: MarkedSourceView<object>,
    documentOffset: number,
): number | null {
    for (const span of view.spans) {
        if (
            span.documentStart <= documentOffset
            && documentOffset <= span.documentEnd
        ) {
            return span.viewStart + documentOffset - span.documentStart;
        }
    }
    for (const boundary of view.boundaries) {
        if (boundary.documentOffset === documentOffset)
            return boundary.viewOffset;
    }
    return null;
}

function rootTokens(value: Token[] | TokensList): value is TokensList {
    return Object.prototype.hasOwnProperty.call(value, 'links');
}

function plansBySourceStart(
    plans: readonly ICriticMarkupFragmentPlan[],
    source: string,
    markerRanges: readonly Tokens.CriticMarkupRange[],
): ReadonlyMap<number, readonly ICriticMarkupFragmentPlan[]> {
    const result = new Map<number, readonly ICriticMarkupFragmentPlan[]>();
    for (const plan of plans) {
        const starts = new Set([
            plan.range.start,
            plan.contentRange.start,
        ]);
        let transformedStart = plan.contentRange.start;
        while (
            transformedStart < plan.contentRange.end
            && (source[transformedStart] === ' '
                || source[transformedStart] === '\t')
        ) {
            transformedStart++;
            starts.add(transformedStart);
        }
        let transparentStart = plan.contentRange.start;
        while (transparentStart < plan.contentRange.end) {
            const marker = markerRanges.find(range =>
                range.start === transparentStart
                && range.end <= plan.contentRange.end);
            if (!marker)
                break;
            transparentStart = marker.end;
            starts.add(transparentStart);
        }
        for (const start of starts) {
            const matches = result.get(start);
            result.set(
                start,
                Object.freeze(matches ? [...matches, plan] : [plan]),
            );
        }
    }
    return result;
}

function plansAtSourceStart(
    plansByStart: ReadonlyMap<number, readonly ICriticMarkupFragmentPlan[]>,
    plans: readonly ICriticMarkupFragmentPlan[],
    transparentItemIds: ReadonlySet<string>,
    sourceStart: number,
): readonly ICriticMarkupFragmentPlan[] | undefined {
    const exact = plansByStart.get(sourceStart);
    if (exact)
        return exact;
    const transformed = plans.filter(plan =>
        transparentItemIds.has(plan.item.id)
        && plan.contentRange.start < sourceStart
        && sourceStart < plan.contentRange.end);
    return transformed.length
        ? Object.freeze(transformed.sort((left, right) =>
                left.range.start - right.range.start
                || right.range.end - left.range.end))
        : undefined;
}

function tokenizeFragment(
    plan: ICriticMarkupFragmentPlan,
    view: MarkedSourceView<object>,
    level: 'block' | 'inline',
    transparentParserView: boolean,
    markerRanges: readonly Tokens.CriticMarkupRange[],
    tokenizeChildren: (
        source: MarkedSourceView<object>,
        tokens: Token[],
    ) => void,
): Tokens.Generic | undefined {
    const viewDocumentStart = view.documentOffsetAt(
        markedViewOffset(0),
        'next',
    );
    let transparentEnd = plan.contentRange.end;
    while (transparentParserView && transparentEnd > plan.contentRange.start) {
        const marker = markerRanges.find(range =>
            range.end === transparentEnd
            && plan.contentRange.start <= range.start);
        if (!marker)
            break;
        transparentEnd = marker.start;
    }
    const fragmentEnd = viewOffsetForDocumentOffset(
        view,
        transparentParserView ? plan.contentRange.end : plan.range.end,
    ) ?? (transparentParserView
        ? viewOffsetForDocumentOffset(view, transparentEnd)
        : null);
    const mappedContentStart = viewOffsetForDocumentOffset(
        view,
        plan.contentRange.start,
    );
    const contentStart = mappedContentStart ?? (
        transparentParserView
        && plan.contentRange.start <= viewDocumentStart
        && viewDocumentStart <= plan.contentRange.end
            ? 0
            : null
    );
    const mappedContentEnd = viewOffsetForDocumentOffset(
        view,
        plan.contentRange.end,
    );
    const contentEnd = mappedContentEnd
        ?? (transparentParserView ? fragmentEnd : null);
    if (
        fragmentEnd === null
        || contentStart === null
        || contentEnd === null
        || fragmentEnd <= 0
        || contentStart < 0
        || contentEnd < contentStart
        || fragmentEnd > view.text.length
    ) {
        return undefined;
    }
    const fragmentView = view.slice(
        markedViewOffset(0),
        markedViewOffset(fragmentEnd),
    );
    const contentView = view.slice(
        markedViewOffset(contentStart),
        markedViewOffset(contentEnd),
    );
    const childTokens: Token[] = [];
    tokenizeChildren(contentView, childTokens);
    let semanticStart = plan.contentRange.start;
    while (semanticStart < plan.contentRange.end) {
        if (/\s/.test(view.document.text[semanticStart])) {
            semanticStart++;
            continue;
        }
        const transparentMarker = markerRanges.find(range =>
            range.start === semanticStart
            && range.end <= plan.contentRange.end);
        if (transparentMarker) {
            semanticStart = transparentMarker.end;
            continue;
        }
        break;
    }
    const token: Tokens.CriticMarkupFragment = {
        type: criticTokenType(plan.item.syntax.type),
        level,
        markersTransparent: transparentParserView,
        fragmentKind: contentView.text.length ? 'content' : 'boundary',
        itemId: plan.item.id,
        arm: plan.arm,
        role: plan.role,
        raw: fragmentView.text,
        fragmentRaw: fragmentView.text,
        suppressBlockSeparatorAfter: level === 'block'
            && (
                plan.role === 'start'
                || plan.role === 'middle'
                || (
                    plan.after.some(value => value.name === 'close')
                    && plan.range.end < view.document.text.length
                    && view.document.text[plan.range.end] !== '\n'
                    && view.document.text[plan.range.end] !== '\r'
                )
            ),
        range: plan.range,
        contentRange: plan.contentRange,
        contentRaw: contentView.text,
        tokens: childTokens,
        before: viewDocumentStart <= semanticStart ? plan.before : [],
        after: plan.after,
    };
    return token as Tokens.Generic;
}

function nextPlanOffset(
    view: MarkedSourceView<object>,
    plansByStart: ReadonlyMap<
        number,
        readonly ICriticMarkupFragmentPlan[]
    >,
    activePlans: ReadonlySet<ICriticMarkupFragmentPlan>,
): number | undefined {
    let result = Infinity;
    for (const [sourceStart, plans] of plansByStart) {
        if (!plans.some(plan => !activePlans.has(plan)))
            continue;
        const offset = viewOffsetForDocumentOffset(view, sourceStart);
        if (offset !== null && offset > 0 && offset < result)
            result = offset;
    }
    return result < Infinity ? result : undefined;
}

interface ICriticMarkupBoundaryAttachmentPlan {
    readonly plan: ICriticMarkupFragmentPlan;
    readonly anchor: number;
    readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
}

function boundaryAttachment(
    plan: ICriticMarkupFragmentPlan,
    edge: 'before' | 'after',
    markers: readonly Tokens.CriticMarkupMarker[],
    source: string,
    triviaStart: number,
    triviaEnd: number,
    followingTriviaStart: number,
    followingTriviaEnd: number,
): Tokens.CriticMarkupBoundaryAttachment {
    const triviaRaw = source.slice(triviaStart, triviaEnd);
    const followingTriviaRaw = source.slice(
        followingTriviaStart,
        followingTriviaEnd,
    );
    if (!/^\s*$/.test(triviaRaw) || !/^\s*$/.test(followingTriviaRaw)) {
        throw new TypeError(
            'Native CriticMarkup boundary trivia contains semantic source.',
        );
    }
    return Object.freeze({
        itemId: plan.item.id,
        criticType: plan.item.syntax.type,
        arm: plan.arm,
        role: plan.role,
        edge,
        range: Object.freeze({ ...plan.range }),
        markers: Object.freeze([...markers]),
        trivia: Object.freeze({
            raw: triviaRaw,
            range: Object.freeze({
                start: triviaStart,
                end: triviaEnd,
            }),
        }),
        followingTrivia: Object.freeze({
            raw: followingTriviaRaw,
            range: Object.freeze({
                start: followingTriviaStart,
                end: followingTriviaEnd,
            }),
        }),
    });
}

function boundaryAttachmentPlans(
    source: string,
    plans: readonly ICriticMarkupFragmentPlan[],
): readonly ICriticMarkupBoundaryAttachmentPlan[] {
    const ordered = [...plans].sort((left, right) =>
        left.range.start - right.range.start);
    const emptyRangeAt = new Map(ordered
        .filter(plan => plan.contentRange.start === plan.contentRange.end)
        .map(plan => [plan.range.start, plan.range]));
    return Object.freeze(ordered.flatMap((plan) => {
        if (plan.contentRange.start === plan.contentRange.end) {
            let anchor = plan.range.end;
            while (anchor < source.length) {
                const adjacentBoundary = emptyRangeAt.get(anchor);
                if (adjacentBoundary) {
                    anchor = adjacentBoundary.end;
                    continue;
                }
                if (/\s/.test(source[anchor])) {
                    anchor++;
                    continue;
                }
                break;
            }
            const edge = anchor < source.length
                ? 'before' as const
                : 'after' as const;
            let triviaStart: number;
            let triviaEnd: number;
            let followingTriviaEnd = plan.range.end;
            while (
                followingTriviaEnd < source.length
                && /\s/.test(source[followingTriviaEnd])
            ) {
                followingTriviaEnd++;
            }
            if (edge === 'after') {
                anchor = plan.range.start;
                while (anchor > 0 && /\s/.test(source[anchor - 1]))
                    anchor--;
                triviaStart = anchor;
                triviaEnd = plan.range.start;
            }
            else {
                triviaStart = anchor;
                while (
                    triviaStart > plan.range.end
                    && /\s/.test(source[triviaStart - 1])
                ) {
                    triviaStart--;
                }
                if (triviaStart !== plan.range.end)
                    triviaStart = anchor;
                triviaEnd = anchor;
            }
            return [Object.freeze({
                plan,
                anchor,
                attachment: boundaryAttachment(
                    plan,
                    edge,
                    [...plan.before, ...plan.after],
                    source,
                    triviaStart,
                    triviaEnd,
                    plan.range.end,
                    followingTriviaEnd,
                ),
            })];
        }

        const result: ICriticMarkupBoundaryAttachmentPlan[] = [];
        if (plan.before.length) {
            let anchor = plan.contentRange.start;
            while (anchor < plan.contentRange.end && /\s/.test(source[anchor]))
                anchor++;
            result.push(Object.freeze({
                plan,
                anchor,
                attachment: boundaryAttachment(
                    plan,
                    'before',
                    plan.before,
                    source,
                    plan.contentRange.start,
                    anchor,
                    plan.range.end,
                    plan.range.end,
                ),
            }));
        }
        if (plan.after.length) {
            let anchor = plan.contentRange.end;
            while (anchor > plan.contentRange.start && /\s/.test(source[anchor - 1]))
                anchor--;
            result.push(Object.freeze({
                plan,
                anchor,
                attachment: boundaryAttachment(
                    plan,
                    'after',
                    plan.after,
                    source,
                    anchor,
                    plan.contentRange.end,
                    plan.range.end,
                    plan.range.end,
                ),
            }));
        }
        return result;
    }));
}

/**
 * Parser-level CriticMarkup fragments. Recognition comes from the canonical
 * balanced grammar; this adapter only maps authenticated source ranges into
 * the active recursive Marked source view.
 */
export function prepareNativeCriticMarkupExtension(
    document: CriticMarkupDocument,
    isStructuralBlock: (source: string) => boolean,
): IPreparedNativeCriticMarkupExtension {
    const criticDocument = semanticDocument(document);
    const allPlans = fragmentPlans(document, isStructuralBlock);
    const blockBoundaryPlans = allPlans.filter(plan =>
        plan.level === 'block'
        && plan.contentRange.start === plan.contentRange.end);
    const blockPlans = allPlans.filter(plan =>
        plan.level === 'block'
        && plan.contentRange.start < plan.contentRange.end);
    const inlinePlans = allPlans.filter(plan => plan.level === 'inline');
    const transparentItemIds = new Set(
        [...blockPlans, ...blockBoundaryPlans].map(plan => plan.item.id),
    );
    const transparentMarkerRanges = Object.freeze(document.items
        .filter(item => transparentItemIds.has(item.id))
        .flatMap(itemMarkerRanges)
        .sort((left, right) => left.start - right.start));
    const boundaryPlans = boundaryAttachmentPlans(
        document.markdown,
        [...blockPlans, ...blockBoundaryPlans],
    );
    const blockPlansByStart = plansBySourceStart(
        blockPlans,
        document.markdown,
        criticMarkerRanges(document),
    );
    const inlinePlansByStart = plansBySourceStart(
        inlinePlans,
        document.markdown,
        criticMarkerRanges(document),
    );
    const useTransparentParserView = transparentMarkerRanges.length > 0;
    const activePlansByLexer = new WeakMap<
        object,
        Set<ICriticMarkupFragmentPlan>
    >();
    const activePlansFor = (lexer: object) => {
        let active = activePlansByLexer.get(lexer);
        if (!active) {
            active = new Set<ICriticMarkupFragmentPlan>();
            activePlansByLexer.set(lexer, active);
        }
        return active;
    };
    const claimedBoundaryAttachments = new WeakMap<
        object,
        Set<Tokens.CriticMarkupBoundaryAttachment>
    >();
    const claimsFor = (lexer: object) => {
        let claimed = claimedBoundaryAttachments.get(lexer);
        if (!claimed) {
            claimed = new Set<Tokens.CriticMarkupBoundaryAttachment>();
            claimedBoundaryAttachments.set(lexer, claimed);
        }
        return claimed;
    };
    const claimAttachments = (
        lexer: { tokens: TokensList },
        matches: readonly ICriticMarkupBoundaryAttachmentPlan[],
    ) => {
        if (!matches.length)
            return;
        const claimed = claimsFor(lexer);
        const attachments = new Set(matches.map(match => match.attachment));
        for (const attachment of attachments)
            claimed.add(attachment);
        lexer.tokens.criticMarkupUnanchored = Object.freeze(
            lexer.tokens.criticMarkupUnanchored.filter(
                attachment => !attachments.has(attachment),
            ),
        );
    };
    const claimFragmentPlan = (
        lexer: { tokens: TokensList },
        plan: ICriticMarkupFragmentPlan,
    ) => claimAttachments(
        lexer,
        boundaryPlans.filter(candidate => candidate.plan === plan),
    );

    const extension: MarkedExtension = {
        extensions: [
            {
                name: 'critic_native_document',
                initializeTokens(tokens) {
                    tokens.criticMarkup = criticDocument;
                    tokens.criticMarkupUnanchored = Object.freeze(
                        boundaryPlans.map(plan => plan.attachment),
                    );
                },
            },
            {
                name: 'critic_native_block',
                level: 'block',
                start() {
                    const view = this.lexer.currentSourceView;
                    if (!view)
                        return undefined;
                    const activePlans = activePlansFor(this.lexer);
                    const offset = nextPlanOffset(
                        view,
                        blockPlansByStart,
                        activePlans,
                    );
                    return offset === undefined ? undefined : offset - 1;
                },
                tokenizer(src, tokens) {
                    if (rootTokens(tokens) && tokens.criticMarkup === null)
                        tokens.criticMarkup = criticDocument;
                    const view = this.lexer.sourceViewFor(src);
                    if (!view) {
                        throw new TypeError(
                            'Native CriticMarkup requires mapped parser source.',
                        );
                    }
                    const activePlans = activePlansFor(this.lexer);
                    const sourceStart = view.documentOffsetAt(
                        markedViewOffset(0),
                        'next',
                    );
                    const candidates = plansAtSourceStart(
                        blockPlansByStart,
                        blockPlans,
                        transparentItemIds,
                        sourceStart,
                    );
                    if (!candidates)
                        return undefined;
                    for (const plan of candidates) {
                        if (activePlans.has(plan))
                            continue;
                        activePlans.add(plan);
                        let token: Tokens.Generic | undefined;
                        try {
                            token = tokenizeFragment(
                                plan,
                                view,
                                'block',
                                transparentItemIds.has(plan.item.id),
                                criticMarkerRanges(document),
                                (source, children) => {
                                    this.lexer.blockTokens(source, children);
                                },
                            );
                        }
                        finally {
                            activePlans.delete(plan);
                        }
                        if (token) {
                            claimFragmentPlan(this.lexer, plan);
                            return token;
                        }
                    }
                    return undefined;
                },
            },
            {
                name: 'critic_native_inline',
                level: 'inline',
                start() {
                    const view = this.lexer.currentSourceView;
                    if (!view)
                        return undefined;
                    const activePlans = activePlansFor(this.lexer);
                    const offset = nextPlanOffset(
                        view,
                        inlinePlansByStart,
                        activePlans,
                    );
                    return offset === undefined ? undefined : offset - 1;
                },
                tokenizer(src) {
                    const view = this.lexer.sourceViewFor(src);
                    if (!view) {
                        throw new TypeError(
                            'Native CriticMarkup requires mapped parser source.',
                        );
                    }
                    const activePlans = activePlansFor(this.lexer);
                    const sourceStart = view.documentOffsetAt(
                        markedViewOffset(0),
                        'next',
                    );
                    const candidates = plansAtSourceStart(
                        inlinePlansByStart,
                        inlinePlans,
                        transparentItemIds,
                        sourceStart,
                    );
                    if (!candidates)
                        return undefined;
                    for (const plan of candidates) {
                        if (activePlans.has(plan))
                            continue;
                        activePlans.add(plan);
                        let token: Tokens.Generic | undefined;
                        try {
                            token = tokenizeFragment(
                                plan,
                                view,
                                'inline',
                                transparentItemIds.has(plan.item.id),
                                criticMarkerRanges(document),
                                (source, children) => {
                                    this.lexer.inlineTokens(source, children);
                                },
                            );
                        }
                        finally {
                            activePlans.delete(plan);
                        }
                        if (token)
                            return token;
                    }
                    return undefined;
                },
            },
            {
                name: 'critic_native_boundary',
                sourceBoundary(token, source, level) {
                    if (level !== 'block' || token.type === 'space')
                        return undefined;
                    const activePlans = activePlansFor(this.lexer);
                    const claimed = claimsFor(this.lexer);
                    const sourceStart = source.documentOffsetAt(
                        markedViewOffset(0),
                        'next',
                    );
                    const sourceEnd = source.documentOffsetAt(
                        markedViewOffset(source.text.length),
                        'previous',
                    );
                    const matches = boundaryPlans.filter((candidate) => {
                        if (
                            claimed.has(candidate.attachment)
                            || activePlans.has(candidate.plan)
                        )
                            return false;
                        return candidate.attachment.edge === 'before'
                            ? candidate.anchor === sourceStart
                            : candidate.anchor === sourceEnd;
                    });
                    claimAttachments(this.lexer, matches);
                    return matches.length
                        ? Object.freeze(matches.map(match => match.attachment))
                        : undefined;
                },
            },
        ],
    };
    return Object.freeze({
        extension,
        transparentMarkerRanges,
        useTransparentParserView,
    });
}
