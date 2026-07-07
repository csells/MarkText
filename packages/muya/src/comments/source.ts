import type { TLexedToken } from '../utils/marked/types';
import { escapeRegExp } from '../utils';
import {
    FRONT_MATTER_OPEN_REGEXP,
    frontMatterCloseMarker,
    INDENTED_CODE_REGEXP,
    isFenceClose,
    MATH_BLOCK_DELIM_REGEXP,
    parseFenceMarker,
} from '../utils/markdownBlockRules';
import { lexBlock } from '../utils/marked';
import { forEachRealCommentMarker, orphansCounterpart } from './markerScan';
import {
    COMMENT_MARKER_PATTERN,
    htmlBlockTokenIsParagraph,
    parseCommentMetadataDefinition,
    parseCommentReplyDefinition,
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

// One entry per definition-shaped line. `id` is the THREAD id — for a v2
// reply line `[MC:cmt_1.0]:` it is `cmt_1`, so per-thread queries (removal
// ranges, discard, line reconciliation) see head and replies alike. `label`
// keeps the raw bracket text; labels that are neither a valid id nor `id.N`
// classify as heads under their raw label, exactly as v1 treated them.
export interface ICommentSourceMetadataDefinition extends ICommentSourceIndexRange {
    id: string;
    label: string;
    kind: 'head' | 'reply';
    replyIndex?: number;
    payload: string;
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

export interface ICommentSourceIndexOptions {
    frontMatter?: boolean;
    math?: boolean;
}

const SOURCE_COMMENT_MARKER_START_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u');
const DEFAULT_SOURCE_INDEX_OPTIONS = {
    frontMatter: true,
    math: true,
} as const;

function normalizeSourceIndexOptions(options: ICommentSourceIndexOptions = {}): Required<ICommentSourceIndexOptions> {
    return {
        ...DEFAULT_SOURCE_INDEX_OPTIONS,
        ...options,
    };
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

// The batch index derives its per-line view from the REAL parser token
// stream (lexBlock), not from a re-derived line grammar: marked's block
// tokenization is the single authority on what is code/html/math/front
// matter, including inside containers (blockquotes, list items) that a flat
// line scan cannot see. Each original line gets its container-stripped
// content and the byte delta to map stripped offsets back to source bytes,
// so markers and metadata definitions are recognized on exactly the text the
// state-walk parser sees. The streaming classifier below
// (prepareCommentSourceLine) remains ONLY as the non-authoritative
// CodeMirror live-decoration adapter.
export interface ICommentSourceLineView {
    // Byte offset of the line start in the original markdown.
    start: number;
    // Byte length including the line terminator.
    rawLength: number;
    // Inside a code/html/math/front-matter block — comment syntax is literal.
    ignored: boolean;
    // Container-stripped line content (blockquote '>' prefixes, list
    // indentation removed) — the text the parser's state walk sees.
    stripped: string;
    // stripped[i] lives at byte start + delta + i in the original markdown.
    delta: number;
}

function splitContentLines(text: string): string[] {
    if (text.length === 0)
        return [];
    const lines = text.split(/\r\n|\n|\r/u);
    // A trailing terminator yields a phantom empty segment, not a line.
    if (lines[lines.length - 1] === '')
        lines.pop();
    return lines;
}

// Byte offsets of every line start in `text` (line 0 always starts at 0).
function lineStartOffsets(text: string): number[] {
    const starts = [0];
    const terminator = /\r\n|\n|\r/gu;
    for (let match = terminator.exec(text); match; match = terminator.exec(text)) {
        if (match.index + match[0].length < text.length)
            starts.push(match.index + match[0].length);
    }
    return starts;
}

type TContainerToken = TLexedToken & { text?: string; tokens?: TLexedToken[]; items?: TLexedToken[] };

// One nesting level of the token walk: `text` is the container-stripped
// source the tokens were lexed from (token raws concatenate to it) and
// `viewOfLine[k]` is the original-document view behind its k-th line.
interface IWalkLevel {
    text: string;
    lineStarts: number[];
    viewOfLine: ICommentSourceLineView[];
}

// Re-view a container's lines through its children: each child line is the
// container line minus a per-line prefix (CommonMark container stripping
// never merges or splits lines), so child content must be a suffix of the
// current view. Anything else means the walk desynced from the source —
// fail loudly, never guess.
function descendIntoContainer(
    children: TLexedToken[],
    level: IWalkLevel,
    startLine: number,
    lineCount: number,
): void {
    const innerText = children.map(child => child.raw ?? '').join('');
    const innerLines = splitContentLines(innerText);
    if (innerLines.length > lineCount)
        throw new Error('comment source index: container children span more lines than the container');

    const viewOfLine: ICommentSourceLineView[] = [];
    for (let k = 0; k < innerLines.length; k += 1) {
        const view = level.viewOfLine[startLine + k];
        const inner = innerLines[k];
        if (view.stripped.endsWith(inner)) {
            view.delta += view.stripped.length - inner.length;
        }
        else if (
            inner.endsWith(view.stripped)
            && /^\s*$/u.test(inner.slice(0, inner.length - view.stripped.length))
        ) {
            // marked pads a lazy-continuation line with leading whitespace to
            // defuse a would-be setext underline ('===' -> '    ==='). The
            // parser's state text carries the same padding, so recognition
            // agrees; the padded columns simply map back left of the line.
            view.delta -= inner.length - view.stripped.length;
        }
        else {
            throw new Error('comment source index: container line alignment failed');
        }
        view.stripped = inner;
        viewOfLine.push(view);
    }

    walkLevelTokens(children, {
        text: innerText,
        lineStarts: lineStartOffsets(innerText),
        viewOfLine,
    });
}

function walkLevelTokens(tokens: TLexedToken[], level: IWalkLevel): void {
    const lineAt = (byte: number): number => {
        let low = 0;
        let high = level.lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (level.lineStarts[mid] <= byte)
                low = mid;
            else
                high = mid - 1;
        }
        return low;
    };

    // Byte cursor shared across the recursion: a `list` token's items are
    // unstripped slices of this level's text, so walking them advances the
    // same cursor the list occupies.
    let byteOffset = 0;
    const walk = (levelTokens: TLexedToken[]): void => {
        for (const token of levelTokens as TContainerToken[]) {
            const raw = token.raw ?? '';
            if (raw.length === 0)
                continue;
            const startLine = lineAt(byteOffset);
            const endLine = lineAt(byteOffset + raw.length - 1);
            switch (token.type) {
                case 'code':
                case 'multiplemath':
                case 'frontmatter': {
                    for (let line = startLine; line <= endLine; line += 1)
                        level.viewOfLine[line].ignored = true;
                    byteOffset += raw.length;
                    break;
                }
                case 'html': {
                    // The state walk lowers marker-led non-HTML (and single
                    // images) to paragraphs; those lines carry LIVE comment
                    // syntax. Real raw HTML is literal.
                    if (!htmlBlockTokenIsParagraph(token.text ?? raw)) {
                        for (let line = startLine; line <= endLine; line += 1)
                            level.viewOfLine[line].ignored = true;
                    }
                    byteOffset += raw.length;
                    break;
                }
                case 'blockquote':
                case 'footnote':
                case 'list_item': {
                    descendIntoContainer(token.tokens ?? [], level, startLine, endLine - startLine + 1);
                    byteOffset += raw.length;
                    break;
                }
                case 'list': {
                    // Items advance the shared cursor through the list's
                    // span, but their raws exclude the list's trailing
                    // terminator (and any inter-item bytes marked absorbed),
                    // so the cursor is pinned to the list's exact end after.
                    const listStart = byteOffset;
                    walk(token.items ?? []);
                    byteOffset = listStart + raw.length;
                    break;
                }
                default: {
                    byteOffset += raw.length;
                    break;
                }
            }
        }
    };

    walk(tokens);
}

export function buildCommentSourceLineViews(
    markdown: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): ICommentSourceLineView[] {
    const normalized = normalizeSourceIndexOptions(options);
    const views: ICommentSourceLineView[] = [];
    for (const { index, rawLine } of sourceLines(markdown)) {
        views.push({
            start: index,
            rawLength: rawLine.length,
            ignored: false,
            stripped: rawLine.slice(0, rawLine.length - lineEndLength(rawLine)),
            delta: 0,
        });
    }

    const tokens = lexBlock(markdown, {
        footnote: false,
        math: normalized.math,
        frontMatter: normalized.frontMatter,
        isGitlabCompatibilityEnabled: false,
    });
    walkLevelTokens(tokens, {
        text: markdown,
        lineStarts: views.map(view => view.start),
        viewOfLine: views,
    });
    return views;
}

function sourceBlockIgnoredIndexRanges(
    views: ICommentSourceLineView[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let runStart: number | null = null;
    let runEnd = 0;

    for (const view of views) {
        if (view.ignored) {
            runStart ??= view.start;
            runEnd = view.start + view.rawLength;
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
    views: ICommentSourceLineView[],
): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];

    for (const view of views) {
        if (view.ignored)
            continue;

        for (const range of sourceInlineCodeRanges(view.stripped)) {
            ranges.push({
                start: view.start + view.delta + range.start,
                end: view.start + view.delta + range.end,
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

export function prepareCommentSourceLine(
    state: ICommentSourceLineState,
    line: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): void {
    const { math } = normalizeSourceIndexOptions(options);
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

    if (math && state.inMathBlock) {
        state.ignoreLine = true;
        state.openParagraph = false;
        if (MATH_BLOCK_DELIM_REGEXP.test(line))
            state.inMathBlock = false;
        return;
    }

    if (math && MATH_BLOCK_DELIM_REGEXP.test(line)) {
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

export function sourceCommentIgnoredIndexRanges(
    markdown: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): ICommentSourceIndexRange[] {
    const views = buildCommentSourceLineViews(markdown, options);
    return [
        ...sourceBlockIgnoredIndexRanges(views),
        ...sourceInlineCodeIndexRanges(views),
    ];
}

export function buildCommentSourceIndex(
    markdown: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): ICommentSourceIndex {
    const views = buildCommentSourceLineViews(markdown, options);
    const blockIgnoredRanges = sourceBlockIgnoredIndexRanges(views);
    const ignoredRanges = [
        ...blockIgnoredRanges,
        ...sourceInlineCodeIndexRanges(views),
    ];
    const markers: ICommentSourceMarker[] = [];
    const metadataDefinitions: ICommentSourceMetadataDefinition[] = [];
    const commentRanges: ICommentSourceRange[] = [];
    const openMarkers = new Map<string, number>();

    for (const view of views) {
        if (view.ignored)
            continue;

        const lineStart = view.start + view.delta;
        forEachRealCommentMarker(view.stripped, (scanned) => {
            const markerStart = lineStart + scanned.start;
            const idStart = markerStart + '<!--MC:'.length + (scanned.kind === 'close' ? 1 : 0);
            const marker: ICommentSourceMarker = {
                id: scanned.id,
                kind: scanned.kind,
                raw: view.stripped.slice(scanned.start, scanned.end),
                start: markerStart,
                end: lineStart + scanned.end,
                idStart,
                idEnd: idStart + scanned.id.length,
            };
            markers.push(marker);

            if (marker.kind === 'close') {
                const start = openMarkers.get(marker.id);
                if (start != null) {
                    commentRanges.push({ id: marker.id, start, end: marker.start });
                    openMarkers.delete(marker.id);
                }
            }
            else if (!openMarkers.has(marker.id)) {
                openMarkers.set(marker.id, marker.end);
            }
        });
    }

    for (const view of views) {
        if (view.ignored)
            continue;

        const metadata = parseCommentMetadataDefinition(view.stripped);
        if (!metadata)
            continue;

        const reply = parseCommentReplyDefinition(view.stripped);
        const lineStart = view.start + view.delta;
        const idStartInLine = view.stripped.indexOf(`[MC:${metadata.id}]`) + '[MC:'.length;
        metadataDefinitions.push({
            id: reply ? reply.id : metadata.id,
            label: metadata.id,
            kind: reply ? 'reply' : 'head',
            ...(reply ? { replyIndex: reply.index } : {}),
            payload: metadata.payload,
            start: lineStart,
            end: lineStart + view.stripped.length,
            idStart: lineStart + idStartInLine,
            idEnd: lineStart + idStartInLine + metadata.id.length,
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
