import type { Token, Tokens } from 'marked';
import type { ListItemToken, ListToken } from './types';
import { replaceArrayRange } from '../arrayMutation';

function isListToken(token: Token | ListToken): token is ListToken {
    return token.type === 'list';
}

function normalizeChildTokens<T extends Token | ListToken | ListItemToken>(
    tokens: T[],
): T[] {
    const normalized = compatibleTaskList(tokens) as T[];
    replaceArrayRange(tokens, 0, tokens.length, normalized);
    return tokens;
}

const EMPTY_TASK_REG = /^ {0,3}[*+-][ \t]+\[([ x])\][ \t]*$/i;
const TASK_MARKER_PREFIX_REG = /^ {0,3}[*+-][ \t]+\[([ x])\][ \t]+/i;

function stripTaskTextPrefix(value: string, marker: string) {
    if (!value.startsWith(marker))
        return value;

    const rest = value.slice(marker.length);
    const newlinePrefix = /^[ \t]*\r?\n/.exec(rest);
    if (newlinePrefix)
        return rest.slice(newlinePrefix[0].length);

    return rest.replace(/^[ \t]+/, '');
}

function stripSyntheticTaskMarker(item: ListItemToken, marker: string) {
    const first = item.tokens?.[0] as Token & { raw?: string; text?: string; tokens?: Token[] } | undefined;
    if (!first)
        return;

    if (typeof first.text === 'string')
        first.text = stripTaskTextPrefix(first.text, marker);
    if (typeof first.raw === 'string')
        first.raw = stripTaskTextPrefix(first.raw, marker);

    const inner = first.type === 'paragraph'
        ? first.tokens?.[0] as Token & { raw?: string; text?: string } | undefined
        : undefined;
    if (inner) {
        if (typeof inner.text === 'string')
            inner.text = stripTaskTextPrefix(inner.text, marker);
        if (typeof inner.raw === 'string')
            inner.raw = stripTaskTextPrefix(inner.raw, marker);
    }
}

// marked >=17 keeps the GFM task marker inside the item content: a leading
// `checkbox` token, plus the literal "[ ] " / "[x] " prefix in the first
// paragraph's `text` for loose lists. muya renders the marker from the
// task-list-item `checked` meta, so strip it here to avoid double-emitting it
// on serialization.
function stripTaskMarker(item: ListItemToken) {
    const tokens = item.tokens;
    if (!tokens || !tokens.length)
        return;
    const first = tokens[0] as Token & { text?: string; tokens?: Token[] };
    if (first.type === 'checkbox') {
        tokens.shift();
        return;
    }
    const inner = first.type === 'paragraph' ? first.tokens?.[0] : undefined;
    if (inner?.type === 'checkbox') {
        const { raw } = inner;
        first.tokens!.shift();
        if (typeof first.text === 'string' && first.text.startsWith(raw))
            first.text = first.text.slice(raw.length);
        if (typeof first.raw === 'string' && first.raw.startsWith(raw))
            first.raw = first.raw.slice(raw.length);
    }
}

function normalizeEmptyTaskItem(item: ListItemToken) {
    if (item.task)
        return;

    const matches = EMPTY_TASK_REG.exec(item.raw) || TASK_MARKER_PREFIX_REG.exec(item.raw);
    if (!matches)
        return;

    const marker = `[${matches[1]}]`;
    const text = typeof item.text === 'string' ? item.text : '';
    if (text.trimEnd() !== marker && !text.startsWith(marker))
        return;

    item.task = true;
    item.checked = matches[1] !== ' ';
    item.text = stripTaskTextPrefix(text, marker);
    if (item.text === '')
        item.tokens = [];
    else
        stripSyntheticTaskMarker(item, marker);
}

// If bullet list contains task list items, split the bullet list into bullet lists and task lists.
// Add `listType` to token, it's type: "order" | "bullet" | "task".
// Add `listItemType` to list_item token. it's type: "order" | "bullet" | "task".
// Add `bulletMarkerOrDelimiter` to list_item token. it's type: "." | ")" | "*" | "+" | "-"
function compatibleTaskList(tokens: (Token | ListToken | ListItemToken)[] = []) {
    const results = [];

    for (const token of tokens) {
        if (isListToken(token)) {
            if (token.ordered === true) {
                token.listType = 'order';
                for (const item of token.items) {
                    item.tokens = normalizeChildTokens(item.tokens);
                    item.listItemType = 'order';
                    item.bulletMarkerOrDelimiter = (
                        item.marker.slice(-1)
                    ) as ListItemToken['bulletMarkerOrDelimiter'];
                }
                results.push(token);
            }
            else {
                const { type, raw, ordered, loose } = token;
                let cache: {
                    type: 'list';
                    listType: 'bullet' | 'task';
                    raw: string;
                    ordered: false;
                    start: '';
                    loose: boolean;
                    items: ListItemToken[];
                    suppressBlockSeparatorAfter?: true;
                    criticMarkupBefore?: readonly Tokens.CriticMarkupBoundaryAttachment[];
                    criticMarkupAfter?: readonly Tokens.CriticMarkupBoundaryAttachment[];
                } | null = null;
                let firstSplit = true;

                for (const item of token.items) {
                    item.tokens = normalizeChildTokens(item.tokens);
                    normalizeEmptyTaskItem(item);
                    const listItemType = item.task ? 'task' : 'bullet';
                    item.listItemType = listItemType;
                    if (item.task)
                        stripTaskMarker(item);
                    item.bulletMarkerOrDelimiter = (
                        item.marker
                    ) as ListItemToken['bulletMarkerOrDelimiter'];

                    if (!cache) {
                        cache = {
                            type,
                            raw,
                            ordered,
                            start: '',
                            loose,
                            listType: listItemType,
                            items: [item],
                            ...(firstSplit && token.criticMarkupBefore
                                ? { criticMarkupBefore: token.criticMarkupBefore }
                                : {}),
                        };
                        firstSplit = false;
                    }
                    else {
                        if (listItemType === cache.listType) {
                            cache.items.push(item);
                        }
                        else {
                            results.push(cache);
                            cache = {
                                type,
                                raw,
                                ordered,
                                start: '',
                                loose,
                                listType: listItemType,
                                items: [item],
                            };
                        }
                    }
                }

                if (cache && token.suppressBlockSeparatorAfter)
                    cache.suppressBlockSeparatorAfter = true;
                if (cache && token.criticMarkupAfter)
                    cache.criticMarkupAfter = token.criticMarkupAfter;
                if (cache)
                    results.push(cache);
            }
        }
        else if (token.type === 'blockquote') {
            const childTokens = token.tokens;
            if (childTokens)
                token.tokens = normalizeChildTokens(childTokens);
            results.push(token);
        }
        else if (token.type === 'footnote') {
            // The footnote extension stores its body block tokens under
            // `tokens` (see utils/marked/extensions/footnote.ts). Without
            // this branch a nested bullet/order/task list inside a footnote
            // never receives a `listType`, and markdownToState produces
            // `undefined-list` for the child state.
            const ft = token as { tokens?: (Token | ListToken | ListItemToken)[] };
            const footnoteTokens = ft.tokens;
            if (footnoteTokens)
                ft.tokens = normalizeChildTokens(footnoteTokens);
            results.push(token);
        }
        else if (
            token.type === 'critic_addition'
            || token.type === 'critic_deletion'
            || token.type === 'critic_substitution'
            || token.type === 'critic_highlight'
            || token.type === 'critic_comment'
        ) {
            const fragment = token as Tokens.CriticMarkupFragment;
            fragment.tokens = normalizeChildTokens(fragment.tokens);
            results.push(token);
        }
        else {
            results.push(token);
        }
    }

    return results;
}

export default compatibleTaskList;
