import { escapeRegExp } from '../utils';

export const COMMENT_METADATA_DATA_URI_PREFIX = 'data:application/json;base64,';
export const COMMENT_ID_PATTERN = '\\w[\\w-]*';
export const COMMENT_MARKER_PATTERN = `<!--MC:(~?)(${COMMENT_ID_PATTERN})-->`;
const COMMENT_MARKER_TEXT_PATTERN = `<!--MC:~?${COMMENT_ID_PATTERN}-->`;
const COMMENT_MARKER_LIKE_REGEXP = /^<!--MC:(~?)(.*?)-->/;
export const COMMENT_MARKER_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`);
export const COMMENT_MARKER_SEARCH_REGEXP = new RegExp(COMMENT_MARKER_PATTERN);
export const COMMENT_METADATA_DEFINITION_REGEXP = /^ {0,3}\[MC:([^\]\s]+)\]:(.*)$/u;

export type TCommentMarkerKind = 'open' | 'close';

export interface IParsedCommentMarker {
    raw: string;
    id: string;
    kind: TCommentMarkerKind;
}

export interface IParsedCommentMetadataDefinition {
    id: string;
    dataUri: string;
}

export interface ICommentSearchText {
    text: string;
    rawIndexBySearchIndex: number[];
}

export function parseCommentMarker(src: string): IParsedCommentMarker | null {
    const match = COMMENT_MARKER_REGEXP.exec(src);
    if (!match)
        return null;

    return {
        raw: match[0],
        id: match[2],
        kind: match[1] === '~' ? 'close' : 'open',
    };
}

// The canonical byte form of a comment marker. This module is the single owner
// of the MC wire format; callers must not hand-build marker strings.
export function serializeCommentMarker(id: string, kind: TCommentMarkerKind = 'open'): string {
    return `<!--MC:${kind === 'close' ? '~' : ''}${id}-->`;
}

// The canonical byte form of a metadata reference-definition line. `dataUri` is
// the already-encoded payload (see encodeCommentMetadata).
export function serializeCommentMetadataDefinition(id: string, dataUri: string): string {
    return `[MC:${id}]: ${dataUri}`;
}

// Matches both the open and close marker for one specific id.
export function commentMarkerRegExpForId(id: string, flags = 'g'): RegExp {
    return new RegExp(`<!--MC:~?${escapeRegExp(id)}-->`, flags);
}

export function isValidCommentId(id: string): boolean {
    return new RegExp(`^${COMMENT_ID_PATTERN}$`).test(id);
}

// Content-leaf block names whose text the comment parser never scans (code
// fences and the code-like containers — frontmatter/math/html/diagram — all
// render through these leaves, plus thematic breaks): marker-shaped text
// there is LITERAL. Document walks that feed the guards below must skip
// these leaves, mirroring parse.ts's NON_INLINE_COMMENT_TEXT_STATES at the
// block level, or a fence containing "<!--MC:~id-->" as documentation would
// count as a real counterpart and falsely block edits.
export const NON_COMMENT_SCANNABLE_LEAF_BLOCKS: ReadonlySet<string> = new Set([
    'codeblock.content',
    'language-input',
    'thematicbreak.content',
]);

// Would removing `removedTexts` while `survivingTexts` remain leave a comment
// with only one of its paired markers? A removed open marker whose close still
// survives (or vice versa) orphans the range. When both endpoints are in the
// removed set the comment is fully gone — safe. Used by structural edits
// (table row/column removal) that delete whole blocks at once.
export function removalOrphansCommentMarker(
    removedTexts: Iterable<string>,
    survivingTexts: Iterable<string>,
): boolean {
    const removed = commentMarkerKindsInTexts(removedTexts);
    if (removed.size === 0)
        return false;

    const surviving = commentMarkerKindsInTexts(survivingTexts);
    for (const [id, kinds] of removed) {
        const survivingKinds = surviving.get(id);
        if (!survivingKinds)
            continue;

        if (
            (kinds.has('open') && !kinds.has('close') && survivingKinds.has('close'))
            || (kinds.has('close') && !kinds.has('open') && survivingKinds.has('open'))
        ) {
            return true;
        }
    }

    return false;
}

// Aggregate every marker kind present across the given texts, keyed by
// comment id. Edit guards use this to answer "does this comment's counterpart
// marker exist anywhere in the document?" — a range can open in one block and
// close in another, so a single-block scan misses the counterpart.
export function commentMarkerKindsInTexts(
    texts: Iterable<string>,
): Map<string, Set<TCommentMarkerKind>> {
    const kindsById = new Map<string, Set<TCommentMarkerKind>>();
    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');

    for (const text of texts) {
        for (const match of text.matchAll(markerRegExp)) {
            const kinds = kindsById.get(match[2]) ?? new Set<TCommentMarkerKind>();
            kinds.add(match[1] === '~' ? 'close' : 'open');
            kindsById.set(match[2], kinds);
        }
    }

    return kindsById;
}

export function parseMalformedCommentMarker(src: string): IParsedCommentMarker | null {
    const match = COMMENT_MARKER_LIKE_REGEXP.exec(src);
    if (!match || isValidCommentId(match[2]))
        return null;

    return {
        raw: match[0],
        id: match[2],
        kind: match[1] === '~' ? 'close' : 'open',
    };
}

export function parseCommentMetadataDefinition(text: string): IParsedCommentMetadataDefinition | null {
    const match = COMMENT_METADATA_DEFINITION_REGEXP.exec(text);
    if (!match)
        return null;

    return {
        id: match[1],
        dataUri: match[2].trim(),
    };
}

export function isCommentMetadataReference(label: string, _href: string): boolean {
    return /^MC:[^\]\s]+$/.test(label);
}

export function createCommentSearchText(text: string): ICommentSearchText {
    if (parseCommentMetadataDefinition(text))
        return { text: '', rawIndexBySearchIndex: [] };

    const rawIndexBySearchIndex: number[] = [];
    let searchText = '';
    let lastIndex = 0;
    const markerRegExp = new RegExp(COMMENT_MARKER_TEXT_PATTERN, 'g');
    let markerMatch = markerRegExp.exec(text);

    const appendVisibleText = (start: number, end: number) => {
        for (let index = start; index < end; index += 1) {
            searchText += text[index];
            rawIndexBySearchIndex.push(index);
        }
    };

    while (markerMatch) {
        appendVisibleText(lastIndex, markerMatch.index);
        lastIndex = markerMatch.index + markerMatch[0].length;
        markerMatch = markerRegExp.exec(text);
    }
    appendVisibleText(lastIndex, text.length);

    return { text: searchText, rawIndexBySearchIndex };
}

export function stripCommentSyntaxForClipboard(text: string): string {
    if (parseCommentMetadataDefinition(text))
        return '';

    const withoutMarkers = text.replace(new RegExp(COMMENT_MARKER_PATTERN, 'g'), '');
    const lines = withoutMarkers.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
    const withoutMetadata = lines
        .filter((line) => {
            const content = line.replace(/(?:\r\n|\n|\r)$/u, '');
            return !parseCommentMetadataDefinition(content);
        })
        .join('');

    return withoutMetadata
        .replace(/(?:\r\n|\n|\r){3,}/gu, '\n\n')
        .replace(/(?:\r\n|\n|\r){2,}$/u, '\n');
}
