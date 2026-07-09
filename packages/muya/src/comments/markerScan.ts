import type { Token } from '../inlineRenderer/types';
import { tokenizer } from '../inlineRenderer/lexer';
import { mayContainCommentSyntax, parseMalformedCommentMarker } from './syntax';

type TCommentMarkerKind = 'open' | 'close';

export interface IScannedCommentMarker {
    id: string;
    kind: TCommentMarkerKind;
    start: number;
    end: number;
}

// Comment markers as the REAL inline tokenizer recognizes them. Unlike a raw
// regex over the text, the tokenizer does not emit `comment_marker` tokens for
// marker-looking text inside inline-code or inline-math spans (that content is
// not re-tokenized), so this matches exactly what the parser treats as a live
// comment — load-time extraction and the file-level analyzer share one
// definition of "a real marker".
//
// Tokenize exactly as `parseMarkdownComments` does (`comments/parse.ts`):
// `hasBeginRules: false`. With begin rules on, block-level rules (notably the
// reference-definition rule for a `[ref]: url` line, which round-trips as
// paragraph text) consume the line and swallow a trailing comment marker the
// parser DOES treat as live.
const COMMENT_TOKENIZER_OPTIONS = {
    hasBeginRules: false,
    options: { superSubScript: true, footnote: false },
} as const;

// Inline-code spans a text may contain — recursive for the same reason as
// the marker scan (code can nest under em/strong/del/link), and on the SAME
// canonical tokenizer options so no two consumers define tokenization
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

export function stripRealCommentMarkersFromText(text: string): string {
    let next = '';
    let lastIndex = 0;

    for (const marker of realCommentMarkersInText(text)) {
        next += text.slice(lastIndex, marker.start);
        lastIndex = marker.end;
    }

    return next + text.slice(lastIndex);
}

export interface IScannedMalformedMarker {
    id: string;
    kind: string;
    raw: string;
}

// Malformed marker SHAPES (`<!--MC:` candidates the tokenizer refused —
// e.g. an invalid id) in a text, via the same canonical tokenization:
// inline-code/math absorb their content, so a shape inside a code span is
// documentation, not a diagnostic. The live view and the byte-level
// analyzer share this one definition.
export function malformedCommentMarkersInText(text: string): IScannedMalformedMarker[] {
    if (!mayContainCommentSyntax(text))
        return [];

    const out: IScannedMalformedMarker[] = [];
    const walk = (tokens: Token[]): void => {
        for (const token of tokens) {
            if (token.type === 'html_tag') {
                const malformed = parseMalformedCommentMarker(token.raw);
                if (malformed)
                    out.push({ id: malformed.id, kind: malformed.kind, raw: malformed.raw });
            }
            if ('children' in token && token.children && Array.isArray(token.children))
                walk(token.children);
        }
    };
    walk(tokenizer(text, COMMENT_TOKENIZER_OPTIONS));
    return out;
}
