import type { Token, Tokens } from 'marked';
import type { ICriticMarkupInlineLeaf } from '../utils/marked/locatedMarkdown';
import type { TBlockToken } from '../utils/marked/types';
import type { ILoweredNativeInlineSource } from './criticMarkupInlineLowering';
import type {
    IOpenCriticCoverageScope,
    IPendingCriticMarkupInlineBinding,
    TPendingCriticMarkupBlockBinding,
} from './criticMarkupStateBindings';
import type { TParserResidueToken } from './parserResidueNewlines';
import type {
    IAtxHeadingState,
    IBulletListState,
    IListItemState,
    IOrderListState,
    ISetextHeadingState,
    IStateSourceTrivia,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    TState,
} from './types';
import { firstWordOfInfo } from '../utils';
import logger from '../utils/logger';
import {
    appendPendingInlineBindings,
    nativeInlineCriticSource,
} from './criticMarkupInlineLowering';
import {
    attachCriticBlockSeparator,
    attachCriticBoundaryAttachments,
    attachCriticBoundaryTrivia,
    attachCriticMarkers,
    criticCoverageRole,
    criticCoverageScopeKey,
    criticMarkerBoundaryState,
} from './criticMarkupStateBindings';

const debug = logger('import markdown: ');

// Token types whose handler manipulates the `parentList` stack (push a
// container and recurse via synthetic `block-end`), as opposed to the leaf
// tokens that only append a state to the current level.
export const CONTAINER_TOKEN_TYPES = new Set([
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


/**
 * Clear `blockSeparatorAfter` on every open ancestor container whose
 * recorded separator is a suffix of the after-boundary trivia. The boundary
 * weave re-emits those exact bytes, so leaving the separator in place would
 * double-spell them on serialization.
 */
function releaseAncestorSeparators(
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

export function handleContainerToken(
    token: TBlockToken,
    parentList: TState[][],
    tokens: TBlockToken[],
    pendingCriticMarkupBlockBindings:
    TPendingCriticMarkupBlockBinding[],
    openCriticCoverageScopes: IOpenCriticCoverageScope[],
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
            if (token.ownsTrailingBlankLines) {
                const lastChild = parentList[0].at(-1);
                const separator
                    = lastChild?.sourceTrivia?.blockSeparatorAfter;
                if (lastChild && separator !== undefined) {
                    const { blockSeparatorAfter: _omitted, ...rest }
                        = lastChild.sourceTrivia!;
                    (lastChild as {
                        sourceTrivia?: typeof rest;
                    }).sourceTrivia = rest;
                }
            }
            if (token.tokenType === 'list') {
                // The final item's trailing blank lines are really the
                // list's separation from the next block. Left on the item,
                // the serializer would emit them AND its default interblock
                // break — one extra blank line per round trip.
                const items = parentList[0];
                const lastItem = items.at(-1);
                const trailing
                    = lastItem?.sourceTrivia?.listItemTrailingBlankLines;
                parentList.shift();
                const listState = parentList[0]?.at(-1);
                if (
                    lastItem
                    && listState
                    && typeof trailing === 'number'
                    && trailing > 0
                    && listState.sourceTrivia?.blockSeparatorAfter
                    === undefined
                ) {
                    (lastItem as {
                        sourceTrivia?: IStateSourceTrivia;
                    }).sourceTrivia = {
                        ...lastItem.sourceTrivia,
                        listItemTrailingBlankLines: 0,
                    };
                    (listState as {
                        sourceTrivia?: IStateSourceTrivia;
                    }).sourceTrivia = {
                        ...listState.sourceTrivia,
                        blockSeparatorAfter: '\n'.repeat(trailing),
                    };
                }
                break;
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
            // Content that ends without an EOL sits flush against its close
            // markers in source; the final state's serialized terminator
            // corresponds to the EOL AFTER those markers, so they must
            // weave inside it.
            const afterMarkersFlush = token.fragment.after.length > 0
                && !token.fragment.contentRaw.endsWith('\n');
            if (
                afterMarkersFlush
                && !lastMarkerState.sourceTrivia?.criticAfterFlush
            ) {
                (lastMarkerState as {
                    sourceTrivia?: IStateSourceTrivia;
                }).sourceTrivia = {
                    ...lastMarkerState.sourceTrivia,
                    criticAfterFlush: true,
                };
            }
            attachCriticBlockSeparator(
                last,
                token.fragment,
                afterMarkersFlush,
            );
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
            const emptyBefore = token.before.filter(attachment =>
                attachment.coverage !== 'content');
            const emptyAfter = token.after.filter(attachment =>
                attachment.coverage !== 'content');
            const contentBefore = token.before.filter(attachment =>
                attachment.coverage === 'content');
            const contentAfter = token.after.filter(attachment =>
                attachment.coverage === 'content');
            if (emptyBefore.length || emptyAfter.length) {
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
                    emptyBefore,
                );
                attachCriticBoundaryAttachments(
                    firstMarkerState,
                    'before',
                    emptyBefore,
                );
                for (const attachment of emptyBefore) {
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
                    emptyAfter,
                );
                // The boundary's trivia spells the bytes between the marker
                // and its neighbors; any open ancestor container whose
                // parser-recorded separator names those same bytes must
                // yield ownership or the byte serializes twice.
                releaseAncestorSeparators(parentList, emptyAfter);
                attachCriticBoundaryAttachments(
                    lastMarkerState,
                    'after',
                    emptyAfter,
                );
                for (const attachment of emptyAfter) {
                    pendingCriticMarkupBlockBindings.push({
                        kind: 'boundary',
                        state: lastMarkerState,
                        attachment,
                    });
                }
            }
            for (const attachment of contentBefore) {
                const covered = target[token.startIndex];
                if (!covered) {
                    throw new TypeError(
                        'Native CriticMarkup coverage opened without a covered state.',
                    );
                }
                openCriticCoverageScopes.push({
                    key: criticCoverageScopeKey(attachment),
                    attachment,
                    target,
                    startIndex: token.startIndex,
                });
                if (attachment.markers.length) {
                    const markerState = criticMarkerBoundaryState(
                        covered,
                        'before',
                    );
                    attachCriticBoundaryTrivia(
                        covered,
                        markerState,
                        'before',
                        [attachment],
                    );
                    attachCriticBoundaryAttachments(
                        markerState,
                        'before',
                        [attachment],
                    );
                }
            }
            for (const attachment of contentAfter) {
                const key = criticCoverageScopeKey(attachment);
                let scopeIndex = -1;
                for (
                    let index = openCriticCoverageScopes.length - 1;
                    index >= 0;
                    index--
                ) {
                    if (openCriticCoverageScopes[index].key === key) {
                        scopeIndex = index;
                        break;
                    }
                }
                if (scopeIndex < 0) {
                    throw new TypeError(
                        'Native CriticMarkup coverage closed without opening.',
                    );
                }
                const [scope] = openCriticCoverageScopes.splice(
                    scopeIndex,
                    1,
                );
                // The close edge may anchor at a different nesting level
                // (its carrier sits inside the last covered subtree or
                // after the open level popped). Coverage is always the
                // open level's produced slice: the deeper carrier is
                // inside its final state, and a popped level is complete.
                const covered = scope.target.slice(scope.startIndex);
                if (!covered.length) {
                    throw new TypeError(
                        'Native CriticMarkup coverage covers no produced state.',
                    );
                }
                if (attachment.markers.length) {
                    const last = covered.at(-1)!;
                    const markerState = criticMarkerBoundaryState(
                        last,
                        'after',
                    );
                    // The whitespace between the covered content and the
                    // close marker is interior to the covered node and is
                    // re-emitted by its own serialization; storing it as
                    // an after-prefix would duplicate those bytes.
                    attachCriticBoundaryAttachments(
                        markerState,
                        'after',
                        [attachment],
                    );
                }
                covered.forEach((coveredState, index) => {
                    pendingCriticMarkupBlockBindings.push({
                        kind: 'coverage',
                        state: coveredState,
                        attachment,
                        role: criticCoverageRole(
                            attachment.role,
                            index,
                            covered.length,
                        ),
                    });
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
            tokens.unshift({
                type: 'block-end',
                tokenType: 'list-item',
                ownsTrailingBlankLines:
                    (token.trailingBlankLines ?? 0) > 0,
            });
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

export function handleLeafToken(
    token: TBlockToken,
    parentList: TState[][],
    tokens: TBlockToken[],
    trimUnnecessaryCodeBlockEmptyLines: boolean,
    residueNewlines: WeakMap<TParserResidueToken, boolean>,
    inlineLeavesByTokens: WeakMap<
        readonly Token[],
        ICriticMarkupInlineLeaf
    >,
    pendingInlineBindings: IPendingCriticMarkupInlineBinding[],
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
                headingStyle === 'atx' ? +depth : 0,
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
                buildCodeState(
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

function buildCodeState(
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
