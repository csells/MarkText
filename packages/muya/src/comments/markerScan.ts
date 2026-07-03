import type { Token } from '../inlineRenderer/types';
import { tokenizer } from '../inlineRenderer/lexer';

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
// comment. The edit guards use it so "what the guard protects" stays identical
// to "what the parser renders as a comment".
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

    walk(tokenizer(text));
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

// Whether removing `removedTexts` while keeping `survivingTexts` orphans a
// comment: one endpoint is removed while its counterpart survives (or vice
// versa). Used by structural edits (table row/column removal) that delete whole
// blocks at once.
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
