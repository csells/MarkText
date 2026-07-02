import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentMetadata, ICommentReplyInput } from './types';
import { tokenizer } from '../inlineRenderer/lexer';
import { MarkdownToState } from '../state/markdownToState';
import ExportMarkdown from '../state/stateToMarkdown';
import { decodeCommentMetadata, encodeCommentMetadata, normalizeCommentMetadata } from './metadata';
import { buildTextPathIndexes, commentPathKey, orderTextRange } from './range';
import { buildCommentSourceIndex } from './source';
import {
    COMMENT_MARKER_PATTERN,
    isValidCommentId,
    parseCommentMetadataDefinition,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
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

type TCommentRangeTargetInput = Omit<IWrapCommentRangeInput, 'metadata'>;

interface IValidatedCommentRange {
    range: {
        startPath: TBlockPath;
        endPath: TBlockPath;
        startOffset: number;
        endOffset: number;
    };
    startText: string;
    endText: string;
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

// Must accept every line the parser's COMMENT_METADATA_DEFINITION_REGEXP
// accepts (any payload tail; decode validates it), or a thread the parser
// surfaces becomes silently un-editable — e.g. a base64 payload containing
// whitespace, which forgiving-base64 decodes but a \S*-only matcher rejects.
// Matches only the `[MC:id]: ` label prefix (with its trailing spaces); the
// payload and trailing whitespace are split off arithmetically to avoid a
// backtracking-prone `(.*?)(\s*)$` tail.
const COMMENT_METADATA_LINE_PREFIX_REGEXP = /^ {0,3}\[MC:[^\]\s]+\]:[^\S\n]*/;

// Split a metadata-definition line into its rewriteable pieces: the label
// prefix (kept verbatim) and any trailing whitespace (preserved), leaving the
// payload to be replaced. Returns null when the line is not a definition.
function splitCommentMetadataLine(line: string): { prefix: string; trailing: string } | null {
    const match = COMMENT_METADATA_LINE_PREFIX_REGEXP.exec(line);
    if (!match)
        return null;

    const prefix = match[0];
    let end = line.length;
    while (end > prefix.length && /\s/u.test(line[end - 1]))
        end -= 1;

    return { prefix, trailing: line.slice(end) };
}

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
    return tokenizer(text, { options: { superSubScript: false, footnote: false } }).some(token =>
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

function selectionContainsNonWhitespace(
    states: TState[],
    indexes: Map<string, number>,
    startPath: TBlockPath,
    endPath: TBlockPath,
    startOffset: number,
    endOffset: number,
): boolean {
    const startIndex = indexes.get(commentPathKey(startPath));
    const endIndex = indexes.get(commentPathKey(endPath));
    if (startIndex == null || endIndex == null)
        return false;

    let textIndex = 0;
    let containsNonWhitespace = false;

    const visit = (nodes: TState[]) => {
        for (const state of nodes) {
            if ('text' in state && typeof state.text === 'string') {
                if (textIndex >= startIndex && textIndex <= endIndex) {
                    const selectionStart = textIndex === startIndex ? startOffset : 0;
                    const selectionEnd = textIndex === endIndex ? endOffset : state.text.length;
                    if (state.text.slice(selectionStart, selectionEnd).trim().length > 0)
                        containsNonWhitespace = true;
                }
                textIndex += 1;
            }

            if (containsNonWhitespace)
                return;

            if ('children' in state && Array.isArray(state.children))
                visit(state.children);
        }
    };

    visit(states);
    return containsNonWhitespace;
}

function validateCommentRangeTarget({
    states,
    path,
    endPath = path,
    startOffset,
    endOffset,
    id,
}: TCommentRangeTargetInput): IValidatedCommentRange | null {
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
        !selectionContainsNonWhitespace(
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
        selectionIntersectsAcrossLeaves(
            states,
            indexes,
            range.startPath,
            range.endPath,
            range.startOffset,
            range.endOffset,
            selectionIntersectsInlineCode,
        )
    ) {
        return null;
    }
    if (
        selectionIntersectsAcrossLeaves(
            states,
            indexes,
            range.startPath,
            range.endPath,
            range.startOffset,
            range.endOffset,
            selectionIntersectsCommentMarker,
        )
    ) {
        return null;
    }

    return { range, startText, endText };
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

export function canWrapCommentRange(input: TCommentRangeTargetInput): boolean {
    const validation = validateCommentRangeTarget(input);
    return !!validation && (
        commentPathKey(validation.range.startPath) !== commentPathKey(validation.range.endPath)
        || validation.range.startOffset < validation.range.endOffset
    );
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
    const validation = validateCommentRangeTarget({ states, path, endPath, startOffset, endOffset, id });
    if (!validation)
        return null;

    const { range, startText, endText } = validation;

    const openMarker = serializeCommentMarker(id, 'open');
    const closeMarker = serializeCommentMarker(id, 'close');
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
        text: serializeCommentMetadataDefinition(id, encodeCommentMetadata(metadata)),
    });

    return states;
}

export function updateCommentMetadataDefinition(
    states: TState[],
    id: string,
    updater: (metadata: ICommentMetadata) => ICommentMetadata,
): TState[] | null {
    let updated = false;
    // Scan each line of a leaf's text, not just leaves whose entire text is a
    // definition: marked folds a definition that is not blank-line-isolated into
    // a multi-line paragraph, and it must still be updatable in place.
    const found = visitStateTexts(states, (state) => {
        const lines = state.text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const definition = parseCommentMetadataDefinition(lines[index]);
            if (!definition || definition.id !== id)
                continue;

            let current: ICommentMetadata;
            try {
                current = decodeCommentMetadata(definition.dataUri);
            }
            catch {
                continue;
            }

            const parts = splitCommentMetadataLine(lines[index]);
            if (!parts)
                continue;

            lines[index] = `${parts.prefix}${encodeCommentMetadata(normalizeCommentMetadata(updater(current)))}${parts.trailing}`;
            state.text = lines.join('\n');
            updated = true;
            return true;
        }
        return false;
    });

    return found && updated ? states : null;
}

export function updateCommentMetadataInMarkdown(
    markdown: string,
    id: string,
    updater: (metadata: ICommentMetadata) => ICommentMetadata,
): string | null {
    const sourceIndex = buildCommentSourceIndex(markdown);
    for (const sourceDefinition of sourceIndex.metadataDefinitions) {
        if (sourceDefinition.id !== id)
            continue;

        let current: ICommentMetadata;
        try {
            current = decodeCommentMetadata(sourceDefinition.dataUri);
        }
        catch {
            continue;
        }

        const sourceLine = markdown.slice(sourceDefinition.start, sourceDefinition.end);
        const parts = splitCommentMetadataLine(sourceLine);
        if (!parts)
            continue;

        const nextDataUri = encodeCommentMetadata(normalizeCommentMetadata(updater(current)));
        if (nextDataUri === sourceDefinition.dataUri)
            return markdown;

        const nextLine = `${parts.prefix}${nextDataUri}${parts.trailing}`;
        return `${markdown.slice(0, sourceDefinition.start)}${nextLine}${markdown.slice(sourceDefinition.end)}`;
    }

    const normalizedMarkdown = markdown.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
    const states = new MarkdownToState().generate(normalizedMarkdown);
    const before = new ExportMarkdown().generate(states);
    const nextStates = updateCommentMetadataDefinition(states, id, updater);
    if (!nextStates)
        return null;

    const after = new ExportMarkdown().generate(nextStates);
    if (after === before)
        return markdown;

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const metadataLineIndex = beforeLines.findIndex((line, index) =>
        line !== afterLines[index]
        && parseCommentMetadataDefinition(line)?.id === id
        && parseCommentMetadataDefinition(afterLines[index])?.id === id,
    );
    if (metadataLineIndex < 0)
        return null;

    const previousLine = beforeLines[metadataLineIndex];
    const nextLine = afterLines[metadataLineIndex];

    let targetOccurrence = 0;
    for (let index = 0; index < metadataLineIndex; index += 1) {
        if (beforeLines[index] === previousLine)
            targetOccurrence += 1;
    }

    const parts = markdown.split(/(\r\n|\n|\r)/u);
    let occurrence = 0;
    for (let index = 0; index < parts.length; index += 2) {
        const sourceLine = parts[index];
        if (sourceLine == null)
            continue;

        const hasBom = index === 0 && sourceLine.startsWith('\uFEFF');
        const comparableSourceLine = hasBom ? sourceLine.slice(1) : sourceLine;
        if (comparableSourceLine !== previousLine)
            continue;

        if (occurrence === targetOccurrence) {
            parts[index] = `${hasBom ? '\uFEFF' : ''}${nextLine}`;
            return parts.join('');
        }

        occurrence += 1;
    }

    return null;
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

export function appendCommentReplyMetadata(
    metadata: ICommentMetadata,
    reply: ICommentReplyInput,
): ICommentMetadata {
    const createdAt = reply.createdAt ?? new Date().toISOString();
    const authors = metadata.authors ? [...metadata.authors] : [];
    if (reply.author && !authors.includes(reply.author))
        authors.push(reply.author);

    return mergeCommentMetadataPatch(metadata, {
        ...(authors.length ? { authors } : {}),
        updatedAt: createdAt,
        replies: [
            ...metadata.replies,
            {
                author: reply.author,
                createdAt,
                body: reply.body,
            },
        ],
    });
}
