import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentMetadata } from './types';
import { tokenizer } from '../inlineRenderer/lexer';
import { decodeCommentMetadata, encodeCommentMetadata, normalizeCommentMetadata } from './metadata';
import { buildTextPathIndexes, commentPathKey, orderTextRange } from './range';
import {
    COMMENT_MARKER_PATTERN,
    COMMENT_METADATA_DATA_URI_PREFIX,
    isValidCommentId,
    parseCommentMetadataDefinition,
} from './syntax';

export interface IAddCommentInput {
    id?: string;
    author?: string;
    body?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface IWrapCommentRangeInput {
    states: TState[];
    path: TBlockPath;
    endPath?: TBlockPath;
    startOffset: number;
    endOffset: number;
    id: string;
    metadata: ICommentMetadata;
}

export type TUpdateCommentThreadPatch = Partial<Omit<ICommentMetadata, 'version'>>;

const NON_COMMENTABLE_TEXT_STATES = new Set<TState['name']>([
    'code-block',
    'diagram',
    'frontmatter',
    'html-block',
    'link-reference-definition',
    'math-block',
    'thematic-break',
]);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const COMMENT_METADATA_LINE_REGEXP = new RegExp(
    `^( {0,3}\\[MC:([^\\]\\s]+)\\]:\\s*)(${escapeRegExp(COMMENT_METADATA_DATA_URI_PREFIX)}\\S*)(\\s*)$`,
);

function readPath(root: unknown, path: TBlockPath): unknown {
    let current = root;
    for (const segment of path) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current))
                return undefined;
            current = current[segment];
        }
        else {
            if (typeof current !== 'object' || current == null)
                return undefined;
            current = (current as Record<string, unknown>)[segment];
        }
    }

    return current;
}

function writePath(root: unknown, path: TBlockPath, value: unknown): boolean {
    if (!path.length)
        return false;

    const parent = readPath(root, path.slice(0, -1));
    const key = path[path.length - 1];
    if (typeof key !== 'string' || typeof parent !== 'object' || parent == null)
        return false;

    (parent as Record<string, unknown>)[key] = value;
    return true;
}

function visitStateTexts(states: TState[], visitor: (state: Extract<TState, { text: string }>) => boolean): boolean {
    for (const state of states) {
        if (
            'text' in state
            && typeof state.text === 'string'
            && !NON_COMMENTABLE_TEXT_STATES.has(state.name)
            && visitor(state as Extract<TState, { text: string }>)
        ) {
            return true;
        }

        if ('children' in state && Array.isArray(state.children) && visitStateTexts(state.children, visitor))
            return true;
    }

    return false;
}

function isCommentableTextState(state: TState): boolean {
    if (!('text' in state) || typeof state.text !== 'string')
        return false;

    return !NON_COMMENTABLE_TEXT_STATES.has(state.name) && !parseCommentMetadataDefinition(state.text);
}

function selectionIntersectsInlineCode(text: string, startOffset: number, endOffset: number): boolean {
    return tokenizer(text, { options: {} as never }).some(token =>
        token.type === 'inline_code' && startOffset < token.range.end && endOffset > token.range.start,
    );
}

function selectionIntersectsCommentMarker(text: string, startOffset: number, endOffset: number): boolean {
    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
    for (const match of text.matchAll(markerRegExp)) {
        const markerStart = match.index;
        const markerEnd = markerStart + match[0].length;
        if (startOffset < markerEnd && endOffset > markerStart)
            return true;
    }

    return false;
}

function selectedTextLeavesAreCommentable(
    states: TState[],
    indexes: Map<string, number>,
    startPath: TBlockPath,
    endPath: TBlockPath,
): boolean {
    const startIndex = indexes.get(commentPathKey(startPath));
    const endIndex = indexes.get(commentPathKey(endPath));
    if (startIndex == null || endIndex == null)
        return false;

    let textIndex = 0;
    let isCommentable = true;

    const visit = (nodes: TState[]) => {
        for (const state of nodes) {
            if ('text' in state && typeof state.text === 'string') {
                if (textIndex >= startIndex && textIndex <= endIndex && !isCommentableTextState(state))
                    isCommentable = false;
                textIndex += 1;
            }

            if (!isCommentable)
                return;

            if ('children' in state && Array.isArray(state.children))
                visit(state.children);
        }
    };

    visit(states);
    return isCommentable;
}

function selectionIntersectsInlineCodeAcrossLeaves(
    states: TState[],
    indexes: Map<string, number>,
    startPath: TBlockPath,
    endPath: TBlockPath,
    startOffset: number,
    endOffset: number,
): boolean {
    return selectionIntersectsAcrossLeaves(
        states,
        indexes,
        startPath,
        endPath,
        startOffset,
        endOffset,
        selectionIntersectsInlineCode,
    );
}

function selectionIntersectsCommentMarkerAcrossLeaves(
    states: TState[],
    indexes: Map<string, number>,
    startPath: TBlockPath,
    endPath: TBlockPath,
    startOffset: number,
    endOffset: number,
): boolean {
    return selectionIntersectsAcrossLeaves(
        states,
        indexes,
        startPath,
        endPath,
        startOffset,
        endOffset,
        selectionIntersectsCommentMarker,
    );
}

function selectionIntersectsAcrossLeaves(
    states: TState[],
    indexes: Map<string, number>,
    startPath: TBlockPath,
    endPath: TBlockPath,
    startOffset: number,
    endOffset: number,
    predicate: (text: string, startOffset: number, endOffset: number) => boolean,
): boolean {
    const startIndex = indexes.get(commentPathKey(startPath));
    const endIndex = indexes.get(commentPathKey(endPath));
    if (startIndex == null || endIndex == null)
        return true;

    let textIndex = 0;
    let intersects = false;

    const visit = (nodes: TState[]) => {
        for (const state of nodes) {
            if ('text' in state && typeof state.text === 'string') {
                if (textIndex >= startIndex && textIndex <= endIndex) {
                    const selectionStart = textIndex === startIndex ? startOffset : 0;
                    const selectionEnd = textIndex === endIndex ? endOffset : state.text.length;
                    if (predicate(state.text, selectionStart, selectionEnd))
                        intersects = true;
                }
                textIndex += 1;
            }

            if (intersects)
                return;

            if ('children' in state && Array.isArray(state.children))
                visit(state.children);
        }
    };

    visit(states);
    return intersects;
}

export function createCommentMetadata(input: IAddCommentInput): ICommentMetadata {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;
    const authors = input.author ? [input.author] : undefined;
    const replies = input.body
        ? [{
                author: input.author ?? '',
                createdAt,
                body: input.body,
            }]
        : [];

    return {
        version: 1,
        status: 'open',
        ...(authors ? { authors } : {}),
        createdAt,
        updatedAt,
        replies,
    };
}

export function nextCommentId(existingIds: Iterable<string>): string {
    const existing = new Set(existingIds);
    let index = 1;
    let candidate = `cmt_${index}`;
    while (existing.has(candidate)) {
        index += 1;
        candidate = `cmt_${index}`;
    }

    return candidate;
}

export function wrapCommentRange({
    states,
    path,
    endPath = path,
    startOffset,
    endOffset,
    id,
    metadata,
}: IWrapCommentRangeInput): TState[] | null {
    const indexes = buildTextPathIndexes(states);
    const range = orderTextRange(indexes, path, startOffset, endPath, endOffset);
    if (!range)
        return null;
    if (!isValidCommentId(id) || !selectedTextLeavesAreCommentable(states, indexes, range.startPath, range.endPath))
        return null;

    const startText = readPath(states, range.startPath);
    const endText = readPath(states, range.endPath);
    if (typeof startText !== 'string' || typeof endText !== 'string')
        return null;
    if (
        range.startOffset < 0
        || range.startOffset > startText.length
        || range.endOffset < 0
        || range.endOffset > endText.length
    ) {
        return null;
    }
    if (
        selectionIntersectsInlineCodeAcrossLeaves(
            states,
            indexes,
            range.startPath,
            range.endPath,
            range.startOffset,
            range.endOffset,
        )
    ) {
        return null;
    }
    if (
        selectionIntersectsCommentMarkerAcrossLeaves(
            states,
            indexes,
            range.startPath,
            range.endPath,
            range.startOffset,
            range.endOffset,
        )
    ) {
        return null;
    }

    const openMarker = `<!--MC:${id}-->`;
    const closeMarker = `<!--MC:~${id}-->`;
    if (commentPathKey(range.startPath) === commentPathKey(range.endPath)) {
        if (range.startOffset >= range.endOffset)
            return null;
        if (selectionIntersectsInlineCode(startText, range.startOffset, range.endOffset))
            return null;

        const nextText = [
            startText.slice(0, range.startOffset),
            openMarker,
            startText.slice(range.startOffset, range.endOffset),
            closeMarker,
            startText.slice(range.endOffset),
        ].join('');

        if (!writePath(states, range.startPath, nextText))
            return null;
    }
    else {
        if (
            selectionIntersectsInlineCode(startText, range.startOffset, startText.length)
            || selectionIntersectsInlineCode(endText, 0, range.endOffset)
        ) {
            return null;
        }

        const nextStartText = [
            startText.slice(0, range.startOffset),
            openMarker,
            startText.slice(range.startOffset),
        ].join('');
        const nextEndText = [
            endText.slice(0, range.endOffset),
            closeMarker,
            endText.slice(range.endOffset),
        ].join('');

        if (
            !writePath(states, range.startPath, nextStartText)
            || !writePath(states, range.endPath, nextEndText)
        ) {
            return null;
        }
    }

    states.push({
        name: 'paragraph',
        text: `[MC:${id}]: ${encodeCommentMetadata(metadata)}`,
    });

    return states;
}

export function updateCommentMetadataDefinition(
    states: TState[],
    id: string,
    updater: (metadata: ICommentMetadata) => ICommentMetadata,
): TState[] | null {
    let updated = false;
    const found = visitStateTexts(states, (state) => {
        const definition = parseCommentMetadataDefinition(state.text);
        if (!definition || definition.id !== id)
            return false;

        let current: ICommentMetadata;
        try {
            current = decodeCommentMetadata(definition.dataUri);
        }
        catch {
            return false;
        }

        const next = normalizeCommentMetadata(updater(current));
        const match = COMMENT_METADATA_LINE_REGEXP.exec(state.text);
        if (!match)
            return false;

        state.text = `${match[1]}${encodeCommentMetadata(next)}${match[4]}`;
        updated = true;
        return true;
    });

    return found && updated ? states : null;
}

export function mergeCommentMetadataPatch(
    metadata: ICommentMetadata,
    patch: TUpdateCommentThreadPatch,
): ICommentMetadata {
    return normalizeCommentMetadata({
        ...metadata,
        ...patch,
        version: 1,
        replies: patch.replies ?? metadata.replies,
    });
}
