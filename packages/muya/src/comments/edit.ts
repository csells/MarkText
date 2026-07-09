import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentSourceMetadataDefinition, TCommentAnalysisOptions } from './analyze';
import type { ICommentMetadata, ICommentReply, ICommentReplyInput } from './types';
import { analyzeMarkdownComments } from './analyze';
import { inlineCodeRangesInText, realCommentMarkersInText } from './markerScan';
import {
    decodeCommentHeadPayload,
    decodeCommentReplyPayload,
    encodeCommentHeadPayload,
    encodeCommentReplyPayload,
    normalizeCommentMetadata,
    serializeCommentThreadLines,
} from './metadata';
import { buildTextPathIndexes, commentPathKey, orderTextRange } from './range';
import {
    COMMENT_METADATA_DATA_URI_PREFIX,
    COMMENT_METADATA_LINE_PREFIX_REGEXP,
    isCommentMetadataDefinitionText,
    isValidCommentId,
    LITERAL_COMMENT_TEXT_STATES,
    serializeCommentMarker,
    serializeCommentReplyDefinition,
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

export type TUpdateCommentThreadPatch = Partial<ICommentMetadata>;

// Commentability additionally excludes the deprecated
// link-reference-definition state (raw definition text, no prose to anchor).
const NON_COMMENTABLE_TEXT_STATES = new Set<string>([
    ...LITERAL_COMMENT_TEXT_STATES,
    'link-reference-definition',
]);

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

function isCommentableTextState(state: TState): boolean {
    if (!('text' in state) || typeof state.text !== 'string')
        return false;

    return !NON_COMMENTABLE_TEXT_STATES.has(state.name) && !isCommentMetadataDefinitionText(state.text);
}

function selectionIntersectsInlineCode(text: string, startOffset: number, endOffset: number): boolean {
    return inlineCodeRangesInText(text).some(range =>
        startOffset < range.end && endOffset > range.start,
    );
}

function selectionIntersectsCommentMarker(text: string, startOffset: number, endOffset: number): boolean {
    return realCommentMarkersInText(text).some(marker =>
        startOffset < marker.end && endOffset > marker.start,
    );
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
    // Same per-leaf walk as selectionIntersectsAcrossLeaves, but a selection
    // whose endpoints are not in the tree counts as empty (false), not
    // intersecting (true) — so guard the missing-path case before delegating.
    if (indexes.get(commentPathKey(startPath)) == null || indexes.get(commentPathKey(endPath)) == null)
        return false;

    return selectionIntersectsAcrossLeaves(
        states,
        indexes,
        startPath,
        endPath,
        startOffset,
        endOffset,
        (text, selectionStart, selectionEnd) => text.slice(selectionStart, selectionEnd).trim().length > 0,
    );
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
    const authors = input.author ? [input.author] : undefined;
    const replies = input.body
        ? [{
                author: input.author ?? '',
                createdAt,
                body: input.body,
            }]
        : [];

    return {
        status: 'open',
        ...(authors ? { authors } : {}),
        createdAt,
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
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

    // One paragraph state holding the whole thread block: contiguous lines
    // are the appendix convention and round-trip byte-identically.
    states.push({ name: 'paragraph', text: serializeCommentThreadLines(id, metadata).join('\n') });

    return states;
}

// The reconciled shape of one thread's definition lines: which head payload
// to keep, which reply lines to rewrite in place, what to append after the
// thread's last line, and which trailing reply slots to delete. Rewrites and
// appends carry normalized positional indexes; untouched lines keep their
// bytes (and any stale index labels) so parallel Git edits stay mergeable.
interface IThreadLinePlan {
    unchanged: boolean;
    v1Upgrade: boolean;
    headPayload: string | null;
    rewrites: Array<{ slot: number; payload: string }>;
    appends: string[];
    deleteFromSlot: number | null;
}

function planThreadLines(
    id: string,
    headIsV1: boolean,
    currentHead: ICommentMetadata,
    currentLineReplies: ICommentReply[],
    next: ICommentMetadata,
): IThreadLinePlan {
    const current: ICommentMetadata = {
        ...currentHead,
        replies: [...currentHead.replies, ...currentLineReplies],
    };
    const unchanged
        = serializeCommentThreadLines(id, current).join('\n') === serializeCommentThreadLines(id, next).join('\n');
    if (unchanged) {
        return { unchanged, v1Upgrade: false, headPayload: null, rewrites: [], appends: [], deleteFromSlot: null };
    }

    if (headIsV1) {
        // Any real change to a v1 thread rewrites it as v2 lines (read
        // forever, written never); untouched v1 threads keep their bytes.
        return { unchanged, v1Upgrade: true, headPayload: null, rewrites: [], appends: [], deleteFromSlot: null };
    }

    const currentHeadPayload = encodeCommentHeadPayload(currentHead);
    const nextHeadPayload = encodeCommentHeadPayload({ ...next, replies: [] });
    const oldPayloads = currentLineReplies.map(reply => encodeCommentReplyPayload(reply));
    const newPayloads = next.replies.map(reply => encodeCommentReplyPayload(reply));

    const rewrites: IThreadLinePlan['rewrites'] = [];
    for (let slot = 0; slot < Math.min(oldPayloads.length, newPayloads.length); slot += 1) {
        if (oldPayloads[slot] !== newPayloads[slot])
            rewrites.push({ slot, payload: newPayloads[slot] });
    }

    return {
        unchanged,
        v1Upgrade: false,
        headPayload: nextHeadPayload === currentHeadPayload ? null : nextHeadPayload,
        rewrites,
        appends: newPayloads
            .slice(oldPayloads.length)
            .map((payload, offset) => serializeCommentReplyDefinition(id, oldPayloads.length + offset, payload)),
        deleteFromSlot: newPayloads.length < oldPayloads.length ? newPayloads.length : null,
    };
}

interface IDecodedThreadLines {
    head: ICommentSourceMetadataDefinition;
    headMetadata: ICommentMetadata;
    headIsV1: boolean;
    replySlots: Array<{ definition: ICommentSourceMetadataDefinition; reply: ICommentReply }>;
}

function decodeThreadLines(
    definitions: ICommentSourceMetadataDefinition[],
    id: string,
): { decoded: IDecodedThreadLines | null; corruptError: unknown } {
    const threadDefinitions = definitions
        .filter(definition => definition.id === id)
        .sort((a, b) => a.start - b.start);

    let head: ICommentSourceMetadataDefinition | null = null;
    let headMetadata: ICommentMetadata | null = null;
    let corruptError: unknown = null;
    for (const definition of threadDefinitions) {
        if (definition.kind !== 'head')
            continue;
        try {
            headMetadata = decodeCommentHeadPayload(definition.payload);
            head = definition;
            break;
        }
        catch (err) {
            // A duplicate id may still carry a decodable definition, so keep
            // scanning; if none decodes, the caller reports the corrupt
            // payload instead of "no definition found".
            corruptError = err;
        }
    }
    if (!head || !headMetadata)
        return { decoded: null, corruptError };

    // Malformed reply lines are preserved byte-for-byte and surface as
    // invalid-reply diagnostics; the reconciled thread covers the decodable
    // lines only.
    const replySlots: IDecodedThreadLines['replySlots'] = [];
    for (const definition of threadDefinitions) {
        if (definition.kind !== 'reply')
            continue;
        try {
            replySlots.push({ definition, reply: decodeCommentReplyPayload(definition.payload) });
        }
        catch {
            continue;
        }
    }

    return {
        decoded: {
            head,
            headMetadata,
            headIsV1: head.payload.startsWith(COMMENT_METADATA_DATA_URI_PREFIX),
            replySlots,
        },
        corruptError: null,
    };
}

function detectLineEnding(markdown: string, afterIndex: number): string {
    if (markdown.startsWith('\r\n', afterIndex))
        return '\r\n';
    if (markdown[afterIndex] === '\n' || markdown[afterIndex] === '\r')
        return markdown[afterIndex];

    const first = /\r\n|\n|\r/u.exec(markdown);
    return first ? first[0] : '\n';
}

// End of the line INCLUDING its terminator, for whole-line deletion.
function lineSpanWithTerminator(markdown: string, range: { start: number; end: number }): { start: number; end: number } {
    let { end } = range;
    if (markdown.startsWith('\r\n', end))
        end += 2;
    else if (markdown[end] === '\n' || markdown[end] === '\r')
        end += 1;

    return { start: range.start, end };
}

export function updateCommentMetadataInMarkdown(
    markdown: string,
    id: string,
    updater: (metadata: ICommentMetadata) => ICommentMetadata,
    // Locating the definition is analysis: a caller matching an editor whose
    // parse options differ from the engine defaults (footnote block context)
    // must pass the same options here or the definition is invisible to it.
    options?: TCommentAnalysisOptions,
): string | null {
    const analysis = analyzeMarkdownComments(markdown, options);
    const { decoded, corruptError } = decodeThreadLines(analysis.sourceIndex.metadataDefinitions, id);
    if (!decoded) {
        if (corruptError != null) {
            const reason = corruptError instanceof Error ? corruptError.message : String(corruptError);
            throw new Error(`Metadata for comment "${id}" is corrupt and cannot be decoded: ${reason}`);
        }

        return null;
    }

    const { head, headMetadata, headIsV1, replySlots } = decoded;
    const current: ICommentMetadata = {
        ...headMetadata,
        replies: [...headMetadata.replies, ...replySlots.map(slot => slot.reply)],
    };
    const next = normalizeCommentMetadata(updater(current));
    const plan = planThreadLines(id, headIsV1, headMetadata, replySlots.map(slot => slot.reply), next);
    if (plan.unchanged)
        return markdown;

    const eol = detectLineEnding(markdown, head.end);
    const edits: Array<{ start: number; end: number; text: string }> = [];

    if (plan.v1Upgrade) {
        // Preserve the rewritten line's own indentation and trailing
        // whitespace, exactly like an in-place v2 head rewrite.
        const headLine = markdown.slice(head.start, head.end);
        const parts = splitCommentMetadataLine(headLine);
        if (!parts)
            return null;
        const threadLines = serializeCommentThreadLines(id, next);
        const rebuilt = [
            `${parts.prefix}${encodeCommentHeadPayload({ ...next, replies: [] })}${parts.trailing}`,
            ...threadLines.slice(1),
        ].join(eol);
        edits.push({ start: head.start, end: head.end, text: rebuilt });
        // The decodable reply lines were folded into the rewrite above.
        for (const slot of replySlots)
            edits.push({ ...lineSpanWithTerminator(markdown, slot.definition), text: '' });
    }
    else {
        if (plan.headPayload != null) {
            const headLine = markdown.slice(head.start, head.end);
            const parts = splitCommentMetadataLine(headLine);
            if (!parts)
                return null;
            edits.push({ start: head.start, end: head.end, text: `${parts.prefix}${plan.headPayload}${parts.trailing}` });
        }
        for (const rewrite of plan.rewrites) {
            const { definition } = replySlots[rewrite.slot];
            edits.push({
                start: definition.start,
                end: definition.end,
                text: serializeCommentReplyDefinition(id, rewrite.slot, rewrite.payload),
            });
        }
        if (plan.appends.length > 0) {
            const anchor = replySlots.length > 0 ? replySlots[replySlots.length - 1].definition : head;
            // Appending at the end of an unterminated file terminates it —
            // "exactly one line (plus a trailing newline if absent)" — so the
            // next append no longer churns the last line in diff terms.
            const terminator = anchor.end === markdown.length ? eol : '';
            edits.push({
                start: anchor.end,
                end: anchor.end,
                text: `${plan.appends.map(line => `${eol}${line}`).join('')}${terminator}`,
            });
        }
        if (plan.deleteFromSlot != null) {
            for (const slot of replySlots.slice(plan.deleteFromSlot))
                edits.push({ ...lineSpanWithTerminator(markdown, slot.definition), text: '' });
        }
    }

    let result = markdown;
    for (const edit of edits.sort((a, b) => b.start - a.start))
        result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;

    return result;
}

export function mergeCommentMetadataPatch(
    metadata: ICommentMetadata,
    patch: TUpdateCommentThreadPatch,
): ICommentMetadata {
    return normalizeCommentMetadata({
        ...metadata,
        ...patch,
        replies: patch.replies ?? metadata.replies,
    });
}

// A pure reply append: head-level fields (status, authors, updatedAt,
// display) are untouched so the write is exactly one new line — thread
// updatedAt and participant authors are derived at read time.
export function appendCommentReplyMetadata(
    metadata: ICommentMetadata,
    reply: ICommentReplyInput,
): ICommentMetadata {
    const createdAt = reply.createdAt ?? new Date().toISOString();

    return mergeCommentMetadataPatch(metadata, {
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
