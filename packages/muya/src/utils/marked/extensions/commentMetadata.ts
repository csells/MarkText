import type { ICommentMetadataDefinitionToken } from '../types';
import { COMMENT_METADATA_DEFINITION_REGEXP } from '../../../comments/syntax';

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
export default function commentMetadataExtension() {
    return {
        extensions: [
            {
                name: 'commentMetadataDefinition',
                level: 'block' as const,
                tokenizer(src: string): ICommentMetadataDefinitionToken | undefined {
                    const lineEnd = src.indexOf('\n');
                    const line = lineEnd === -1 ? src : src.slice(0, lineEnd);
                    if (!COMMENT_METADATA_DEFINITION_REGEXP.test(line))
                        return undefined;

                    return {
                        type: 'commentMetadataDefinition',
                        raw: lineEnd === -1 ? line : src.slice(0, lineEnd + 1),
                        text: line,
                    };
                },
            },
        ],
    };
}
