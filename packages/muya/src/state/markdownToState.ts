import type { IFenceMarker } from '../utils/markdownBlockRules';
import type { TBlockToken } from '../utils/marked/types';
import type {
    IAtxHeadingState,
    IBulletListState,
    IListItemState,
    IOrderListState,
    ISetextHeadingState,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    TState,
} from './types';
import {
    COMMENT_MARKER_PATTERN,
    COMMENT_MARKER_SEARCH_REGEXP,
    parseCommentMetadataDefinition,
} from '../comments/syntax';
import { escapeRegExp } from '../utils';
import logger from '../utils/logger';
import {
    FRONT_MATTER_OPEN_REGEXP,
    frontMatterCloseMarker,
    INDENTED_CODE_REGEXP,
    isFenceClose,
    MATH_BLOCK_DELIM_REGEXP,
    parseFenceMarker,
} from '../utils/markdownBlockRules';
import { lexBlock } from '../utils/marked';

const debug = logger('import markdown: ');
const COMMENT_MARKER_GLOBAL_REGEXP = new RegExp(COMMENT_MARKER_PATTERN, 'g');

function restoreTableEscapeCharacters(text: string) {
    // NOTE: markedjs replaces all escaped "|" ("\|") characters inside a cell with "|".
    //       We have to re-escape the character to not break the table.
    return text.replace(/\|/g, '\\|');
}

function looksLikeRawHtmlAfterCommentMarkers(text: string) {
    const trimmed = text.replace(COMMENT_MARKER_GLOBAL_REGEXP, '').trim();
    if (!trimmed.startsWith('<'))
        return false;

    const next = trimmed[1];
    return (
        next === '!'
        || next === '/'
        || (next >= 'A' && next <= 'Z')
        || (next >= 'a' && next <= 'z')
    );
}

function shouldTreatHtmlAsParagraph(text: string) {
    return COMMENT_MARKER_SEARCH_REGEXP.test(text) && !looksLikeRawHtmlAfterCommentMarkers(text);
}

function buildHeadingState(token: Extract<TBlockToken, { type: 'heading' }>): IAtxHeadingState | ISetextHeadingState {
    const { headingStyle, depth, text, marker } = token;
    const value = headingStyle === 'atx'
        ? `${'#'.repeat(+depth)} ${text}`
        : text;

    return headingStyle === 'atx'
        ? {
                name: 'atx-heading',
                meta: { level: depth },
                text: value,
            }
        : {
                name: 'setext-heading',
                meta: { level: depth, underline: marker },
                text: value,
            };
}

function buildTableState(token: Extract<TBlockToken, { type: 'table' }>): ITableState {
    const { header, align, rows } = token;
    return {
        name: 'table',
        children: [
            {
                name: 'table.row',
                children: header.map((h, i) => ({
                    name: 'table.cell' as const,
                    meta: { align: align[i] || 'none' },
                    text: restoreTableEscapeCharacters(h.text),
                })),
            },
            ...rows.map(row => ({
                name: 'table.row' as const,
                children: row.map((c, i) => ({
                    name: 'table.cell' as const,
                    meta: { align: align[i] || 'none' },
                    text: restoreTableEscapeCharacters(c.text),
                })),
            })),
        ],
    };
}

function buildHtmlState(token: Extract<TBlockToken, { type: 'html' }>): TState {
    const text = token.text.trim();
    // TODO: Treat html state which only contains one img as paragraph, we maybe add image state in the future.
    const isSingleImage = /^<img[^<>]+>$/.test(text);
    return isSingleImage || shouldTreatHtmlAsParagraph(text)
        ? {
                name: 'paragraph' as const,
                text,
            }
        : {
                name: 'html-block' as const,
                text,
            };
}

function consumeTextToken(token: Extract<TBlockToken, { type: 'text' }>, tokens: TBlockToken[]): string {
    let value = token.text;
    while (tokens[0]?.type === 'text') {
        const next = tokens.shift() as Extract<TBlockToken, { type: 'text' }>;
        value += `\n${next.text}`;
    }

    return value;
}

interface ICommentMetadataDefinitionScanOptions {
    frontMatter: boolean;
    math: boolean;
}

function getFrontMatterEndLine(lines: string[]): number | null {
    const opening = lines[0] == null ? null : FRONT_MATTER_OPEN_REGEXP.exec(lines[0]);
    if (!opening)
        return null;

    const closing = frontMatterCloseMarker(opening[1]);
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index].trim() === closing)
            return index;
    }

    return null;
}

function getHtmlBlockClosing(line: string): RegExp | 'single-line' | null {
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--')) {
        return /-->/u.test(trimmed) ? 'single-line' : /-->/u;
    }

    const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/u.exec(trimmed);
    if (!tag)
        return null;
    if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed))
        return 'single-line';

    return new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu');
}

function commentMetadataDefinitionLines(
    markdown: string,
    options: ICommentMetadataDefinitionScanOptions,
): string[] {
    const lines = markdown
        .replace(/^\uFEFF/u, '')
        .split(/\r\n|\n|\r/u);
    const definitions: string[] = [];
    let fence: IFenceMarker | null = null;
    const frontMatterEndLine = options.frontMatter ? getFrontMatterEndLine(lines) : null;
    let htmlClosing: RegExp | null = null;
    let inMathBlock = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();

        if (frontMatterEndLine != null && index <= frontMatterEndLine)
            continue;

        if (fence) {
            if (isFenceClose(line, fence))
                fence = null;
            continue;
        }

        const fenceStart = parseFenceMarker(line);
        if (fenceStart) {
            fence = fenceStart;
            continue;
        }

        if (options.math && inMathBlock) {
            if (MATH_BLOCK_DELIM_REGEXP.test(line))
                inMathBlock = false;
            continue;
        }

        if (options.math && MATH_BLOCK_DELIM_REGEXP.test(line)) {
            inMathBlock = true;
            continue;
        }

        if (htmlClosing) {
            if (!trimmed || htmlClosing.test(trimmed))
                htmlClosing = null;
            continue;
        }

        const htmlBlockClosing = getHtmlBlockClosing(line);
        if (htmlBlockClosing) {
            if (htmlBlockClosing !== 'single-line')
                htmlClosing = htmlBlockClosing;
            continue;
        }

        if (INDENTED_CODE_REGEXP.test(line))
            continue;

        if (parseCommentMetadataDefinition(line))
            definitions.push(line);
    }

    return definitions;
}

function restoreDroppedCommentMetadataDefinitions(
    markdown: string,
    states: TState[],
    options: ICommentMetadataDefinitionScanOptions,
): void {
    const definitionKeySeparator = '\u0000';
    const rawDefinitions = commentMetadataDefinitionLines(markdown, options);
    if (!rawDefinitions.length)
        return;

    // Count each (id, dataUri) definition already present anywhere in the parsed
    // state tree — including definitions marked folded into a multi-line
    // paragraph or indented inside a container, which it does not surface as
    // their own paragraph. Keying on the parsed definition (not the raw line
    // text) makes this indentation-independent. Only genuinely dropped
    // definitions are restored, so a save never duplicates one that survived.
    const definitionKey = (line: string): string | null => {
        const parsed = parseCommentMetadataDefinition(line);
        return parsed ? `${parsed.id}${definitionKeySeparator}${parsed.dataUri}` : null;
    };
    // Definitions inside these blocks are literal text, not real definitions —
    // mirror what commentMetadataDefinitionLines skips so a def in frontmatter or
    // a code block cannot mask a genuinely dropped definition with the same id.
    const nonDefinitionStates = new Set<TState['name']>([
        'code-block',
        'diagram',
        'frontmatter',
        'html-block',
        'math-block',
    ]);
    const present = new Map<string, number>();
    const countPresent = (nodes: TState[]): void => {
        for (const state of nodes) {
            if ('text' in state && typeof state.text === 'string' && !nonDefinitionStates.has(state.name)) {
                for (const line of state.text.split('\n')) {
                    const key = definitionKey(line);
                    if (key)
                        present.set(key, (present.get(key) ?? 0) + 1);
                }
            }
            if ('children' in state && Array.isArray(state.children))
                countPresent(state.children);
        }
    };
    countPresent(states);

    let insertIndex = states.length;
    states.forEach((state, index) => {
        if (state.name === 'paragraph' && 'text' in state && parseCommentMetadataDefinition(state.text))
            insertIndex = index + 1;
    });

    const missing = rawDefinitions.filter((definition) => {
        const key = definitionKey(definition);
        if (!key)
            return false;

        const count = present.get(key) ?? 0;
        if (count > 0) {
            present.set(key, count - 1);
            return false;
        }
        return true;
    });
    if (!missing.length)
        return;

    states.splice(
        insertIndex,
        0,
        ...missing.map(text => ({
            name: 'paragraph' as const,
            text,
        })),
    );
}

export interface IMarkdownToStateOptions {
    footnote: boolean;
    math: boolean;
    isGitlabCompatibilityEnabled: boolean;
    trimUnnecessaryCodeBlockEmptyLines: boolean;
    frontMatter: boolean;
};

const DEFAULT_OPTIONS = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
};

// Token types whose handler manipulates the `parentList` stack (push a
// container and recurse via synthetic `block-end`), as opposed to the leaf
// tokens that only append a state to the current level.
const CONTAINER_TOKEN_TYPES = new Set([
    'block-end',
    'blockquote',
    'list',
    'list_item',
    'footnote',
]);

export class MarkdownToState {
    constructor(private _options: IMarkdownToStateOptions = DEFAULT_OPTIONS) {}

    generate(markdown: string): TState[] {
        return this._convertMarkdownToState(markdown);
    }

    private _convertMarkdownToState(markdown: string): TState[] {
        const {
            footnote = false,
            math = true,
            isGitlabCompatibilityEnabled = true,
            trimUnnecessaryCodeBlockEmptyLines = false,
            frontMatter = true,
        } = this._options;

        // markdownToState injects synthetic `block-end` markers (see the
        // blockquote/list/list_item/footnote cases below) to pop the parent
        // stack, so the working stream is wider than what `lexBlock` returns.
        const tokens: TBlockToken[] = lexBlock(markdown, {
            footnote,
            math,
            frontMatter,
            isGitlabCompatibilityEnabled,
        });

        const states: TState[] = [];
        let token: TBlockToken | undefined;
        const parentList: TState[][] = [states];

        // eslint-disable-next-line no-cond-assign
        while ((token = tokens.shift())) {
            if (CONTAINER_TOKEN_TYPES.has(token.type))
                this._handleContainerToken(token, parentList, tokens);
            else
                this._handleLeafToken(token, parentList, tokens, trimUnnecessaryCodeBlockEmptyLines);
        }

        if (states.length)
            restoreDroppedCommentMetadataDefinitions(markdown, states, { frontMatter, math });

        return states.length ? states : [{ name: 'paragraph', text: '' }];
    }

    private _handleContainerToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
    ) {
        let state: TState;
        switch (token.type) {
            // Marks the end of the children's traversal and a return to the previous level
            case 'block-end': {
                // Fix #1735 the blockquote maybe empty. like bellow:
                // >
                // bar
                if (
                    parentList[0].length === 0
                    && (token.tokenType === 'blockquote' || token.tokenType === 'list-item')
                ) {
                    state = {
                        name: 'paragraph' as const,
                        text: '',
                    };
                    parentList[0].push(state);
                }
                parentList.shift();
                break;
            }

            case 'blockquote': {
                state = {
                    name: 'block-quote' as const,
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'blockquote' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }

            case 'list': {
                const { listType, loose, start } = token;
                const bulletMarkerOrDelimiter
                    = token.items[0].bulletMarkerOrDelimiter;

                let listState: IOrderListState | IBulletListState | ITaskListState;
                if (listType === 'order') {
                    listState = {
                        name: 'order-list',
                        meta: {
                            loose,
                            start: /^\d+$/.test(String(start)) ? Number(start) : 1,
                            delimiter: bulletMarkerOrDelimiter || '.',
                        },
                        children: [],
                    };
                }
                else if (listType === 'task') {
                    listState = {
                        name: 'task-list',
                        meta: {
                            loose,
                            marker: bulletMarkerOrDelimiter || '-',
                        },
                        children: [],
                    };
                }
                else {
                    listState = {
                        name: 'bullet-list',
                        meta: {
                            loose,
                            marker: bulletMarkerOrDelimiter || '-',
                        },
                        children: [],
                    };
                }

                state = listState;
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list' });
                tokens.unshift(...(token.items as TBlockToken[]));
                break;
            }

            case 'list_item': {
                const { listItemType, checked } = token;
                let itemState: IListItemState | ITaskListItemState;
                if (listItemType === 'task') {
                    itemState = {
                        name: 'task-list-item',
                        meta: { checked: Boolean(checked) },
                        children: [],
                    };
                }
                else {
                    itemState = {
                        name: 'list-item',
                        children: [],
                    };
                }

                state = itemState;
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list-item' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }

            case 'footnote': {
                // The footnote extension (utils/marked/extensions/footnote.ts)
                // emits a parent token whose `tokens` array holds nested
                // block tokens. Mirror that into a `footnote` container
                // state and recurse via tokens.unshift / block-end.
                const { identifier } = token;
                state = {
                    name: 'footnote' as const,
                    meta: { identifier },
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'footnote' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }
        }
    }

    private _handleLeafToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
        trimUnnecessaryCodeBlockEmptyLines: boolean,
    ) {
        let state: TState;
        let value: string;
        switch (token.type) {
            case 'frontmatter': {
                const { lang, style, text } = token;
                value = text.replace(/^\s+/, '').replace(/\s$/, '');

                state = {
                    name: 'frontmatter' as const,
                    meta: {
                        lang,
                        style,
                    },
                    text: value,
                };

                parentList[0].push(state);
                break;
            }

            case 'hr': {
                state = {
                    name: 'thematic-break' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };

                parentList[0].push(state);
                break;
            }

            case 'heading': {
                parentList[0].push(buildHeadingState(token));
                break;
            }

            case 'code': {
                const { codeBlockStyle, text, lang: infoString = '', raw = '' } = token;
                // marked >=17 appends a trailing newline to indented code text
                // (fenced text has none); strip it so indented blocks round-trip.
                const codeText = codeBlockStyle === 'indented' ? text.replace(/\n$/, '') : text;
                const fenceLength = /^ {0,3}([`~]{3,})/.exec(raw)?.[1].length;
                parentList[0].push(
                    this._buildCodeState(codeText, infoString, codeBlockStyle, trimUnnecessaryCodeBlockEmptyLines, fenceLength),
                );
                break;
            }

            case 'table': {
                parentList[0].push(buildTableState(token));
                break;
            }

            case 'html': {
                parentList[0].push(buildHtmlState(token));
                break;
            }

            case 'multiplemath': {
                const text = token.text.trim();
                const { mathStyle = '' } = token;
                const state = {
                    name: 'math-block' as const,
                    text,
                    meta: { mathStyle },
                };
                parentList[0].push(state);
                break;
            }

            case 'text': {
                state = {
                    name: 'paragraph',
                    text: consumeTextToken(token, tokens),
                };
                parentList[0].push(state);
                break;
            }

            case 'paragraph': {
                value = token.text;
                state = {
                    name: 'paragraph' as const,
                    text: value,
                };
                parentList[0].push(state);
                break;
            }

            case 'space': {
                break;
            }

            case 'def': {
                // Marked v16 hoists `[label]: url "title"` reference
                // definitions to block-level `def` tokens. Lower them back
                // to paragraph state nodes so the rest of the pipeline —
                // `InlineRenderer.collectReferenceDefinitions` (regex scan
                // over paragraph text) and round-trip serialization —
                // keeps working without a dedicated state node.
                // Aligns with marktext's "definition is paragraph text"
                // model. See plan section 13 (PR-16).
                state = {
                    name: 'paragraph' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };
                parentList[0].push(state);
                break;
            }

            default:
                debug.warn(`Unknown type ${token.type}`);
                break;
        }
    }

    private _buildCodeState(
        text: string,
        infoString: string,
        codeBlockStyle: 'indented' | undefined,
        trimUnnecessaryCodeBlockEmptyLines: boolean,
        fenceLength?: number,
    ): TState {
        // GH#697, markedjs#1387 — strip everything past the first
        // whitespace; `\S*` matches the empty string so this is
        // always non-null even for `infoString === ''`.
        const lang = (infoString || '').match(/\S*/)?.[0] ?? '';

        let value = text;
        // Fix: #1265.
        if (
            trimUnnecessaryCodeBlockEmptyLines
            && (value.endsWith('\n') || value.startsWith('\n'))
        ) {
            value = value.replace(/\n+$/, '').replace(/^\n+/, '');
        }

        const diagramMatch = /^(mermaid|vega-lite|plantuml|flowchart|sequence)$/.exec(lang);
        if (diagramMatch) {
            const diagramType = diagramMatch[1] as 'mermaid' | 'vega-lite' | 'plantuml' | 'flowchart' | 'sequence';
            return {
                name: 'diagram' as const,
                text: value,
                meta: {
                    type: diagramType,
                    lang: diagramType === 'vega-lite' ? 'json' : 'yaml',
                },
            };
        }

        // walkTokens (utils/marked/walkTokens.ts) writes
        // codeBlockStyle = 'fenced' for fenced blocks and
        // leaves 'indented' for indented blocks. marked's
        // type widens the field to `'indented' | undefined`,
        // but `'fenced'` reaches us at runtime via the
        // walkTokens assignment — hence the cast.
        const isFenced = (codeBlockStyle as 'indented' | 'fenced' | undefined) === 'fenced';
        return {
            name: 'code-block' as const,
            meta: {
                type: isFenced ? 'fenced' : 'indented',
                lang,
                ...(isFenced && fenceLength && fenceLength > 3 ? { fenceLength } : {}),
            },
            text: value,
        };
    }
}
