import type { TBlockToken } from '../utils/marked/types';
import type {
    IOpenCriticCoverageScope,
    TPendingCriticMarkupBlockBinding,
} from './criticMarkupStateBindings';
import type { IStateSourceTrivia, TState } from './types';
import {
    attachCriticBoundaryAttachments,
    attachCriticBoundaryTrivia,
    criticCoverageRole,
    criticCoverageScopeKey,
    criticMarkerBoundaryState,
    criticMarkerRunEnd,
    criticMarkerRunStart,
    criticOpenAncestors,
    criticPreviousSiblingChain,
    releaseAncestorSeparators,
} from './criticMarkupStateBindings';

type TCriticBoundaryEndToken = Extract<
    TBlockToken,
    { type: 'critic-boundary-end' }
>;

/**
 * Lower one `critic-boundary-end` token: attach empty-coverage boundary
 * markers with their displaced trivia, open/close structural coverage
 * scopes, and reconstruct re-homed unanchored items from source.
 */
export function lowerCriticBoundaryEnd(
    incoming: TCriticBoundaryEndToken,
    parentList: TState[][],
    pendingCriticMarkupBlockBindings: TPendingCriticMarkupBlockBinding[],
    openCriticCoverageScopes: IOpenCriticCoverageScope[],
    markdown: string,
): void {
    let token = incoming;
    const target = parentList[0];
    if (token.startIndex === -1)
        token = { ...token, startIndex: target.length };
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
        attachCriticBoundaryAttachments(
            firstMarkerState,
            'before',
            emptyBefore,
            token.unanchoredInterior ?? markdown,
        );
        attachCriticBoundaryTrivia(
            first,
            firstMarkerState,
            'before',
            emptyBefore,
            criticPreviousSiblingChain(
                parentList,
                target,
                token.startIndex,
            ),
            criticOpenAncestors(parentList, target),
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
            token.unanchoredInterior ?? markdown,
        );
        for (const attachment of emptyAfter) {
            pendingCriticMarkupBlockBindings.push({
                kind: 'boundary',
                state: lastMarkerState,
                attachment,
            });
        }
        if (
            token.unanchoredInterior !== undefined
            && emptyBefore.length
            && emptyAfter.length
        ) {
            // Unanchored pair in a whitespace-only document: every
            // byte outside the markers comes straight from source —
            // leading run as the block prefix, the run between the
            // opener and closer as the opener's suffix; the final
            // newline stays with terminal-EOL ownership.
            const source = token.unanchoredInterior;
            const leadingEnd = Math.min(
                criticMarkerRunStart(emptyBefore),
                criticMarkerRunStart(emptyAfter),
            );
            const interiorStart = criticMarkerRunEnd(emptyBefore);
            const interiorEnd = criticMarkerRunStart(emptyAfter);
            let leading = /\s*$/.exec(
                source.slice(0, leadingEnd),
            )![0];
                // A preceding block regenerates its own line terminator
                // — and any spaces before that newline are the previous
                // line's trimmed trailing padding (marked's empty-item
                // quirk), which its serialization also respells. None of
                // those bytes are ours.
            if (token.startIndex > 0)
                leading = leading.replace(/^[ \t]*\r?\n/, '');
            const interior = source.slice(
                interiorStart,
                interiorEnd,
            );
            if (!/^\s*$/.test(leading + interior)) {
                throw new TypeError(
                    'Native CriticMarkup unanchored interior contains semantic source.',
                );
            }
            (first as { sourceTrivia?: IStateSourceTrivia })
                .sourceTrivia = {
                    ...first.sourceTrivia,
                    ...(leading ? { blockPrefix: leading } : {}),
                };
            if (interior) {
                (firstMarkerState as {
                    sourceTrivia?: IStateSourceTrivia;
                }).sourceTrivia = {
                    ...firstMarkerState.sourceTrivia,
                    criticBeforeSuffix: interior,
                };
            }
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
            attachCriticBoundaryAttachments(
                markerState,
                'before',
                [attachment],
                markdown,
            );
            attachCriticBoundaryTrivia(
                covered,
                markerState,
                'before',
                [attachment],
                criticPreviousSiblingChain(
                    parentList,
                    target,
                    token.startIndex,
                ),
                criticOpenAncestors(parentList, target),
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
                // The producer's trivia is the whitespace displaced
                // from between the covered content and the close
                // markers; it belongs before them. Its first newline is
                // the covered block's regenerated terminator (the weave
                // yields it); a following space token skips separator
                // capture for the bytes this prefix re-emits.
            const run = attachment.trivia.raw;
            if (
                run
                && /^[ \t\r\n]*$/.test(run)
                && markerState.sourceTrivia?.criticAfterPrefix
                === undefined
            ) {
                (markerState as {
                    sourceTrivia?: IStateSourceTrivia;
                }).sourceTrivia = {
                    ...markerState.sourceTrivia,
                    criticAfterPrefix: run,
                };
                // A space token following the covered container may
                // already have captured the prefix's displaced bytes
                // (beyond the terminator) as a separator on the
                // container — deduct them so they emit only once.
                const reEmitted = run.replace(/^\r?\n/, '');
                if (reEmitted) {
                    for (const holder of covered) {
                        const separator = holder.sourceTrivia
                            ?.blockSeparatorAfter;
                        if (
                            separator !== undefined
                            && separator.startsWith(reEmitted)
                        ) {
                            (holder as {
                                sourceTrivia?: IStateSourceTrivia;
                            }).sourceTrivia = {
                                ...holder.sourceTrivia,
                                blockSeparatorAfter: separator
                                    .slice(reEmitted.length),
                            };
                            break;
                        }
                    }
                }
            }
            // Blank lines the parser view attributed to the last
            // covered item really sit AFTER the closer in source
            // (split around this and the next item's markers). The
            // whitespace run following the closer becomes the
            // markers' suffix, and the item's blank count resets so
            // the same bytes don't also serialize inside the item.
            const trailingBlanks = markerState.sourceTrivia
                ?.listItemTrailingBlankLines;
            if (
                typeof trailingBlanks === 'number'
                && trailingBlanks > 0
                && markerState.sourceTrivia?.criticAfterSuffix
                === undefined
            ) {
                const closersEnd
                    = criticMarkerRunEnd([attachment]);
                const followRun = /^[ \t\r\n]*/.exec(
                    markdown.slice(closersEnd),
                )![0];
                if (followRun) {
                    (markerState as {
                        sourceTrivia?: IStateSourceTrivia;
                    }).sourceTrivia = {
                        ...markerState.sourceTrivia,
                        criticAfterSuffix: followRun,
                        listItemTrailingBlankLines: 0,
                    };
                }
            }
            attachCriticBoundaryAttachments(
                markerState,
                'after',
                [attachment],
                markdown,
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
}
