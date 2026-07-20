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
    const wanted = states.at(-1)?.sourceTrivia?.terminalLineEnding;
    const actual = markdown.text.endsWith('\r\n')
        ? '\r\n'
        : markdown.text.endsWith('\n') ? '\n' : '';
    if (wanted === undefined || actual === wanted)
        return markdown;

    if (!actual) {
        return wanted
            ? concatMarkdown([markdown, plainMarkdown(wanted)])
            : markdown;
    }

    const terminalStart = markdown.text.length - actual.length;
    return concatMarkdown([
        sliceMarkdown(markdown, 0, terminalStart),
        replaceGeneratedMarkdown(
            // A structural node ending exactly before the terminal byte does
            // not own that byte. The ordinary mapped slice preserves its
            // zero-width boundary envelope on both sides of the cut; if that
            // envelope is expanded to CRLF, an after-marker is then woven
            // past the document terminator. Use the weave slice's half-open
            // node ownership for this replacement chunk.
            sliceMarkdownForWeave(markdown, terminalStart),
            wanted,
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
        return `${marker.rawPrefix ?? ''}${marker.raw}`;
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
        readonly pathKey: string;
        readonly markdown: TTrackedMarkdown;
        /**
         * Whitespace owed before the markers whose leading newlines yield
         * to bytes already serialized directly before the insertion point
         * — resolved during assembly so co-located insertions cannot yield
         * to the same byte twice.
         */
        readonly deferredPrefix?: {
            readonly text: string;
            readonly path: TMarkdownStatePath;
        };
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
                        pathKey: path.join('\u0000'),
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
                    // Only a newline inside this state's own range can be
                    // its terminator; a zero-width synthetic state must not
                    // hijack the preceding block's line ending.
                    if (
                        state.sourceTrivia?.criticAfterFlush
                        && range.start < afterOffset
                    ) {
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
                    const deferPrefix = afterPrefix
                        && !state.sourceTrivia?.criticAfterFlush;
                    insertions.push({
                        offset: afterOffset,
                        pathKey: path.join('\u0000'),
                        edge: 'after',
                        depth: path.length,
                        ...(deferPrefix
                            ? {
                                    deferredPrefix: {
                                        text: afterPrefix,
                                        path,
                                    },
                                }
                            : {}),
                        markdown: concatMarkdown([
                            ...(afterPrefix && !deferPrefix
                                ? [plainMarkdown(afterPrefix)
                                        .withNode(path)]
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
            // At a shared offset, a previous node's closer precedes the next
            // node's opener — except on a zero-width node carrying both
            // edges itself, where its own opener must come first.
            : left.pathKey === right.pathKey
                ? left.edge === 'before' ? -1 : 1
                : left.edge === 'after' ? -1 : 1));
    const parts: TTrackedMarkdown[] = [];
    let cursor = 0;
    // Only the trailing bytes matter for prefix yielding; whitespace runs
    // are short, so a bounded tail avoids re-concatenating the document.
    let assembledTail = '';
    const pushPart = (part: TTrackedMarkdown): void => {
        parts.push(part);
        assembledTail = (assembledTail + part.text).slice(-1024);
    };
    for (const insertion of insertions) {
        if (cursor < insertion.offset) {
            pushPart(sliceMarkdownForWeave(
                clean,
                cursor,
                insertion.offset,
            ));
            cursor = insertion.offset;
        }
        if (insertion.deferredPrefix) {
            // The prefix's leading newlines yield to bytes the assembly
            // already emitted directly before this point — the node's
            // regenerated terminator, blank lines a loose container
            // re-emits, or a co-located earlier insertion's own run.
            let prefix = insertion.deferredPrefix.text;
            let tailCursor = assembledTail.length;
            while (prefix) {
                const prefixUnit = prefix.startsWith('\r\n')
                    ? '\r\n'
                    : prefix.startsWith('\n') ? '\n' : '';
                if (!prefixUnit)
                    break;
                const assembled = assembledTail.slice(0, tailCursor);
                const tailUnit = assembled.endsWith('\r\n')
                    ? '\r\n'
                    : assembled.endsWith('\n') ? '\n' : '';
                if (!tailUnit) {
                    break;
                }
                // Internal Markdown CRLF is intentionally normalized to LF.
                // Treat either spelling as the same already-emitted line
                // boundary so parser-owned CRLF trivia cannot append a second
                // newline after the generated LF.
                prefix = prefix.slice(prefixUnit.length);
                tailCursor -= tailUnit.length;
            }
            if (prefix) {
                pushPart(plainMarkdown(prefix)
                    .withNode(insertion.deferredPrefix.path));
            }
        }
        pushPart(insertion.markdown);
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
