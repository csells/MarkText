import type { TCriticMarkupDraft } from './parser';
import type { TCriticMarkupDecision } from './project';
import {
    parseCriticMarkupAt,
    serializeCriticMarkupDraft,
} from './parser';
import { resolveCriticMarkupToken } from './project';

/** Create pure CriticMarkup using the grammar owner's canonical delimiters. */
export function createCriticMarkup(draft: TCriticMarkupDraft): string {
    return serializeCriticMarkupDraft(draft);
}

/** Resolve exactly one known review item and leave adjacent Markdown intact. */
export function resolveCriticMarkupAt(
    source: string,
    offset: number,
    decision: TCriticMarkupDecision,
): string {
    const token = parseCriticMarkupAt(source, offset);
    if (!token) {
        throw new TypeError(
            `No CriticMarkup construct begins at offset ${offset}.`,
        );
    }

    return source.slice(0, token.range.start)
        + resolveCriticMarkupToken(token, decision)
        + source.slice(token.range.end);
}
