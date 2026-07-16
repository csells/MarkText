import type { Token, Tokens } from 'marked';
import type { ICriticMarkupBindingRange } from '../criticMarkup/bindingGraph';
import type {
    ICriticMarkupInlineLeaf,
    ICriticMarkupLocatedInlineToken,
} from '../utils/marked/locatedMarkdown';
import type {
    ICriticMarkupInlineStateBindingDraft,
    IPendingCriticMarkupInlineBinding,
    TCriticMarkupInlineStateBindingSegment,
} from './criticMarkupStateBindings';
import type { TState } from './types';
import {
    criticStateType,
    immutableCriticBindingRange,
} from './criticMarkupStateBindings';

export interface ILoweredNativeInlineSource {
    readonly text: string;
    readonly bindings: readonly ICriticMarkupInlineStateBindingDraft[];
}

function isCriticInlineFragment(
    token: Token,
): token is Tokens.CriticMarkupFragment {
    return token.type === 'critic_addition'
        || token.type === 'critic_deletion'
        || token.type === 'critic_substitution'
        || token.type === 'critic_highlight'
        || token.type === 'critic_comment';
}

interface ILocatedInlineCriticFragment {
    readonly fragment: Tokens.CriticMarkupFragment;
    readonly parserLocalRange: ICriticMarkupBindingRange;
}

interface IInlineMappedPiece {
    readonly localStart: number;
    readonly localEnd: number;
    readonly sourceStart: number;
    readonly sourceEnd: number;
}

interface ITransparentMarkerInsertion {
    readonly marker: Tokens.CriticMarkupMarker;
    readonly parserOffset: number;
}

function firstInlinePieceStartingAtOrAfter(
    pieces: readonly IInlineMappedPiece[],
    sourceOffset: number,
): number {
    let low = 0;
    let high = pieces.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (pieces[middle].sourceStart < sourceOffset)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

function firstInlinePieceEndingAfter(
    pieces: readonly IInlineMappedPiece[],
    sourceOffset: number,
): number {
    let low = 0;
    let high = pieces.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (pieces[middle].sourceEnd <= sourceOffset)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}

function inlinePiecesIntersectRange(
    pieces: readonly IInlineMappedPiece[],
    range: ICriticMarkupBindingRange,
): boolean {
    const candidate = pieces[firstInlinePieceEndingAfter(
        pieces,
        range.start,
    )];
    return candidate !== undefined && candidate.sourceStart < range.end;
}

function mergeInlineMappedPieces(
    pieces: readonly IInlineMappedPiece[],
): IInlineMappedPiece[] {
    const merged: IInlineMappedPiece[] = [];
    for (const piece of pieces) {
        const previous = merged.at(-1);
        if (
            previous
            && previous.localEnd === piece.localStart
            && previous.sourceEnd === piece.sourceStart
        ) {
            merged[merged.length - 1] = {
                localStart: previous.localStart,
                localEnd: piece.localEnd,
                sourceStart: previous.sourceStart,
                sourceEnd: piece.sourceEnd,
            };
        }
        else {
            merged.push(piece);
        }
    }
    return merged;
}

function hasNativeInlineCriticFragment(
    tokens: readonly Token[] | undefined,
): boolean {
    if (!tokens)
        return false;
    const pending = [...tokens];
    while (pending.length) {
        const token = pending.pop()!;
        if (isCriticInlineFragment(token) && token.level === 'inline')
            return true;
        const children = (token as Tokens.Generic).tokens;
        if (Array.isArray(children)) {
            for (const child of children)
                pending.push(child);
        }
    }
    return false;
}

function locatedInlineCriticFragments(
    nodes: readonly ICriticMarkupLocatedInlineToken[],
): ILocatedInlineCriticFragment[] {
    const fragments: ILocatedInlineCriticFragment[] = [];
    const pending = [...nodes].reverse();
    while (pending.length) {
        const node = pending.pop()!;
        if (isCriticInlineFragment(node.token)) {
            if (node.token.level !== 'inline') {
                throw new TypeError(
                    'Block CriticMarkup fragment appeared in an inline token graph.',
                );
            }
            fragments.push({
                fragment: node.token,
                parserLocalRange: immutableCriticBindingRange(
                    node.localRange.start,
                    node.localRange.end,
                ),
            });
        }
        for (let index = node.children.length - 1; index >= 0; index--)
            pending.push(node.children[index]);
    }
    return fragments;
}

function parserLocalBoundaryForSource(
    pieces: readonly IInlineMappedPiece[],
    sourceOffset: number,
    affinity: 'previous' | 'next',
): number {
    const nextIndex = firstInlinePieceStartingAtOrAfter(
        pieces,
        sourceOffset,
    );
    const next = pieces[nextIndex];
    const previous = pieces[nextIndex - 1];
    if (
        previous
        && previous.sourceStart < sourceOffset
        && sourceOffset < previous.sourceEnd
    ) {
        return previous.localStart + sourceOffset - previous.sourceStart;
    }
    if (affinity === 'next') {
        if (next?.sourceStart === sourceOffset)
            return next.localStart;
        if (previous?.sourceEnd === sourceOffset)
            return previous.localEnd;
        if (next)
            return next.localStart;
    }
    else {
        if (previous?.sourceEnd === sourceOffset)
            return previous.localEnd;
        if (next?.sourceStart === sourceOffset)
            return next.localStart;
        if (previous)
            return previous.localEnd;
    }
    throw new RangeError(
        'Native inline CriticMarkup marker has no parser-leaf boundary.',
    );
}

function inlineLeafPieces(
    leaf: ICriticMarkupInlineLeaf,
): IInlineMappedPiece[] {
    const pieces = leaf.pieces.map((piece): IInlineMappedPiece => ({
        localStart: piece.localStart,
        localEnd: piece.localEnd,
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
    }));
    for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index];
        const previous = pieces[index - 1];
        if (
            !Number.isSafeInteger(piece.localStart)
            || !Number.isSafeInteger(piece.localEnd)
            || !Number.isSafeInteger(piece.sourceStart)
            || !Number.isSafeInteger(piece.sourceEnd)
            || piece.localStart < 0
            || piece.localEnd < piece.localStart
            || leaf.text.length < piece.localEnd
            || piece.sourceStart < 0
            || piece.sourceEnd < piece.sourceStart
            || piece.localEnd - piece.localStart
            !== piece.sourceEnd - piece.sourceStart
            || (
                previous
                && (
                    piece.localStart < previous.localEnd
                    || piece.sourceStart < previous.sourceEnd
                )
            )
        ) {
            throw new RangeError(
                'Located Markdown inline leaf has invalid source pieces.',
            );
        }
    }
    return mergeInlineMappedPieces(pieces);
}

function transparentMarkerInsertions(
    fragments: readonly ILocatedInlineCriticFragment[],
    pieces: readonly IInlineMappedPiece[],
): ITransparentMarkerInsertion[] {
    const insertions = new Map<string, ITransparentMarkerInsertion>();
    for (const { fragment } of fragments) {
        if (!fragment.markersTransparent)
            continue;
        for (const [edge, markers] of [
            ['before', fragment.before],
            ['after', fragment.after],
        ] as const) {
            for (const marker of markers) {
                if (
                    marker.range.end - marker.range.start
                    !== marker.raw.length
                    || inlinePiecesIntersectRange(pieces, marker.range)
                ) {
                    throw new RangeError(
                        'Transparent CriticMarkup marker conflicts with its parser leaf.',
                    );
                }
                const key = [
                    marker.range.start,
                    marker.range.end,
                    marker.name,
                ].join(':');
                const insertion = {
                    marker,
                    parserOffset: parserLocalBoundaryForSource(
                        pieces,
                        edge === 'before'
                            ? marker.range.end
                            : marker.range.start,
                        edge === 'before' ? 'next' : 'previous',
                    ),
                };
                const existing = insertions.get(key);
                if (
                    existing
                    && (
                        existing.marker.raw !== marker.raw
                        || existing.parserOffset !== insertion.parserOffset
                    )
                ) {
                    throw new TypeError(
                        'Native inline CriticMarkup marker has conflicting parser ownership.',
                    );
                }
                insertions.set(key, insertion);
            }
        }
    }
    return [...insertions.values()].sort((left, right) =>
        left.parserOffset - right.parserOffset
        || left.marker.range.start - right.marker.range.start
        || left.marker.range.end - right.marker.range.end);
}

function lowerInlineLeafMapping(
    leaf: ICriticMarkupInlineLeaf,
    fallback: string,
    fragments: readonly ILocatedInlineCriticFragment[],
): { readonly text: string; readonly pieces: readonly IInlineMappedPiece[] } {
    if (leaf.text !== fallback) {
        throw new TypeError(
            'Native inline CriticMarkup parser leaf differs from its lowered state text.',
        );
    }
    const basePieces = inlineLeafPieces(leaf);
    const insertions = transparentMarkerInsertions(fragments, basePieces);
    if (!insertions.length)
        return { text: fallback, pieces: basePieces };

    const insertedPieces: IInlineMappedPiece[] = [];
    let cursor = 0;
    let text = '';
    for (const insertion of insertions) {
        if (
            insertion.parserOffset < cursor
            || fallback.length < insertion.parserOffset
        ) {
            throw new RangeError(
                'Native inline CriticMarkup marker insertion is outside its leaf.',
            );
        }
        text += fallback.slice(cursor, insertion.parserOffset);
        const localStart = text.length;
        text += insertion.marker.raw;
        insertedPieces.push({
            localStart,
            localEnd: text.length,
            sourceStart: insertion.marker.range.start,
            sourceEnd: insertion.marker.range.end,
        });
        cursor = insertion.parserOffset;
    }
    text += fallback.slice(cursor);

    const sourceOrderedInsertions = [...insertions].sort((left, right) =>
        left.marker.range.end - right.marker.range.end
        || left.marker.range.start - right.marker.range.start);
    let sourceInsertionIndex = 0;
    let insertedLength = 0;
    const shiftedBasePieces = basePieces.map((piece) => {
        while (
            sourceInsertionIndex < sourceOrderedInsertions.length
            && sourceOrderedInsertions[sourceInsertionIndex].marker.range.end
            <= piece.sourceStart
        ) {
            insertedLength += sourceOrderedInsertions[sourceInsertionIndex]
                .marker
                .raw
                .length;
            sourceInsertionIndex++;
        }
        const localStart = piece.localStart + insertedLength;
        while (
            sourceInsertionIndex < sourceOrderedInsertions.length
            && sourceOrderedInsertions[sourceInsertionIndex].marker.range.end
            <= piece.sourceEnd
        ) {
            insertedLength += sourceOrderedInsertions[sourceInsertionIndex]
                .marker
                .raw
                .length;
            sourceInsertionIndex++;
        }
        return {
            localStart,
            localEnd: piece.localEnd + insertedLength,
            sourceStart: piece.sourceStart,
            sourceEnd: piece.sourceEnd,
        };
    });
    const pieces = [...shiftedBasePieces, ...insertedPieces].sort((left, right) =>
        left.localStart - right.localStart
        || left.sourceStart - right.sourceStart
        || left.localEnd - right.localEnd);
    for (let index = 1; index < pieces.length; index++) {
        if (
            pieces[index].localStart < pieces[index - 1].localEnd
            || pieces[index].sourceStart < pieces[index - 1].sourceEnd
        ) {
            throw new RangeError(
                'Lowered inline CriticMarkup source pieces overlap.',
            );
        }
    }
    return { text, pieces: mergeInlineMappedPieces(pieces) };
}

function sameInlineBindingSegment(
    left: TCriticMarkupInlineStateBindingSegment,
    right: TCriticMarkupInlineStateBindingSegment,
): boolean {
    if (left.kind !== right.kind)
        return false;
    if (left.kind === 'marker' && right.kind === 'marker')
        return left.marker === right.marker;
    if (left.kind === 'content' && right.kind === 'content')
        return left.arm === right.arm;
    return false;
}

function bindingSegmentsForSourceRange(
    pieces: readonly IInlineMappedPiece[],
    sourceRange: ICriticMarkupBindingRange,
    semantic: Readonly<
        | { readonly kind: 'marker'; readonly marker: Tokens.CriticMarkupMarker['name'] }
        | { readonly kind: 'content'; readonly arm: Tokens.CriticMarkupArm['name'] }
    >,
): TCriticMarkupInlineStateBindingSegment[] {
    const segments: TCriticMarkupInlineStateBindingSegment[] = [];
    const firstPiece = firstInlinePieceEndingAfter(
        pieces,
        sourceRange.start,
    );
    for (let index = firstPiece; index < pieces.length; index++) {
        const piece = pieces[index];
        if (sourceRange.end <= piece.sourceStart)
            break;
        const sourceStart = Math.max(piece.sourceStart, sourceRange.start);
        const sourceEnd = Math.min(piece.sourceEnd, sourceRange.end);
        if (sourceEnd <= sourceStart)
            continue;
        const localStart = piece.localStart + sourceStart - piece.sourceStart;
        const localEnd = piece.localStart + sourceEnd - piece.sourceStart;
        const segment = semantic.kind === 'marker'
            ? {
                    kind: 'marker' as const,
                    marker: semantic.marker,
                    localRange: immutableCriticBindingRange(
                        localStart,
                        localEnd,
                    ),
                    sourceRange: immutableCriticBindingRange(
                        sourceStart,
                        sourceEnd,
                    ),
                }
            : {
                    kind: 'content' as const,
                    arm: semantic.arm,
                    localRange: immutableCriticBindingRange(
                        localStart,
                        localEnd,
                    ),
                    sourceRange: immutableCriticBindingRange(
                        sourceStart,
                        sourceEnd,
                    ),
                };
        const previous = segments.at(-1);
        if (
            previous
            && sameInlineBindingSegment(previous, segment)
            && previous.localRange.end === segment.localRange.start
            && previous.sourceRange.end === segment.sourceRange.start
        ) {
            segments[segments.length - 1] = semantic.kind === 'marker'
                ? {
                        kind: 'marker',
                        marker: semantic.marker,
                        localRange: immutableCriticBindingRange(
                            previous.localRange.start,
                            segment.localRange.end,
                        ),
                        sourceRange: immutableCriticBindingRange(
                            previous.sourceRange.start,
                            segment.sourceRange.end,
                        ),
                    }
                : {
                        kind: 'content',
                        arm: semantic.arm,
                        localRange: immutableCriticBindingRange(
                            previous.localRange.start,
                            segment.localRange.end,
                        ),
                        sourceRange: immutableCriticBindingRange(
                            previous.sourceRange.start,
                            segment.sourceRange.end,
                        ),
                    };
        }
        else {
            segments.push(segment);
        }
    }
    return segments;
}

function inlineBindingDraft(
    located: ILocatedInlineCriticFragment,
    pieces: readonly IInlineMappedPiece[],
): ICriticMarkupInlineStateBindingDraft {
    const { fragment, parserLocalRange } = located;
    if (
        parserLocalRange.end < parserLocalRange.start
        || fragment.contentRange.start < fragment.range.start
        || fragment.range.end < fragment.contentRange.end
    ) {
        throw new RangeError(
            'Native inline CriticMarkup fragment has invalid parser ranges.',
        );
    }
    const segments: TCriticMarkupInlineStateBindingSegment[] = [];
    const appendSegments = (
        produced: readonly TCriticMarkupInlineStateBindingSegment[],
    ) => {
        for (const segment of produced)
            segments.push(segment);
    };
    for (const marker of fragment.before) {
        appendSegments(bindingSegmentsForSourceRange(
            pieces,
            marker.range,
            { kind: 'marker', marker: marker.name },
        ));
    }
    if (fragment.contentRange.start < fragment.contentRange.end) {
        appendSegments(bindingSegmentsForSourceRange(
            pieces,
            fragment.contentRange,
            { kind: 'content', arm: fragment.arm },
        ));
    }
    for (const marker of fragment.after) {
        appendSegments(bindingSegmentsForSourceRange(
            pieces,
            marker.range,
            { kind: 'marker', marker: marker.name },
        ));
    }
    const first = segments[0];
    const last = segments.at(-1);
    if (!first || !last) {
        throw new TypeError(
            'Native inline CriticMarkup fragment produced no mapped segments.',
        );
    }
    return {
        itemId: fragment.itemId,
        criticType: criticStateType(fragment.type),
        arm: fragment.arm,
        role: fragment.role,
        localRange: immutableCriticBindingRange(
            first.localRange.start,
            last.localRange.end,
        ),
        sourceRange: immutableCriticBindingRange(
            fragment.range.start,
            fragment.range.end,
        ),
        segments,
    };
}

/** Lower one located parser-native inline owner without source-text search. */
export function nativeInlineCriticSource(
    tokens: readonly Token[] | undefined,
    fallback: string,
    leavesByTokens: WeakMap<readonly Token[], ICriticMarkupInlineLeaf>,
): ILoweredNativeInlineSource {
    if (!tokens)
        return { text: fallback, bindings: [] };
    const leaf = leavesByTokens.get(tokens);
    if (!leaf) {
        if (hasNativeInlineCriticFragment(tokens)) {
            throw new TypeError(
                'Native inline CriticMarkup has no located parser leaf.',
            );
        }
        return { text: fallback, bindings: [] };
    }
    const fragments = locatedInlineCriticFragments(leaf.locatedTokens);
    if (!fragments.length)
        return { text: fallback, bindings: [] };
    const lowered = lowerInlineLeafMapping(leaf, fallback, fragments);
    return {
        text: lowered.text,
        bindings: fragments.map(fragment =>
            inlineBindingDraft(fragment, lowered.pieces)),
    };
}

export function appendPendingInlineBindings(
    pending: IPendingCriticMarkupInlineBinding[],
    state: TState,
    lowered: ILoweredNativeInlineSource,
    localOffset = 0,
    mappedPrefixLength = 0,
): void {
    if (!lowered.bindings.length)
        return;
    if (
        !Number.isSafeInteger(localOffset)
        || localOffset < 0
        || !('text' in state)
        || typeof state.text !== 'string'
    ) {
        throw new TypeError(
            'Native inline CriticMarkup binding has no produced text leaf.',
        );
    }
    for (const binding of lowered.bindings) {
        const segments = binding.segments.map(segment => ({
            ...segment,
            localRange: immutableCriticBindingRange(
                segment.localRange.start + localOffset,
                segment.localRange.end + localOffset,
            ),
        }));
        let localStart = binding.localRange.start + localOffset;
        const first = segments[0];
        if (
            localOffset > 0
            && mappedPrefixLength > 0
            && first
            && first.localRange.start === localOffset
            && binding.sourceRange.start
            <= first.sourceRange.start - localOffset
        ) {
            // The fragment covers the leaf's generated block prefix (for
            // example an ATX `# `). Only the serializer-mapped prefix bytes
            // (the `#` run, not the padding space) can enter the segment.
            segments.unshift({
                kind: 'content',
                arm: binding.arm,
                localRange: immutableCriticBindingRange(
                    0,
                    mappedPrefixLength,
                ),
                sourceRange: immutableCriticBindingRange(
                    first.sourceRange.start - localOffset,
                    first.sourceRange.start
                    - localOffset
                    + mappedPrefixLength,
                ),
            });
            localStart = 0;
        }
        pending.push({
            state,
            binding: {
                ...binding,
                localRange: immutableCriticBindingRange(
                    localStart,
                    binding.localRange.end + localOffset,
                ),
                segments,
            },
        });
    }
}
