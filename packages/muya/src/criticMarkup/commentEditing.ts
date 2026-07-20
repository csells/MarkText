import type { TCriticMarkupDocumentToken } from './analysis';
import type { IExcludedRange } from './excludedRanges';
import diff from 'fast-diff';
import { criticMarkupSemanticPayloadView } from './analysis';
import { haveEqualExactPatternMultiplicities } from './exactPatternMultiplicity';
import { ExcludedRanges } from './excludedRanges';
import { createCriticMarkup } from './transform';

export type TCriticMarkupCommentEditPlan
    = | Readonly<{ outcome: 'unchanged' }>
        | Readonly<{ outcome: 'rejected' }>
        | Readonly<{ outcome: 'replace'; replacement: string }>;

interface IEqualSpan {
    readonly oldStart: number;
    readonly oldEnd: number;
    readonly newStart: number;
}

function equalSpans(before: string, after: string): IEqualSpan[] {
    const spans: IEqualSpan[] = [];
    let oldOffset = 0;
    let newOffset = 0;
    for (const [operation, value] of diff(before, after)) {
        if (operation === diff.EQUAL) {
            spans.push({
                oldStart: oldOffset,
                oldEnd: oldOffset + value.length,
                newStart: newOffset,
            });
        }
        if (operation !== diff.INSERT)
            oldOffset += value.length;
        if (operation !== diff.DELETE)
            newOffset += value.length;
    }
    return spans;
}

function relocateOpaqueRange(
    before: string,
    after: string,
    spans: readonly IEqualSpan[],
    range: Readonly<IExcludedRange>,
): IExcludedRange | null {
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (spans[middle].oldEnd <= range.start)
            low = middle + 1;
        else
            high = middle;
    }

    const raw = before.slice(range.start, range.end);
    const candidates = new Set<number>();
    for (
        let index = low;
        index < spans.length && spans[index].oldStart < range.end;
        index++
    ) {
        const span = spans[index];
        const start = span.newStart + range.start - span.oldStart;
        if (
            start >= 0
            && start + raw.length <= after.length
            && after.slice(start, start + raw.length) === raw
        ) {
            candidates.add(start);
        }
    }
    if (candidates.size !== 1)
        return null;
    const [start] = candidates;
    return { start, end: start + raw.length };
}

function relocateOpaqueRanges(
    before: string,
    after: string,
    ranges: readonly Readonly<IExcludedRange>[],
): IExcludedRange[] | null {
    const spans = equalSpans(before, after);
    const relocated = [...ranges]
        .sort((left, right) => left.start - right.start)
        .map(range => relocateOpaqueRange(before, after, spans, range));
    const result: IExcludedRange[] = [];
    let previousEnd = -1;
    for (const range of relocated) {
        if (!range || range.start < previousEnd)
            return null;
        result.push(range);
        previousEnd = range.end;
    }
    return result;
}

/**
 * Plan an in-place comment-body edit without weakening parser ownership.
 *
 * Nested review items and Markdown literals are opaque islands. A text diff
 * may split an unchanged island across equal spans when repeated delimiter-
 * looking text admits several alignments. Exact opaque-pattern multiplicity
 * must remain fixed, and every island must resolve to one whole-range mapping.
 * Missing, duplicated, ambiguous, crossing, or overlapping mappings reject
 * the edit instead of silently rewriting parser-owned bytes.
 */
export function planCriticMarkupCommentEdit(
    source: string,
    token: TCriticMarkupDocumentToken,
    excludedRanges: ExcludedRanges,
    content: string,
): TCriticMarkupCommentEditPlan {
    if (token.type !== 'comment') {
        throw new TypeError(
            'CriticMarkup comment editing requires a comment token.',
        );
    }
    const current = criticMarkupSemanticPayloadView(
        source,
        token,
        token.contentRange,
        excludedRanges,
    );
    // Re-serializing a semantic no-op would protective-escape nested raw
    // delimiters. Preserve the source bytes exactly instead.
    if (content === current.text)
        return Object.freeze({ outcome: 'unchanged' });

    const opaqueRanges = [
        ...current.nestedRanges,
        ...current.literalRanges,
    ];
    const opaquePatterns = opaqueRanges.map(range =>
        current.text.slice(range.start, range.end));
    if (!haveEqualExactPatternMultiplicities(
        current.text,
        content,
        opaquePatterns,
    )) {
        return Object.freeze({ outcome: 'rejected' });
    }

    const opaque = relocateOpaqueRanges(
        current.text,
        content,
        opaqueRanges,
    );
    if (!opaque)
        return Object.freeze({ outcome: 'rejected' });

    return Object.freeze({
        outcome: 'replace',
        replacement: createCriticMarkup(
            { type: 'comment', content },
            { content: ExcludedRanges.from(content.length, opaque) },
        ),
    });
}
