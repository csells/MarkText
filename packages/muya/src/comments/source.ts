import type { TLexedToken } from '../utils/marked/types';
import { lexBlock } from '../utils/marked';
import { forEachRealCommentMarker, inlineCodeRangesInText } from './markerScan';
import {
    COMMENT_DEFINITION_LABEL_PREFIX,
    COMMENT_MARKER_OPEN_PREFIX,
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

export interface ICommentSourceIndexOptions {
    frontMatter?: boolean;
    math?: boolean;
    // Footnote parsing changes block context: with it on, an indented
    // definition line inside a footnote is metadata, not code. Callers
    // matching a footnote-enabled editor must pass true (engine default off).
    footnote?: boolean;
}

const DEFAULT_SOURCE_INDEX_OPTIONS = {
    frontMatter: true,
    math: true,
    footnote: false,
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
        footnote: normalized.footnote,
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

// Live comment markers with their source-byte offsets, scanned over
// PARAGRAPH text (contiguous non-ignored, non-empty lines joined) rather
// than per line — so a code span opening on one soft-wrapped line and
// closing on the next masks its markers exactly as the block-path parser's
// leaf tokenization does. One tokenizer authority (markerScan), no second
// backtick grammar.
function paragraphCommentMarkers(views: ICommentSourceLineView[]): ICommentSourceMarker[] {
    const markers: ICommentSourceMarker[] = [];
    let i = 0;
    while (i < views.length) {
        if (views[i].ignored || views[i].stripped.length === 0) {
            i += 1;
            continue;
        }
        const group: ICommentSourceLineView[] = [];
        while (i < views.length && !views[i].ignored && views[i].stripped.length > 0) {
            group.push(views[i]);
            i += 1;
        }
        const joined = group.map(view => view.stripped).join('\n');
        const lineStartInJoined: number[] = [];
        let cursor = 0;
        for (const view of group) {
            lineStartInJoined.push(cursor);
            cursor += view.stripped.length + 1;
        }
        forEachRealCommentMarker(joined, (scanned) => {
            // A marker never spans a line; locate its line to map back to bytes.
            let li = 0;
            while (li + 1 < group.length && lineStartInJoined[li + 1] <= scanned.start)
                li += 1;
            const view = group[li];
            const offset = scanned.start - lineStartInJoined[li];
            const lineStart = view.start + view.delta;
            const markerStart = lineStart + offset;
            const idStart = markerStart + COMMENT_MARKER_OPEN_PREFIX.length + (scanned.kind === 'close' ? 1 : 0);
            markers.push({
                id: scanned.id,
                kind: scanned.kind,
                raw: view.stripped.slice(offset, offset + (scanned.end - scanned.start)),
                start: markerStart,
                end: lineStart + offset + (scanned.end - scanned.start),
                idStart,
                idEnd: idStart + scanned.id.length,
            });
        });
    }
    return markers;
}

// Inline-code char ranges over PARAGRAPH text (same grouping as the marker
// scan), tokenizer-derived so a multi-line span masks its content exactly
// as the parser sees it. Feeds the ignored-range set the source index and
// CodeMirror overlay consult.
function paragraphInlineCodeRanges(views: ICommentSourceLineView[]): ICommentSourceIndexRange[] {
    const ranges: ICommentSourceIndexRange[] = [];
    let i = 0;
    while (i < views.length) {
        if (views[i].ignored || views[i].stripped.length === 0) {
            i += 1;
            continue;
        }
        const group: ICommentSourceLineView[] = [];
        while (i < views.length && !views[i].ignored && views[i].stripped.length > 0) {
            group.push(views[i]);
            i += 1;
        }
        const joined = group.map(view => view.stripped).join('\n');
        const lineStartInJoined: number[] = [];
        let cursor = 0;
        for (const view of group) {
            lineStartInJoined.push(cursor);
            cursor += view.stripped.length + 1;
        }
        const byteOf = (joinedOffset: number): number => {
            let li = 0;
            while (li + 1 < group.length && lineStartInJoined[li + 1] <= joinedOffset)
                li += 1;
            const view = group[li];
            return view.start + view.delta + (joinedOffset - lineStartInJoined[li]);
        };
        for (const range of inlineCodeRangesInText(joined))
            ranges.push({ start: byteOf(range.start), end: byteOf(range.end - 1) + 1 });
    }
    return ranges;
}

export function sourceCommentIgnoredIndexRanges(
    markdown: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): ICommentSourceIndexRange[] {
    const views = buildCommentSourceLineViews(markdown, options);
    return [
        ...sourceBlockIgnoredIndexRanges(views),
        ...paragraphInlineCodeRanges(views),
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
        ...paragraphInlineCodeRanges(views),
    ];
    const metadataDefinitions: ICommentSourceMetadataDefinition[] = [];
    const commentRanges: ICommentSourceRange[] = [];
    const openMarkers = new Map<string, number>();

    const markers = paragraphCommentMarkers(views);
    for (const marker of markers) {
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
    }

    for (const view of views) {
        if (view.ignored)
            continue;

        const metadata = parseCommentMetadataDefinition(view.stripped);
        if (!metadata)
            continue;

        const reply = parseCommentReplyDefinition(view.stripped);
        const lineStart = view.start + view.delta;
        const idStartInLine
            = view.stripped.indexOf(`${COMMENT_DEFINITION_LABEL_PREFIX}${metadata.id}]`)
                + COMMENT_DEFINITION_LABEL_PREFIX.length;
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
export function commentSyntaxRangesForId(
    markdown: string,
    id: string,
    index: ICommentSourceIndex = buildCommentSourceIndex(markdown),
): ICommentSourceIndexRange[] {
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

export interface ISourceLineDecorationSpan {
    // Column offsets within the raw line (container prefixes excluded).
    start: number;
    end: number;
    token: 'marker' | 'metadata';
}

export interface ISourceLineDecoration {
    ignored: boolean;
    spans: ISourceLineDecorationSpan[];
}

// Per-line comment decorations for the source-mode CodeMirror overlay,
// derived entirely from the batch index (the real parser's block/inline
// tokenization). The overlay tracks its line number and looks each line up
// here — there is no second streaming grammar. Marker/metadata char spans
// are clipped to their line; `ignored` lines (code/front-matter/html blocks)
// carry no comment decoration.
export function buildSourceLineDecorations(
    markdown: string,
    options: ICommentSourceIndexOptions = DEFAULT_SOURCE_INDEX_OPTIONS,
): ISourceLineDecoration[] {
    const views = buildCommentSourceLineViews(markdown, options);
    const index = buildCommentSourceIndex(markdown, options);
    return views.map((view) => {
        const lineStart = view.start;
        const lineEnd = view.start + view.rawLength;
        const spans: ISourceLineDecorationSpan[] = [];
        const clip = (start: number, end: number, token: 'marker' | 'metadata') => {
            const from = Math.max(start, lineStart) - lineStart;
            const to = Math.min(end, lineEnd) - lineStart;
            if (to > from)
                spans.push({ start: from, end: to, token });
        };
        for (const marker of index.markers)
            clip(marker.start, marker.end, 'marker');
        for (const definition of index.metadataDefinitions)
            clip(definition.start, definition.end, 'metadata');
        spans.sort((a, b) => a.start - b.start);
        return { ignored: view.ignored, spans };
    });
}
