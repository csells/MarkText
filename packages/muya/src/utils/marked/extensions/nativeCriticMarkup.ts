import type {
    MarkedExtension,
    MarkedSourceView,
    Token,
    Tokens,
    TokensList,
} from 'marked';
import type { TCriticMarkupDocumentToken } from '../../../criticMarkup/analysis';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
} from '../../../criticMarkup/document';
import type { IBoundaryAttachmentHolder, ICriticMarkupBoundaryAttachmentPlan } from './criticMarkupBoundaryPlans';
import type { ICriticMarkupFragmentPlan } from './criticMarkupFragmentPlans';
import type { ICriticMarkupMarkerIndex } from './criticMarkupPlanIndex';
import {
    markedViewOffset,
} from 'marked';
import { HalfOpenIntervalIndex, upperBound } from '../../../mapped-range';
import {
    boundaryAttachmentPlans,
    coverageEdgeFits,
    detachBoundaryAttachment,
} from './criticMarkupBoundaryPlans';
import {
    fragmentPlans,
    itemMarkerRanges,
    marker,
} from './criticMarkupFragmentPlans';
import {
    criticMarkupMarkerIndex,
    viewDocumentEnvelope,
    viewOffsetForDocumentOffset,
} from './criticMarkupPlanIndex';

export interface IPreparedNativeCriticMarkupExtension {
    readonly extension: MarkedExtension;
    readonly transparentMarkerRanges: readonly Tokens.CriticMarkupRange[];
    readonly useTransparentParserView: boolean;
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

function rootTokens(value: Token[] | TokensList): value is TokensList {
    // Object.hasOwn needs lib es2022; this package compiles below that.
    // eslint-disable-next-line e18e/prefer-object-has-own
    return Object.prototype.hasOwnProperty.call(value, 'links');
}

function plansBySourceStart(
    plans: readonly ICriticMarkupFragmentPlan[],
    source: string,
    transparentMarkerIndex: ICriticMarkupMarkerIndex,
): ReadonlyMap<number, readonly ICriticMarkupFragmentPlan[]> {
    const result = new Map<number, readonly ICriticMarkupFragmentPlan[]>();
    for (const plan of plans) {
        const starts = new Set([
            plan.range.start,
            plan.contentRange.start,
        ]);
        if (plan.literalLine) {
            // The line may open with block syntax (heading/quote/list
            // prefixes) that never reaches the inline lexer; the fragment
            // becomes reachable at the first inline-visible byte.
            const prefix = /^(?:#{1,6}[ \t]+|>[ \t]?|(?:[*+-]|\d{1,9}[.)])[ \t]+|[ \t])*/
                .exec(source.slice(
                    plan.contentRange.start,
                    plan.contentRange.end,
                ));
            if (prefix && prefix[0].length)
                starts.add(plan.contentRange.start + prefix[0].length);
        }
        let transformedStart = plan.contentRange.start;
        while (
            transformedStart < plan.contentRange.end
            && (source[transformedStart] === ' '
                || source[transformedStart] === '\t')
        ) {
            transformedStart++;
            starts.add(transformedStart);
        }
        // Only markers removed from the parser view are invisible here; a
        // nested literal item's markers are real view bytes, so stepping
        // over them would register a start inside visible content.
        let transparentStart = plan.contentRange.start;
        while (transparentStart < plan.contentRange.end) {
            const marker = transparentMarkerIndex.startingAt(transparentStart);
            if (!marker || marker.end > plan.contentRange.end)
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

function transparentPlanIntervals(
    plans: readonly ICriticMarkupFragmentPlan[],
    transparentItemIds: ReadonlySet<string>,
): HalfOpenIntervalIndex<ICriticMarkupFragmentPlan> {
    return new HalfOpenIntervalIndex(plans
        .filter(plan =>
            transparentItemIds.has(plan.item.id)
            && plan.contentRange.start < plan.contentRange.end)
        .map(plan => ({
            start: plan.contentRange.start,
            end: plan.contentRange.end,
            value: plan,
        })));
}

function plansAtSourceStart(
    plansByStart: ReadonlyMap<number, readonly ICriticMarkupFragmentPlan[]>,
    transparentIntervals: HalfOpenIntervalIndex<ICriticMarkupFragmentPlan>,
    sourceStart: number,
): readonly ICriticMarkupFragmentPlan[] | undefined {
    const exact = plansByStart.get(sourceStart);
    if (exact)
        return exact;
    const transformed = transparentIntervals.containing(sourceStart)
        .filter(plan => plan.contentRange.start < sourceStart);
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
    transparentMarkerIndex: ICriticMarkupMarkerIndex,
    tokenizeChildren: (
        source: MarkedSourceView<object>,
        tokens: Token[],
    ) => void,
): Tokens.Generic | undefined {
    const viewDocumentStart = view.documentOffsetAt(
        markedViewOffset(0),
        'next',
    );
    // Walk back only over markers the parser view removed: a nested literal
    // item's close marker is visible content and must stay inside the
    // fragment, or the fragment envelope would cut mid-content.
    let transparentEnd = plan.contentRange.end;
    if (transparentParserView) {
        while (transparentEnd > plan.contentRange.start) {
            const marker = transparentMarkerIndex.endingAt(transparentEnd);
            if (!marker || marker.start < plan.contentRange.start)
                break;
            transparentEnd = marker.start;
        }
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
        (transparentParserView || plan.literalLine)
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
        ?? (transparentParserView || plan.literalLine ? fragmentEnd : null);
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
        const startingMarker
            = transparentMarkerIndex.startingAt(semanticStart);
        const transparentMarker
            = startingMarker && startingMarker.end <= plan.contentRange.end
                ? startingMarker
                : undefined;
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
    sortedStarts: readonly number[],
    plansByStart: ReadonlyMap<
        number,
        readonly ICriticMarkupFragmentPlan[]
    >,
    activePlans: ReadonlySet<ICriticMarkupFragmentPlan>,
): number | undefined {
    const envelope = viewDocumentEnvelope(view);
    if (!envelope)
        return undefined;
    // Document order maps monotonically into view order, so the first
    // in-envelope start that resolves is the minimal view offset.
    const first = upperBound(sortedStarts, envelope.start, start => start);
    for (let index = first; index < sortedStarts.length; index++) {
        const sourceStart = sortedStarts[index];
        if (sourceStart > envelope.end)
            break;
        const plans = plansByStart.get(sourceStart)!;
        if (!plans.some(plan => !activePlans.has(plan)))
            continue;
        const offset = viewOffsetForDocumentOffset(view, sourceStart);
        if (offset !== null && offset > 0)
            return offset;
    }
    return undefined;
}

/**
 * Parser-level CriticMarkup fragments. Recognition comes from the canonical
 * balanced grammar; this adapter only maps authenticated source ranges into
 * the active recursive Marked source view.
 */
export function prepareNativeCriticMarkupExtension(
    document: CriticMarkupDocument,
    isStructuralBlock: (source: string) => boolean,
    isPureListBlock: (source: string) => boolean,
): IPreparedNativeCriticMarkupExtension {
    const criticDocument = semanticDocument(document);
    const allPlans = fragmentPlans(document, isStructuralBlock);
    // Mixed items were already rewritten to literal inline line pieces by
    // fragmentPlans, so every remaining block plan owns whole native blocks.
    const blockBoundaryPlans = allPlans.filter(plan =>
        plan.level === 'block'
        && plan.contentRange.start === plan.contentRange.end);
    const blockPlans = allPlans.filter(plan =>
        plan.level === 'block'
        && plan.contentRange.start < plan.contentRange.end);
    // Pure list arms must weld into the surrounding native list so sibling
    // items share one list AST; they parse natively and bind through paired
    // coverage attachments on their exact carrier tokens. Whitespace arms
    // with a line break are block separators whose markers split onto the
    // surrounding tokens. Any other content (tables, paragraphs, mixed
    // runs) would merge across arm/edge boundaries in a transparent parse,
    // so those plans keep the fragment tokenizer.
    const separatorBlockPlanSet = new Set(blockPlans.filter(plan =>
        !/\S/.test(document.markdown.slice(
            plan.contentRange.start,
            plan.contentRange.end,
        ))));
    const interceptedBlockPlans = blockPlans.filter(plan =>
        !separatorBlockPlanSet.has(plan)
        && !isPureListBlock(document.markdown.slice(
            plan.contentRange.start,
            plan.contentRange.end,
        )));
    const interceptedBlockPlanSet = new Set(interceptedBlockPlans);
    const inlinePlans = allPlans.filter(plan => plan.level === 'inline');
    const transparentItemIds = new Set(
        [...blockPlans, ...blockBoundaryPlans].map(plan => plan.item.id),
    );
    const transparentMarkerRanges = Object.freeze(document.items
        .filter(item => transparentItemIds.has(item.id))
        .flatMap(itemMarkerRanges)
        .sort((left, right) => left.start - right.start));
    const transparentMarkerIndex = criticMarkupMarkerIndex(
        transparentMarkerRanges,
    );
    const boundaryPlans = boundaryAttachmentPlans(
        document.markdown,
        [...blockPlans, ...blockBoundaryPlans],
        transparentMarkerIndex,
        plan => separatorBlockPlanSet.has(plan)
            ? 'separator'
            : interceptedBlockPlanSet.has(plan)
                ? 'intercepted'
                : 'native',
    );
    const boundaryPlansByPlan = new Map<
        ICriticMarkupFragmentPlan,
        ICriticMarkupBoundaryAttachmentPlan[]
    >();
    for (const candidate of boundaryPlans) {
        const entries = boundaryPlansByPlan.get(candidate.plan) ?? [];
        entries.push(candidate);
        boundaryPlansByPlan.set(candidate.plan, entries);
    }
    const blockPlansByStart = plansBySourceStart(
        interceptedBlockPlans,
        document.markdown,
        transparentMarkerIndex,
    );
    const inlinePlansByStart = plansBySourceStart(
        inlinePlans,
        document.markdown,
        transparentMarkerIndex,
    );
    const blockPlanStarts = [...blockPlansByStart.keys()]
        .sort((left, right) => left - right);
    const inlinePlanStarts = [...inlinePlansByStart.keys()]
        .sort((left, right) => left - right);
    const blockTransparentIntervals = transparentPlanIntervals(
        interceptedBlockPlans,
        transparentItemIds,
    );
    const inlineTransparentIntervals = transparentPlanIntervals(
        inlinePlans,
        transparentItemIds,
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
    const boundaryAttachmentHolders = new WeakMap<
        object,
        Map<Tokens.CriticMarkupBoundaryAttachment, IBoundaryAttachmentHolder>
    >();
    const holdersFor = (lexer: object) => {
        let holders = boundaryAttachmentHolders.get(lexer);
        if (!holders) {
            holders = new Map();
            boundaryAttachmentHolders.set(lexer, holders);
        }
        return holders;
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
    ) => claimAttachments(lexer, boundaryPlansByPlan.get(plan) ?? []);

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
                        blockPlanStarts,
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
                        blockTransparentIntervals,
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
                                transparentMarkerIndex,
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
                        inlinePlanStarts,
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
                        inlineTransparentIntervals,
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
                                transparentMarkerIndex,
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
                    const holders = holdersFor(this.lexer);
                    const sourceStart = source.documentOffsetAt(
                        markedViewOffset(0),
                        'next',
                    );
                    const sourceEnd = source.documentOffsetAt(
                        markedViewOffset(source.text.length),
                        'previous',
                    );
                    const matches: ICriticMarkupBoundaryAttachmentPlan[] = [];
                    for (const candidate of boundaryPlans) {
                        if (activePlans.has(candidate.plan))
                            continue;
                        const { attachment } = candidate;
                        const exactCoverage = attachment.coverage === 'content';
                        if (!exactCoverage) {
                            if (claimed.has(attachment))
                                continue;
                            const anchored = attachment.edge === 'before'
                                ? candidate.anchor === sourceStart
                                : candidate.anchor === sourceEnd;
                            if (anchored)
                                matches.push(candidate);
                            continue;
                        }
                        const fits = coverageEdgeFits(
                            document.markdown,
                            transparentMarkerIndex,
                            candidate,
                            sourceStart,
                            sourceEnd,
                        );
                        if (!fits) {
                            continue;
                        }
                        const holder = holders.get(attachment);
                        if (holder) {
                            // Inner tokens are consumed before their
                            // containers; a later fitting token that
                            // encloses the current holder is the more
                            // semantic carrier and takes the attachment.
                            if (
                                sourceStart <= holder.start
                                && holder.end <= sourceEnd
                                && (sourceStart < holder.start
                                    || holder.end < sourceEnd)
                            ) {
                                detachBoundaryAttachment(
                                    holder.token,
                                    attachment,
                                );
                            }
                            else {
                                continue;
                            }
                        }
                        holders.set(attachment, {
                            token,
                            start: sourceStart,
                            end: sourceEnd,
                        });
                        matches.push(candidate);
                    }
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
