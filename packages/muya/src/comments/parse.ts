import type { IMarkdownToStateOptions } from '../state/markdownToState';
import type { TState } from '../state/types';
import type { IParsedMarkdownComments } from './types';
import { MarkdownToState } from '../state/markdownToState';
import { commentModelView, extractCommentModel } from './model';

type TParseMarkdownCommentOptions = Partial<IMarkdownToStateOptions>;

function markdownToStates(markdownOrStates: string | TState[], options?: TParseMarkdownCommentOptions) {
    if (typeof markdownOrStates !== 'string')
        return markdownOrStates;

    const markdown = markdownOrStates.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
    return new MarkdownToState(options as IMarkdownToStateOptions | undefined).generate(markdown);
}

export function parseMarkdownComments(
    markdownOrStates: string | TState[],
    options?: TParseMarkdownCommentOptions,
): IParsedMarkdownComments {
    // Fast path: every comment marker (`<!--MC:`) and metadata definition
    // (`[MC:`) contains the literal `MC:`, and no diagnostic can arise without
    // one of them. A document lacking `MC:` has no comments, so skip the
    // expensive full-document re-parse this would otherwise run on every load.
    if (typeof markdownOrStates === 'string' && !markdownOrStates.includes('MC:'))
        return { threads: [], ranges: [], diagnostics: [] };

    // ONE owner of comment semantics: the byte-level analyzer IS the runtime
    // model pipeline — extraction resolves markers/definitions and records
    // exact diagnostics, the view derives ranges/threads/diagnostics. Ranges
    // are CLEAN-text coordinates (marker bytes excluded), identical to what
    // the live editor reports.
    const { states, model } = extractCommentModel(markdownToStates(markdownOrStates, options));
    return commentModelView(model, states);
}
