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
import { finalizeCriticMarkupStateBindings } from './criticMarkupStateBindings';
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
        IPendingCriticMarkupInlineBinding[] = [];
        const openCriticCoverageScopes: IOpenCriticCoverageScope[] = [];
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
                handleContainerToken(
                    token,
                    parentList,
                    tokens,
                    pendingCriticMarkupBlockBindings,
                    openCriticCoverageScopes,
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
        // A Critic after-boundary woven inside `previous` may already spell
        // these exact interblock bytes as its marker prefix; attaching the
        // separator too would serialize the same bytes twice.
        let descendant: TState | undefined = previous;
        while (descendant) {
            const prefix = descendant.sourceTrivia?.criticAfterPrefix;
            if (
                prefix !== undefined
                && descendant !== previous
                && `${prefix}${descendant.sourceTrivia?.criticAfterSuffix ?? ''}`
                    .endsWith(raw.slice(1))
            ) {
                return;
            }
            descendant = (descendant as { children?: TState[] })
                .children?.at(-1);
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
}
