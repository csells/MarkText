/**
 * CriticMarkup source-trivia serialization: weaving state-owned Critic
 * markers (criticBefore/criticAfter and their prefix/suffix/flush trivia)
 * back into serialized markdown, plus the parser-owned terminal line
 * ending that a trailing Critic suffix supersedes.
 */
import type {
    TMarkdownStatePath,
    TTrackedMarkdown,
} from './markdownSourceMap';
import type { ICriticMarkupStateMarker, TState } from './types';
import { criticMarkupMarkerRaw } from '../criticMarkup/parser';
import { sourceOffset } from '../mappedText';
import {
    concatMarkdown,
    markdownStatePath,
    plainMarkdown,
    replaceGeneratedMarkdown,
    sliceMarkdown,
    sliceMarkdownForWeave,
} from './markdownSourceMap';

export function applyTerminalLineEnding(
    states: readonly TState[],
    markdown: TTrackedMarkdown,
): TTrackedMarkdown {
    const finalTrivia = states.at(-1)?.sourceTrivia;
    const terminalLineEnding = finalTrivia?.criticAfterSuffix !== undefined
        ? ''
        : finalTrivia?.terminalLineEnding;
    if (terminalLineEnding === undefined || terminalLineEnding === '\n')
        return markdown;
    if (terminalLineEnding === '' && !markdown.text.endsWith('\n'))
        return markdown;
    if (!markdown.text.endsWith('\n')) {
        throw new TypeError(
            'Parser-owned terminal EOL has no generated LF to replace.',
        );
    }

    const terminalStart = markdown.text.length - 1;
    return concatMarkdown([
        sliceMarkdown(markdown, 0, terminalStart),
        replaceGeneratedMarkdown(
            sliceMarkdown(markdown, terminalStart),
            terminalLineEnding,
        ),
    ]);
}

export function criticMarkerText(
    markers: readonly ICriticMarkupStateMarker[] | undefined,
): string {
    if (!markers?.length)
        return '';

    const ordered = markers.every(marker =>
        marker.sourceOffset !== undefined)
        ? [...markers].sort((left, right) =>
                left.sourceOffset! - right.sourceOffset!)
        : markers;
    return ordered.map((marker) => {
        const expected = criticMarkupMarkerRaw(
            marker.type,
            marker.marker,
        );
        if (marker.raw !== expected) {
            throw new TypeError(
                'State CriticMarkup marker differs from grammar-owned syntax.',
            );
        }
        return marker.raw;
    }).join('');
}

export function weaveCriticSourceTrivia(
    states: readonly TState[],
    clean: TTrackedMarkdown,
): TTrackedMarkdown {
    const insertions: Array<{
        readonly offset: number;
        readonly edge: 'after' | 'before';
        readonly depth: number;
        readonly markdown: TTrackedMarkdown;
    }> = [];
    const pending: Array<{
        readonly states: readonly TState[];
        readonly parentPath: TMarkdownStatePath;
    }> = [{ states, parentPath: markdownStatePath([]) }];
    while (pending.length) {
        const current = pending.pop()!;
        current.states.forEach((state, index) => {
            const path = markdownStatePath([
                ...current.parentPath,
                index,
            ]);
            const before = criticMarkerText(
                state.sourceTrivia?.criticBefore,
            );
            const after = criticMarkerText(
                state.sourceTrivia?.criticAfter,
            );
            const beforeSuffix = state.sourceTrivia?.criticBeforeSuffix
                ?? '';
            const afterPrefix = state.sourceTrivia?.criticAfterPrefix
                ?? '';
            const afterSuffix = state.sourceTrivia?.criticAfterSuffix
                ?? '';
            if (beforeSuffix && !before) {
                throw new TypeError(
                    'Critic before-marker suffix has no before marker.',
                );
            }
            if (afterPrefix && !after) {
                throw new TypeError(
                    'Critic after-marker prefix has no after marker.',
                );
            }
            if (afterSuffix && !after) {
                throw new TypeError(
                    'Critic after-marker suffix has no after marker.',
                );
            }
            if (before || after) {
                const range = clean.sourceMap.nodeRange(path);
                if (!range) {
                    throw new TypeError(
                        'State CriticMarkup trivia has no native node range.',
                    );
                }
                if (before) {
                    insertions.push({
                        offset: range.start,
                        edge: 'before',
                        depth: path.length,
                        markdown: concatMarkdown([
                            plainMarkdown(before),
                            ...(beforeSuffix
                                ? [plainMarkdown(beforeSuffix).withNode(path)]
                                : []),
                        ]),
                    });
                }
                if (after) {
                    // A flush after-marker sits between the node's text
                    // and its own line terminator (`first{++` before the
                    // paragraph's LF), so it weaves inside the newline.
                    let afterOffset = range.end;
                    if (state.sourceTrivia?.criticAfterFlush) {
                        if (clean.text.slice(
                            afterOffset - 2,
                            afterOffset,
                        ) === '\r\n') {
                            afterOffset = sourceOffset(afterOffset - 2);
                        }
                        else if (clean.text[afterOffset - 1] === '\n') {
                            afterOffset = sourceOffset(afterOffset - 1);
                        }
                    }
                    insertions.push({
                        offset: afterOffset,
                        edge: 'after',
                        depth: path.length,
                        markdown: concatMarkdown([
                            ...(afterPrefix
                                ? [plainMarkdown(afterPrefix).withNode(path)]
                                : []),
                            plainMarkdown(after),
                            ...(afterSuffix
                                ? [plainMarkdown(afterSuffix).withNode(path)]
                                : []),
                        ]),
                    });
                }
            }
            if ('children' in state) {
                pending.push({
                    states: state.children as TState[],
                    parentPath: markdownStatePath([
                        ...path,
                        'children',
                    ]),
                });
            }
        });
    }
    if (!insertions.length)
        return clean;

    insertions.sort((left, right) =>
        left.offset - right.offset
        || (left.edge === right.edge
            ? left.edge === 'before'
                ? left.depth - right.depth
                : right.depth - left.depth
            : left.edge === 'after' ? -1 : 1));
    const parts: TTrackedMarkdown[] = [];
    let cursor = 0;
    for (const insertion of insertions) {
        if (cursor < insertion.offset) {
            parts.push(sliceMarkdownForWeave(
                clean,
                cursor,
                insertion.offset,
            ));
            cursor = insertion.offset;
        }
        parts.push(insertion.markdown);
    }
    if (!clean.text.length) {
        // Preserve the zero-width native node that owns a marker-only
        // Critic boundary. Without this carrier, weaving the marker bytes
        // would leave no AST boundary for document/UI binding.
        parts.push(clean);
    }
    if (cursor < clean.text.length) {
        parts.push(sliceMarkdownForWeave(
            clean,
            cursor,
            clean.text.length,
        ));
    }
    return concatMarkdown(parts);
}
