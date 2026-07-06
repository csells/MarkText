import type { IMarkdownToStateOptions } from '../state/markdownToState';
import type { TState } from '../state/types';
import type {
    ICommentSourceIndex,
    ICommentSourceIndexOptions,
    ICommentSourceIndexRange,
    ICommentSourceMarker,
    ICommentSourceMetadataDefinition,
    ICommentSourceRange,
} from './source';
import type {
    ICommentDiagnostic,
    ICommentRange,
    IParsedMarkdownComments,
} from './types';
import { parseMarkdownComments } from './parse';
import { buildCommentSourceIndex } from './source';

type TCommentAnalysisOptions = Partial<IMarkdownToStateOptions> & ICommentSourceIndexOptions;

export interface ICommentRangeSourceMap {
    id: string;
    range: ICommentRange;
    sourceRange: ICommentSourceRange | null;
    openMarker: ICommentSourceMarker | null;
    closeMarker: ICommentSourceMarker | null;
    metadataDefinition: ICommentSourceMetadataDefinition | null;
    syntaxRemovalRanges: ICommentSourceIndexRange[];
}

export interface ICommentDiagnosticSourceMap {
    id: string;
    diagnostic: ICommentDiagnostic;
    syntaxRange: ICommentSourceIndexRange | null;
}

export interface ICommentAnalysis {
    comments: IParsedMarkdownComments;
    ids: Set<string>;
    sourceIndex: ICommentSourceIndex;
    sourceMaps: {
        ranges: ICommentRangeSourceMap[];
        diagnostics: ICommentDiagnosticSourceMap[];
    };
}

const EMPTY_SOURCE_INDEX: ICommentSourceIndex = {
    ignoredRanges: [],
    markers: [],
    metadataDefinitions: [],
    commentRanges: [],
    syntaxRanges: [],
};

function firstMarker(markers: ICommentSourceMarker[], id: string, kind: 'open' | 'close'): ICommentSourceMarker | null {
    return markers.find(marker => marker.id === id && marker.kind === kind) ?? null;
}

function firstMetadataDefinition(
    definitions: ICommentSourceMetadataDefinition[],
    id: string,
): ICommentSourceMetadataDefinition | null {
    return definitions.find(definition => definition.id === id) ?? null;
}

function sourceRangeForDiagnostic(
    sourceIndex: ICommentSourceIndex,
    diagnostic: ICommentDiagnostic,
): ICommentSourceIndexRange | null {
    if (
        diagnostic.code === 'orphan-metadata'
        || diagnostic.code === 'duplicate-metadata'
        || diagnostic.code === 'invalid-metadata'
    ) {
        return firstMetadataDefinition(sourceIndex.metadataDefinitions, diagnostic.id);
    }

    return (
        firstMarker(sourceIndex.markers, diagnostic.id, 'open')
        ?? firstMarker(sourceIndex.markers, diagnostic.id, 'close')
        ?? firstMetadataDefinition(sourceIndex.metadataDefinitions, diagnostic.id)
    );
}

function definitionRemovalRange(
    markdown: string,
    range: ICommentSourceIndexRange,
): ICommentSourceIndexRange {
    let { start } = range;
    let { end } = range;

    if (markdown[end] === '\r')
        end += markdown[end + 1] === '\n' ? 2 : 1;
    else if (markdown[end] === '\n')
        end += 1;

    if (end >= markdown.length && (markdown[start - 1] === '\n' || markdown[start - 1] === '\r')) {
        const separatorStart = markdown[start - 1] === '\n' && markdown[start - 2] === '\r'
            ? start - 2
            : start - 1;
        if (markdown[separatorStart - 1] === '\n' || markdown[separatorStart - 1] === '\r')
            start = separatorStart;
    }

    return { start, end };
}

function syntaxRemovalRangesForId(
    markdown: string | null,
    sourceIndex: ICommentSourceIndex,
    id: string,
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = sourceIndex.markers
        .filter(marker => marker.id === id)
        .map(marker => ({ start: marker.start, end: marker.end }));

    for (const definition of sourceIndex.metadataDefinitions) {
        if (definition.id === id) {
            ranges.push(markdown == null ? definition : definitionRemovalRange(markdown, definition));
        }
    }

    return ranges.sort((a, b) => b.start - a.start);
}

function buildSourceMaps(comments: IParsedMarkdownComments, sourceIndex: ICommentSourceIndex): ICommentAnalysis['sourceMaps'] {
    return {
        ranges: comments.ranges.map(range => ({
            id: range.id,
            range,
            sourceRange: sourceIndex.commentRanges.find(sourceRange => sourceRange.id === range.id) ?? null,
            openMarker: firstMarker(sourceIndex.markers, range.id, 'open'),
            closeMarker: firstMarker(sourceIndex.markers, range.id, 'close'),
            metadataDefinition: firstMetadataDefinition(sourceIndex.metadataDefinitions, range.id),
            syntaxRemovalRanges: syntaxRemovalRangesForId(null, sourceIndex, range.id),
        })),
        diagnostics: comments.diagnostics.map(diagnostic => ({
            id: diagnostic.id,
            diagnostic,
            syntaxRange: sourceRangeForDiagnostic(sourceIndex, diagnostic),
        })),
    };
}

function collectAnalysisIds(comments: IParsedMarkdownComments, sourceIndex: ICommentSourceIndex): Set<string> {
    const ids = new Set<string>();

    for (const thread of comments.threads)
        ids.add(thread.id);
    for (const range of comments.ranges)
        ids.add(range.id);
    for (const diagnostic of comments.diagnostics)
        ids.add(diagnostic.id);
    for (const marker of sourceIndex.markers)
        ids.add(marker.id);
    for (const definition of sourceIndex.metadataDefinitions)
        ids.add(definition.id);
    for (const range of sourceIndex.commentRanges)
        ids.add(range.id);

    return ids;
}

export function analyzeMarkdownComments(
    markdownOrStates: string | TState[],
    options?: TCommentAnalysisOptions,
): ICommentAnalysis {
    const markdown = typeof markdownOrStates === 'string' ? markdownOrStates : null;
    const sourceIndex = markdown != null
        ? buildCommentSourceIndex(markdown, options)
        : EMPTY_SOURCE_INDEX;
    let parsedComments: IParsedMarkdownComments | null = null;
    let analysisIds: Set<string> | null = null;
    let analysisSourceMaps: ICommentAnalysis['sourceMaps'] | null = null;

    return {
        get comments() {
            return comments();
        },
        get ids() {
            return ids();
        },
        sourceIndex,
        get sourceMaps() {
            return sourceMaps();
        },
    };

    function comments(): IParsedMarkdownComments {
        parsedComments ??= parseMarkdownComments(markdownOrStates, options);
        return parsedComments;
    }

    function ids(): Set<string> {
        analysisIds ??= collectAnalysisIds(comments(), sourceIndex);
        return analysisIds;
    }

    function sourceMaps(): ICommentAnalysis['sourceMaps'] {
        analysisSourceMaps ??= buildSourceMaps(comments(), sourceIndex);
        if (markdown != null) {
            for (const range of analysisSourceMaps.ranges)
                range.syntaxRemovalRanges = syntaxRemovalRangesForId(markdown, sourceIndex, range.id);
        }

        return analysisSourceMaps;
    }
}

export function stripAnalyzedCommentSyntaxFromMarkdown(
    markdown: string,
    options?: TCommentAnalysisOptions,
): string {
    const analysis = analyzeMarkdownComments(markdown, options);
    const syntaxRanges = [...analysis.sourceIndex.syntaxRanges].sort((a, b) => b.start - a.start);
    let next = markdown;

    for (const range of syntaxRanges)
        next = `${next.slice(0, range.start)}${next.slice(range.end)}`;

    return next;
}

export function validateCommentGraph(
    markdownOrStates: string | TState[],
    options?: TCommentAnalysisOptions,
): ICommentDiagnostic[] {
    return analyzeMarkdownComments(markdownOrStates, options).comments.diagnostics;
}
