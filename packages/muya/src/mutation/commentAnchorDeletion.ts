import type Content from '../block/base/content';
import type {
    CriticMarkupDocument,
    TCriticMarkupDocumentToken,
} from '../criticMarkup/document';
import type { ICriticMarkupSourceEdit } from '../criticMarkup/trackChanges';
import type { Muya } from '../muya';
import type { TMarkdownStatePath, TTrackedMarkdown } from '../state/markdownSourceMap';
import type { ICapturedStateMutation } from '../state/mutationCapture';
import { nestedPointCommentSource } from '../criticMarkup/pointComments';
import { MappedPathIndex, mappedPathsEqual } from '../mapped-range';
import { sourceOffset } from '../mappedText';
import { deriveOperationSourceEdits } from './operationSourceEdits';

interface ILocalRemoval {
    readonly path: TMarkdownStatePath;
    readonly start: number;
    readonly end: number;
    readonly expected: string;
    readonly replacement: string;
}

interface IIndexedSourceEdit {
    readonly index: number;
    readonly start: number;
    readonly end: number;
    readonly inserted: string;
}

/**
 * Immutable search index over the exact, sorted operation edit set. Range
 * queries and old-to-proposed offset mapping stay logarithmic instead of
 * rescanning every edit for every parser-owned comment anchor.
 */
class SourceEditIndex {
    private readonly _edits: readonly IIndexedSourceEdit[];
    private readonly _prefixDelta: readonly number[];

    private constructor(edits: readonly IIndexedSourceEdit[]) {
        this._edits = edits;
        const prefixDelta = [0];
        for (const edit of edits) {
            prefixDelta.push(
                prefixDelta[prefixDelta.length - 1]
                + edit.inserted.length - (edit.end - edit.start),
            );
        }
        this._prefixDelta = prefixDelta;
    }

    static from(
        edits: readonly ICriticMarkupSourceEdit[],
    ): SourceEditIndex | null {
        const indexed: IIndexedSourceEdit[] = [];
        let previous: IIndexedSourceEdit | undefined;
        for (const [index, edit] of edits.entries()) {
            const { start, end } = edit.oldRange;
            if (
                !Number.isInteger(start)
                || !Number.isInteger(end)
                || start < 0
                || end < start
                || previous && (
                    start < previous.end
                    || start === previous.start
                )
            ) {
                return null;
            }
            const current = { index, start, end, inserted: edit.inserted };
            indexed.push(current);
            previous = current;
        }
        return new SourceEditIndex(indexed);
    }

    exactDeletion(
        range: { readonly start: number; readonly end: number },
    ): IIndexedSourceEdit | null {
        const index = this._firstStartAtLeast(range.start);
        const edit = this._edits[index];
        return edit?.start === range.start
            && edit.end === range.end
            && edit.inserted === ''
            ? edit
            : null;
    }

    hasTouchOtherThan(
        range: { readonly start: number; readonly end: number },
        excludedIndex: number,
    ): boolean {
        const first = this._firstEndAfter(range.start);
        const end = this._firstStartAtLeast(range.end);
        const count = Math.max(0, end - first);
        return count > (
            first <= excludedIndex && excludedIndex < end ? 1 : 0
        );
    }

    proposedOffset(
        offset: number,
        affinity: 'left' | 'right' = 'right',
    ): number | null {
        const next = this._firstStartAtLeast(offset);
        const previous = this._edits[next - 1];
        if (previous && previous.start < offset && offset < previous.end)
            return null;

        let applied = this._firstEndAfter(offset);
        const atOffset = this._edits[applied - 1];
        if (
            affinity === 'left'
            && atOffset?.start === offset
            && atOffset.end === offset
        ) {
            applied--;
        }
        return offset + this._prefixDelta[applied];
    }

    private _firstStartAtLeast(offset: number): number {
        let low = 0;
        let high = this._edits.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (this._edits[middle].start < offset)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    }

    private _firstEndAfter(offset: number): number {
        let low = 0;
        let high = this._edits.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (this._edits[middle].end <= offset)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    }
}

function survivingHighlightEndsAt(
    proposed: TTrackedMarkdown,
    edits: SourceEditIndex,
    proposedEnd: number,
    candidates: readonly TCriticMarkupDocumentToken[],
): boolean {
    return candidates.some((candidate) => {
        const start = edits.proposedOffset(candidate.range.start);
        const end = edits.proposedOffset(candidate.range.end, 'left');
        return start !== null
            && end === proposedEnd
            && proposed.text.slice(start, end) === candidate.raw;
    });
}

function captureDeletesSource(
    captured: ICapturedStateMutation<unknown>,
): boolean {
    return captured.intents.some((intent) => {
        if (intent.kind === 'insert')
            return false;
        if (intent.kind === 'text-edit') {
            return intent.edits.some(edit =>
                edit.oldRange.start < edit.oldRange.end);
        }
        return true;
    });
}

function localRemoval(
    document: CriticMarkupDocument,
    proposed: TTrackedMarkdown,
    edits: SourceEditIndex,
    anchor: TCriticMarkupDocumentToken | undefined,
    comment: TCriticMarkupDocumentToken | undefined,
    precedingHighlights: readonly TCriticMarkupDocumentToken[],
): ILocalRemoval | null {
    if (
        anchor?.type !== 'highlight'
        || comment?.type !== 'comment'
        || anchor.contentRange.start === anchor.contentRange.end
    ) {
        return null;
    }

    const payloadDeletion = edits.exactDeletion(anchor.contentRange);
    if (!payloadDeletion)
        return null;

    const commentedSpan = {
        start: anchor.range.start,
        end: comment.range.end,
    };
    if (edits.hasTouchOtherThan(commentedSpan, payloadDeletion.index)) {
        return null;
    }

    const proposedStart = edits.proposedOffset(anchor.range.start);
    const proposedEnd = edits.proposedOffset(anchor.range.end, 'left');
    const proposedCommentStart = edits.proposedOffset(comment.range.start);
    const proposedCommentEnd = edits.proposedOffset(comment.range.end, 'left');
    if (
        proposedStart === null
        || proposedEnd === null
        || proposedCommentStart === null
        || proposedCommentEnd === null
        || proposedEnd !== proposedCommentStart
    ) {
        return null;
    }

    const emptyAnchor = document.markdown.slice(
        anchor.range.start,
        anchor.contentRange.start,
    ) + document.markdown.slice(
        anchor.contentRange.end,
        anchor.range.end,
    );
    if (
        proposed.text.slice(proposedStart, proposedEnd) !== emptyAnchor
        || proposed.text.slice(
            proposedCommentStart,
            proposedCommentEnd,
        ) !== comment.raw
    ) {
        return null;
    }

    const nestedComments = nestedPointCommentSource(anchor);
    // A bare point comment immediately after a different highlight would be
    // reparsed as that highlight's comment. Keep this parser-native empty
    // anchor as an invisible boundary only when the preceding highlight is
    // proven to survive at the exact proposed-source edge.
    const replacement = survivingHighlightEndsAt(
        proposed,
        edits,
        proposedStart,
        precedingHighlights,
    )
        ? emptyAnchor + nestedComments
        : nestedComments;

    const start = proposed.sourceMap.sourceToLocal(
        sourceOffset(proposedStart),
        'next',
    );
    const end = proposed.sourceMap.sourceToLocal(
        sourceOffset(proposedEnd),
        'previous',
    );
    if (!start || !end || !mappedPathsEqual(start.path, end.path))
        return null;

    return {
        path: start.path,
        start: start.offset,
        end: end.offset,
        expected: emptyAnchor,
        replacement,
    };
}

function localRemovals(
    document: CriticMarkupDocument,
    captured: ICapturedStateMutation<unknown>,
    proposed: TTrackedMarkdown,
): ILocalRemoval[] {
    const sourceEdits = deriveOperationSourceEdits(
        captured,
        document.mappedText,
        proposed,
    );
    if (!sourceEdits?.length)
        return [];
    const edits = SourceEditIndex.from(sourceEdits);
    if (!edits)
        return [];

    const highlightsByEnd = new Map<
        number,
        TCriticMarkupDocumentToken[]
    >();
    for (const { syntax } of document.items) {
        if (syntax.type !== 'highlight')
            continue;
        const highlights = highlightsByEnd.get(syntax.range.end) ?? [];
        highlights.push(syntax);
        highlightsByEnd.set(syntax.range.end, highlights);
    }
    const removals: ILocalRemoval[] = [];

    for (const pair of document.commentAnchorPairs()) {
        const anchor = pair.anchor.syntax;
        const comment = pair.comment.syntax;
        const removal = localRemoval(
            document,
            proposed,
            edits,
            anchor,
            comment,
            anchor
                ? highlightsByEnd.get(anchor.range.start) ?? []
                : [],
        );
        if (removal)
            removals.push(removal);
    }

    return removals;
}

/**
 * Collapse an anchor whose exact visible payload was deleted into a point
 * comment. The parser-owned before-document identifies the pair and the
 * captured operation proves the exact deletion; no delimiter text is rescanned.
 */
export function normalizeDeletedCommentAnchors(
    muya: Muya,
    beforeDocument: CriticMarkupDocument,
    captured: ICapturedStateMutation<unknown>,
): void {
    // Ordinary typing in a document that happens to contain a comment anchor
    // must stay on the normal O(local edit) path. Only a captured deletion can
    // empty an existing anchor and justify materializing the proposed source.
    if (!captureDeletesSource(captured))
        return;
    const proposed = muya.editor.jsonState.getMappedMarkdownFromState(
        captured.afterState,
    );
    const removals = localRemovals(beforeDocument, captured, proposed);
    if (!removals.length)
        return;

    const byPath = new MappedPathIndex<
        TMarkdownStatePath,
        ILocalRemoval[]
    >();
    for (const removal of removals) {
        const pathRemovals = byPath.get(removal.path) ?? [];
        pathRemovals.push(removal);
        byPath.set(removal.path, pathRemovals);
    }

    const prepared: Array<{ block: Content; text: string }> = [];
    for (const [path, pathRemovals] of byPath.entries()) {
        const block = muya.editor.scrollPage?.queryBlock([...path]);
        if (!block?.isContent())
            return;
        let text = block.text;
        for (const removal of [...pathRemovals].sort((left, right) =>
            right.start - left.start)) {
            if (text.slice(removal.start, removal.end) !== removal.expected)
                return;
            text = text.slice(0, removal.start)
                + removal.replacement
                + text.slice(removal.end);
        }
        prepared.push({ block, text });
    }

    for (const { block, text } of prepared)
        block.text = text;
}
