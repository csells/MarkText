import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentMetadata } from './types';
import { decodeCommentMetadata, encodeCommentMetadata, normalizeCommentMetadata } from './metadata';
import { buildTextPathIndexes, commentPathKey, orderTextRange } from './range';
import { parseCommentMetadataDefinition } from './syntax';

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
        if ('text' in state && typeof state.text === 'string' && visitor(state as Extract<TState, { text: string }>))
            return true;

        if ('children' in state && Array.isArray(state.children) && visitStateTexts(state.children, visitor))
            return true;
    }

    return false;
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

    const openMarker = `<!--MC:${id}-->`;
    const closeMarker = `<!--MC:~${id}-->`;
    if (commentPathKey(range.startPath) === commentPathKey(range.endPath)) {
        if (range.startOffset >= range.endOffset)
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

        const current = decodeCommentMetadata(definition.dataUri);
        const next = normalizeCommentMetadata(updater(current));
        state.text = `[MC:${id}]: ${encodeCommentMetadata(next)}`;
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
