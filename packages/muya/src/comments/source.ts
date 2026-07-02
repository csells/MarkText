import {
    COMMENT_MARKER_PATTERN,
    parseCommentMetadataDefinition,
} from './syntax';

type TMarkerKind = 'open' | 'close';

interface IScannedMarkers {
    // Marker kinds fully covered by the edit, keyed by comment id.
    selectedKindsById: Map<string, Set<TMarkerKind>>;
    // Every marker kind present in `text`, the fallback counterpart source.
    allKindsById: Map<string, Set<TMarkerKind>>;
    // The edit only partially covers a marker (would leave a broken fragment).
    partial: boolean;
}

// Scan `text` for comment markers the edit touches. Returns `partial: true` as
// soon as the edit clips a marker without covering it whole.
function scanEditedCommentMarkers(text: string, startOffset: number, endOffset: number): IScannedMarkers {
    const selectedKindsById = new Map<string, Set<TMarkerKind>>();
    const allKindsById = new Map<string, Set<TMarkerKind>>();
    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');

    for (const match of text.matchAll(markerRegExp)) {
        const id = match[2];
        const kind: TMarkerKind = match[1] === '~' ? 'close' : 'open';
        const start = match.index;
        const end = match.index + match[0].length;

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

// Whether removing exactly `selectedKinds` for `id` orphans a counterpart that
// survives elsewhere (per `documentKinds`).
function orphansCounterpart(
    selectedKinds: ReadonlySet<TMarkerKind>,
    documentKinds: ReadonlySet<TMarkerKind>,
): boolean {
    return (
        (selectedKinds.has('open') && !selectedKinds.has('close') && documentKinds.has('close'))
        || (selectedKinds.has('close') && !selectedKinds.has('open') && documentKinds.has('open'))
    );
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
}

const SOURCE_COMMENT_MARKER_START_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u');
const FRONT_MATTER_OPEN_REGEXP = /^(---|\+\+\+|;;;|\{)[ \t]*$/u;

function frontMatterCloseMarker(openMarker: string): string {
    return openMarker === '{' ? '}' : openMarker;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

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

function sourceFencedCodeIndexRanges(markdown: string): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let fence: { char: '`' | '~'; length: number; start: number } | null = null;

    for (const { index, rawLine } of sourceLines(markdown)) {
        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        if (fence) {
            const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lineText);
            if (
                closing
                && closing[1][0] === fence.char
                && closing[1].length >= fence.length
            ) {
                ranges.push({ start: fence.start, end: index + rawLine.length });
                fence = null;
            }
            continue;
        }

        const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(lineText);
        if (opening) {
            fence = {
                char: opening[1][0] as '`' | '~',
                length: opening[1].length,
                start: index,
            };
        }
    }

    if (fence)
        ranges.push({ start: fence.start, end: markdown.length });
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
            return;
        }
    }

    if (state.frontMatterMarker) {
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
        const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
        if (
            closing
            && closing[1][0] === state.fence.char
            && closing[1].length >= state.fence.length
        ) {
            state.fence = null;
        }
        return;
    }

    const openingFence = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (openingFence) {
        state.fence = {
            char: openingFence[1][0] as '`' | '~',
            length: openingFence[1].length,
        };
        state.ignoreLine = true;
        return;
    }

    if (state.inMathBlock) {
        state.ignoreLine = true;
        if (/^ {0,3}\$\$[ \t]*$/u.test(line))
            state.inMathBlock = false;
        return;
    }

    if (/^ {0,3}\$\$[ \t]*$/u.test(line)) {
        state.inMathBlock = true;
        state.ignoreLine = true;
        return;
    }

    if (state.htmlClosing) {
        state.ignoreLine = true;
        if (!trimmed || state.htmlClosing.test(trimmed))
            state.htmlClosing = null;
        return;
    }

    if (/^(?: {4,}|\t)/u.test(line)) {
        state.ignoreLine = true;
        return;
    }

    const htmlClosing = getHtmlBlockClosing(line);
    if (!htmlClosing)
        return;

    state.ignoreLine = true;
    state.htmlClosing = htmlClosing === 'single-line' ? null : htmlClosing;
}

function sourceFrontMatterIndexRanges(markdown: string): ICommentSourceIndexRange[] {
    const opening = /^(---|\+\+\+|;;;|\{)[ \t]*(?:\r\n|\n|\r)/u.exec(markdown);
    if (!opening)
        return [];

    const marker = frontMatterCloseMarker(opening[1]);
    for (const { index, rawLine } of sourceLines(markdown, opening[0].length)) {
        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        if (lineText.trim() === marker)
            return [{ start: 0, end: index + rawLine.length }];
    }

    return [];
}

function sourceMathBlockIndexRanges(
    markdown: string,
    ignoredRanges: ICommentSourceIndexRange[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let start: number | null = null;

    for (const { index, rawLine } of sourceLines(markdown)) {
        if (sourceIndexInsideRanges(index, ignoredRanges))
            continue;

        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        if (!/^ {0,3}\$\$[ \t]*$/u.test(lineText))
            continue;

        if (start == null) {
            start = index;
        }
        else {
            ranges.push({ start, end: index + rawLine.length });
            start = null;
        }
    }

    if (start != null)
        ranges.push({ start, end: markdown.length });
    return ranges;
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

function sourceHtmlBlockIndexRanges(
    markdown: string,
    ignoredRanges: ICommentSourceIndexRange[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let start: number | null = null;
    let closing: RegExp | null = null;

    for (const { index, rawLine } of sourceLines(markdown)) {
        if (sourceIndexInsideRanges(index, ignoredRanges))
            continue;

        const trimmed = rawLine.slice(0, rawLine.length - lineEndLength(rawLine)).trim();
        if (start != null) {
            if (!trimmed || closing?.test(trimmed)) {
                ranges.push({ start, end: index + rawLine.length });
                start = null;
                closing = null;
            }
            continue;
        }

        const htmlClosing = getHtmlBlockClosing(rawLine);
        if (!htmlClosing)
            continue;
        if (htmlClosing === 'single-line') {
            ranges.push({ start: index, end: index + rawLine.length });
        }
        else {
            start = index;
            closing = htmlClosing;
        }
    }

    if (start != null)
        ranges.push({ start, end: markdown.length });
    return ranges;
}

function sourceIndentedCodeIndexRanges(
    markdown: string,
    ignoredRanges: ICommentSourceIndexRange[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let openParagraph = false;

    for (const { index, rawLine } of sourceLines(markdown)) {
        const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine));
        const isBlank = lineText.trim().length === 0;
        const isIndented = /^(?: {4,}|\t)/u.test(lineText);
        const insideIgnored = sourceIndexInsideRanges(index, ignoredRanges);

        if (isIndented && !openParagraph && !insideIgnored) {
            ranges.push({ start: index, end: index + rawLine.length });
        }
        else if (isBlank || insideIgnored) {
            openParagraph = false;
        }
        else {
            openParagraph = true;
        }
    }

    return ranges;
}

export function sourceCommentIgnoredIndexRanges(markdown: string): ICommentSourceIndexRange[] {
    const frontMatterRanges = sourceFrontMatterIndexRanges(markdown);
    const fencedRanges = sourceFencedCodeIndexRanges(markdown);
    const blockRanges = [
        ...frontMatterRanges,
        ...fencedRanges,
        ...sourceMathBlockIndexRanges(markdown, [...frontMatterRanges, ...fencedRanges]),
    ];
    const htmlRanges = sourceHtmlBlockIndexRanges(markdown, blockRanges);
    const blockAndHtmlRanges = [...blockRanges, ...htmlRanges];
    const indentedRanges = sourceIndentedCodeIndexRanges(markdown, blockAndHtmlRanges);
    const blockIgnoredRanges = [...blockAndHtmlRanges, ...indentedRanges];

    return [
        ...blockIgnoredRanges,
        ...sourceInlineCodeIndexRanges(markdown, blockIgnoredRanges),
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

export function removeCommentSyntaxFromMarkdown(markdown: string, id: string): string {
    const index = buildCommentSourceIndex(markdown);
    const syntaxRanges = [
        ...index.markers.filter(marker => marker.id === id),
        ...index.metadataDefinitions.filter(definition => definition.id === id),
    ].sort((a, b) => b.start - a.start);
    let next = markdown;

    for (const range of syntaxRanges)
        next = `${next.slice(0, range.start)}${next.slice(range.end)}`;

    return next;
}
