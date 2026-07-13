import type { TSourceRange } from '../mappedText';
import type { CriticMarkupAnalysis } from './analysis';
import type {
    CriticMarkupDocument,
    TCriticMarkupDocumentToken,
} from './document';
import { sourceOffset, sourceRange } from '../mappedText';
import { ExcludedRanges } from './excludedRanges';
import { serializeCriticMarkupDraft } from './parser';

export interface ICriticMarkupTrackedEdit {
    text: string;
    selectionStart: number;
    selectionEnd: number;
    analysis: CriticMarkupAnalysis;
}

export interface ICriticMarkupTrackContext {
    /** Required canonical documents built with one identical parser option set. */
    beforeDocument: CriticMarkupDocument;
    proposedDocument: CriticMarkupDocument;
    createDocument: (source: string) => CriticMarkupDocument;
}

export interface ICriticMarkupSourceEdit {
    oldRange: TSourceRange;
    inserted: string;
}

interface ITrackedReplacement {
    edit: ICriticMarkupSourceEdit;
    replacement: string;
    authored: boolean;
}

interface IConcreteSourceEdit {
    oldRange: TSourceRange;
}

function editableRanges(token: TCriticMarkupDocumentToken): TSourceRange[] {
    return token.type === 'substitution'
        ? [token.oldRange, token.newRange]
        : [token.contentRange];
}

function rangeContainsEdit(
    range: TSourceRange,
    edit: IConcreteSourceEdit,
): boolean {
    const { oldRange } = edit;
    return oldRange.start === oldRange.end
        ? range.start <= oldRange.start && oldRange.start <= range.end
        : range.start <= oldRange.start && oldRange.end <= range.end;
}

function applyExactEdits(
    source: string,
    edits: readonly ICriticMarkupSourceEdit[],
    replacement: (edit: ICriticMarkupSourceEdit) => string,
): string {
    return [...edits]
        .sort((left, right) => right.oldRange.start - left.oldRange.start)
        .reduce((result, edit) =>
            result.slice(0, edit.oldRange.start)
            + replacement(edit)
            + result.slice(edit.oldRange.end), source);
}

function validatedEdits(
    source: string,
    edits: readonly ICriticMarkupSourceEdit[],
): ICriticMarkupSourceEdit[] | null {
    const sorted = edits.map(edit => ({
        oldRange: { ...edit.oldRange },
        inserted: edit.inserted,
    })).sort((left, right) =>
        left.oldRange.start - right.oldRange.start
        || left.oldRange.end - right.oldRange.end);

    let previous: ICriticMarkupSourceEdit | undefined;
    for (const edit of sorted) {
        const { start, end } = edit.oldRange;
        if (
            !Number.isInteger(start)
            || !Number.isInteger(end)
            || start < 0
            || end < start
            || end > source.length
            || (previous && (
                start < previous.oldRange.end
                || start === previous.oldRange.start
            ))
        ) {
            return null;
        }
        previous = edit;
    }

    return sorted;
}

function authoredReplacement(
    removed: string,
    inserted: string,
    removedOpaque: ExcludedRanges,
    insertedOpaque: ExcludedRanges,
): string {
    return removed && inserted
        ? serializeCriticMarkupDraft({
                type: 'substitution',
                oldContent: removed,
                newContent: inserted,
            }, {
                oldContent: removedOpaque,
                newContent: insertedOpaque,
            })
        : removed
            ? serializeCriticMarkupDraft({
                    type: 'deletion',
                    content: removed,
                }, {
                    content: removedOpaque,
                })
            : serializeCriticMarkupDraft({
                    type: 'addition',
                    content: inserted,
                }, {
                    content: insertedOpaque,
                });
}

function relativeExcludedRanges(
    excludedRanges: ExcludedRanges,
    range: TSourceRange,
): ExcludedRanges {
    return ExcludedRanges.from(
        range.end - range.start,
        excludedRanges.ranges.flatMap((excluded) => {
            const start = Math.max(range.start, excluded.start);
            const end = Math.min(range.end, excluded.end);
            return start < end
                ? [{ start: start - range.start, end: end - range.start }]
                : [];
        }),
    );
}

function assertDocumentSource(
    label: string,
    document: CriticMarkupDocument,
    source: string,
): void {
    if (document.markdown !== source) {
        throw new TypeError(
            `${label} CriticMarkup document belongs to a different source revision.`,
        );
    }
}

function assertMatchingParserAuthority(
    expected: CriticMarkupDocument,
    actual: CriticMarkupDocument,
): void {
    expected.analysis.assertContextCoverage('complete');
    actual.analysis.assertContextCoverage('complete');
    actual.analysis.assertParserProfile(expected.analysis.parserProfile);
}

function assertCanonicalTrackContext(
    context: ICriticMarkupTrackContext | null | undefined,
): asserts context is ICriticMarkupTrackContext {
    if (
        !context?.beforeDocument
        || !context.proposedDocument
        || typeof context.createDocument !== 'function'
    ) {
        throw new TypeError(
            'CriticMarkup Track Changes requires canonical before, proposed, '
            + 'and factory documents.',
        );
    }
}

/**
 * Convert an exact, non-overlapping operation-derived edit set into pure
 * CriticMarkup and prove both projections before returning it.
 */
export function trackCriticMarkupEdits(
    before: string,
    after: string,
    sourceEdits: readonly ICriticMarkupSourceEdit[],
    context: ICriticMarkupTrackContext,
): ICriticMarkupTrackedEdit | null {
    assertCanonicalTrackContext(context);
    const edits = validatedEdits(before, sourceEdits);
    if (!edits?.length)
        return null;
    if (applyExactEdits(before, edits, edit => edit.inserted) !== after)
        return null;
    const { beforeDocument, proposedDocument, createDocument } = context;
    assertDocumentSource('Before', beforeDocument, before);
    assertDocumentSource('Proposed', proposedDocument, after);
    assertMatchingParserAuthority(beforeDocument, proposedDocument);
    const replacements: ITrackedReplacement[] = [];
    let proposedShift = 0;

    for (const edit of edits) {
        const removed = before.slice(edit.oldRange.start, edit.oldRange.end);
        const proposedRange = sourceRange(
            edit.oldRange.start + proposedShift,
            edit.oldRange.start + proposedShift + edit.inserted.length,
        );
        proposedShift += edit.inserted.length
            - (edit.oldRange.end - edit.oldRange.start);
        const completeEdit: IConcreteSourceEdit = {
            oldRange: edit.oldRange,
        };
        const containing = beforeDocument.itemsContainingSourceRange(
            edit.oldRange,
        ).find(item => editableRanges(item.syntax).some(range =>
            rangeContainsEdit(range, completeEdit)))?.syntax;

        if (containing) {
            replacements.push({
                edit,
                replacement: edit.inserted,
                authored: false,
            });
            continue;
        }
        if (beforeDocument.itemIntersectingSourceRange(edit.oldRange)) {
            return null;
        }

        const authored = authoredReplacement(
            removed,
            edit.inserted,
            relativeExcludedRanges(
                beforeDocument.excludedRanges,
                edit.oldRange,
            ),
            relativeExcludedRanges(
                proposedDocument.excludedRanges,
                proposedRange,
            ),
        );
        replacements.push({
            edit,
            replacement: authored,
            authored: true,
        });
    }

    const replacementByEdit = new Map(
        replacements.map(replacement => [replacement.edit, replacement]),
    );
    const tracked = applyExactEdits(
        before,
        edits,
        edit => replacementByEdit.get(edit)!.replacement,
    );
    const replacementStarts = new Map<ITrackedReplacement, number>();
    let trackedShift = 0;
    for (const replacement of replacements) {
        replacementStarts.set(
            replacement,
            replacement.edit.oldRange.start + trackedShift,
        );
        trackedShift += replacement.replacement.length
            - (replacement.edit.oldRange.end
                - replacement.edit.oldRange.start);
    }
    const trackedDocument = createDocument(tracked);
    assertDocumentSource('Tracked', trackedDocument, tracked);
    assertMatchingParserAuthority(beforeDocument, trackedDocument);
    const expectedOriginal = beforeDocument.project('original');
    const expectedRevised = proposedDocument.project('revised');
    if (
        trackedDocument.project('original') !== expectedOriginal
        || trackedDocument.project('revised') !== expectedRevised
    ) {
        return null;
    }

    const last = replacements.at(-1)!;
    const replacementStart = replacementStarts.get(last)!;
    let selection = replacementStart + last.replacement.length;
    if (last.authored) {
        const token = trackedDocument.itemStartingAtSourceOffset(
            sourceOffset(replacementStart),
        )?.syntax;
        if (!token)
            return null;
        selection = token.type === 'substitution'
            ? token.newRange.end
            : token.type === 'deletion'
                ? token.range.end
                : token.contentRange.end;
    }

    return {
        text: tracked,
        selectionStart: selection,
        selectionEnd: selection,
        analysis: trackedDocument.analysis,
    };
}
