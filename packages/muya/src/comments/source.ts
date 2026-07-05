import { escapeRegExp } from '../utils';
import {
    FRONT_MATTER_OPEN_REGEXP,
    frontMatterCloseMarker,
    INDENTED_CODE_REGEXP,
    isFenceClose,
    MATH_BLOCK_DELIM_REGEXP,
    parseFenceMarker,
} from '../utils/markdownBlockRules';
import getFrontMatterInfo from '../utils/marked/frontMatter';
import { forEachRealCommentMarker, orphansCounterpart } from './markerScan';
import {
    COMMENT_MARKER_PATTERN,
    parseCommentMetadataDefinition,
} from './syntax';

type TMarkerKind = 'open' | 'close';

export interface IScannedMarkers {
    // Marker kinds fully covered by the edit, keyed by comment id.
    selectedKindsById: Map<string, Set<TMarkerKind>>;
    // Every marker kind present in `text`, the fallback counterpart source.
    allKindsById: Map<string, Set<TMarkerKind>>;
    // The edit only partially covers a marker (would leave a broken fragment).
    partial: boolean;
}

// Scan `text` for comment markers the edit touches, using the real inline
// tokenizer (so a marker inside an inline-code/inline-math span is not treated
// as a comment marker). Returns `partial: true` as soon as the edit clips a
// marker without covering it whole. Exported so the clipboard cut guards scan
// selections with the SAME tokenizer definition of a marker as everything else.
export function scanEditedCommentMarkers(text: string, startOffset: number, endOffset: number): IScannedMarkers {
    const selectedKindsById = new Map<string, Set<TMarkerKind>>();
    const allKindsById = new Map<string, Set<TMarkerKind>>();

    const markers: Array<{ id: string; kind: TMarkerKind; start: number; end: number }> = [];
    forEachRealCommentMarker(text, marker => markers.push(marker));

    for (const { id, kind, start, end } of markers) {
        const allKinds = allKindsById.get(id) ?? new Set<TMarkerKind>();
        allKinds.add(kind);
        allKindsById.set(id, allKinds);

        const intersects = startOffset < end && endOffset > start;
        const cursorInside = startOffset === endOffset && startOffset > start && startOffset < end;
        if (!intersects && !cursorInside)
            continue;

        if (startOffset > start || endOffset < end)
            return { selectedKindsById, allKindsById, partial: true };

        const selectedKinds = selectedKindsById.get(id) ?? new Set<TMarkerKind>();
        selectedKinds.add(kind);
        selectedKindsById.set(id, selectedKinds);
    }

    return { selectedKindsById, allKindsById, partial: false };
}

export function isUnsafeCommentMarkerTextEdit(
    text: string,
    startOffset: number,
    endOffset: number,
    // A comment range can open in this block and close in another, so the
    // counterpart check must consult marker kinds from the whole document,
    // not just `text`. Lazy because most edits touch no marker at all — the
    // thunk runs only when the edit fully covers at least one marker.
    getDocumentKinds?: () => ReadonlyMap<string, ReadonlySet<TMarkerKind>>,
): boolean {
    const { selectedKindsById, allKindsById, partial } = scanEditedCommentMarkers(
        text,
        startOffset,
        endOffset,
    );
    if (partial)
        return true;
    if (selectedKindsById.size === 0)
        return false;

    const documentKinds = getDocumentKinds?.() ?? allKindsById;
    for (const [id, selectedKinds] of selectedKindsById) {
        const counterpartKinds = documentKinds.get(id) ?? allKindsById.get(id) ?? new Set<TMarkerKind>();
        if (orphansCounterpart(selectedKinds, counterpartKinds))
            return true;
    }

    return false;
}

export interface ICommentSourceIndexRange {
    start: number;
    end: number;
}

export interface ICommentSourceMarker extends ICommentSourceIndexRange {
    id: string;
    kind: 'open' | 'close';
    raw: string;
    idStart: number;
    idEnd: number;
}

export interface ICommentSourceMetadataDefinition extends ICommentSourceIndexRange {
    id: string;
    dataUri: string;
    idStart: number;
    idEnd: number;
}

export interface ICommentSourceRange extends ICommentSourceIndexRange {
    id: string;
}

export interface ICommentSourceIndex {
    ignoredRanges: ICommentSourceIndexRange[];
    markers: ICommentSourceMarker[];
    metadataDefinitions: ICommentSourceMetadataDefinition[];
    commentRanges: ICommentSourceRange[];
    syntaxRanges: ICommentSourceIndexRange[];
}

export interface ICommentSourceLineState {
    seenFirstLine: boolean;
    frontMatterMarker: string | null;
    fence: { char: '`' | '~'; length: number } | null;
    inMathBlock: boolean;
    htmlClosing: RegExp | null;
    ignoreLine: boolean;
    // An indented line only starts an indented code block when it does NOT
    // continue a paragraph. Tracks whether the previous non-ignored line was
    // paragraph text (CommonMark lazy-continuation rule).
    openParagraph: boolean;
}

const SOURCE_COMMENT_MARKER_START_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u');

function lineEndLength(rawLine: string): number {
    const match = /(?:\r\n|\n|\r)$/u.exec(rawLine);
    return match ? match[0].length : 0;
}

function* sourceLines(markdown: string, startIndex = 0): Generator<{ index: number; rawLine: string }> {
    const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu;
    lineRegExp.lastIndex = startIndex;

    for (let lineMatch = lineRegExp.exec(markdown); lineMatch; lineMatch = lineRegExp.exec(markdown)) {
        const rawLine = lineMatch[0];
        if (rawLine.length === 0)
            break;
        yield { index: lineMatch.index, rawLine };
    }
}

export function sourceIndexInsideRanges(index: number, ranges: ICommentSourceIndexRange[]): boolean {
    return ranges.some(range => index >= range.start && index < range.end);
}

export function sourceRangesOverlap(
    start: number,
    end: number,
    ranges: ICommentSourceIndexRange[],
): boolean {
    return ranges.some(range => start < range.end && end > range.start);
}

// Contiguous runs of lines the streaming classifier marks as ignored (fenced
// code, math blocks, HTML blocks, indented code). Folding the one classifier
// here keeps the batch index and the CodeMirror source-mode highlighter from
// drifting on those constructs.
//
// Front matter is the deliberate exception: it needs whole-document look-ahead
// (a leading `---` is front matter only when a matching close + blank/EOF
// follows — otherwise it is a thematic break whose following lines carry real
// comments). The streaming classifier cannot look ahead, so it is intentionally
// forgiving for live highlighting; the batch index feeds persistence/CLI and
// MUST match the parser, so it detects front matter with the parser's own
// `getFrontMatterInfo` and suppresses the classifier's forgiving version.
function sourceBlockIgnoredIndexRanges(markdown: string): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];

    const { token: frontMatter } = getFrontMatterInfo(markdown);
    const frontMatterEnd = frontMatter ? frontMatter.raw.length : 0;
    if (frontMatterEnd > 0)
        ranges.push({ start: 0, end: frontMatterEnd });

    const state = createCommentSourceLineState();
    // Front matter is resolved above; mark the first line seen so the classifier
    // never treats a leading (bare/unterminated) `---` as forgiving front matter.
    state.seenFirstLine = true;
    let runStart: number | null = null;
    let runEnd = 0;

    for (const { index, rawLine } of sourceLines(markdown, frontMatterEnd)) {
        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        prepareCommentSourceLine(state, lineText);
        if (state.ignoreLine) {
            runStart ??= index;
            runEnd = index + rawLine.length;
        }
        else if (runStart != null) {
            ranges.push({ start: runStart, end: runEnd });
            runStart = null;
        }
    }

    if (runStart != null)
        ranges.push({ start: runStart, end: runEnd });
    return ranges;
}

function sourceInlineCodeIndexRanges(
    markdown: string,
    ignoredRanges: ICommentSourceIndexRange[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];

    for (const { index, rawLine } of sourceLines(markdown)) {
        if (sourceIndexInsideRanges(index, ignoredRanges))
            continue;

        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        for (const range of sourceInlineCodeRanges(lineText)) {
            ranges.push({
                start: index + range.start,
                end: index + range.end,
            });
        }
    }

    return ranges;
}

export function sourceInlineCodeRanges(line: string): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let cursor = 0;

    while (cursor < line.length) {
        if (line[cursor] !== '`') {
            cursor += 1;
            continue;
        }

        let openLen = 1;
        while (line[cursor + openLen] === '`')
            openLen += 1;
        const openStart = cursor;
        let scan = cursor + openLen;
        let closeStart = -1;
        while (scan < line.length) {
            if (line[scan] !== '`') {
                scan += 1;
                continue;
            }
            let closeLen = 1;
            while (line[scan + closeLen] === '`')
                closeLen += 1;
            if (closeLen === openLen) {
                closeStart = scan;
                break;
            }
            scan += closeLen;
        }

        if (closeStart < 0) {
            cursor = openStart + openLen;
            continue;
        }

        ranges.push({ start: openStart, end: closeStart + openLen });
        cursor = closeStart + openLen;
    }

    return ranges;
}

export function sourceLinePositionInsideInlineCode(line: string, position: number): boolean {
    return sourceInlineCodeRanges(line).some(range => position >= range.start && position < range.end);
}

export function createCommentSourceLineState(): ICommentSourceLineState {
    return {
        seenFirstLine: false,
        frontMatterMarker: null,
        fence: null,
        inMathBlock: false,
        htmlClosing: null,
        ignoreLine: false,
        openParagraph: false,
    };
}

export function prepareCommentSourceLine(state: ICommentSourceLineState, line: string): void {
    const trimmed = line.trim();
    state.ignoreLine = false;

    if (!state.seenFirstLine) {
        state.seenFirstLine = true;
        const frontMatter = FRONT_MATTER_OPEN_REGEXP.exec(line);
        if (frontMatter) {
            state.frontMatterMarker = frontMatterCloseMarker(frontMatter[1]);
            state.ignoreLine = true;
            state.openParagraph = false;
            return;
        }
    }

    if (state.frontMatterMarker) {
        state.openParagraph = false;
        if (trimmed === state.frontMatterMarker) {
            state.frontMatterMarker = null;
        }
        else if (trimmed === '') {
            state.frontMatterMarker = null;
            state.ignoreLine = false;
            return;
        }
        state.ignoreLine = true;
        return;
    }

    if (state.fence) {
        state.ignoreLine = true;
        state.openParagraph = false;
        if (isFenceClose(line, state.fence))
            state.fence = null;
        return;
    }

    const openingFence = parseFenceMarker(line);
    if (openingFence) {
        state.fence = openingFence;
        state.ignoreLine = true;
        state.openParagraph = false;
        return;
    }

    if (state.inMathBlock) {
        state.ignoreLine = true;
        state.openParagraph = false;
        if (MATH_BLOCK_DELIM_REGEXP.test(line))
            state.inMathBlock = false;
        return;
    }

    if (MATH_BLOCK_DELIM_REGEXP.test(line)) {
        state.inMathBlock = true;
        state.ignoreLine = true;
        state.openParagraph = false;
        return;
    }

    if (state.htmlClosing) {
        state.ignoreLine = true;
        state.openParagraph = false;
        if (!trimmed || state.htmlClosing.test(trimmed))
            state.htmlClosing = null;
        return;
    }

    // A blank line ends any open paragraph; the next indented line then starts
    // an indented code block instead of continuing the paragraph.
    if (trimmed === '') {
        state.openParagraph = false;
        return;
    }

    if (INDENTED_CODE_REGEXP.test(line) && !state.openParagraph) {
        state.ignoreLine = true;
        return;
    }

    const htmlClosing = getHtmlBlockClosing(line);
    if (htmlClosing) {
        state.ignoreLine = true;
        state.openParagraph = false;
        state.htmlClosing = htmlClosing === 'single-line' ? null : htmlClosing;
        return;
    }

    state.openParagraph = true;
}

function getHtmlBlockClosing(line: string): 'single-line' | RegExp | null {
    let trimmed = line.trim();
    for (
        let marker = SOURCE_COMMENT_MARKER_START_REGEXP.exec(trimmed);
        marker;
        marker = SOURCE_COMMENT_MARKER_START_REGEXP.exec(trimmed)
    ) {
        trimmed = trimmed.slice(marker[0].length).trimStart();
    }
    if (!trimmed)
        return null;

    if (trimmed.startsWith('<!--'))
        return /-->/u.test(trimmed) ? 'single-line' : /-->/u;

    const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/u.exec(trimmed);
    if (!tag)
        return null;
    if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed))
        return 'single-line';

    return new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu');
}

export function sourceCommentIgnoredIndexRanges(markdown: string): ICommentSourceIndexRange[] {
    const blockRanges = sourceBlockIgnoredIndexRanges(markdown);
    return [
        ...blockRanges,
        ...sourceInlineCodeIndexRanges(markdown, blockRanges),
    ];
}

export function buildCommentSourceIndex(markdown: string): ICommentSourceIndex {
    const ignoredRanges = sourceCommentIgnoredIndexRanges(markdown);
    const markers: ICommentSourceMarker[] = [];
    const metadataDefinitions: ICommentSourceMetadataDefinition[] = [];
    const commentRanges: ICommentSourceRange[] = [];
    const openMarkers = new Map<string, number>();
    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');

    for (let markerMatch = markerRegExp.exec(markdown); markerMatch; markerMatch = markerRegExp.exec(markdown)) {
        if (sourceIndexInsideRanges(markerMatch.index, ignoredRanges))
            continue;

        const closePrefix = markerMatch[1];
        const id = markerMatch[2];
        const idStart = markerMatch.index + '<!--MC:'.length + closePrefix.length;
        const marker: ICommentSourceMarker = {
            id,
            kind: closePrefix === '~' ? 'close' : 'open',
            raw: markerMatch[0],
            start: markerMatch.index,
            end: markerMatch.index + markerMatch[0].length,
            idStart,
            idEnd: idStart + id.length,
        };
        markers.push(marker);

        if (marker.kind === 'close') {
            const start = openMarkers.get(id);
            if (start != null) {
                commentRanges.push({ id, start, end: marker.start });
                openMarkers.delete(id);
            }
        }
        else if (!openMarkers.has(id)) {
            openMarkers.set(id, marker.end);
        }
    }

    for (const { index, rawLine } of sourceLines(markdown)) {
        if (sourceIndexInsideRanges(index, ignoredRanges))
            continue;

        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        const metadata = parseCommentMetadataDefinition(lineText);
        if (!metadata)
            continue;

        const idStartInLine = lineText.indexOf(`[MC:${metadata.id}]`) + '[MC:'.length;
        metadataDefinitions.push({
            id: metadata.id,
            dataUri: metadata.dataUri,
            start: index,
            end: index + lineText.length,
            idStart: index + idStartInLine,
            idEnd: index + idStartInLine + metadata.id.length,
        });
    }

    return {
        ignoredRanges,
        markers,
        metadataDefinitions,
        commentRanges,
        syntaxRanges: [
            ...markers,
            ...metadataDefinitions,
        ].map(({ start, end }) => ({ start, end })),
    };
}

export function collectSourceCommentIds(markdown: string): Set<string> {
    const index = buildCommentSourceIndex(markdown);
    return new Set([
        ...index.markers.map(marker => marker.id),
        ...index.metadataDefinitions.map(definition => definition.id),
    ]);
}

export function stripCommentSyntaxFromMarkdown(markdown: string): string {
    const index = buildCommentSourceIndex(markdown);
    const syntaxRanges = [...index.syntaxRanges].sort((a, b) => b.start - a.start);
    let next = markdown;

    for (const range of syntaxRanges)
        next = `${next.slice(0, range.start)}${next.slice(range.end)}`;

    return next;
}

// A metadata definition occupies its own line, set off from the document body
// by the blank-line separator the metadata appendix introduced. Removing the
// definition text alone would leave that blank line behind (so discarding a
// just-created comment left trailing blanks). Take the whole line including its
// terminator, and — only when the definition is the last content in the
// document — the one blank-line separator before it too (which is then just
// trailing whitespace, so dropping it is safe and restores the prior bytes).
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

// A single comment's marker + metadata-definition removal ranges, sorted
// descending so a caller can splice them out left-to-right without shifting
// later offsets. Shared by removeCommentSyntaxFromMarkdown and the source-mode
// discard action.
export function commentSyntaxRangesForId(markdown: string, id: string): ICommentSourceIndexRange[] {
    const index = buildCommentSourceIndex(markdown);
    const ranges: ICommentSourceIndexRange[] = index.markers
        .filter(marker => marker.id === id)
        .map(marker => ({ start: marker.start, end: marker.end }));

    for (const definition of index.metadataDefinitions) {
        if (definition.id === id)
            ranges.push(definitionRemovalRange(markdown, definition));
    }

    return ranges.sort((a, b) => b.start - a.start);
}

export function removeCommentSyntaxFromMarkdown(markdown: string, id: string): string {
    let next = markdown;

    for (const range of commentSyntaxRangesForId(markdown, id))
        next = `${next.slice(0, range.start)}${next.slice(range.end)}`;

    return next;
}
