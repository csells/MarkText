import type { MarkedExtension, Tokenizer, Tokens } from 'marked';
import type { ICommentMetadataDefinitionToken } from '../types';
import {
    COMMENT_METADATA_DEFINITION_REGEXP,
    htmlBlockTokenIsParagraph,
    LINE_LEADING_COMMENT_MARKER_REGEXP,
} from '../../../comments/syntax';

// `[MC:id]: <payload>` thread-metadata definitions are first-class block
// syntax. Letting them fall through to marked's generic reference-definition
// rule loses data: marked dedups definition labels case-insensitively, so a
// duplicate `[MC:id]` line (a merge artifact diagnostics must see) is silently
// dropped, and an `[MC:x]` registration shadows a user's own `[mc:x]` link
// definition into deletion. Malformed payloads are deliberately matched too,
// so the comment analyzer can still diagnose them after a round-trip.
//
// No `start` hook on purpose: without it the tokenizer only runs at block
// starts, so a definition line inside a paragraph run keeps folding into the
// paragraph (lazy continuation) — the same view the comment analyzer takes.
export default function commentMetadataExtension(): MarkedExtension {
    return {
        // A line-leading MC marker must never trigger CommonMark's HTML-block
        // rule: kind 2 (comment blocks) would split soft-wrapped paragraphs at
        // the marker line, injecting blank lines on the next save. Declining
        // here lets the paragraph/text rules consume the line as ordinary
        // prose (marker-led REAL html still html-tokenizes via the original).
        tokenizer: {
            html(this: Tokenizer, src: string): Tokens.HTML | false | undefined {
                const lineEnd = src.indexOf('\n');
                const line = lineEnd === -1 ? src : src.slice(0, lineEnd);
                if (LINE_LEADING_COMMENT_MARKER_REGEXP.test(line) && htmlBlockTokenIsParagraph(line))
                    return undefined;

                const prototype = Object.getPrototypeOf(this) as Tokenizer;
                return prototype.html.call(this, src) as Tokens.HTML | false | undefined;
            },
        },
        extensions: [
            {
                name: 'commentMetadataDefinition',
                level: 'block' as const,
                tokenizer(src: string): ICommentMetadataDefinitionToken | undefined {
                    // Consume the whole contiguous RUN of definition lines as
                    // one token: v2 threads conventionally keep head and reply
                    // lines adjacent, and one-token-per-line would split them
                    // into separate paragraphs whose serialization re-inserts
                    // blank lines — breaking round-trip byte identity.
                    const lines: string[] = [];
                    let consumed = 0;
                    for (;;) {
                        const lineEnd = src.indexOf('\n', consumed);
                        const line = lineEnd === -1 ? src.slice(consumed) : src.slice(consumed, lineEnd);
                        if (!COMMENT_METADATA_DEFINITION_REGEXP.test(line))
                            break;
                        lines.push(line);
                        if (lineEnd === -1) {
                            consumed = src.length;
                            break;
                        }
                        consumed = lineEnd + 1;
                    }
                    if (lines.length === 0)
                        return undefined;

                    return {
                        type: 'commentMetadataDefinition',
                        raw: src.slice(0, consumed),
                        text: lines.join('\n'),
                    };
                },
            },
        ],
    };
}
