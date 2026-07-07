import type { Token } from '../inlineRenderer/types';
import { tokenizer } from '../inlineRenderer/lexer';
import { parseCommentMetadataDefinition } from './syntax';

type TCommentMarkerKind = 'open' | 'close';

export interface IScannedCommentMarker {
    id: string;
    kind: TCommentMarkerKind;
    start: number;
    end: number;
}

export interface ICommentSearchText {
    text: string;
    rawIndexBySearchIndex: number[];
}

// Comment markers as the REAL inline tokenizer recognizes them. Unlike a raw
// regex over the text, the tokenizer does not emit `comment_marker` tokens for
// marker-looking text inside inline-code or inline-math spans (that content is
// not re-tokenized), so this matches exactly what the parser treats as a live
// comment. The edit guards use it so "what the guard protects" stays identical
// to "what the parser renders as a comment".
//
// Tokenize exactly as `parseMarkdownComments` does (`comments/parse.ts`):
// `hasBeginRules: false`. With begin rules on, block-level rules (notably the
// reference-definition rule for a `[ref]: url` line, which round-trips as
// paragraph text) consume the line and swallow a trailing comment marker the
// parser DOES treat as live — the guard would then miss that marker and permit
// an edit that orphans its counterpart.
const COMMENT_TOKENIZER_OPTIONS = {
    hasBeginRules: false,
    options: { superSubScript: true, footnote: false },
} as const;

// Inline-code spans a selection may intersect — recursive for the same
// reason as the marker scan (code can nest under em/strong/del/link), and on
// the SAME canonical tokenizer options so no two guards define tokenization
// differently.
export function inlineCodeRangesInText(text: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const walk = (tokens: Token[]): void => {
        for (const token of tokens) {
            if (token.type === 'inline_code')
                ranges.push({ start: token.range.start, end: token.range.end });
            if ('children' in token && token.children && Array.isArray(token.children))
                walk(token.children);
        }
    };

    walk(tokenizer(text, COMMENT_TOKENIZER_OPTIONS));
    return ranges;
}

export function forEachRealCommentMarker(
    text: string,
    visit: (marker: IScannedCommentMarker) => void,
): void {
    const walk = (tokens: Token[]): void => {
        for (const token of tokens) {
            if (token.type === 'comment_marker') {
                visit({
                    id: token.markerId,
                    kind: token.markerKind,
                    start: token.range.start,
                    end: token.range.end,
                });
            }
            // Markers can nest inside emphasis/strong/etc.; recurse like the
            // lexer's own post-tokenizer walk does.
            if ('children' in token && token.children && Array.isArray(token.children))
                walk(token.children);
        }
    };

    walk(tokenizer(text, COMMENT_TOKENIZER_OPTIONS));
}

export function realCommentMarkersInText(text: string): IScannedCommentMarker[] {
    const markers: IScannedCommentMarker[] = [];
    forEachRealCommentMarker(text, marker => markers.push(marker));
    return markers.sort((a, b) => a.start - b.start);
}

export function createCommentSearchText(text: string): ICommentSearchText {
    if (!text.includes('MC:')) {
        return {
            text,
            rawIndexBySearchIndex: Array.from({ length: text.length }, (_, index) => index),
        };
    }
    if (parseCommentMetadataDefinition(text))
        return { text: '', rawIndexBySearchIndex: [] };

    const rawIndexBySearchIndex: number[] = [];
    let searchText = '';
    let lastIndex = 0;

    const appendVisibleText = (start: number, end: number) => {
        for (let index = start; index < end; index += 1) {
            searchText += text[index];
            rawIndexBySearchIndex.push(index);
        }
    };

    for (const marker of realCommentMarkersInText(text)) {
        appendVisibleText(lastIndex, marker.start);
        lastIndex = marker.end;
    }
    appendVisibleText(lastIndex, text.length);

    return { text: searchText, rawIndexBySearchIndex };
}

export function stripRealCommentMarkersFromText(text: string): string {
    let next = '';
    let lastIndex = 0;

    for (const marker of realCommentMarkersInText(text)) {
        next += text.slice(lastIndex, marker.start);
        lastIndex = marker.end;
    }

    return next + text.slice(lastIndex);
}

export function stripCommentSyntaxForClipboard(text: string): string {
    if (!text.includes('MC:'))
        return text;

    if (parseCommentMetadataDefinition(text))
        return '';

    const withoutMarkers = stripRealCommentMarkersFromText(text);
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

// Every marker kind present in `text`, keyed by comment id.
export function commentMarkerKindsInText(text: string): Map<string, Set<TCommentMarkerKind>> {
    const kindsById = new Map<string, Set<TCommentMarkerKind>>();
    forEachRealCommentMarker(text, ({ id, kind }) => {
        const kinds = kindsById.get(id) ?? new Set<TCommentMarkerKind>();
        kinds.add(kind);
        kindsById.set(id, kinds);
    });
    return kindsById;
}

// Aggregate every marker kind present across the given texts, keyed by comment
// id. Edit guards use this to answer "does this comment's counterpart marker
// exist anywhere in the document?" — a range can open in one block and close in
// another, so a single-block scan misses the counterpart.
export function commentMarkerKindsInTexts(
    texts: Iterable<string>,
): Map<string, Set<TCommentMarkerKind>> {
    const kindsById = new Map<string, Set<TCommentMarkerKind>>();
    for (const text of texts) {
        for (const [id, kinds] of commentMarkerKindsInText(text)) {
            const merged = kindsById.get(id) ?? new Set<TCommentMarkerKind>();
            for (const kind of kinds)
                merged.add(kind);
            kindsById.set(id, merged);
        }
    }
    return kindsById;
}

// Whether removing exactly `removedKinds` for a comment orphans a counterpart
// that survives elsewhere (per `survivingKinds`): one endpoint is removed while
// its partner remains, or vice versa. The single definition of "this edit
// orphans a marker", shared by every edit guard.
export function orphansCounterpart(
    removedKinds: ReadonlySet<TCommentMarkerKind>,
    survivingKinds: ReadonlySet<TCommentMarkerKind>,
): boolean {
    return (
        (removedKinds.has('open') && !removedKinds.has('close') && survivingKinds.has('close'))
        || (removedKinds.has('close') && !removedKinds.has('open') && survivingKinds.has('open'))
    );
}

// Whether removing `removedTexts` while keeping `survivingTexts` orphans a
// comment. Used by structural edits (table row/column removal) that delete
// whole blocks at once.
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
        if (survivingKinds && orphansCounterpart(kinds, survivingKinds))
            return true;
    }

    return false;
}
