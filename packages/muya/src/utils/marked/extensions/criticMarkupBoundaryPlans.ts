import type { Token, Tokens } from 'marked';
import type { ICriticMarkupFragmentPlan } from './criticMarkupFragmentPlans';
import type { ICriticMarkupMarkerIndex } from './criticMarkupPlanIndex';

export interface ICriticMarkupBoundaryAttachmentPlan {
    readonly plan: ICriticMarkupFragmentPlan;
    readonly anchor: number;
    readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
}

export interface IBoundaryAttachmentHolder {
    readonly token: Token;
    readonly start: number;
    readonly end: number;
}

/**
 * True when [start, end) holds only whitespace and transparent Critic
 * marker bytes — the bytes the native parser view never sees.
 */
function isTriviaBetween(
    source: string,
    markerIndex: ICriticMarkupMarkerIndex,
    start: number,
    end: number,
): boolean {
    if (end < start)
        return false;
    let cursor = start;
    while (cursor < end) {
        if (/\s/.test(source[cursor])) {
            cursor++;
            continue;
        }
        const marker = markerIndex.startingAt(cursor);
        if (!marker || marker.end > end)
            return false;
        cursor = marker.end;
    }
    return true;
}

function skipTriviaForward(
    source: string,
    markerIndex: ICriticMarkupMarkerIndex,
    from: number,
    limit: number,
): number {
    let cursor = from;
    while (cursor < limit) {
        if (/\s/.test(source[cursor])) {
            cursor++;
            continue;
        }
        const marker = markerIndex.startingAt(cursor);
        if (!marker || marker.end > limit)
            break;
        cursor = marker.end;
    }
    return cursor;
}

function skipTriviaBackward(
    source: string,
    markerIndex: ICriticMarkupMarkerIndex,
    from: number,
    limit: number,
): number {
    let cursor = from;
    while (cursor > limit) {
        if (/\s/.test(source[cursor - 1])) {
            cursor--;
            continue;
        }
        const marker = markerIndex.endingAt(cursor);
        if (!marker || marker.start < limit)
            break;
        cursor = marker.start;
    }
    return cursor;
}

/**
 * A token carries one edge of a structural arm when it sits flush against
 * that edge (whitespace-tolerant) and does not escape the arm's content
 * envelope on the opposite side.
 */
export function coverageEdgeFits(
    source: string,
    markerIndex: ICriticMarkupMarkerIndex,
    candidate: ICriticMarkupBoundaryAttachmentPlan,
    tokenStart: number,
    tokenEnd: number,
): boolean {
    const { contentRange } = candidate.attachment;
    const coverageStart = skipTriviaForward(
        source,
        markerIndex,
        contentRange.start,
        contentRange.end,
    );
    const coverageEnd = skipTriviaBackward(
        source,
        markerIndex,
        contentRange.end,
        coverageStart,
    );
    if (candidate.attachment.edge === 'before') {
        // The carrier must reach the covered content; a token lying wholly
        // before it (for example a lazy-continuation newline consumption)
        // can touch the edge without carrying anything.
        return tokenEnd > coverageStart
            && isTriviaBetween(
                source,
                markerIndex,
                Math.min(tokenStart, coverageStart),
                Math.max(tokenStart, coverageStart),
            ) && (
            tokenEnd <= coverageEnd
            || isTriviaBetween(source, markerIndex, coverageEnd, tokenEnd)
        );
    }
    return tokenStart < coverageEnd
        && isTriviaBetween(
            source,
            markerIndex,
            Math.min(tokenEnd, coverageEnd),
            Math.max(tokenEnd, coverageEnd),
        ) && (
        coverageStart <= tokenStart
        || isTriviaBetween(source, markerIndex, tokenStart, coverageStart)
    );
}

export function detachBoundaryAttachment(
    token: Token,
    attachment: Tokens.CriticMarkupBoundaryAttachment,
): void {
    const carrier = token as Partial<Tokens.CriticMarkupBoundaryCarrier>;
    for (const key of ['criticMarkupBefore', 'criticMarkupAfter'] as const) {
        const list = carrier[key];
        if (!list?.includes(attachment))
            continue;
        (carrier as Record<typeof key, unknown>)[key] = Object.freeze(
            list.filter(entry => entry !== attachment),
        );
    }
}

function boundaryAttachment(
    plan: ICriticMarkupFragmentPlan,
    edge: 'before' | 'after',
    coverage: Tokens.CriticMarkupBoundaryAttachment['coverage'],
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
        coverage,
        contentRange: Object.freeze({ ...plan.contentRange }),
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

export function boundaryAttachmentPlans(
    source: string,
    plans: readonly ICriticMarkupFragmentPlan[],
    markerIndex: ICriticMarkupMarkerIndex,
    classifyPlan: (
        plan: ICriticMarkupFragmentPlan,
    ) => 'native' | 'separator' | 'intercepted',
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
                    'empty',
                    [...plan.before, ...plan.after],
                    source,
                    triviaStart,
                    triviaEnd,
                    plan.range.end,
                    followingTriviaEnd,
                ),
            })];
        }

        const classification = classifyPlan(plan);
        if (classification === 'separator') {
            // A whitespace block separator's interior bytes stay owned by
            // the native space token. Its open markers ride AFTER the
            // preceding token and its close markers BEFORE the following
            // token, so the weave reproduces `prev{++` + separator + `++}next`.
            const result: ICriticMarkupBoundaryAttachmentPlan[] = [];
            if (plan.before.length) {
                const anchor = skipTriviaBackward(
                    source,
                    markerIndex,
                    plan.contentRange.start,
                    0,
                );
                result.push(Object.freeze({
                    plan,
                    anchor,
                    attachment: boundaryAttachment(
                        plan,
                        'after',
                        'empty',
                        plan.before,
                        source,
                        anchor,
                        anchor,
                        plan.range.end,
                        plan.range.end,
                    ),
                }));
            }
            if (plan.after.length) {
                const anchor = skipTriviaForward(
                    source,
                    markerIndex,
                    plan.contentRange.end,
                    source.length,
                );
                result.push(Object.freeze({
                    plan,
                    anchor,
                    attachment: boundaryAttachment(
                        plan,
                        'before',
                        'empty',
                        plan.after,
                        source,
                        anchor,
                        anchor,
                        plan.range.end,
                        plan.range.end,
                    ),
                }));
            }
            return result;
        }
        // Native-merge arms carry BOTH edges as `content` coverage so the
        // state builder can pair them into exact native coverage, even when
        // an edge owns no marker bytes. Intercepted plans keep the
        // baseline zero-width attachment semantics — their coverage is
        // reconstructed by the fragment tokenizer, not by edge pairing.
        const coverage = classification === 'native'
            ? 'content' as const
            : 'empty' as const;
        const result: ICriticMarkupBoundaryAttachmentPlan[] = [];
        if (coverage === 'content' || plan.before.length) {
            // The anchor may cross nested transparent markers to reach the
            // native token, but stored trivia stays whitespace-pure — the
            // nested item's own markers re-emit those bytes. The trivia run
            // starts at the opener's end: an opener that ends its line owns
            // the gap up to the covered content ({++\n…).
            const anchor = skipTriviaForward(
                source,
                markerIndex,
                plan.contentRange.start,
                plan.contentRange.end,
            );
            const openerEnd = plan.before.length
                ? plan.before.reduce(
                        (end, marker) => Math.max(end, marker.range.end),
                        0,
                    )
                : plan.contentRange.start;
            let triviaStart = Math.min(openerEnd, plan.contentRange.start);
            while (
                triviaStart < plan.contentRange.start
                && !/\s/.test(source[triviaStart])
            ) {
                triviaStart++;
            }
            let triviaEnd = plan.contentRange.start;
            while (triviaEnd < anchor && /\s/.test(source[triviaEnd]))
                triviaEnd++;
            result.push(Object.freeze({
                plan,
                anchor,
                attachment: boundaryAttachment(
                    plan,
                    'before',
                    coverage,
                    plan.before,
                    source,
                    triviaStart,
                    triviaEnd,
                    plan.range.end,
                    plan.range.end,
                ),
            }));
        }
        if (coverage === 'content' || plan.after.length) {
            const anchor = skipTriviaBackward(
                source,
                markerIndex,
                plan.contentRange.end,
                plan.contentRange.start,
            );
            let triviaStart = plan.contentRange.end;
            while (triviaStart > anchor && /\s/.test(source[triviaStart - 1]))
                triviaStart--;
            result.push(Object.freeze({
                plan,
                anchor,
                attachment: boundaryAttachment(
                    plan,
                    'after',
                    coverage,
                    plan.after,
                    source,
                    triviaStart,
                    plan.contentRange.end,
                    plan.range.end,
                    plan.range.end,
                ),
            }));
        }
        return result;
    }));
}
