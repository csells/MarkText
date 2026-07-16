/**
 * List-item source-trivia serialization: validation of parser-captured
 * list-item trivia, marker/padding resolution, and re-application of the
 * parser-owned physical continuation-line prefixes onto generated output.
 */
import type { TTrackedMarkdown } from './markdownSourceMap';
import type {
    IBulletListState,
    IListItemState,
    IOrderListState,
    ITaskListItemState,
    ITaskListState,
} from './types';
import {
    concatMarkdown,
    replaceGeneratedMarkdown,
    sliceMarkdown,
} from './markdownSourceMap';

export interface IListItemMarkerTrivia {
    readonly markerPadding: string;
    readonly sourceLeadingPrefix: string | undefined;
    readonly sourceMarker: string | undefined;
}

export function assertListItemChildSourceTrivia(
    children: readonly (IListItemState | ITaskListItemState)[],
): void {
    for (const child of children) {
        const leadingPrefix = child.sourceTrivia?.listItemLeadingPrefix;
        if (
            leadingPrefix !== undefined
            && !/^[ \t]*$/.test(leadingPrefix)
        ) {
            throw new TypeError(
                'State source trivia listItemLeadingPrefix must be whitespace.',
            );
        }
        const markerPadding = child.sourceTrivia?.listItemMarkerPadding;
        if (
            markerPadding !== undefined
            && !/^[ \t]*$/.test(markerPadding)
        ) {
            throw new TypeError(
                'State source trivia listItemMarkerPadding must be whitespace.',
            );
        }
        const trailing = child.sourceTrivia?.listItemTrailingBlankLines;
        if (
            trailing !== undefined
            && (!Number.isSafeInteger(trailing) || trailing < 0)
        ) {
            throw new TypeError(
                'State source trivia listItemTrailingBlankLines must be a nonnegative safe integer.',
            );
        }
        const prefixes = child.sourceTrivia?.listItemContinuationPrefixes;
        if (
            prefixes !== undefined
            && (
                !Array.isArray(prefixes)
                || prefixes.some(prefix =>
                    typeof prefix !== 'string'
                    || !/^[ \t]*$/.test(prefix))
            )
        ) {
            throw new TypeError(
                'State source trivia listItemContinuationPrefixes must contain whitespace strings.',
            );
        }
    }
}

export function startsWithEmptyDashBulletItem(
    state: IOrderListState | IBulletListState | ITaskListState,
) {
    if (state.name !== 'bullet-list' || state.meta.marker !== '-')
        return false;

    const firstItem = state.children[0];
    if (!firstItem)
        return false;
    if (firstItem.children.length === 0)
        return true;

    const firstChild = firstItem.children[0];
    return firstChild.name === 'paragraph' && firstChild.text.trim() === '';
}

export function readListItemMarkerTrivia(
    state: IListItemState | ITaskListItemState,
): IListItemMarkerTrivia {
    const { children } = state;
    const sourceLeadingPrefix
        = state.sourceTrivia?.listItemLeadingPrefix;
    if (
        sourceLeadingPrefix !== undefined
        && !/^[ \t]*$/.test(sourceLeadingPrefix)
    ) {
        throw new TypeError(
            'State source trivia listItemLeadingPrefix must be whitespace.',
        );
    }
    const sourceMarker = state.sourceTrivia?.listItemMarker;
    if (
        sourceMarker !== undefined
        && !/^(?:[*+-]|\d{1,9}[.)])$/.test(sourceMarker)
    ) {
        throw new TypeError(
            'State source trivia listItemMarker is not a CommonMark list marker.',
        );
    }
    const sourceMarkerPadding
        = state.sourceTrivia?.listItemMarkerPadding;
    if (
        sourceMarkerPadding !== undefined
        && !/^[ \t]*$/.test(sourceMarkerPadding)
    ) {
        throw new TypeError(
            'State source trivia listItemMarkerPadding must be whitespace.',
        );
    }
    // Marked trims the final empty item's post-marker space before it
    // recursively tokenizes a parent item. Preserve MarkText's established
    // parseable empty-item spelling instead of serializing a bare marker.
    const isEmptyItem = children.length === 0
        || (
            children.length === 1
            && children[0].name === 'paragraph'
            && children[0].text === ''
        );
    const markerPadding = sourceMarkerPadding === '' && isEmptyItem
        ? ' '
        : sourceMarkerPadding ?? ' ';

    return { markerPadding, sourceLeadingPrefix, sourceMarker };
}

export function applyListItemContinuationPrefixes(
    markdown: TTrackedMarkdown,
    parentIndent: string,
    generatedPrefix: string,
    prefixes: readonly string[] | undefined,
): TTrackedMarkdown {
    if (!prefixes?.length)
        return markdown;

    const lineStarts: number[] = [];
    for (let index = 0; index < markdown.text.length - 1; index++) {
        if (markdown.text[index] === '\n')
            lineStarts.push(index + 1);
    }
    if (lineStarts.length !== prefixes.length)
        return markdown;

    if (!generatedPrefix.startsWith(parentIndent)) {
        throw new TypeError(
            'Generated list-item prefix is outside its parent indentation.',
        );
    }

    const replacements: Array<{
        readonly start: number;
        readonly end: number;
        readonly text: string;
    }> = [];
    const generatedSegment = generatedPrefix.slice(parentIndent.length);
    for (let index = 0; index < lineStarts.length; index++) {
        const start = lineStarts[index];
        const sourcePrefix = prefixes[index];
        if (markdown.text.startsWith(generatedPrefix, start)) {
            if (sourcePrefix === generatedSegment)
                continue;
            replacements.push({
                start: start + parentIndent.length,
                end: start + generatedPrefix.length,
                text: sourcePrefix,
            });
        }
        else if (
            sourcePrefix === ''
            && (markdown.text[start] === '\n'
                || start === markdown.text.length)
        ) {
            continue;
        }
        else {
            // A topology or newline edit made this parser-owned physical
            // line layout stale. Normalize the whole item instead of
            // applying only part of an obsolete recursive transform.
            return markdown;
        }
    }
    if (!replacements.length)
        return markdown;

    const parts: TTrackedMarkdown[] = [];
    let cursor = 0;
    for (const replacement of replacements) {
        parts.push(sliceMarkdown(markdown, cursor, replacement.start));
        parts.push(replaceGeneratedMarkdown(
            sliceMarkdown(markdown, replacement.start, replacement.end),
            replacement.text,
        ));
        cursor = replacement.end;
    }
    parts.push(sliceMarkdown(markdown, cursor));
    return concatMarkdown(parts);
}
