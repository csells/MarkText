import type { TBlockPath } from '../block/types';
import type { CommentMarkerToken, Token } from '../inlineRenderer/types';
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
import { decodeCommentMetadata } from './metadata';
import { COMMENT_MARKER_SEARCH_REGEXP, parseCommentMetadataDefinition } from './syntax';

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

function shouldScanInlineText(state: TState): state is Extract<TState, { text: string }> {
    return (
        state.name === 'paragraph'
        || state.name === 'atx-heading'
        || state.name === 'setext-heading'
        || state.name === 'table.cell'
        || (state.name === 'html-block' && COMMENT_MARKER_SEARCH_REGEXP.test(state.text))
    );
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

function commentMarkerTokens(text: string): CommentMarkerToken[] {
    return flatten(
        tokenizer(text, {
            hasBeginRules: false,
            options: { superSubScript: true, footnote: false },
        }),
    ).filter(isCommentMarkerToken);
}

function markdownToStates(markdownOrStates: string | TState[]) {
    if (typeof markdownOrStates !== 'string')
        return markdownOrStates;

    return new MarkdownToState().generate(markdownOrStates);
}

export function parseMarkdownComments(markdownOrStates: string | TState[]): IParsedMarkdownComments {
    const states = markdownToStates(markdownOrStates);
    const diagnostics: ICommentDiagnostic[] = [];
    const ranges: ICommentRange[] = [];
    const openMarkers = new Map<string, IOpenMarker>();
    const rangeIds = new Set<string>();
    const metadataById = new Map<string, ICommentMetadata>();

    const recordClose = (close: ICloseMarker) => {
        const open = openMarkers.get(close.id);
        if (!open) {
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
        });
        rangeIds.add(close.id);
        openMarkers.delete(close.id);
    };

    const scanText = (text: string, path: TBlockPath) => {
        const metadata = parseCommentMetadataDefinition(text);
        if (metadata) {
            if (metadataById.has(metadata.id)) {
                diagnostics.push(diagnostic(
                    'duplicate-metadata',
                    metadata.id,
                    `Found duplicate metadata definition for comment "${metadata.id}".`,
                ));
                return;
            }

            try {
                metadataById.set(metadata.id, decodeCommentMetadata(metadata.dataUri));
            }
            catch (error) {
                diagnostics.push(diagnostic(
                    'invalid-metadata',
                    metadata.id,
                    error instanceof Error ? error.message : `Metadata for comment "${metadata.id}" is invalid.`,
                ));
            }
            return;
        }

        for (const token of commentMarkerTokens(text)) {
            if (token.markerKind === 'open') {
                if (openMarkers.has(token.markerId)) {
                    diagnostics.push(diagnostic(
                        'duplicate-open-marker',
                        token.markerId,
                        `Found duplicate opening marker for comment "${token.markerId}".`,
                    ));
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
            if (isTextState(state) && shouldScanInlineText(state))
                scanText(state.text, [...statePath, 'text']);

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
