import type { Token, Tokens, TokensList } from 'marked';
import type { CriticMarkupAnalysis } from '../criticMarkup/analysis';
import type { ICriticMarkupInlineLeaf } from '../utils/marked/locatedMarkdown';
import type {
    TBlockToken,
    TLexedToken,
} from '../utils/marked/types';
import type {
    ICriticMarkupStateBindingGraph,
    IOpenCriticCoverageScope,
    IPendingCriticMarkupInlineBinding,
    TPendingCriticMarkupBlockBinding,
} from './criticMarkupStateBindings';
import type {
    IStateSourceTrivia,
    TState,
} from './types';
import { lexBlock } from '../utils/marked/lexBlock';
import {
    criticMarkerRunEnd,
    criticMarkerRunStart,
    finalizeCriticMarkupStateBindings,
} from './criticMarkupStateBindings';
import {
    CONTAINER_TOKEN_TYPES,
    handleContainerToken,
    handleLeafToken,
} from './markdownTokenToState';
import {
    parserResidueTerminalNewlines,
} from './parserResidueNewlines';
import { isAnyListState } from './types';

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

export type {
    ICriticMarkupBindingRange,
} from '../criticMarkup/bindingGraph';

export type {
    ICriticMarkupBlockBoundaryStateBinding,
    ICriticMarkupBlockContentStateBinding,
    ICriticMarkupInlineContentStateBindingSegment,
    ICriticMarkupInlineMarkerStateBindingSegment,
    ICriticMarkupInlineStateBinding,
    ICriticMarkupStateBindingGraph,
    TCriticMarkupBlockStateBinding,
    TCriticMarkupInlineStateBindingSegment,
} from './criticMarkupStateBindings';

const DEFAULT_OPTIONS = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
    superSubScript: true,
};

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
        // blockquote/list/list_item/footnote cases in markdownTokenToState.ts)
        // to pop the parent stack, so the working stream is wider than what
        // `lexBlock` returns.
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
            criticMarkupDocument?: import('../criticMarkup/document').CriticMarkupDocument;
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
            // Zero-content items in a document's whitespace tail (or a
            // whitespace-only document) cannot anchor to a following token.
            // Re-home each such item onto its own synthetic empty state at
            // the document tail: its markers plus the whitespace runs around
            // them are reconstructed from source, per item, in order.
            const unanchoredItemIds = new Set(
                lexedTokens.criticMarkupUnanchored.map(
                    attachment => attachment.itemId,
                ),
            );
            const tailAttachments = [...lexedTokens.criticMarkupUnanchored];
            // A partner attachment may sit on a nested token (a leaf inside
            // a list item), so the sweep must walk the whole token tree.
            const stealFrom = (candidates: readonly TBlockToken[]): void => {
                for (const candidate of candidates) {
                    const carrier = candidate as
                        Partial<Tokens.CriticMarkupBoundaryCarrier>;
                    for (const key of [
                        'criticMarkupBefore',
                        'criticMarkupAfter',
                    ] as const) {
                        const attachments = carrier[key];
                        if (!attachments?.length)
                            continue;
                        const stolen = attachments.filter(attachment =>
                            unanchoredItemIds.has(attachment.itemId));
                        if (stolen.length) {
                            for (const attachment of stolen)
                                tailAttachments.push(attachment);
                            carrier[key] = attachments.filter(attachment =>
                                !unanchoredItemIds.has(attachment.itemId));
                        }
                    }
                    const children = candidate as {
                        tokens?: TBlockToken[];
                        items?: TBlockToken[];
                    };
                    if (children.tokens?.length)
                        stealFrom(children.tokens);
                    if (children.items?.length)
                        stealFrom(children.items);
                }
            };
            stealFrom(tokens);
            let lastContent = -1;
            for (let index = tokens.length - 1; index >= 0; index--) {
                if (tokens[index].type !== 'space') {
                    lastContent = index;
                    break;
                }
            }
            // Trailing space tokens spell the same bytes the reconstructed
            // trivia re-emits; both would double them.
            tokens.length = lastContent + 1;
            const byItem = new Map<
                string,
                Tokens.CriticMarkupBoundaryAttachment[]
            >();
            for (const attachment of tailAttachments) {
                const bucket = byItem.get(attachment.itemId) ?? [];
                bucket.push(attachment);
                byItem.set(attachment.itemId, bucket);
            }
            const orderedItems = [...byItem.values()].sort((left, right) =>
                criticMarkerRunStart(left) - criticMarkerRunStart(right));
            const rehomedToken = (
                attachments: Tokens.CriticMarkupBoundaryAttachment[],
            ): TBlockToken => {
                // A zero-width attachment carries the whole marker run; its
                // recorded edge is the binding contract and stays untouched.
                const zeroWidth = (
                    attachment: Tokens.CriticMarkupBoundaryAttachment,
                ): boolean =>
                    attachment.contentRange.start
                    === attachment.contentRange.end;
                const before = attachments
                    .filter(attachment => attachment.edge === 'after')
                    .map(attachment => (zeroWidth(attachment)
                        ? attachment
                        : {
                                ...attachment,
                                edge: 'before' as const,
                            }));
                const after = attachments
                    .filter(attachment => attachment.edge === 'before')
                    .map(attachment => ({
                        ...attachment,
                        edge: 'after' as const,
                    }));
                return {
                    type: 'critic-boundary-end',
                    // -1: append a synthetic state at the current tail.
                    startIndex: -1,
                    before,
                    // A paired item's interior reconstruction respells all
                    // its whitespace; a closer's recorded post-marker run
                    // must not double it. A lone re-homed closer (opener
                    // stayed anchored) instead owns the run directly before
                    // its markers, which the plan never recorded.
                    after: before.length
                        ? after.map(attachment => ({
                                ...attachment,
                                trivia: {
                                    raw: '',
                                    range: {
                                        start: attachment.trivia.range.end,
                                        end: attachment.trivia.range.end,
                                    },
                                },
                            }))
                        : after.map((attachment) => {
                                if (attachment.trivia.raw)
                                    return attachment;
                                const markerStart
                                    = criticMarkerRunStart([attachment]);
                                let runStart = markerStart;
                                while (
                                    runStart > 0
                                    && /[ \t\r\n]/.test(
                                        markdown[runStart - 1],
                                    )
                                ) {
                                    runStart--;
                                }
                                if (runStart === markerStart)
                                    return attachment;
                                return {
                                    ...attachment,
                                    trivia: {
                                        raw: markdown.slice(
                                            runStart,
                                            markerStart,
                                        ),
                                        range: {
                                            start: runStart,
                                            end: markerStart,
                                        },
                                    },
                                };
                            }),
                    unanchoredInterior: markdown,
                };
            };
            // An item followed by semantic content lives in the document's
            // leading whitespace, not its tail: its synthetic state must
            // precede the parsed blocks, and the leading space token's
            // bytes are re-spelled by the reconstruction. Other unanchored
            // items' marker bytes are not content — skip them when probing.
            const unanchoredMarkerRanges = [...byItem.values()]
                .flat()
                .flatMap(attachment => attachment.markers.map(
                    marker => marker.range,
                ))
                .sort((left, right) => left.start - right.start);
            const contentFollows = (offset: number): boolean => {
                let cursor = offset;
                while (cursor < markdown.length) {
                    const covering = unanchoredMarkerRanges.find(range =>
                        range.start <= cursor && cursor < range.end);
                    if (covering) {
                        cursor = covering.end;
                        continue;
                    }
                    if (/[ \t\r\n]/.test(markdown[cursor])) {
                        cursor++;
                        continue;
                    }
                    return true;
                }
                return false;
            };
            const headItems = orderedItems.filter(attachments =>
                contentFollows(criticMarkerRunEnd(attachments)));
            const tailItems = orderedItems.filter(
                attachments => !headItems.includes(attachments),
            );
            if (headItems.length && tokens[0]?.type === 'space') {
                // The head items' reconstruction respells every whitespace
                // byte up to the last head closer; the leading space token
                // keeps only the remainder, which flows through the normal
                // separator capture against the last synthetic state.
                const lastClosersEnd = criticMarkerRunEnd(
                    headItems.at(-1)!.filter(
                        attachment => attachment.edge === 'before',
                    ),
                );
                let wsBefore = 0;
                for (let index = 0; index < lastClosersEnd; index++) {
                    if (/[ \t\r\n]/.test(markdown[index]))
                        wsBefore++;
                }
                const trimmed = tokens[0].raw.slice(wsBefore);
                if (trimmed)
                    tokens[0] = { type: 'space', raw: trimmed };
                else
                    tokens.shift();
            }
            headItems.forEach((attachments, index) => {
                tokens.splice(index, 0, rehomedToken(attachments));
            });
            for (const attachments of tailItems)
                tokens.push(rehomedToken(attachments));
        }

        const states: TState[] = [];
        const pendingCriticMarkupBlockBindings:
        TPendingCriticMarkupBlockBinding[] = [];
        const pendingCriticMarkupInlineBindings:
        IPendingCriticMarkupInlineBinding[] = [];
        const openCriticCoverageScopes: IOpenCriticCoverageScope[] = [];
        let token: TBlockToken | undefined;
        const parentList: TState[][] = [states];
        const pendingBlockPrefixes = new WeakMap<TState[], string>();
        // CriticMarkup documents must serialize byte-exactly (the lowering
        // exactness gate reparses the output); default interblock spacing
        // may not widen a directly-abutting block pair, so the gap records
        // as an explicitly empty separator. Plain documents keep the
        // historical blank-line normalization.
        const exactSpacing = lexedTokens.criticMarkup !== null
            && lexedTokens.criticMarkup !== undefined;
        const SYNTHETIC_TOKEN_TYPES = new Set([
            'block-end',
            'critic-fragment-end',
            'critic-boundary-end',
        ]);
        let previousTokenWasSpace = true;

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
                previousTokenWasSpace = true;
                continue;
            }
            if (!SYNTHETIC_TOKEN_TYPES.has(token.type)) {
                if (
                    exactSpacing
                    && !previousTokenWasSpace
                    // Container-internal spacing (list items, quotes) is
                    // owned by their own trivia machinery.
                    && parentList.length === 1
                ) {
                    const previousState = targetStates.at(-1);
                    if (
                        previousState
                        && previousState.sourceTrivia?.blockSeparatorAfter
                        === undefined
                    ) {
                        (previousState as {
                            sourceTrivia?: IStateSourceTrivia;
                        }).sourceTrivia = {
                            ...previousState.sourceTrivia,
                            blockSeparatorAfter: '',
                        };
                    }
                }
                // A token whose own raw swallowed a trailing blank run
                // (math/code fences) separates itself from what follows;
                // treat it like an explicit space token.
                previousTokenWasSpace = /\n\s*\n$/.test(
                    (token as { raw?: string }).raw ?? '',
                );
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
                handleContainerToken(
                    token,
                    parentList,
                    tokens,
                    pendingCriticMarkupBlockBindings,
                    openCriticCoverageScopes,
                    markdown,
                );
            }
            else {
                handleLeafToken(
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

        // The editor tree always holds at least one editable content block;
        // front matter alone cannot host a cursor. Reparsing must reproduce
        // that block or a frontmatter-only revision would lose its mandatory
        // trailing paragraph on every round trip.
        if (!states.some(state => state.name !== 'frontmatter')) {
            const fallback: TState = { name: 'paragraph', text: '' };
            states.push(fallback);
            this._attachPendingBlockPrefix(
                fallback,
                states,
                pendingBlockPrefixes,
                true,
            );
        }
        if (openCriticCoverageScopes.length) {
            throw new TypeError(
                'Native CriticMarkup structural coverage was never closed.',
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
            // syntax and the block's terminal LF already own that spelling —
            // but anything beyond that head is a real trailing blank run
            // that must still capture as the separator.
            if (isAnyListState(previous)) {
                const remainder = raw.replace(/^[ \t]+\r?\n/, '');
                if (
                    remainder
                    && remainder !== raw
                    && previous.sourceTrivia?.blockSeparatorAfter
                    === undefined
                ) {
                    (previous as {
                        sourceTrivia?: IStateSourceTrivia;
                    }).sourceTrivia = {
                        ...previous.sourceTrivia,
                        blockSeparatorAfter: remainder,
                    };
                }
                return;
            }
            throw new TypeError(
                'Markdown parser interblock space token has no prior block LF.',
            );
        }
        const existingSeparator
            = previous.sourceTrivia?.blockSeparatorAfter;
        if (existingSeparator !== undefined && existingSeparator !== '') {
            throw new TypeError(
                'Markdown parser emitted consecutive interblock space tokens.',
            );
        }
        // A Critic after-boundary woven inside `previous` may already spell
        // part of these interblock bytes as its marker prefix: the prefix's
        // first newline is the block terminator the weave yields, and the
        // rest re-emits displaced pre-closer whitespace that this space run
        // repeats at its front. Deduct the re-emitted bytes (or all of them)
        // so the same byte never serializes twice.
        let descendant: TState | undefined = previous;
        let separatorRemainder: string | undefined;
        while (descendant) {
            const prefix = descendant.sourceTrivia?.criticAfterPrefix;
            if (prefix !== undefined && descendant !== previous) {
                const suffix
                    = descendant.sourceTrivia?.criticAfterSuffix ?? '';
                const remainder = raw.slice(1);
                const reEmitted
                    = `${prefix.replace(/^\r?\n/, '')}${suffix}`;
                if (`${prefix}${suffix}`.endsWith(remainder))
                    return;
                if (reEmitted && remainder.startsWith(reEmitted)) {
                    separatorRemainder = remainder.slice(reEmitted.length);
                    break;
                }
            }
            descendant = (descendant as { children?: TState[] })
                .children
                ?.at(-1);
        }
        // A non-flush fragment close consumed the block's terminator into
        // the fragment raw (its pre-closer run is recorded as the closers'
        // prefix), so this space run holds only separator bytes; slicing
        // off a "terminator" would drop a real byte per save. Coverage-
        // attached closers never consume the terminator, so they keep the
        // plain convention.
        let terminatorInsideFragment = false;
        let cursor: TState | undefined = previous;
        while (cursor) {
            if (
                cursor.sourceTrivia?.criticAfter?.length
                && !cursor.sourceTrivia.criticAfterFlush
                && cursor.sourceTrivia.criticAfterConsumedEol === true
            ) {
                terminatorInsideFragment = true;
                break;
            }
            cursor = (cursor as { children?: TState[] }).children?.at(-1);
        }
        (previous as { sourceTrivia?: IStateSourceTrivia }).sourceTrivia = {
            ...previous.sourceTrivia,
            blockSeparatorAfter: separatorRemainder
                ?? (terminatorInsideFragment ? raw : raw.slice(1)),
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
}
