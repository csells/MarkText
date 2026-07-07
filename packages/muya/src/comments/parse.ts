import type { TBlockPath } from '../block/types';
import type { CommentMarkerToken, HTMLTagToken, Token } from '../inlineRenderer/types';
import type { IMarkdownToStateOptions } from '../state/markdownToState';
import type { TState } from '../state/types';
import type {
    ICommentDiagnostic,
    ICommentMetadata,
    ICommentRange,
    ICommentThread,
    IParsedMarkdownComments,
} from './types';
import { tokenizer } from '../inlineRenderer/lexer';
import { MarkdownToState } from '../state/markdownToState';
import { stripRealCommentMarkersFromText } from './markerScan';
import { decodeCommentMetadata } from './metadata';
import { commentPathKey } from './range';
import {
    LITERAL_COMMENT_TEXT_STATES,
    parseCommentMetadataDefinition,
    parseMalformedCommentMarker,
} from './syntax';

interface IOpenMarker {
    id: string;
    path: TBlockPath;
    endOffset: number;
}

interface ICloseMarker {
    id: string;
    path: TBlockPath;
    startOffset: number;
}

function diagnostic(code: ICommentDiagnostic['code'], id: string, message: string): ICommentDiagnostic {
    return { code, id, message };
}

function isTextState(state: TState): state is Extract<TState, { text: string }> {
    return 'text' in state && typeof state.text === 'string';
}

const NON_INLINE_COMMENT_TEXT_STATES = LITERAL_COMMENT_TEXT_STATES;

function shouldScanInlineText(state: TState): state is Extract<TState, { text: string }> {
    return isTextState(state) && !NON_INLINE_COMMENT_TEXT_STATES.has(state.name);
}

function flatten(tokens: Token[]): Token[] {
    return tokens.flatMap(token =>
        'children' in token && Array.isArray(token.children)
            ? [token, ...flatten(token.children)]
            : [token],
    );
}

function isCommentMarkerToken(token: Token): token is CommentMarkerToken {
    return token.type === 'comment_marker';
}

function isHtmlTagToken(token: Token): token is HTMLTagToken {
    return token.type === 'html_tag';
}

function commentSyntaxTokens(text: string): Token[] {
    return flatten(
        tokenizer(text, {
            hasBeginRules: false,
            options: { superSubScript: true, footnote: false },
        }),
    ).filter(token => isCommentMarkerToken(token) || isHtmlTagToken(token));
}

type TParseMarkdownCommentOptions = Partial<IMarkdownToStateOptions>;

function markdownToStates(markdownOrStates: string | TState[], options?: TParseMarkdownCommentOptions) {
    if (typeof markdownOrStates !== 'string')
        return markdownOrStates;

    const markdown = markdownOrStates.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
    return new MarkdownToState(options as IMarkdownToStateOptions | undefined).generate(markdown);
}

function selectedTextPreview(
    textEntries: Array<{ path: TBlockPath; text: string }>,
    open: IOpenMarker,
    close: ICloseMarker,
): string {
    const startKey = commentPathKey(open.path);
    const endKey = commentPathKey(close.path);
    const startIndex = textEntries.findIndex(entry => commentPathKey(entry.path) === startKey);
    const endIndex = textEntries.findIndex(entry => commentPathKey(entry.path) === endKey);
    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex)
        return '';

    const parts: string[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
        const entry = textEntries[index];
        const startOffset = index === startIndex ? open.endOffset : 0;
        const endOffset = index === endIndex ? close.startOffset : entry.text.length;
        parts.push(stripRealCommentMarkersFromText(entry.text.slice(startOffset, endOffset)));
    }

    return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

// Clipboard-facing strip over COPY STATE: markers removed from commentable
// leaf text, hidden metadata definition lines dropped, and literal contexts
// (code/html/math/diagram/front matter) left byte-verbatim — the exact same
// per-state rules this parser applies, so a copy can never mangle a fence.
export function stripCommentSyntaxFromStates(states: TState[]): TState[] {
    const out: TState[] = [];
    for (const state of states) {
        const next = { ...state } as TState;
        if (shouldScanInlineText(state)) {
            if (parseCommentMetadataDefinition(state.text))
                continue;
            const lines = stripRealCommentMarkersFromText(state.text)
                .split('\n')
                .filter(line => !parseCommentMetadataDefinition(line));
            if (lines.length === 0)
                continue;
            (next as Extract<TState, { text: string }>).text = lines.join('\n');
        }
        if ('children' in state && Array.isArray(state.children)) {
            const children = stripCommentSyntaxFromStates(state.children);
            if (children.length === 0)
                continue;
            (next as { children: TState[] }).children = children;
        }
        out.push(next);
    }
    return out;
}

export function parseMarkdownComments(
    markdownOrStates: string | TState[],
    options?: TParseMarkdownCommentOptions,
): IParsedMarkdownComments {
    // Fast path: every comment marker (`<!--MC:`) and metadata definition
    // (`[MC:`) contains the literal `MC:`, and no diagnostic can arise without
    // one of them. A document lacking `MC:` has no comments, so skip the
    // expensive full-document re-parse this would otherwise run on every load.
    if (typeof markdownOrStates === 'string' && !markdownOrStates.includes('MC:'))
        return { threads: [], ranges: [], diagnostics: [] };

    const states = markdownToStates(markdownOrStates, options);
    const diagnostics: ICommentDiagnostic[] = [];
    const ranges: ICommentRange[] = [];
    const textEntries: Array<{ path: TBlockPath; text: string }> = [];
    const openMarkers = new Map<string, IOpenMarker>();
    const ignoredDuplicateOpenMarkers = new Map<string, number>();
    const rangeIds = new Set<string>();
    const seenMetadataIds = new Set<string>();
    const metadataById = new Map<string, ICommentMetadata>();

    const recordClose = (close: ICloseMarker) => {
        const open = openMarkers.get(close.id);
        if (!open) {
            const ignoredCount = ignoredDuplicateOpenMarkers.get(close.id) ?? 0;
            if (ignoredCount > 0) {
                if (ignoredCount === 1)
                    ignoredDuplicateOpenMarkers.delete(close.id);
                else
                    ignoredDuplicateOpenMarkers.set(close.id, ignoredCount - 1);
                return;
            }

            if (rangeIds.has(close.id)) {
                diagnostics.push(diagnostic(
                    'duplicate-close-marker',
                    close.id,
                    `Found duplicate closing marker for comment "${close.id}".`,
                ));
                return;
            }

            diagnostics.push(diagnostic(
                'orphan-close-marker',
                close.id,
                `Found closing comment marker for "${close.id}" without a matching open marker.`,
            ));
            return;
        }

        ranges.push({
            id: close.id,
            startPath: open.path,
            endPath: close.path,
            startOffset: open.endOffset,
            endOffset: close.startOffset,
            preview: selectedTextPreview(textEntries, open, close),
        });
        rangeIds.add(close.id);
        openMarkers.delete(close.id);
    };

    const recordMetadata = (metadata: ReturnType<typeof parseCommentMetadataDefinition>) => {
        if (metadata) {
            if (seenMetadataIds.has(metadata.id)) {
                diagnostics.push(diagnostic(
                    'duplicate-metadata',
                    metadata.id,
                    `Found duplicate metadata definition for comment "${metadata.id}".`,
                ));
            }
            seenMetadataIds.add(metadata.id);

            try {
                const decoded = decodeCommentMetadata(metadata.dataUri);
                if (!metadataById.has(metadata.id))
                    metadataById.set(metadata.id, decoded);
            }
            catch (error) {
                diagnostics.push(diagnostic(
                    'invalid-metadata',
                    metadata.id,
                    error instanceof Error ? error.message : `Metadata for comment "${metadata.id}" is invalid.`,
                ));
            }
        }
    };

    const scanText = (text: string, path: TBlockPath) => {
        // Every marker/metadata/malformed candidate contains the literal `MC:`.
        if (!text.includes('MC:'))
            return;

        const lines = text.split('\n');
        let hasMetadataLine = false;
        for (const line of lines) {
            const metadata = parseCommentMetadataDefinition(line);
            if (!metadata)
                continue;
            hasMetadataLine = true;
            recordMetadata(metadata);
        }

        if (hasMetadataLine && lines.length === 1)
            return;

        for (const token of commentSyntaxTokens(text)) {
            if (!isCommentMarkerToken(token)) {
                const malformed = parseMalformedCommentMarker(token.raw);
                if (malformed) {
                    diagnostics.push(diagnostic(
                        'malformed-marker',
                        malformed.id,
                        `Found malformed comment ${malformed.kind} marker "${malformed.raw}".`,
                    ));
                }
                continue;
            }

            if (token.markerKind === 'open') {
                if (openMarkers.has(token.markerId) || rangeIds.has(token.markerId)) {
                    diagnostics.push(diagnostic(
                        'duplicate-open-marker',
                        token.markerId,
                        `Found duplicate opening marker for comment "${token.markerId}".`,
                    ));
                    ignoredDuplicateOpenMarkers.set(
                        token.markerId,
                        (ignoredDuplicateOpenMarkers.get(token.markerId) ?? 0) + 1,
                    );
                    continue;
                }

                openMarkers.set(token.markerId, {
                    id: token.markerId,
                    path,
                    endOffset: token.range.end,
                });
            }
            else {
                recordClose({
                    id: token.markerId,
                    path,
                    startOffset: token.range.start,
                });
            }
        }
    };

    const visit = (nodes: TState[], path: TBlockPath = []) => {
        nodes.forEach((state, index) => {
            const statePath = [...path, index];
            if (isTextState(state) && shouldScanInlineText(state)) {
                textEntries.push({ path: [...statePath, 'text'], text: state.text });
                scanText(state.text, [...statePath, 'text']);
            }

            if ('children' in state && Array.isArray(state.children))
                visit(state.children, [...statePath, 'children']);
        });
    };

    visit(states);

    for (const open of openMarkers.values()) {
        diagnostics.push(diagnostic(
            'unclosed-open-marker',
            open.id,
            `Found opening comment marker for "${open.id}" without a matching close marker.`,
        ));
    }

    for (const range of ranges) {
        if (!metadataById.has(range.id)) {
            diagnostics.push(diagnostic(
                'missing-metadata',
                range.id,
                `Comment "${range.id}" has markers but no metadata definition.`,
            ));
        }
    }

    for (const id of metadataById.keys()) {
        if (!rangeIds.has(id)) {
            diagnostics.push(diagnostic(
                'orphan-metadata',
                id,
                `Comment "${id}" has metadata but no marker range.`,
            ));
        }
    }

    const threads: ICommentThread[] = [];
    for (const [id, metadata] of metadataById.entries()) {
        if (rangeIds.has(id))
            threads.push({ id, ...metadata });
    }

    return { threads, ranges, diagnostics };
}
