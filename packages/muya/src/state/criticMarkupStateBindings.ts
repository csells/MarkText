import type { Tokens } from 'marked';
import type {
    ICriticMarkupBindingGraph,
    ICriticMarkupBindingRange,
    ICriticMarkupBlockBoundaryBinding,
    ICriticMarkupBlockContentBinding,
    ICriticMarkupInlineBinding,
    ICriticMarkupInlineContentBindingSegment,
    ICriticMarkupInlineMarkerBindingSegment,
    TCriticMarkupBlockBinding,
    TCriticMarkupInlineBindingSegment,
} from '../criticMarkup/bindingGraph';
import type { TMarkdownStatePath } from './markdownSourceMap';
import type {
    ICriticMarkupStateMarker,
    IStateSourceTrivia,
    TState,
} from './types';
import { markdownStatePath } from './markdownSourceMap';
import { isAnyListState } from './types';

/**
 * State-domain views of the neutral parser-binding contracts
 * (`criticMarkup/bindingGraph.ts`): every path is a produced Muya state
 * path in this result's immutable parse revision.
 */
export type ICriticMarkupBlockContentStateBinding
    = ICriticMarkupBlockContentBinding<TMarkdownStatePath>;
export type ICriticMarkupBlockBoundaryStateBinding
    = ICriticMarkupBlockBoundaryBinding<TMarkdownStatePath>;
export type TCriticMarkupBlockStateBinding
    = TCriticMarkupBlockBinding<TMarkdownStatePath>;
export type ICriticMarkupInlineMarkerStateBindingSegment
    = ICriticMarkupInlineMarkerBindingSegment;
export type ICriticMarkupInlineContentStateBindingSegment
    = ICriticMarkupInlineContentBindingSegment;
export type TCriticMarkupInlineStateBindingSegment
    = TCriticMarkupInlineBindingSegment;
export type ICriticMarkupInlineStateBinding
    = ICriticMarkupInlineBinding<TMarkdownStatePath>;
export type ICriticMarkupStateBindingGraph
    = ICriticMarkupBindingGraph<TMarkdownStatePath>;

export type TPendingCriticMarkupBlockBinding
    = | {
        readonly kind: 'content';
        readonly state: TState;
        readonly fragment: Tokens.CriticMarkupFragment;
    }
    | {
        readonly kind: 'boundary';
        readonly state: TState;
        readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
    }
    | {
        readonly kind: 'coverage';
        readonly state: TState;
        readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
        readonly role: Tokens.CriticMarkupFragment['role'];
    };

/**
 * One structural arm whose `before` coverage edge has streamed past but
 * whose `after` edge has not yet closed it. Covered sibling states are
 * bound when the matching close attachment arrives.
 */
export interface IOpenCriticCoverageScope {
    readonly key: string;
    readonly attachment: Tokens.CriticMarkupBoundaryAttachment;
    readonly target: TState[];
    readonly startIndex: number;
}

export function criticCoverageScopeKey(
    attachment: Tokens.CriticMarkupBoundaryAttachment,
): string {
    return [
        attachment.itemId,
        attachment.arm,
        attachment.range.start,
        attachment.range.end,
    ].join('\u0000');
}

export function criticCoverageRole(
    planRole: Tokens.CriticMarkupFragment['role'],
    index: number,
    count: number,
): Tokens.CriticMarkupFragment['role'] {
    const first = index === 0;
    const last = index === count - 1;
    switch (planRole) {
        case 'only':
            return first && last
                ? 'only'
                : first ? 'start' : last ? 'end' : 'middle';
        case 'start':
            return first ? 'start' : 'middle';
        case 'end':
            return last ? 'end' : 'middle';
        case 'middle':
            return 'middle';
        default:
            return planRole;
    }
}

export interface ICriticMarkupInlineStateBindingDraft {
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
    readonly segments: readonly TCriticMarkupInlineStateBindingSegment[];
}

export interface IPendingCriticMarkupInlineBinding {
    readonly state: TState;
    readonly binding: ICriticMarkupInlineStateBindingDraft;
}

export function criticStateType(
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

export function attachCriticMarkers(
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

export function attachCriticBoundaryAttachments(
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

/**
 * Move covered-content leading whitespace from the first covered state's
 * block prefix to the opener's marker suffix, so serialization re-emits it
 * INSIDE the item (`{++` + trivia + content) instead of hoisting it before
 * the opener and changing the item's payload bytes.
 */
export function relocateCriticLeadingTrivia(
    owner: TState,
    markerState: TState,
    trivia: string,
    previousChain: readonly TState[] = [],
    allowGeneratedJoinerClaim = false,
): void {
    if (!trivia)
        return;
    const setSuffix = (): void => {
        const existingSuffix = markerState.sourceTrivia?.criticBeforeSuffix;
        if (existingSuffix !== undefined && existingSuffix !== trivia) {
            throw new TypeError(
                'Native CriticMarkup before-boundary trivia conflicts on its state.',
            );
        }
        (markerState as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...markerState.sourceTrivia,
            criticBeforeSuffix: trivia,
        };
    };
    const prefix = owner.sourceTrivia?.blockPrefix;
    if (prefix === undefined) {
        // Block lexing folded the byte into the preceding whitespace run:
        // reclaim it from the nearest preceding sibling's separator tail
        // (walking outward through open ancestors), or — when nothing
        // recorded it — from the serializer's generated block joiner, which
        // yields to a covered state carrying an opener suffix.
        for (const previous of previousChain) {
            const separator = previous.sourceTrivia?.blockSeparatorAfter;
            if (separator !== undefined && separator.endsWith(trivia)) {
                (previous as {
                    sourceTrivia?: IStateSourceTrivia;
                }).sourceTrivia = {
                    ...previous.sourceTrivia,
                    blockSeparatorAfter:
                        separator.slice(0, -trivia.length) || undefined,
                };
                setSuffix();
                return;
            }
        }
        // Nothing recorded the byte. Only at document start is it provably
        // the serializer's generated joiner (which yields to the suffix);
        // anywhere else the bytes already have a structural owner.
        if (allowGeneratedJoinerClaim)
            setSuffix();
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
}

export function attachCriticBoundaryTrivia(
    owner: TState,
    markerState: TState,
    edge: 'before' | 'after',
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
    previousChain: readonly TState[] = [],
): void {
    if (!attachments.length)
        return;
    const trivia = criticBoundaryTrivia(edge, attachments);
    if (!trivia && edge === 'before')
        return;

    if (edge === 'before') {
        relocateCriticLeadingTrivia(owner, markerState, trivia, previousChain);
        return;
    }

    const followingTrivia = criticBoundaryFollowingTrivia(attachments);
    const separator = owner.sourceTrivia?.blockSeparatorAfter;
    if (!trivia && !followingTrivia) {
        // The marker sits flush against its node (`first{++` …), BEFORE the
        // node's own line terminator and block separator, which both keep
        // their owners. The weave inserts inside the trailing newline.
        (markerState as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...markerState.sourceTrivia,
            criticAfterFlush: true,
        };
        return;
    }
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

export function attachCriticBlockSeparator(
    state: TState,
    fragment: Tokens.CriticMarkupFragment,
    afterMarkersFlush = false,
): void {
    if (!fragment.raw.startsWith(fragment.fragmentRaw)) {
        throw new TypeError(
            'Native CriticMarkup token raw detached from its fragment envelope.',
        );
    }
    let suffix = fragment.raw.slice(fragment.fragmentRaw.length);
    if (suffix && !/^[ \t\r\n]+$/.test(suffix)) {
        throw new TypeError(
            'Native CriticMarkup fragment suffix contains semantic source.',
        );
    }
    if (afterMarkersFlush) {
        // Flush close markers weave inside the final state's generated line
        // terminator, so the suffix's first EOL is that terminator (the
        // block-spacing analogue of a space token's leading LF), not an
        // interblock separator.
        suffix = suffix.replace(/^\r?\n/, '');
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

export function criticMarkerBoundaryState(
    state: TState,
    edge: 'before' | 'after',
): TState {
    if (!isAnyListState(state) || !state.children.length)
        return state;
    return edge === 'before' ? state.children[0] : state.children.at(-1)!;
}

export function immutableCriticBindingRange(
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
    const close = attachment.markers.find(marker => marker.name === 'close');
    // A close-only attachment (split separator markers) is anchored at its
    // close marker, which sits at the arm content's end.
    const offset = (open?.range.end ?? close?.range.start
        ?? attachment.range.start) - attachment.range.start;
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

export function finalizeCriticMarkupStateBindings(
    states: readonly TState[],
    pendingBlock: readonly TPendingCriticMarkupBlockBinding[],
    pendingInline: readonly IPendingCriticMarkupInlineBinding[],
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
        if (binding.kind === 'coverage') {
            const { attachment } = binding;
            return Object.freeze({
                kind: 'content',
                path,
                itemId: attachment.itemId,
                criticType: attachment.criticType,
                arm: attachment.arm,
                role: binding.role,
                sourceRange: immutableCriticBindingRange(
                    attachment.range.start,
                    attachment.range.end,
                ),
                localRange: immutableCriticBindingRange(
                    attachment.contentRange.start - attachment.range.start,
                    attachment.contentRange.end - attachment.range.start,
                ),
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

/**
 * Clear `blockSeparatorAfter` on every open ancestor container whose
 * recorded separator is a suffix of the after-boundary trivia. The boundary
 * weave re-emits those exact bytes, so leaving the separator in place would
 * double-spell them on serialization.
 */
export function releaseAncestorSeparators(
    parentList: TState[][],
    attachments: readonly Tokens.CriticMarkupBoundaryAttachment[],
): void {
    const trivia = attachments
        .map(attachment => attachment.trivia.raw + attachment.followingTrivia.raw)
        .join('');
    if (!trivia)
        return;
    for (let level = 1; level < parentList.length; level++) {
        const container = parentList[level].at(-1);
        const separator = container?.sourceTrivia?.blockSeparatorAfter;
        if (
            container
            && separator !== undefined
            && separator.length > 0
            && trivia.endsWith(separator)
        ) {
            const { blockSeparatorAfter: _released, ...rest }
                = container.sourceTrivia!;
            (container as { sourceTrivia?: typeof rest }).sourceTrivia
                = Object.keys(rest).length ? rest : undefined;
        }
    }
}

/**
 * Preceding siblings whose separator may own an opener's leading trivia:
 * the covered state's direct predecessor first, then each open ancestor
 * level's predecessor (the covered subtree itself is each level's last
 * state while it is being built).
 */
export function criticPreviousSiblingChain(
    parentList: TState[][],
    target: TState[],
    startIndex: number,
): TState[] {
    const chain: TState[] = [];
    const direct = target[startIndex - 1];
    if (direct)
        chain.push(direct);
    for (let level = 0; level < parentList.length; level++) {
        if (parentList[level] === target)
            continue;
        const candidate = parentList[level].at(-2);
        if (candidate)
            chain.push(candidate);
    }
    return chain;
}
