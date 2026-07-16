import type { Token, Tokens } from 'marked';
import type {
    ICriticMarkupBindingGraph,
    ICriticMarkupBindingRange,
    ICriticMarkupInlineBinding,
    TCriticMarkupInlineBindingSegment,
} from '../../criticMarkup/bindingGraph';
import type { IMarkdownSourceMapPiece } from '../../state/stateToMarkdown';
import type { TMarkedParserPath } from './markedSourceView';

/**
 * Binding-graph emission for the marked parser path domain. The located
 * parse walk supplies its leaves and coverage scopes; this module owns
 * turning that provenance into the parser's CriticMarkup topology.
 */

export const CRITIC_FRAGMENT_TOKEN_TYPES: Readonly<
    Partial<Record<string, Tokens.CriticMarkupType>>
> = {
    critic_addition: 'addition',
    critic_deletion: 'deletion',
    critic_substitution: 'substitution',
    critic_highlight: 'highlight',
    critic_comment: 'comment',
};

export interface IMarkedLocatedTokenNode {
    readonly token: Token;
    readonly children: readonly IMarkedLocatedTokenNode[];
}

export interface IMarkedBindingLeaf {
    readonly path: TMarkedParserPath;
    readonly pieces: readonly IMarkdownSourceMapPiece[];
    readonly locatedTokens: readonly IMarkedLocatedTokenNode[];
}

export interface IMarkedCoverageScope {
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly sourceRange: { readonly start: number; readonly end: number };
}

export interface IMarkedCoveredLeaf {
    readonly leaf: IMarkedBindingLeaf;
    readonly scopes: readonly IMarkedCoverageScope[];
}

function markedBindingRange(
    start: number,
    end: number,
): ICriticMarkupBindingRange {
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end)
        || start < 0
        || end < start
    ) {
        throw new RangeError(
            'Located CriticMarkup binding has an invalid range.',
        );
    }
    return Object.freeze({ start, end });
}

/** Map one source range onto a leaf's mapped pieces as binding segments. */
function markedBindingSegments(
    pieces: readonly IMarkdownSourceMapPiece[],
    range: ICriticMarkupBindingRange,
    semantic: Readonly<
        | { readonly kind: 'marker'; readonly marker: Tokens.CriticMarkupMarker['name'] }
        | { readonly kind: 'content'; readonly arm: Tokens.CriticMarkupArm['name'] }
    >,
): TCriticMarkupInlineBindingSegment[] {
    const segments: TCriticMarkupInlineBindingSegment[] = [];
    for (const piece of pieces) {
        if (range.end <= piece.sourceStart || piece.sourceEnd <= range.start)
            continue;
        const sourceStart = Math.max(piece.sourceStart, range.start);
        const sourceEnd = Math.min(piece.sourceEnd, range.end);
        if (sourceEnd <= sourceStart)
            continue;
        const localStart = piece.localStart + sourceStart - piece.sourceStart;
        const localEnd = piece.localStart + sourceEnd - piece.sourceStart;
        const previous = segments.at(-1);
        if (
            previous
            && previous.localRange.end === localStart
            && previous.sourceRange.end === sourceStart
        ) {
            segments[segments.length - 1] = {
                ...previous,
                localRange: markedBindingRange(
                    previous.localRange.start,
                    localEnd,
                ),
                sourceRange: markedBindingRange(
                    previous.sourceRange.start,
                    sourceEnd,
                ),
            };
            continue;
        }
        segments.push(semantic.kind === 'marker'
            ? {
                    kind: 'marker',
                    marker: semantic.marker,
                    localRange: markedBindingRange(localStart, localEnd),
                    sourceRange: markedBindingRange(sourceStart, sourceEnd),
                }
            : {
                    kind: 'content',
                    arm: semantic.arm,
                    localRange: markedBindingRange(localStart, localEnd),
                    sourceRange: markedBindingRange(sourceStart, sourceEnd),
                });
    }
    return segments;
}

function isCriticInlineFragmentToken(
    token: Token,
): token is Tokens.CriticMarkupFragment {
    return token.type in CRITIC_FRAGMENT_TOKEN_TYPES
        && (token as Tokens.CriticMarkupFragment).level === 'inline';
}

function markedInlineFragmentBindings(
    leaf: IMarkedBindingLeaf,
): ICriticMarkupInlineBinding<TMarkedParserPath>[] {
    const bindings: ICriticMarkupInlineBinding<TMarkedParserPath>[] = [];
    const pending = [...leaf.locatedTokens].reverse();
    while (pending.length) {
        const node = pending.pop()!;
        if (isCriticInlineFragmentToken(node.token)) {
            const fragment = node.token;
            const segments: TCriticMarkupInlineBindingSegment[] = [];
            const appendSegments = (
                produced: readonly TCriticMarkupInlineBindingSegment[],
            ) => {
                for (const segment of produced)
                    segments.push(segment);
            };
            for (const marker of fragment.before) {
                appendSegments(markedBindingSegments(
                    leaf.pieces,
                    marker.range,
                    { kind: 'marker', marker: marker.name },
                ));
            }
            if (fragment.contentRange.start < fragment.contentRange.end) {
                appendSegments(markedBindingSegments(
                    leaf.pieces,
                    fragment.contentRange,
                    { kind: 'content', arm: fragment.arm },
                ));
            }
            for (const marker of fragment.after) {
                appendSegments(markedBindingSegments(
                    leaf.pieces,
                    marker.range,
                    { kind: 'marker', marker: marker.name },
                ));
            }
            const first = segments[0];
            const last = segments.at(-1);
            if (first && last) {
                bindings.push(Object.freeze({
                    path: leaf.path,
                    itemId: fragment.itemId,
                    criticType: CRITIC_FRAGMENT_TOKEN_TYPES[fragment.type]!,
                    arm: fragment.arm,
                    role: fragment.role,
                    localRange: markedBindingRange(
                        first.localRange.start,
                        last.localRange.end,
                    ),
                    sourceRange: markedBindingRange(
                        fragment.range.start,
                        fragment.range.end,
                    ),
                    segments: Object.freeze(segments),
                }));
            }
        }
        for (let index = node.children.length - 1; index >= 0; index--)
            pending.push(node.children[index]);
    }
    return bindings;
}

/**
 * Emit the located parser's binding graph for the marked path domain: one
 * inline binding per located critic fragment, plus one per (covered leaf,
 * covering structural arm). Structural carriers have no marked-domain block
 * paths, so the block member stays empty.
 */
export function markedCriticBindingGraph(
    inlineLeaves: readonly IMarkedBindingLeaf[],
    criticCoveredLeaves: readonly IMarkedCoveredLeaf[],
): ICriticMarkupBindingGraph<TMarkedParserPath> {
    const inline: ICriticMarkupInlineBinding<TMarkedParserPath>[] = [];
    for (const leaf of inlineLeaves) {
        for (const binding of markedInlineFragmentBindings(leaf))
            inline.push(binding);
    }

    const coverageByItem = new Map<
        string,
        Array<{
            binding: Omit<ICriticMarkupInlineBinding<TMarkedParserPath>, 'role'>;
            sourceStart: number;
        }>
    >();
    for (const covered of criticCoveredLeaves) {
        for (const scope of covered.scopes) {
            const segments = markedBindingSegments(
                covered.leaf.pieces,
                markedBindingRange(
                    scope.sourceRange.start,
                    scope.sourceRange.end,
                ),
                { kind: 'content', arm: scope.arm },
            );
            const first = segments[0];
            const last = segments.at(-1);
            if (!first || !last)
                continue;
            const entries = coverageByItem.get(scope.itemId) ?? [];
            entries.push({
                binding: {
                    path: covered.leaf.path,
                    itemId: scope.itemId,
                    criticType: scope.criticType,
                    arm: scope.arm,
                    localRange: markedBindingRange(
                        first.localRange.start,
                        last.localRange.end,
                    ),
                    sourceRange: markedBindingRange(
                        first.sourceRange.start,
                        last.sourceRange.end,
                    ),
                    segments: Object.freeze(segments),
                },
                sourceStart: first.sourceRange.start,
            });
            coverageByItem.set(scope.itemId, entries);
        }
    }
    for (const entries of coverageByItem.values()) {
        entries.sort((left, right) => left.sourceStart - right.sourceStart);
        entries.forEach((entry, index) => {
            const role = entries.length === 1
                ? 'only' as const
                : index === 0
                    ? 'start' as const
                    : index === entries.length - 1
                        ? 'end' as const
                        : 'middle' as const;
            inline.push(Object.freeze({ ...entry.binding, role }));
        });
    }
    return Object.freeze({
        block: Object.freeze([]),
        inline: Object.freeze(inline),
    });
}
