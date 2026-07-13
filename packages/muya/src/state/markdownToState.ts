import type { Token, Tokens, TokensList } from 'marked';
import type { CriticMarkupAnalysis } from '../criticMarkup/analysis';
import type {
    ICriticMarkupInlineLeaf,
    ICriticMarkupLocatedInlineToken,
} from '../utils/marked/locatedMarkdown';
import type { TMarkdownStatePath } from './markdownSourceMap';
import type {
    TBlockToken,
    TLexedToken,
} from '../utils/marked/types';
import type { TParserResidueToken } from './parserResidueNewlines';
import type {
    IAtxHeadingState,
    IBulletListState,
    ICriticMarkupStateMarker,
    IStateSourceTrivia,
    IListItemState,
    IOrderListState,
    ISetextHeadingState,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    TState,
} from './types';
import { firstWordOfInfo } from '../utils';
import logger from '../utils/logger';
import { lexBlock } from '../utils/marked/lexBlock';
import {
    parserResidueTerminalNewlines,
} from './parserResidueNewlines';
import { markdownStatePath } from './markdownSourceMap';
import { isAnyListState } from './types';

const debug = logger('import markdown: ');

interface IMarkdownToStateOptions {
    footnote: boolean;
    math: boolean;
    isGitlabCompatibilityEnabled: boolean;
    trimUnnecessaryCodeBlockEmptyLines: boolean;
    frontMatter: boolean;
    superSubScript?: boolean;
};

export interface IMarkdownToStateResult {
    readonly states: TState[];
    readonly criticMarkup: Tokens.CriticMarkupDocument | null;
    readonly criticMarkupAnalysis: CriticMarkupAnalysis | null;
    /** Immutable parser bindings valid only for this generated state revision. */
    readonly criticMarkupBindings: ICriticMarkupStateBindingGraph;
}

export interface ICriticMarkupBindingRange {
    readonly start: number;
    readonly end: number;
}

interface ICriticMarkupBlockStateBindingBase {
    /** Produced Muya state path in this result's immutable parse revision. */
    readonly path: TMarkdownStatePath;
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupBoundaryAttachment['role'];
    /** Canonical source envelope owned by the native fragment. */
    readonly sourceRange: ICriticMarkupBindingRange;
    /** Semantic content range relative to `sourceRange.start`. */
    readonly localRange: ICriticMarkupBindingRange;
}

export interface ICriticMarkupBlockContentStateBinding
    extends ICriticMarkupBlockStateBindingBase {
    readonly kind: 'content';
}

export interface ICriticMarkupBlockBoundaryStateBinding
    extends ICriticMarkupBlockStateBindingBase {
    readonly kind: 'boundary';
    readonly edge: Tokens.CriticMarkupBoundaryAttachment['edge'];
}

export type TCriticMarkupBlockStateBinding
    = | ICriticMarkupBlockContentStateBinding
        | ICriticMarkupBlockBoundaryStateBinding;

interface ICriticMarkupInlineStateBindingBase {
    /** Produced formattable leaf path in this parse revision. */
    readonly path: TMarkdownStatePath;
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    /** Actual UTF-16 envelope in the produced state's `text` leaf. */
    readonly localRange: ICriticMarkupBindingRange;
    /** Canonical source envelope owned by the native inline fragment. */
    readonly sourceRange: ICriticMarkupBindingRange;
}

export interface ICriticMarkupInlineMarkerStateBindingSegment {
    readonly kind: 'marker';
    readonly marker: Tokens.CriticMarkupMarker['name'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
}

export interface ICriticMarkupInlineContentStateBindingSegment {
    readonly kind: 'content';
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
}

export type TCriticMarkupInlineStateBindingSegment
    = | ICriticMarkupInlineMarkerStateBindingSegment
        | ICriticMarkupInlineContentStateBindingSegment;

export interface ICriticMarkupInlineStateBinding
    extends ICriticMarkupInlineStateBindingBase {
    readonly segments: readonly TCriticMarkupInlineStateBindingSegment[];
}

/**
 * Parser-owned CriticMarkup-to-state topology for one generated revision.
 * Inline bindings will be a separate graph member rather than widening block
 * bindings with leaf-only concepts.
 */
export interface ICriticMarkupStateBindingGraph {
    readonly block: readonly TCriticMarkupBlockStateBinding[];
    readonly inline: readonly ICriticMarkupInlineStateBinding[];
}

type TPendingCriticMarkupBlockBinding
    = | {
        readonly kind: 'content';
        readonly state: TState;
        readonly fragment: Tokens.CriticMarkupFragment;
    }
        | {
            readonly kind: 'boundary';
            readonly state: TState;
            readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
        };

interface ICriticMarkupInlineStateBindingDraft {
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
    readonly segments: readonly TCriticMarkupInlineStateBindingSegment[];
}

interface TPendingCriticMarkupInlineBinding {
    readonly state: TState;
    readonly binding: ICriticMarkupInlineStateBindingDraft;
}

interface ILoweredNativeInlineSource {
    readonly text: string;
    readonly bindings: readonly ICriticMarkupInlineStateBindingDraft[];
}

const DEFAULT_OPTIONS = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
    superSubScript: true,
};

// Token types whose handler manipulates the `parentList` stack (push a
// container and recurse via synthetic `block-end`), as opposed to the leaf
// tokens that only append a state to the current level.
const CONTAINER_TOKEN_TYPES = new Set([
    'block-end',
    'blockquote',
    'list',
    'list_item',
    'footnote',
    'critic-fragment-end',
    'critic-boundary-end',
    'critic_addition',
    'critic_deletion',
    'critic_substitution',
    'critic_highlight',
    'critic_comment',
]);

function criticStateType(
    type: Tokens.CriticMarkupFragment['type'],
): ICriticMarkupStateMarker['type'] {
    switch (type) {
        case 'critic_addition': return 'addition';
        case 'critic_deletion': return 'deletion';
        case 'critic_substitution': return 'substitution';
        case 'critic_highlight': return 'highlight';
        case 'critic_comment': return 'comment';
        default: return unexpectedCriticFragment(type);
    }
}

function unexpectedCriticFragment(value: never): never {
    throw new TypeError(`Unknown native CriticMarkup fragment: ${String(value)}.`);
}

function attachCriticMarkers(
    state: TState,
    edge: 'before' | 'after',
    fragment: Tokens.CriticMarkupFragment,
    markers: readonly Tokens.CriticMarkupMarker[],
): void {
    if (!markers.length)
        return;
    const key = edge === 'before' ? 'criticBefore' : 'criticAfter';
    const existing = state.sourceTrivia?.[key] ?? [];
    const attached: ICriticMarkupStateMarker[] = markers.map(value => ({
        type: criticStateType(fragment.type),
        marker: value.name,
        raw: value.raw,
        sourceOffset: value.range.start,
    }));
    (state as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
        ...state.sourceTrivia,
        [key]: [...existing, ...attached],
    };
}

function criticBoundaryStateType(
    type: Tokens.CriticMarkupType,
): ICriticMarkupStateMarker['type'] {
    switch (type) {
        case 'addition':
        case 'deletion':
        case 'substitution':
        case 'highlight':
        case 'comment':
            return type;
        default:
            return unexpectedCriticBoundaryType(type);
    }
}

function unexpectedCriticBoundaryType(value: never): never {
    throw new TypeError(`Unknown native CriticMarkup boundary: ${String(value)}.`);
}

function attachCriticBoundaryAttachments(
    state: TState,
    edge: 'before' | 'after',
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): void {
    if (!attachments.length)
        return;
    const key = edge === 'before' ? 'criticBefore' : 'criticAfter';
    const existing = state.sourceTrivia?.[key] ?? [];
    const markers = attachments.flatMap(attachment =>
        attachment.markers.map(marker => ({
            type: criticBoundaryStateType(attachment.criticType),
            marker: marker.name,
            raw: marker.raw,
            sourceOffset: marker.range.start,
        })));
    (state as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
        ...state.sourceTrivia,
        [key]: [...existing, ...markers],
    };
}

function criticBoundaryTrivia(
    edge: 'before' | 'after',
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): string {
    const trivia = new Map<string, string>();
    for (const attachment of attachments) {
        if (!/^\s*$/.test(attachment.trivia.raw)) {
            throw new TypeError(
                'Native CriticMarkup boundary trivia contains semantic source.',
            );
        }
        if (!attachment.trivia.raw)
            continue;
        if (attachment.edge !== edge) {
            throw new TypeError(
                `Native CriticMarkup ${edge} boundary has ${attachment.edge} trivia.`,
            );
        }
        const key = `${attachment.trivia.range.start}:${attachment.trivia.range.end}`;
        const existing = trivia.get(key);
        if (existing !== undefined && existing !== attachment.trivia.raw) {
            throw new TypeError(
                'Native CriticMarkup boundary trivia range has conflicting source.',
            );
        }
        trivia.set(key, attachment.trivia.raw);
    }
    if (trivia.size > 1) {
        throw new TypeError(
            'Native CriticMarkup boundary has multiple displaced trivia ranges.',
        );
    }
    return trivia.values().next().value ?? '';
}

function criticBoundaryFollowingTrivia(
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): string {
    const trivia = new Map<string, string>();
    for (const attachment of attachments) {
        if (!/^\s*$/.test(attachment.followingTrivia.raw)) {
            throw new TypeError(
                'Native CriticMarkup following boundary trivia contains semantic source.',
            );
        }
        if (!attachment.followingTrivia.raw)
            continue;
        const key = `${attachment.followingTrivia.range.start}:${attachment.followingTrivia.range.end}`;
        const existing = trivia.get(key);
        if (
            existing !== undefined
            && existing !== attachment.followingTrivia.raw
        ) {
            throw new TypeError(
                'Native CriticMarkup following trivia range has conflicting source.',
            );
        }
        trivia.set(key, attachment.followingTrivia.raw);
    }
    if (trivia.size > 1) {
        throw new TypeError(
            'Native CriticMarkup boundary has multiple following trivia ranges.',
        );
    }
    return trivia.values().next().value ?? '';
}

function attachCriticBoundaryTrivia(
    owner: TState,
    markerState: TState,
    edge: 'before' | 'after',
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): void {
    if (!attachments.length)
        return;
    const trivia = criticBoundaryTrivia(edge, attachments);
    if (!trivia && edge === 'before')
        return;

    if (edge === 'before') {
        const prefix = owner.sourceTrivia?.blockPrefix;
        if (prefix === undefined) {
            // Container syntax such as list indentation is already inside the
            // native node's mapped range, so marker weaving preserves it.
            return;
        }
        if (!prefix.endsWith(trivia)) {
            throw new TypeError(
                'Native CriticMarkup before-boundary trivia is not a block-prefix suffix.',
            );
        }
        const existing = markerState.sourceTrivia?.criticBeforeSuffix;
        if (existing !== undefined && existing !== trivia) {
            throw new TypeError(
                'Native CriticMarkup before-boundary trivia conflicts on its state.',
            );
        }
        (owner as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...owner.sourceTrivia,
            blockPrefix: prefix.slice(0, -trivia.length) || undefined,
        };
        (markerState as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...markerState.sourceTrivia,
            criticBeforeSuffix: trivia,
        };
        return;
    }

    const followingTrivia = criticBoundaryFollowingTrivia(attachments);
    const separator = owner.sourceTrivia?.blockSeparatorAfter;
    if (
        separator !== undefined
        && !`${trivia}${followingTrivia}`.endsWith(separator)
    ) {
        throw new TypeError(
            'Native CriticMarkup after-boundary trivia does not own its block separator.',
        );
    }
    const existing = markerState.sourceTrivia?.criticAfterPrefix;
    if (existing !== undefined && existing !== trivia) {
        throw new TypeError(
            'Native CriticMarkup after-boundary trivia conflicts on its state.',
        );
    }
    const existingSuffix = markerState.sourceTrivia?.criticAfterSuffix;
    if (
        existingSuffix !== undefined
        && existingSuffix !== followingTrivia
    ) {
        throw new TypeError(
            'Native CriticMarkup following trivia conflicts on its state.',
        );
    }
    (owner as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
        ...owner.sourceTrivia,
        blockSeparatorAfter: undefined,
    };
    (markerState as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
        ...markerState.sourceTrivia,
        criticAfterPrefix: trivia,
        criticAfterSuffix: followingTrivia,
    };
}

function attachCriticBlockSeparator(
    state: TState,
    fragment: Tokens.CriticMarkupFragment,
): void {
    if (!fragment.raw.startsWith(fragment.fragmentRaw)) {
        throw new TypeError(
            'Native CriticMarkup token raw detached from its fragment envelope.',
        );
    }
    const suffix = fragment.raw.slice(fragment.fragmentRaw.length);
    if (suffix && !/^[ \t\r\n]+$/.test(suffix)) {
        throw new TypeError(
            'Native CriticMarkup fragment suffix contains semantic source.',
        );
    }
    if (!suffix && !fragment.suppressBlockSeparatorAfter)
        return;
    const existing = state.sourceTrivia?.blockSeparatorAfter;
    if (existing !== undefined) {
        if (existing === suffix || suffix === '')
            return;
        if (existing === '') {
            (state as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
                ...state.sourceTrivia,
                blockSeparatorAfter: suffix,
            };
            return;
        }
        throw new TypeError(
            'Nested native CriticMarkup fragments disagree on block separator ownership.',
        );
    }
    (state as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
        ...state.sourceTrivia,
        blockSeparatorAfter: suffix,
    };
}

function criticMarkerBoundaryState(
    state: TState,
    edge: 'before' | 'after',
): TState {
    if (!isAnyListState(state) || !state.children.length)
        return state;
    return edge === 'before' ? state.children[0] : state.children.at(-1)!;
}

function immutableCriticBindingRange(
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
            'Native CriticMarkup state binding has an invalid range.',
        );
    }
    return Object.freeze({ start, end });
}

function fragmentLocalRange(
    fragment: Tokens.CriticMarkupFragment,
): ICriticMarkupBindingRange {
    if (
        fragment.contentRange.start < fragment.range.start
        || fragment.range.end < fragment.contentRange.end
    ) {
        throw new RangeError(
            'Native CriticMarkup content range escapes its fragment envelope.',
        );
    }
    return immutableCriticBindingRange(
        fragment.contentRange.start - fragment.range.start,
        fragment.contentRange.end - fragment.range.start,
    );
}

function boundaryLocalRange(
    attachment: Tokens.CriticMarkupBoundaryAttachment,
): ICriticMarkupBindingRange {
    const open = attachment.markers.find(marker => marker.name === 'open');
    const offset = (open?.range.end ?? attachment.range.start)
        - attachment.range.start;
    if (offset < 0 || attachment.range.end - attachment.range.start < offset) {
        throw new RangeError(
            'Native CriticMarkup boundary marker escapes its source envelope.',
        );
    }
    return immutableCriticBindingRange(offset, offset);
}

function statePathIndex(
    states: readonly TState[],
): WeakMap<TState, TMarkdownStatePath> {
    const paths = new WeakMap<TState, TMarkdownStatePath>();
    const visit = (
        children: readonly TState[],
        parentPath: readonly (string | number)[],
    ): void => {
        children.forEach((state, index) => {
            if (paths.has(state)) {
                throw new TypeError(
                    'Generated Markdown state appears at more than one path.',
                );
            }
            const path = markdownStatePath([...parentPath, index]);
            paths.set(state, path);
            if ('children' in state) {
                visit(
                    state.children as readonly TState[],
                    [...path, 'children'],
                );
            }
        });
    };
    visit(states, []);
    return paths;
}

function compareStatePaths(
    left: TMarkdownStatePath,
    right: TMarkdownStatePath,
): number {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const leftPart = left[index];
        const rightPart = right[index];
        if (leftPart === rightPart)
            continue;
        if (typeof leftPart === 'number' && typeof rightPart === 'number')
            return leftPart - rightPart;
        return String(leftPart).localeCompare(String(rightPart));
    }
    return left.length - right.length;
}

function finalizeCriticMarkupStateBindings(
    states: readonly TState[],
    pendingBlock: readonly TPendingCriticMarkupBlockBinding[],
    pendingInline: readonly TPendingCriticMarkupInlineBinding[],
): ICriticMarkupStateBindingGraph {
    if (!pendingBlock.length && !pendingInline.length) {
        return Object.freeze({
            block: Object.freeze([]),
            inline: Object.freeze([]),
        });
    }
    const paths = statePathIndex(states);
    const block = pendingBlock.map((binding): TCriticMarkupBlockStateBinding => {
        const path = paths.get(binding.state);
        if (!path) {
            throw new TypeError(
                'Native CriticMarkup binding refers to no generated state path.',
            );
        }
        if (binding.kind === 'boundary') {
            const { attachment } = binding;
            return Object.freeze({
                kind: 'boundary',
                path,
                itemId: attachment.itemId,
                criticType: attachment.criticType,
                arm: attachment.arm,
                role: attachment.role,
                edge: attachment.edge,
                sourceRange: immutableCriticBindingRange(
                    attachment.range.start,
                    attachment.range.end,
                ),
                localRange: boundaryLocalRange(attachment),
            });
        }
        const { fragment } = binding;
        if (fragment.level !== 'block') {
            throw new TypeError(
                'Inline CriticMarkup fragment entered the block state binding graph.',
            );
        }
        return Object.freeze({
            kind: 'content',
            path,
            itemId: fragment.itemId,
            criticType: criticStateType(fragment.type),
            arm: fragment.arm,
            role: fragment.role,
            sourceRange: immutableCriticBindingRange(
                fragment.range.start,
                fragment.range.end,
            ),
            localRange: fragmentLocalRange(fragment),
        });
    });
    block.sort((left, right) =>
        left.sourceRange.start - right.sourceRange.start
        || right.sourceRange.end - left.sourceRange.end
        || compareStatePaths(left.path, right.path));
    const inline = pendingInline.map((pending): ICriticMarkupInlineStateBinding => {
        const statePath = paths.get(pending.state);
        if (!statePath || !('text' in pending.state)) {
            throw new TypeError(
                'Native inline CriticMarkup binding refers to no generated text path.',
            );
        }
        const text = pending.state.text;
        const binding = pending.binding;
        if (
            typeof text !== 'string'
            || text.length < binding.localRange.end
            || binding.segments.length === 0
        ) {
            throw new RangeError(
                'Native inline CriticMarkup binding escapes its produced text leaf.',
            );
        }
        let previous: TCriticMarkupInlineStateBindingSegment | undefined;
        const segments = binding.segments.map((segment) => {
            if (
                segment.localRange.start < binding.localRange.start
                || binding.localRange.end < segment.localRange.end
                || segment.sourceRange.start < binding.sourceRange.start
                || binding.sourceRange.end < segment.sourceRange.end
                || segment.localRange.end - segment.localRange.start
                !== segment.sourceRange.end - segment.sourceRange.start
                || (
                    previous
                    && (
                        segment.localRange.start < previous.localRange.end
                        || segment.sourceRange.start < previous.sourceRange.end
                    )
                )
            ) {
                throw new RangeError(
                    'Native inline CriticMarkup binding has invalid segment ranges.',
                );
            }
            const frozen = Object.freeze({
                ...segment,
                localRange: immutableCriticBindingRange(
                    segment.localRange.start,
                    segment.localRange.end,
                ),
                sourceRange: immutableCriticBindingRange(
                    segment.sourceRange.start,
                    segment.sourceRange.end,
                ),
            }) as TCriticMarkupInlineStateBindingSegment;
            previous = frozen;
            return frozen;
        });
        return Object.freeze({
            path: markdownStatePath([...statePath, 'text']),
            itemId: binding.itemId,
            criticType: binding.criticType,
            arm: binding.arm,
            role: binding.role,
            localRange: immutableCriticBindingRange(
                binding.localRange.start,
                binding.localRange.end,
            ),
            sourceRange: immutableCriticBindingRange(
                binding.sourceRange.start,
                binding.sourceRange.end,
            ),
            segments: Object.freeze(segments),
        });
    });
    inline.sort((left, right) =>
        left.sourceRange.start - right.sourceRange.start
        || right.sourceRange.end - left.sourceRange.end
        || compareStatePaths(left.path, right.path)
        || left.localRange.start - right.localRange.start
        || left.localRange.end - right.localRange.end);
    return Object.freeze({
        block: Object.freeze(block),
        inline: Object.freeze(inline),
    });
}

function prependTokens(
    target: TBlockToken[],
    values: readonly TBlockToken[],
): void {
    const originalLength = target.length;
    const addedLength = values.length;
    target.length = originalLength + addedLength;
    for (let index = originalLength - 1; index >= 0; index--)
        target[index + addedLength] = target[index];
    for (let index = 0; index < addedLength; index++)
        target[index] = values[index];
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
        if (Array.isArray(children))
            pending.push(...children);
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
                .marker.raw.length;
            sourceInsertionIndex++;
        }
        const localStart = piece.localStart + insertedLength;
        while (
            sourceInsertionIndex < sourceOrderedInsertions.length
            && sourceOrderedInsertions[sourceInsertionIndex].marker.range.end
            <= piece.sourceEnd
        ) {
            insertedLength += sourceOrderedInsertions[sourceInsertionIndex]
                .marker.raw.length;
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
    for (const marker of fragment.before) {
        segments.push(...bindingSegmentsForSourceRange(
            pieces,
            marker.range,
            { kind: 'marker', marker: marker.name },
        ));
    }
    if (fragment.contentRange.start < fragment.contentRange.end) {
        segments.push(...bindingSegmentsForSourceRange(
            pieces,
            fragment.contentRange,
            { kind: 'content', arm: fragment.arm },
        ));
    }
    for (const marker of fragment.after) {
        segments.push(...bindingSegmentsForSourceRange(
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
function nativeInlineCriticSource(
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

function appendPendingInlineBindings(
    pending: TPendingCriticMarkupInlineBinding[],
    state: TState,
    lowered: ILoweredNativeInlineSource,
    localOffset = 0,
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
        pending.push({
            state,
            binding: {
                ...binding,
                localRange: immutableCriticBindingRange(
                    binding.localRange.start + localOffset,
                    binding.localRange.end + localOffset,
                ),
                segments: binding.segments.map(segment => ({
                    ...segment,
                    localRange: immutableCriticBindingRange(
                        segment.localRange.start + localOffset,
                        segment.localRange.end + localOffset,
                    ),
                })),
            },
        });
    }
}

export class MarkdownToState {
    constructor(private _options: IMarkdownToStateOptions = DEFAULT_OPTIONS) {}

    generate(markdown: string): TState[] {
        return this.generateWithMetadata(markdown).states;
    }

    generateWithMetadata(markdown: string): IMarkdownToStateResult {
        const {
            states,
            criticMarkup,
            criticMarkupAnalysis,
            criticMarkupBindings,
        } = this._convertMarkdownToState(markdown);
        const terminalLineEnding = markdown.endsWith('\r\n')
            ? '\r\n'
            : markdown.endsWith('\n') ? '\n' : '';
        const finalState = states.at(-1);
        if (!finalState) {
            throw new TypeError(
                'Markdown parser produced no state for terminal EOL ownership.',
            );
        }
        (finalState as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...finalState.sourceTrivia,
            terminalLineEnding,
        };
        return Object.freeze({
            states,
            criticMarkup,
            criticMarkupAnalysis,
            criticMarkupBindings,
        });
    }

    private _convertMarkdownToState(markdown: string): IMarkdownToStateResult {
        const {
            footnote = false,
            math = true,
            isGitlabCompatibilityEnabled = true,
            trimUnnecessaryCodeBlockEmptyLines = false,
            frontMatter = true,
            superSubScript = true,
        } = this._options;

        // markdownToState injects synthetic `block-end` markers (see the
        // blockquote/list/list_item/footnote cases below) to pop the parent
        // stack, so the working stream is wider than what `lexBlock` returns.
        const lexedTokens = lexBlock(markdown, {
            footnote,
            math,
            frontMatter,
            superSubScript,
            isGitlabCompatibilityEnabled,
        }) as TLexedToken[] & Pick<
            TokensList,
            'criticMarkup' | 'criticMarkupUnanchored'
        > & {
            criticMarkupDocument?: import('../criticMarkup/document')
                .CriticMarkupDocument;
            criticMarkupInlineLeaves: readonly ICriticMarkupInlineLeaf[];
        };
        const residueNewlines = parserResidueTerminalNewlines(lexedTokens);
        const inlineLeavesByTokens = new WeakMap<
            readonly Token[],
            ICriticMarkupInlineLeaf
        >();
        for (const leaf of lexedTokens.criticMarkupInlineLeaves) {
            if (inlineLeavesByTokens.has(leaf.tokens)) {
                throw new TypeError(
                    'Located Markdown inline token owner appears more than once.',
                );
            }
            inlineLeavesByTokens.set(leaf.tokens, leaf);
        }
        const tokens: TBlockToken[] = [...lexedTokens];
        if (lexedTokens.criticMarkupUnanchored.length) {
            if (lexedTokens.some(candidate => candidate.type !== 'space')) {
                throw new TypeError(
                    'Native CriticMarkup boundary did not bind to a parser token.',
                );
            }
            tokens.push({
                type: 'critic-boundary-end',
                startIndex: 0,
                before: lexedTokens.criticMarkupUnanchored,
                after: [],
            });
        }

        const states: TState[] = [];
        const pendingCriticMarkupBlockBindings:
            TPendingCriticMarkupBlockBinding[] = [];
        const pendingCriticMarkupInlineBindings:
            TPendingCriticMarkupInlineBinding[] = [];
        let token: TBlockToken | undefined;
        const parentList: TState[][] = [states];
        const pendingBlockPrefixes = new WeakMap<TState[], string>();

        // eslint-disable-next-line no-cond-assign
        while ((token = tokens.shift())) {
            const targetStates = parentList[0];
            if (!targetStates) {
                throw new TypeError(
                    'Markdown parser token has no active state parent.',
                );
            }
            if (token.type === 'space') {
                this._captureBlockSpacing(
                    token.raw,
                    targetStates,
                    pendingBlockPrefixes,
                );
                continue;
            }

            const carrier = token as Partial<Tokens.CriticMarkupBoundaryCarrier>;
            const boundaryBefore = carrier.criticMarkupBefore ?? [];
            const boundaryAfter = carrier.criticMarkupAfter ?? [];
            if (boundaryBefore.length || boundaryAfter.length) {
                let boundaryIndex = 0;
                if (boundaryAfter.length) {
                    while (tokens[boundaryIndex]?.type === 'space')
                        boundaryIndex++;
                }
                tokens.splice(boundaryIndex, 0, {
                    type: 'critic-boundary-end',
                    startIndex: targetStates.length,
                    before: boundaryBefore,
                    after: boundaryAfter,
                });
            }

            const previousLength = targetStates.length;
            if (CONTAINER_TOKEN_TYPES.has(token.type)) {
                this._handleContainerToken(
                    token,
                    parentList,
                    tokens,
                    pendingCriticMarkupBlockBindings,
                );
            }
            else {
                this._handleLeafToken(
                    token,
                    parentList,
                    tokens,
                    trimUnnecessaryCodeBlockEmptyLines,
                    residueNewlines,
                    inlineLeavesByTokens,
                    pendingCriticMarkupInlineBindings,
                );
            }

            if (
                token.type === 'block-end'
                && targetStates.length === previousLength
                && pendingBlockPrefixes.has(targetStates)
            ) {
                targetStates.push({ name: 'paragraph', text: '' });
            }
            if (targetStates.length > previousLength) {
                this._attachPendingBlockPrefix(
                    targetStates[previousLength],
                    targetStates,
                    pendingBlockPrefixes,
                    token.type === 'block-end',
                );
            }
        }

        if (!states.length) {
            const fallback: TState = { name: 'paragraph', text: '' };
            states.push(fallback);
            this._attachPendingBlockPrefix(
                fallback,
                states,
                pendingBlockPrefixes,
                true,
            );
        }
        return {
            states,
            criticMarkup: lexedTokens.criticMarkup,
            criticMarkupAnalysis:
                lexedTokens.criticMarkupDocument?.analysis ?? null,
            criticMarkupBindings: finalizeCriticMarkupStateBindings(
                states,
                pendingCriticMarkupBlockBindings,
                pendingCriticMarkupInlineBindings,
            ),
        };
    }

    private _captureBlockSpacing(
        raw: string,
        states: TState[],
        pendingPrefixes: WeakMap<TState[], string>,
    ): void {
        if (!/^[ \t\r\n]+$/.test(raw)) {
            throw new TypeError(
                'Markdown parser space token contains non-whitespace bytes.',
            );
        }
        const previous = states.at(-1);
        if (!previous) {
            if (pendingPrefixes.has(states)) {
                throw new TypeError(
                    'Markdown parser emitted consecutive leading space tokens.',
                );
            }
            pendingPrefixes.set(states, raw);
            return;
        }
        if (!raw.startsWith('\n')) {
            // Marked trims the final empty list item's padding/EOL from the
            // list token and reports those already-serialized bytes as a
            // trailing space token (for example `" \\n"`). List-item source
            // syntax and the block's terminal LF already own that spelling;
            // it is not an interblock separator.
            if (isAnyListState(previous))
                return;
            throw new TypeError(
                'Markdown parser interblock space token has no prior block LF.',
            );
        }
        if (previous.sourceTrivia?.blockSeparatorAfter !== undefined) {
            throw new TypeError(
                'Markdown parser emitted consecutive interblock space tokens.',
            );
        }
        (previous as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...previous.sourceTrivia,
            blockSeparatorAfter: raw.slice(1),
        };
    }

    private _attachPendingBlockPrefix(
        state: TState,
        parentStates: TState[],
        pendingPrefixes: WeakMap<TState[], string>,
        syntheticEmptyBlock: boolean,
    ): void {
        const pending = pendingPrefixes.get(parentStates);
        if (pending === undefined)
            return;
        pendingPrefixes.delete(parentStates);
        if (state.sourceTrivia?.blockPrefix !== undefined) {
            throw new TypeError(
                'Markdown state already owns a parser block prefix.',
            );
        }
        const blockPrefix = syntheticEmptyBlock && pending.endsWith('\n')
            ? pending.slice(0, -1)
            : pending;
        (state as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...state.sourceTrivia,
            blockPrefix,
        };
    }

    private _handleContainerToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
        pendingCriticMarkupBlockBindings:
            TPendingCriticMarkupBlockBinding[],
    ) {
        let state: TState;
        switch (token.type) {
            // Marks the end of the children's traversal and a return to the previous level
            case 'block-end': {
                // Fix #1735 the blockquote maybe empty. like bellow:
                // >
                // bar
                if (
                    parentList[0].length === 0
                    && (token.tokenType === 'blockquote' || token.tokenType === 'list-item')
                ) {
                    state = {
                        name: 'paragraph' as const,
                        text: '',
                    };
                    parentList[0].push(state);
                }
                parentList.shift();
                break;
            }

            case 'critic_addition':
            case 'critic_deletion':
            case 'critic_substitution':
            case 'critic_highlight':
            case 'critic_comment': {
                tokens.unshift({
                    type: 'critic-fragment-end',
                    fragment: token,
                    startIndex: parentList[0].length,
                });
                prependTokens(tokens, token.tokens as TBlockToken[]);
                break;
            }

            case 'critic-fragment-end': {
                const target = parentList[0];
                if (target.length === token.startIndex) {
                    target.push({
                        name: 'paragraph',
                        text: '',
                    });
                }
                const first = target[token.startIndex];
                const last = target.at(-1);
                if (!first || !last) {
                    throw new TypeError(
                        'Native CriticMarkup fragment produced no state boundary.',
                    );
                }
                const firstMarkerState = criticMarkerBoundaryState(
                    first,
                    'before',
                );
                const lastMarkerState = criticMarkerBoundaryState(
                    last,
                    'after',
                );
                if (token.fragment.fragmentKind === 'boundary') {
                    attachCriticMarkers(
                        firstMarkerState,
                        'before',
                        token.fragment,
                        [
                            ...token.fragment.before,
                            ...token.fragment.after,
                        ],
                    );
                }
                else {
                    attachCriticMarkers(
                        firstMarkerState,
                        'before',
                        token.fragment,
                        token.fragment.before,
                    );
                    attachCriticMarkers(
                        lastMarkerState,
                        'after',
                        token.fragment,
                        token.fragment.after,
                    );
                }
                const contentSuffix = last.sourceTrivia
                    ?.blockSeparatorAfter;
                if (
                    contentSuffix
                    && token.fragment.after.length
                ) {
                    (lastMarkerState as {
                        sourceTrivia?: IStateSourceTrivia;
                    }).sourceTrivia = {
                        ...lastMarkerState.sourceTrivia,
                        criticAfterPrefix: contentSuffix,
                    };
                    (last as { sourceTrivia?: IStateSourceTrivia })
                        .sourceTrivia = {
                            ...last.sourceTrivia,
                            blockSeparatorAfter: undefined,
                        };
                }
                attachCriticBlockSeparator(last, token.fragment);
                if (token.fragment.fragmentKind !== 'content') {
                    throw new TypeError(
                        'Zero-width block CriticMarkup must lower through a boundary attachment.',
                    );
                }
                for (const producedState of target.slice(token.startIndex)) {
                    pendingCriticMarkupBlockBindings.push({
                        kind: 'content',
                        state: producedState,
                        fragment: token.fragment,
                    });
                }
                break;
            }

            case 'critic-boundary-end': {
                const target = parentList[0];
                if (target.length === token.startIndex) {
                    target.push({
                        name: 'paragraph',
                        text: '',
                    });
                }
                const first = target[token.startIndex];
                const last = target.at(-1);
                if (!first || !last) {
                    throw new TypeError(
                        'Native CriticMarkup boundary produced no state anchor.',
                    );
                }
                const firstMarkerState = criticMarkerBoundaryState(
                    first,
                    'before',
                );
                attachCriticBoundaryTrivia(
                    first,
                    firstMarkerState,
                    'before',
                    token.before,
                );
                attachCriticBoundaryAttachments(
                    firstMarkerState,
                    'before',
                    token.before,
                );
                for (const attachment of token.before) {
                    pendingCriticMarkupBlockBindings.push({
                        kind: 'boundary',
                        state: firstMarkerState,
                        attachment,
                    });
                }
                const lastMarkerState = criticMarkerBoundaryState(
                    last,
                    'after',
                );
                attachCriticBoundaryTrivia(
                    last,
                    lastMarkerState,
                    'after',
                    token.after,
                );
                attachCriticBoundaryAttachments(
                    lastMarkerState,
                    'after',
                    token.after,
                );
                for (const attachment of token.after) {
                    pendingCriticMarkupBlockBindings.push({
                        kind: 'boundary',
                        state: lastMarkerState,
                        attachment,
                    });
                }
                break;
            }

            case 'blockquote': {
                state = {
                    name: 'block-quote' as const,
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'blockquote' });
                prependTokens(tokens, token.tokens as TBlockToken[]);
                break;
            }

            case 'list': {
                const { listType, loose, start } = token;
                const bulletMarkerOrDelimiter
                    = token.items[0].bulletMarkerOrDelimiter;

                let listState: IOrderListState | IBulletListState | ITaskListState;
                if (listType === 'order') {
                    listState = {
                        name: 'order-list',
                        meta: {
                            loose,
                            start: /^\d+$/.test(String(start)) ? Number(start) : 1,
                            delimiter: bulletMarkerOrDelimiter || '.',
                        },
                        children: [],
                    };
                }
                else if (listType === 'task') {
                    listState = {
                        name: 'task-list',
                        meta: {
                            loose,
                            marker: bulletMarkerOrDelimiter || '-',
                        },
                        children: [],
                    };
                }
                else {
                    listState = {
                        name: 'bullet-list',
                        meta: {
                            loose,
                            marker: bulletMarkerOrDelimiter || '-',
                        },
                        children: [],
                    };
                }

                if (token.suppressBlockSeparatorAfter) {
                    (listState as { sourceTrivia?: IStateSourceTrivia })
                        .sourceTrivia = { blockSeparatorAfter: '' };
                }
                state = listState;
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list' });
                prependTokens(tokens, token.items as TBlockToken[]);
                break;
            }

            case 'list_item': {
                const { listItemType, checked } = token;
                let itemState: IListItemState | ITaskListItemState;
                if (listItemType === 'task') {
                    itemState = {
                        name: 'task-list-item',
                        meta: { checked: Boolean(checked) },
                        children: [],
                        sourceTrivia: {
                            listItemLeadingPrefix: token.leadingPrefix,
                            listItemMarker: token.marker,
                            listItemMarkerPadding: token.markerPadding,
                            listItemTrailingBlankLines:
                                token.trailingBlankLines,
                            listItemContinuationPrefixes:
                                token.continuationPrefixes,
                        },
                    };
                }
                else {
                    itemState = {
                        name: 'list-item',
                        children: [],
                        sourceTrivia: {
                            listItemLeadingPrefix: token.leadingPrefix,
                            listItemMarker: token.marker,
                            listItemMarkerPadding: token.markerPadding,
                            listItemTrailingBlankLines:
                                token.trailingBlankLines,
                            listItemContinuationPrefixes:
                                token.continuationPrefixes,
                        },
                    };
                }

                state = itemState;
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list-item' });
                prependTokens(tokens, token.tokens as TBlockToken[]);
                break;
            }

            case 'footnote': {
                // The footnote extension (utils/marked/extensions/footnote.ts)
                // emits a parent token whose `tokens` array holds nested
                // block tokens. Mirror that into a `footnote` container
                // state and recurse via tokens.unshift / block-end.
                const { identifier } = token;
                state = {
                    name: 'footnote' as const,
                    meta: { identifier },
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'footnote' });
                prependTokens(tokens, token.tokens as TBlockToken[]);
                break;
            }
        }
    }

    private _handleLeafToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
        trimUnnecessaryCodeBlockEmptyLines: boolean,
        residueNewlines: WeakMap<TParserResidueToken, boolean>,
        inlineLeavesByTokens: WeakMap<
            readonly Token[],
            ICriticMarkupInlineLeaf
        >,
        pendingInlineBindings: TPendingCriticMarkupInlineBinding[],
    ) {
        let state: TState;
        let value: string;
        switch (token.type) {
            case 'frontmatter': {
                const { lang, style, text } = token;
                value = text.replace(/^\s+/, '').replace(/\s$/, '');

                state = {
                    name: 'frontmatter' as const,
                    meta: {
                        lang,
                        style,
                    },
                    text: value,
                };

                parentList[0].push(state);
                break;
            }

            case 'hr': {
                state = {
                    name: 'thematic-break' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };

                parentList[0].push(state);
                break;
            }

            case 'heading': {
                const { headingStyle, depth, text, marker } = token;
                const inlineSource = nativeInlineCriticSource(
                    token.tokens,
                    text,
                    inlineLeavesByTokens,
                );
                value = headingStyle === 'atx'
                    ? `${'#'.repeat(+depth)} ${inlineSource.text}`
                    : inlineSource.text;

                if (headingStyle === 'atx') {
                    const atxState: IAtxHeadingState = {
                        name: 'atx-heading',
                        meta: { level: depth },
                        text: value,
                    };
                    state = atxState;
                }
                else {
                    const setextState: ISetextHeadingState = {
                        name: 'setext-heading',
                        meta: { level: depth, underline: marker },
                        text: value,
                    };
                    state = setextState;
                }

                parentList[0].push(state);
                appendPendingInlineBindings(
                    pendingInlineBindings,
                    state,
                    inlineSource,
                    headingStyle === 'atx' ? +depth + 1 : 0,
                );
                break;
            }

            case 'code': {
                const { codeBlockStyle, text, lang: infoString = '', raw = '' } = token;
                // marked >=17 appends a trailing newline to indented code text
                // (fenced text has none); strip it so indented blocks round-trip.
                const codeText = codeBlockStyle === 'indented' ? text.replace(/\n$/, '') : text;
                const fenceLength = /^ {0,3}([`~]{3,})/.exec(raw)?.[1].length;
                parentList[0].push(
                    this._buildCodeState(
                        codeText,
                        infoString,
                        codeBlockStyle,
                        trimUnnecessaryCodeBlockEmptyLines,
                        fenceLength,
                        token.sourceSyntax?.closingFence !== null,
                    ),
                );
                break;
            }

            case 'table': {
                const { header, align, rows } = token;
                const tableState: ITableState = {
                    name: 'table',
                    children: [],
                    sourceTrivia: {
                        tableSourceSyntax: {
                            header: token.sourceSyntax.header,
                            delimiter: token.sourceSyntax.delimiter,
                            rows: token.sourceSyntax.rows,
                            alignments: token.align.map(value =>
                                value ?? 'none'),
                        },
                    },
                };

                // Store the cell text as marked emits it (with the table `\|`
                // escape already resolved to a literal `|`), so the editor shows
                // `` `|` `` rather than the escaped `` `\|` `` inside inline code
                // (#4849). `escapeText` re-adds the `\|` escape on serialization,
                // keeping the markdown round-trip intact.
                tableState.children.push({
                    name: 'table.row',
                    children: header.map((h, i) => {
                        const inlineSource = nativeInlineCriticSource(
                            h.tokens,
                            h.text,
                            inlineLeavesByTokens,
                        );
                        const cell = {
                            name: 'table.cell' as const,
                            meta: {
                                align: align[i] || 'none',
                            },
                            text: inlineSource.text,
                        };
                        appendPendingInlineBindings(
                            pendingInlineBindings,
                            cell,
                            inlineSource,
                        );
                        return cell;
                    }),
                });

                for (const row of rows) {
                    tableState.children.push({
                        name: 'table.row' as const,
                        children: row.map((c, i) => {
                            const inlineSource = nativeInlineCriticSource(
                                c.tokens,
                                c.text,
                                inlineLeavesByTokens,
                            );
                            const cell = {
                                name: 'table.cell' as const,
                                meta: {
                                    align: align[i] || 'none',
                                },
                                text: inlineSource.text,
                            };
                            appendPendingInlineBindings(
                                pendingInlineBindings,
                                cell,
                                inlineSource,
                            );
                            return cell;
                        }),
                    });
                }

                state = tableState;
                parentList[0].push(state);
                break;
            }

            case 'html': {
                const text = token.text.trim();
                // TODO: Treat html state which only contains one img as paragraph, we maybe add image state in the future.
                const isSingleImage = /^<img[^<>]+>$/.test(text);
                if (isSingleImage) {
                    state = {
                        name: 'paragraph' as const,
                        text,
                    };
                    parentList[0].push(state);
                }
                else {
                    state = {
                        name: 'html-block' as const,
                        text,
                    };
                    parentList[0].push(state);
                }
                break;
            }

            case 'multiplemath': {
                const text = token.text.trim();
                const { mathStyle = '' } = token;
                const state = {
                    name: 'math-block' as const,
                    text,
                    meta: { mathStyle },
                };
                parentList[0].push(state);
                break;
            }

            case 'text': {
                const loweredInline: Array<{
                    readonly source: ILoweredNativeInlineSource;
                    readonly offset: number;
                }> = [];
                const first = nativeInlineCriticSource(
                    token.tokens,
                    token.text,
                    inlineLeavesByTokens,
                );
                value = first.text;
                loweredInline.push({ source: first, offset: 0 });
                while (tokens[0]?.type === 'text') {
                    const next = tokens.shift() as Extract<TBlockToken, { type: 'text' }>;
                    const nextInline = nativeInlineCriticSource(
                        next.tokens,
                        next.text,
                        inlineLeavesByTokens,
                    );
                    const offset = value.length + 1;
                    value += `\n${nextInline.text}`;
                    loweredInline.push({ source: nextInline, offset });
                }
                state = {
                    name: 'paragraph',
                    text: value,
                };
                parentList[0].push(state);
                for (const lowered of loweredInline) {
                    appendPendingInlineBindings(
                        pendingInlineBindings,
                        state,
                        lowered.source,
                        lowered.offset,
                    );
                }
                break;
            }

            case 'parser_residue': {
                const trailingNewline = residueNewlines.get(token);
                if (trailingNewline === undefined) {
                    throw new TypeError(
                        'Markdown parser residue has no terminal-newline ownership.',
                    );
                }
                state = {
                    name: 'markdown-parser-residue',
                    text: token.text,
                    meta: {
                        parserDiagnostic: { ...token.diagnostic },
                        trailingNewline,
                    },
                };
                parentList[0].push(state);
                break;
            }

            case 'paragraph': {
                const inlineSource = nativeInlineCriticSource(
                    token.tokens,
                    token.text,
                    inlineLeavesByTokens,
                );
                value = inlineSource.text;
                state = {
                    name: 'paragraph' as const,
                    text: value,
                };
                parentList[0].push(state);
                appendPendingInlineBindings(
                    pendingInlineBindings,
                    state,
                    inlineSource,
                );
                break;
            }

            case 'def': {
                // Marked v16 hoists `[label]: url "title"` reference
                // definitions to block-level `def` tokens. Lower them back
                // to paragraph state nodes so the rest of the pipeline —
                // `InlineRenderer.collectReferenceDefinitions` (regex scan
                // over paragraph text) and round-trip serialization —
                // keeps working without a dedicated state node.
                // Aligns with marktext's "definition is paragraph text"
                // model. See plan section 13 (PR-16).
                state = {
                    name: 'paragraph' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };
                parentList[0].push(state);
                break;
            }

            default:
                debug.warn(`Unknown type ${token.type}`);
                break;
        }
    }

    private _buildCodeState(
        text: string,
        infoString: string,
        codeBlockStyle: 'indented' | undefined,
        trimUnnecessaryCodeBlockEmptyLines: boolean,
        fenceLength?: number,
        fenceClosed = true,
    ): TState {
        // Keep the whole info string; the language for highlighting / diagram
        // detection is its first word (CommonMark §4.5).
        const info = (infoString || '').trim();
        const lang = firstWordOfInfo(info);

        let value = text;
        // Fix: #1265.
        if (
            trimUnnecessaryCodeBlockEmptyLines
            && (value.endsWith('\n') || value.startsWith('\n'))
        ) {
            value = value.replace(/\n+$/, '').replace(/^\n+/, '');
        }

        const diagramMatch = /^(mermaid|vega-lite|plantuml|flowchart|sequence)$/.exec(lang);
        if (diagramMatch) {
            const diagramType = diagramMatch[1] as 'mermaid' | 'vega-lite' | 'plantuml' | 'flowchart' | 'sequence';
            return {
                name: 'diagram' as const,
                text: value,
                meta: {
                    type: diagramType,
                    lang: diagramType === 'vega-lite' ? 'json' : 'yaml',
                },
            };
        }

        // walkTokens (utils/marked/walkTokens.ts) writes
        // codeBlockStyle = 'fenced' for fenced blocks and
        // leaves 'indented' for indented blocks. marked's
        // type widens the field to `'indented' | undefined`,
        // but `'fenced'` reaches us at runtime via the
        // walkTokens assignment — hence the cast.
        const isFenced = (codeBlockStyle as 'indented' | 'fenced' | undefined) === 'fenced';
        return {
            name: 'code-block' as const,
            meta: {
                type: isFenced ? 'fenced' : 'indented',
                // The full info string verbatim (empty for indented blocks); the
                // language is its first word — see `firstWordOfInfo`.
                lang: info,
                ...(isFenced && fenceLength && fenceLength > 3 ? { fenceLength } : {}),
                ...(isFenced && !fenceClosed ? { fenceClosed: false as const } : {}),
            },
            text: value,
        };
    }
}
