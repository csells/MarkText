/* eslint-disable no-fallthrough */
import type {
    IMarkdownSourceMap,
    TMarkdownStatePath,
    TTrackedMarkdown,
} from './markdownSourceMap';
import type {
    IAtxHeadingState,
    IBlockQuoteState,
    IBulletListState,
    ICriticMarkupStateMarker,
    IFootnoteBlockState,
    IListItemState,
    IMarkdownParserResidueState,
    IOrderListState,
    IParagraphState,
    ISetextHeadingState,
    ITableRowSourceSyntax,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    IThematicBreakState,
    TState,
} from './types';
import { criticMarkupMarkerRaw } from '../criticMarkup/parser';
/**
 * Hi contributors!
 *
 * Before you edit or update codes in this file,
 * make sure you have read this bellow:
 * Commonmark Spec: https://spec.commonmark.org/0.29/
 * GitHub Flavored Markdown Spec: https://github.github.com/gfm/
 * Pandoc Markdown: https://pandoc.org/MANUAL.html#pandocs-markdown
 * The output markdown needs to obey the standards of these Spec.
 */
import { deepClone } from '../utils';

import logger from '../utils/logger';
import stringWidth from '../utils/stringWidth';
import {
    escapeTableText,
    serializeCodeBlock,
    serializeDiagramBlock,
    serializeFrontMatter,
    serializeHtmlBlock,
    serializeMathBlock,
} from './markdownBlockSerializers';
import {
    boundaryMarkdown,
    concatMarkdown,
    mappedMarkdown,
    markdownStatePath,
    plainMarkdown,
    replaceGeneratedMarkdown,
    removeFirstMarkdown,
    sliceMarkdown,
    sliceMarkdownForWeave,
    toMarkdownSourceMap,
} from './markdownSourceMap';
import { isAnyListState } from './types';

export type {
    IMarkdownLeafSourceMap,
    IMarkdownSourceMap,
    IMarkdownSourceMapPiece,
} from './markdownSourceMap';

const debug = logger('export markdown: ');
const SETEXT_SAFE_BULLET_MARKER = '*';

export interface IExportMarkdownOptions {
    listIndentation: number | string;
}

export default class ExportMarkdown {
    // Stack of currently-open list metas while serializing a tree (push on
    // descent into bullet/order/task list, pop on ascent). The serializer
    // reads `loose` / `marker` / `delimiter` / `start` from the top entry
    // to render the correct bullet, indentation, and tightness.
    private _listType: (
        | IBulletListState['meta']
        | IOrderListState['meta']
        | ITaskListState['meta']
    )[];
    private _listUsesSourceSpacing: boolean[];

    private _isLooseParentList: boolean;
    private _listIndentation: string;
    private _listIndentationCount: number;
    private _sourceMapEnabled = false;
    private _mappedLeafPaths: TMarkdownStatePath[] = [];

    constructor(
        {
            listIndentation,
        }: IExportMarkdownOptions = {
            listIndentation: 1,
        },
    ) {
        this._listType = []; // 'ul' or 'ol'
        this._listUsesSourceSpacing = [];
        // helper to translate the first tight item in a nested list
        this._isLooseParentList = true;

        // set and validate settings
        this._listIndentation = 'number';
        if (listIndentation === 'dfm') {
            this._listIndentation = 'dfm';
            this._listIndentationCount = 4;
        }
        else if (typeof listIndentation === 'number') {
            this._listIndentationCount = Math.min(Math.max(listIndentation, 1), 4);
        }
        else {
            this._listIndentationCount = 1;
        }
    }

    generate(states: TState[]) {
        return this._weaveCriticSourceTrivia(
            states,
            this._applyTerminalLineEnding(
                states,
                this._convertStatesToMarkdown(states),
            ),
        ).text;
    }

    /**
     * Serialize directly into the immutable branded mapping domain used by
     * mutation capture and CriticMarkup. Public DTO callers keep using
     * generateWithSourceMap; production consumers must not round-trip through
     * that compatibility shape.
     */
    generateMapped(states: TState[]): TTrackedMarkdown {
        return this._generateMapped(states).markdown;
    }

    generateWithSourceMap(states: TState[]): IMarkdownSourceMap {
        const { markdown, leafPaths } = this._generateMapped(states);

        return toMarkdownSourceMap(markdown, leafPaths);
    }

    private _generateMapped(states: TState[]): {
        markdown: TTrackedMarkdown;
        leafPaths: readonly TMarkdownStatePath[];
    } {
        this._sourceMapEnabled = true;
        this._mappedLeafPaths = [];

        try {
            const markdown = this._weaveCriticSourceTrivia(
                states,
                this._applyTerminalLineEnding(
                    states,
                    this._convertStatesToMarkdown(states),
                ),
            );
            return {
                markdown,
                leafPaths: [...this._mappedLeafPaths],
            };
        }
        finally {
            this._sourceMapEnabled = false;
            this._mappedLeafPaths = [];
        }
    }

    private _applyTerminalLineEnding(
        states: readonly TState[],
        markdown: TTrackedMarkdown,
    ): TTrackedMarkdown {
        const finalTrivia = states.at(-1)?.sourceTrivia;
        const terminalLineEnding = finalTrivia?.criticAfterSuffix !== undefined
            ? ''
            : finalTrivia?.terminalLineEnding;
        if (terminalLineEnding === undefined || terminalLineEnding === '\n')
            return markdown;
        if (terminalLineEnding === '' && !markdown.text.endsWith('\n'))
            return markdown;
        if (!markdown.text.endsWith('\n')) {
            throw new TypeError(
                'Parser-owned terminal EOL has no generated LF to replace.',
            );
        }

        const terminalStart = markdown.text.length - 1;
        return concatMarkdown([
            sliceMarkdown(markdown, 0, terminalStart),
            replaceGeneratedMarkdown(
                sliceMarkdown(markdown, terminalStart),
                terminalLineEnding,
            ),
        ]);
    }

    private _convertStatesToMarkdown(
        states: TState[],
        indent = '',
        listIndent = '',
        parentPath: TMarkdownStatePath = markdownStatePath([]),
    ): TTrackedMarkdown {
        const result: TTrackedMarkdown[] = [];
        // helper for CommonMark 264
        let lastListBullet = '';
        let previousState: TState | undefined;

        states.forEach((state, index) => {
            const blockPrefix = state.sourceTrivia?.blockPrefix;
            const previousSeparator = previousState?.sourceTrivia
                ?.blockSeparatorAfter;
            const blockSeparatorAfter = state.sourceTrivia
                ?.blockSeparatorAfter;
            this._assertBlockSpacing(blockPrefix, 'blockPrefix');
            this._assertBlockSpacing(
                blockSeparatorAfter,
                'blockSeparatorAfter',
            );
            if (
                blockPrefix !== undefined
                && previousSeparator !== undefined
            ) {
                throw new TypeError(
                    'Adjacent states cannot both own the same parser block boundary.',
                );
            }
            const suppressInitialLineBreak = blockPrefix !== undefined
                || previousSeparator !== undefined;
            if (blockPrefix !== undefined) {
                result.push(this._serializeBlockSpacing(
                    blockPrefix,
                    indent,
                ));
            }
            const resultStart = result.length;
            const statePath = markdownStatePath([...parentPath, index]);
            if (
                state.name !== 'order-list'
                && state.name !== 'bullet-list'
                && state.name !== 'task-list'
            ) {
                lastListBullet = '';
            }

            if (isAnyListState(state)) {
                const markerOverride = !this._isLooseParentList
                    && previousState?.name === 'paragraph'
                    && previousState.text.trim() !== ''
                    && this._startsWithEmptyDashBulletItem(state)
                    ? SETEXT_SAFE_BULLET_MARKER
                    : undefined;
                lastListBullet = this._serializeListBlock(
                    state,
                    result,
                    indent,
                    listIndent,
                    lastListBullet,
                    statePath,
                    markerOverride,
                    suppressInitialLineBreak,
                );
            }
            else if (state.name === 'list-item' || state.name === 'task-list-item') {
                this._serializeListItemBlock(
                    state,
                    result,
                    indent,
                    listIndent,
                    statePath,
                    suppressInitialLineBreak,
                );
            }
            else {
                this._serializeSimpleBlock(
                    state,
                    result,
                    indent,
                    statePath,
                    suppressInitialLineBreak,
                );
            }

            const stateParts = result.splice(resultStart);
            result.push(concatMarkdown(stateParts).withNode(statePath));
            if (blockSeparatorAfter !== undefined) {
                result.push(this._serializeBlockSpacing(
                    blockSeparatorAfter,
                    indent,
                ));
            }

            previousState = state;
        });

        return concatMarkdown(result).withNode(parentPath);
    }

    private _assertBlockSpacing(
        value: string | undefined,
        field: 'blockPrefix' | 'blockSeparatorAfter',
    ): void {
        if (value !== undefined && !/^[ \t\r\n]*$/.test(value)) {
            throw new TypeError(
                `State source trivia ${field} must be whitespace.`,
            );
        }
    }

    /** Restore parent syntax around parser-view whitespace lines. */
    private _serializeBlockSpacing(
        value: string,
        indent: string,
    ): TTrackedMarkdown {
        if (!value || !indent)
            return plainMarkdown(value);

        const parts: TTrackedMarkdown[] = [];
        let cursor = 0;
        while (cursor < value.length) {
            const newline = value.indexOf('\n', cursor);
            if (newline === -1) {
                parts.push(plainMarkdown(
                    `${indent}${value.slice(cursor)}`,
                ));
                break;
            }
            const hasCarriageReturn = newline > cursor
                && value[newline - 1] === '\r';
            const contentEnd = hasCarriageReturn ? newline - 1 : newline;
            const content = value.slice(cursor, contentEnd);
            const lineIndent = content
                ? indent
                : indent.replace(/ +$/, '');
            parts.push(plainMarkdown(
                `${lineIndent}${content}${hasCarriageReturn ? '\r\n' : '\n'}`,
            ));
            cursor = newline + 1;
        }
        return concatMarkdown(parts);
    }

    private _criticMarkerText(
        markers: readonly ICriticMarkupStateMarker[] | undefined,
    ): string {
        if (!markers?.length)
            return '';

        const ordered = markers.every(marker =>
            marker.sourceOffset !== undefined)
            ? [...markers].sort((left, right) =>
                    left.sourceOffset! - right.sourceOffset!)
            : markers;
        return ordered.map((marker) => {
            const expected = criticMarkupMarkerRaw(
                marker.type,
                marker.marker,
            );
            if (marker.raw !== expected) {
                throw new TypeError(
                    'State CriticMarkup marker differs from grammar-owned syntax.',
                );
            }
            return marker.raw;
        }).join('');
    }

    private _weaveCriticSourceTrivia(
        states: readonly TState[],
        clean: TTrackedMarkdown,
    ): TTrackedMarkdown {
        const insertions: Array<{
            readonly offset: number;
            readonly edge: 'after' | 'before';
            readonly depth: number;
            readonly markdown: TTrackedMarkdown;
        }> = [];
        const pending: Array<{
            readonly states: readonly TState[];
            readonly parentPath: TMarkdownStatePath;
        }> = [{ states, parentPath: markdownStatePath([]) }];
        while (pending.length) {
            const current = pending.pop()!;
            current.states.forEach((state, index) => {
                const path = markdownStatePath([
                    ...current.parentPath,
                    index,
                ]);
                const before = this._criticMarkerText(
                    state.sourceTrivia?.criticBefore,
                );
                const after = this._criticMarkerText(
                    state.sourceTrivia?.criticAfter,
                );
                const beforeSuffix = state.sourceTrivia?.criticBeforeSuffix
                    ?? '';
                const afterPrefix = state.sourceTrivia?.criticAfterPrefix
                    ?? '';
                const afterSuffix = state.sourceTrivia?.criticAfterSuffix
                    ?? '';
                if (beforeSuffix && !before) {
                    throw new TypeError(
                        'Critic before-marker suffix has no before marker.',
                    );
                }
                if (afterPrefix && !after) {
                    throw new TypeError(
                        'Critic after-marker prefix has no after marker.',
                    );
                }
                if (afterSuffix && !after) {
                    throw new TypeError(
                        'Critic after-marker suffix has no after marker.',
                    );
                }
                if (before || after) {
                    const range = clean.sourceMap.nodeRange(path);
                    if (!range) {
                        throw new TypeError(
                            'State CriticMarkup trivia has no native node range.',
                        );
                    }
                    if (before) {
                        insertions.push({
                            offset: range.start,
                            edge: 'before',
                            depth: path.length,
                            markdown: concatMarkdown([
                                plainMarkdown(before),
                                ...(beforeSuffix
                                    ? [plainMarkdown(beforeSuffix).withNode(path)]
                                    : []),
                            ]),
                        });
                    }
                    if (after) {
                        insertions.push({
                            offset: range.end,
                            edge: 'after',
                            depth: path.length,
                            markdown: concatMarkdown([
                                ...(afterPrefix
                                    ? [plainMarkdown(afterPrefix).withNode(path)]
                                    : []),
                                plainMarkdown(after),
                                ...(afterSuffix
                                    ? [plainMarkdown(afterSuffix).withNode(path)]
                                    : []),
                            ]),
                        });
                    }
                }
                if ('children' in state) {
                    pending.push({
                        states: state.children as TState[],
                        parentPath: markdownStatePath([
                            ...path,
                            'children',
                        ]),
                    });
                }
            });
        }
        if (!insertions.length)
            return clean;

        insertions.sort((left, right) =>
            left.offset - right.offset
            || (left.edge === right.edge
                ? left.edge === 'before'
                    ? left.depth - right.depth
                    : right.depth - left.depth
                : left.edge === 'after' ? -1 : 1));
        const parts: TTrackedMarkdown[] = [];
        let cursor = 0;
        for (const insertion of insertions) {
            if (cursor < insertion.offset) {
                parts.push(sliceMarkdownForWeave(
                    clean,
                    cursor,
                    insertion.offset,
                ));
                cursor = insertion.offset;
            }
            parts.push(insertion.markdown);
        }
        if (!clean.text.length) {
            // Preserve the zero-width native node that owns a marker-only
            // Critic boundary. Without this carrier, weaving the marker bytes
            // would leave no AST boundary for document/UI binding.
            parts.push(clean);
        }
        if (cursor < clean.text.length) {
            parts.push(sliceMarkdownForWeave(
                clean,
                cursor,
                clean.text.length,
            ));
        }
        return concatMarkdown(parts);
    }

    private _serializeSimpleBlock(
        state: TState,
        result: TTrackedMarkdown[],
        indent: string,
        statePath: TMarkdownStatePath,
        suppressInitialLineBreak: boolean,
    ) {
        const insertInitialLineBreak = () => {
            if (!suppressInitialLineBreak)
                this._insertLineBreak(result, indent);
        };
        switch (state.name) {
            case 'frontmatter':
                result.push(plainMarkdown(serializeFrontMatter(state)));
                break;

            case 'paragraph':

            case 'thematic-break':
                insertInitialLineBreak();
                result.push(this._serializeTextParagraph(state, indent, statePath));
                break;

            case 'markdown-parser-residue':
                insertInitialLineBreak();
                result.push(this._serializeMarkdownParserResidue(
                    state,
                    indent,
                    statePath,
                ));
                break;

            case 'atx-heading':
                insertInitialLineBreak();
                result.push(this._serializeAtxHeading(state, indent, statePath));
                break;

            case 'setext-heading':
                insertInitialLineBreak();
                result.push(this._serializeSetextHeading(state, indent, statePath));
                break;

            case 'code-block':
                insertInitialLineBreak();
                result.push(plainMarkdown(serializeCodeBlock(state, indent)));
                break;

            case 'html-block':
                insertInitialLineBreak();
                result.push(plainMarkdown(serializeHtmlBlock(state, indent)));
                break;

            case 'math-block':
                insertInitialLineBreak();
                result.push(plainMarkdown(serializeMathBlock(state, indent)));
                break;

            case 'diagram':
                insertInitialLineBreak();
                result.push(plainMarkdown(serializeDiagramBlock(state, indent)));
                break;

            case 'block-quote':
                insertInitialLineBreak();
                result.push(this._serializeBlockquote(state, indent, statePath));
                break;

            case 'table':
                insertInitialLineBreak();
                result.push(this._serializeTable(state, indent, statePath));
                break;

            case 'footnote':
                insertInitialLineBreak();
                result.push(this._serializeFootnote(state, indent, statePath));
                break;

            default: {
                debug.warn(
                    'convertStatesToMarkdown: Unknown state type:',
                    state.name,
                );
                break;
            }
        }
    }

    private _serializeListBlock(
        state: IOrderListState | IBulletListState | ITaskListState,
        result: TTrackedMarkdown[],
        indent: string,
        listIndent: string,
        lastListBullet: string,
        statePath: TMarkdownStatePath,
        markerOverride?: string,
        suppressInitialLineBreak = false,
    ): string {
        let insertNewLine = this._isLooseParentList
            && !suppressInitialLineBreak;
        this._isLooseParentList = true;
        const meta = deepClone(state.meta);
        if (markerOverride && 'marker' in meta)
            meta.marker = markerOverride;

        // Start a new list without separation due changing the bullet or ordered list delimiter starts a new list.
        const bulletMarkerOrDelimiter
            = 'delimiter' in meta ? meta.delimiter : meta.marker;

        if (lastListBullet && lastListBullet !== bulletMarkerOrDelimiter)
            insertNewLine = false;

        if (insertNewLine)
            this._insertLineBreak(result, indent);

        for (const child of state.children) {
            const leadingPrefix = child.sourceTrivia?.listItemLeadingPrefix;
            if (
                leadingPrefix !== undefined
                && !/^[ \t]*$/.test(leadingPrefix)
            ) {
                throw new TypeError(
                    'State source trivia listItemLeadingPrefix must be whitespace.',
                );
            }
            const markerPadding = child.sourceTrivia?.listItemMarkerPadding;
            if (
                markerPadding !== undefined
                && !/^[ \t]*$/.test(markerPadding)
            ) {
                throw new TypeError(
                    'State source trivia listItemMarkerPadding must be whitespace.',
                );
            }
            const trailing = child.sourceTrivia?.listItemTrailingBlankLines;
            if (
                trailing !== undefined
                && (!Number.isSafeInteger(trailing) || trailing < 0)
            ) {
                throw new TypeError(
                    'State source trivia listItemTrailingBlankLines must be a nonnegative safe integer.',
                );
            }
            const prefixes = child.sourceTrivia?.listItemContinuationPrefixes;
            if (
                prefixes !== undefined
                && (
                    !Array.isArray(prefixes)
                    || prefixes.some(prefix =>
                        typeof prefix !== 'string'
                        || !/^[ \t]*$/.test(prefix))
                )
            ) {
                throw new TypeError(
                    'State source trivia listItemContinuationPrefixes must contain whitespace strings.',
                );
            }
        }
        const usesSourceSpacing = state.children.every(child =>
            child.sourceTrivia?.listItemTrailingBlankLines !== undefined);
        this._listType.push(meta);
        this._listUsesSourceSpacing.push(usesSourceSpacing);
        result.push(this._serializeList(state, indent, listIndent, statePath));
        this._listUsesSourceSpacing.pop();
        this._listType.pop();

        return bulletMarkerOrDelimiter;
    }

    private _startsWithEmptyDashBulletItem(
        state: IOrderListState | IBulletListState | ITaskListState,
    ) {
        if (state.name !== 'bullet-list' || state.meta.marker !== '-')
            return false;

        const firstItem = state.children[0];
        if (!firstItem)
            return false;
        if (firstItem.children.length === 0)
            return true;

        const firstChild = firstItem.children[0];
        return firstChild.name === 'paragraph' && firstChild.text.trim() === '';
    }

    private _serializeListItemBlock(
        state: IListItemState | ITaskListItemState,
        result: TTrackedMarkdown[],
        indent: string,
        listIndent: string,
        statePath: TMarkdownStatePath,
        suppressInitialLineBreak = false,
    ) {
        const { loose } = this._listType[this._listType.length - 1];
        const usesSourceSpacing = this._listUsesSourceSpacing.at(-1) ?? false;

        // helper variable to correct the first tight item in a nested list
        this._isLooseParentList = loose;
        if (loose && !usesSourceSpacing && !suppressInitialLineBreak)
            this._insertLineBreak(result, indent);

        result.push(this._serializeListItem(
            state,
            indent,
            listIndent,
            statePath,
        ));
        if (usesSourceSpacing) {
            const trailing = state.sourceTrivia?.listItemTrailingBlankLines;
            if (trailing === undefined) {
                throw new TypeError(
                    'A parser-spaced list item has no trailing blank-line count.',
                );
            }
            if (trailing)
                result.push(plainMarkdown('\n'.repeat(trailing)));
        }
        this._isLooseParentList = true;
    }

    private _insertLineBreak(result: TTrackedMarkdown[], indent: string) {
        if (!result.length)
            return;
        // Blank lines inside a list item should be empty, not carry the
        // item's indent as trailing whitespace. For blockquote-style indents
        // like `> ` we keep the `>` so the quote stays continuous — only
        // strip the trailing run of plain spaces.
        result.push(plainMarkdown(`${indent.replace(/ +$/, '')}\n`));
    }

    private _leafPath(
        statePath: TMarkdownStatePath,
    ): TMarkdownStatePath {
        const path = markdownStatePath([...statePath, 'text']);
        if (this._sourceMapEnabled)
            this._mappedLeafPaths.push(path);

        return path;
    }

    private _mappedText(
        text: string,
        path: TMarkdownStatePath,
        localStart: number,
    ): TTrackedMarkdown {
        if (!this._sourceMapEnabled)
            return plainMarkdown(text);
        if (!text)
            return boundaryMarkdown(path, localStart);

        return mappedMarkdown(text, path, localStart);
    }

    private _mappedLines(
        text: string,
        path: TMarkdownStatePath,
        indent: string,
        localStart = 0,
    ): TTrackedMarkdown {
        const parts: TTrackedMarkdown[] = [];
        const lines = text.split('\n');
        let localOffset = localStart;

        lines.forEach((line, index) => {
            parts.push(plainMarkdown(indent));
            parts.push(this._mappedText(line, path, localOffset));
            localOffset += line.length;

            if (index < lines.length - 1) {
                parts.push(this._mappedText('\n', path, localOffset));
                localOffset++;
            }
        });

        return concatMarkdown(parts);
    }

    private _serializeTextParagraph(
        state: IParagraphState | IThematicBreakState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const { text } = state;
        const path = this._leafPath(statePath);

        return concatMarkdown([
            this._mappedLines(text, path, indent),
            plainMarkdown('\n'),
        ]);
    }

    private _serializeMarkdownParserResidue(
        state: IMarkdownParserResidueState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        return concatMarkdown([
            this._mappedLines(
                state.text,
                this._leafPath(statePath),
                indent,
            ),
            plainMarkdown(state.meta.trailingNewline ? '\n' : ''),
        ]);
    }

    private _serializeAtxHeading(
        state: IAtxHeadingState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const { text } = state;
        const match = text.match(/(#{1,6})(.*)/);
        const path = this._leafPath(statePath);

        const atxHeadingText = `${match?.[1]} ${match?.[2].trim()}`;
        if (!match)
            return plainMarkdown(`${indent}${atxHeadingText}\n`);

        const marker = match[1];
        const contentSource = match[2];
        const content = contentSource.trim();
        const contentLocalStart = (match.index ?? 0)
            + marker.length
            + (contentSource.length - contentSource.trimStart().length);

        return concatMarkdown([
            plainMarkdown(indent),
            this._mappedText(marker, path, match.index ?? 0),
            plainMarkdown(' '),
            this._mappedText(content, path, contentLocalStart),
            plainMarkdown('\n'),
        ]);
    }

    private _serializeSetextHeading(
        state: ISetextHeadingState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const { text, meta } = state;
        const { underline } = meta;
        const path = this._leafPath(statePath);
        const trimmed = text.trim();
        const localStart = trimmed ? text.indexOf(trimmed) : 0;

        return concatMarkdown([
            this._mappedLines(trimmed, path, indent, localStart),
            plainMarkdown(`\n${indent}${underline.trim()}\n`),
        ]);
    }

    private _serializeBlockquote(
        state: IBlockQuoteState,
        indent: string,
        statePath: TMarkdownStatePath,
    ) {
        const { children } = state;
        const newIndent = `${indent}> `;

        return this._convertStatesToMarkdown(
            children,
            newIndent,
            '',
            markdownStatePath([...statePath, 'children']),
        );
    }

    private _serializeFootnote(
        state: IFootnoteBlockState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        // Footnote definitions render as
        //   [^id]: first paragraph
        //
        //       continuation block indented by 4 spaces
        // i.e. the `[^id]: ` prefix sits on the first child's first line and
        // subsequent content (including blank lines between paragraphs) is
        // indented by four spaces past the surrounding `indent`.
        const { meta, children } = state;
        const innerIndent = `${indent}    `;
        const inner = this._convertStatesToMarkdown(
            children,
            innerIndent,
            '',
            markdownStatePath([...statePath, 'children']),
        );
        const prefix = `${indent}[^${meta.identifier}]: `;
        // Strip the inner indent off the first non-empty line so the prefix
        // sits flush, leaving subsequent lines at the four-space indent.
        const stripped = removeFirstMarkdown(inner, innerIndent);
        return concatMarkdown([plainMarkdown(prefix), stripped]);
    }

    private _mappedTableText(
        text: string,
        path: TMarkdownStatePath,
        localStart: number,
    ): TTrackedMarkdown {
        const parts: TTrackedMarkdown[] = [];
        for (let index = 0; index < text.length; index++) {
            if (text[index] === '|' && text[index - 1] !== '\\') {
                if (this._sourceMapEnabled) {
                    parts.push(boundaryMarkdown(
                        path,
                        localStart + index,
                    ));
                }
                parts.push(plainMarkdown('\\'));
            }
            parts.push(this._mappedText(text[index], path, localStart + index));
        }
        return concatMarkdown(parts);
    }

    private _serializeTable(
        state: ITableState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const result: TTrackedMarkdown[] = [];
        const row = state.children.length;
        const tableData: Array<Array<{
            cellPath: TMarkdownStatePath;
            escaped: string;
            localStart: number;
            text: string;
            textPath: TMarkdownStatePath;
        }>> = [];

        state.children.forEach((rowState, rowIndex) => {
            tableData.push(
                rowState.children.map((cell, cellIndex) => {
                    const text = cell.text.trim();
                    const cellPath = markdownStatePath([
                        ...statePath,
                        'children',
                        rowIndex,
                        'children',
                        cellIndex,
                    ]);
                    return {
                        cellPath,
                        escaped: escapeTableText(text),
                        localStart: text ? cell.text.indexOf(text) : 0,
                        text,
                        textPath: this._leafPath(cellPath),
                    };
                }),
            );
        });

        const sourceSyntax = state.sourceTrivia?.tableSourceSyntax;
        if (sourceSyntax) {
            const sourceRows = [
                sourceSyntax.header,
                ...sourceSyntax.rows,
            ];
            const sourceColumnCount = sourceSyntax.header.cells.length;
            const syntaxShapeValid =
                sourceSyntax.header.segments.length
                    === sourceColumnCount + 1
                && sourceSyntax.delimiter.cells.length === sourceColumnCount
                && sourceSyntax.delimiter.segments.length
                    === sourceColumnCount + 1
                && sourceSyntax.alignments.length === sourceColumnCount
                && sourceSyntax.rows.every(rowSyntax =>
                    rowSyntax.cells.length === sourceColumnCount
                    && rowSyntax.segments.length === sourceColumnCount + 1);
            if (!syntaxShapeValid) {
                throw new TypeError(
                    'Parser-owned table source syntax has inconsistent column counts.',
                );
            }
            const topologyMatches = sourceRows.length === tableData.length
                && tableData.every(rowData =>
                    rowData.length === sourceColumnCount);
            const alignmentMatches = topologyMatches
                && state.children[0].children.every((cell, index) =>
                    cell.meta.align === sourceSyntax.alignments[index]);
            if (topologyMatches && alignmentMatches) {
                const serializeSourceRow = (
                    rowData: typeof tableData[number],
                    rowSyntax: ITableRowSourceSyntax,
                    rowPath: TMarkdownStatePath,
                    delimiter = false,
                ): TTrackedMarkdown => {
                    const parts: TTrackedMarkdown[] = [
                        plainMarkdown(`${indent}${rowSyntax.segments[0]}`),
                    ];
                    rowData.forEach((cell, cellIndex) => {
                        const content = delimiter
                            ? plainMarkdown(rowSyntax.cells[cellIndex]).withNode(
                                    markdownStatePath([
                                        ...cell.cellPath,
                                        'meta',
                                        'align',
                                    ]),
                                )
                            : this._mappedTableText(
                                    cell.text,
                                    cell.textPath,
                                    cell.localStart,
                                ).withNode(cell.cellPath);
                        parts.push(
                            content,
                            plainMarkdown(rowSyntax.segments[cellIndex + 1]),
                        );
                    });
                    return concatMarkdown([
                        concatMarkdown(parts),
                        plainMarkdown('\n'),
                    ]).withNode(rowPath);
                };

                const sourceResult: TTrackedMarkdown[] = [];
                tableData.forEach((rowData, rowIndex) => {
                    const rowPath = markdownStatePath([
                        ...statePath,
                        'children',
                        rowIndex,
                    ]);
                    sourceResult.push(serializeSourceRow(
                        rowData,
                        sourceRows[rowIndex],
                        rowPath,
                    ));
                    if (rowIndex === 0) {
                        sourceResult.push(serializeSourceRow(
                            rowData,
                            sourceSyntax.delimiter,
                            rowPath,
                            true,
                        ));
                    }
                });
                return concatMarkdown(sourceResult);
            }
        }

        const columnWidth = state.children[0].children.map(th => ({
            width: 5,
            align: th.meta.align,
        }));

        let i;
        let j;

        for (i = 0; i < row; i++) {
            const cells = Math.min(tableData[i].length, columnWidth.length);
            for (j = 0; j < cells; j++) {
                columnWidth[j].width = Math.max(
                    columnWidth[j].width,
                    stringWidth(tableData[i][j].escaped) + 2,
                ); // add 2, because have two space around text
            }
        }

        tableData.forEach((r, i) => {
            const rowParts: TTrackedMarkdown[] = [plainMarkdown(`${indent}|`)];
            const emittedCells = r.slice(0, columnWidth.length);
            emittedCells.forEach((cell, j) => {
                const cellWidth = columnWidth[j].width;
                const fill = cellWidth
                    - 1
                    - stringWidth(cell.escaped);
                rowParts.push(concatMarkdown([
                    plainMarkdown(' '),
                    this._mappedTableText(
                        cell.text,
                        cell.textPath,
                        cell.localStart,
                    ),
                    plainMarkdown(' '.repeat(Math.max(fill, 1))),
                    plainMarkdown('|'),
                ]).withNode(cell.cellPath));
            });
            if (!emittedCells.length)
                rowParts.push(plainMarkdown('|'));

            const serializedRow: TTrackedMarkdown[] = [
                concatMarkdown(rowParts),
                plainMarkdown('\n'),
            ];
            if (i === 0) {
                const alignmentParts: TTrackedMarkdown[] = [
                    plainMarkdown(`${indent}|`),
                ];
                columnWidth.forEach(({ width: initialWidth, align }, columnIndex) => {
                    const cell = tableData[0][columnIndex];
                    const width = initialWidth;
                    let raw = '-'.repeat(Math.max(width, 5) - 2);
                    switch (align) {
                        case 'left':
                            raw = `:${raw} `;
                            break;

                        case 'center':
                            raw = `:${raw}:`;
                            break;

                        case 'right':
                            raw = ` ${raw}:`;
                            break;
                        default:
                            raw = ` ${raw} `;
                            break;
                    }

                    const segment = plainMarkdown(`${raw}|`);
                    alignmentParts.push(cell
                        ? segment.withNode(markdownStatePath([
                                ...cell.cellPath,
                                'meta',
                                'align',
                            ]))
                        : segment);
                });
                if (!columnWidth.length)
                    alignmentParts.push(plainMarkdown('|'));
                serializedRow.push(
                    concatMarkdown(alignmentParts),
                    plainMarkdown('\n'),
                );
            }

            const rowPath = markdownStatePath([
                ...statePath,
                'children',
                i,
            ]);
            result.push(concatMarkdown(serializedRow).withNode(rowPath));
        });

        return concatMarkdown(result);
    }

    private _serializeList(
        state: IBulletListState | IOrderListState | ITaskListState,
        indent: string,
        listIndent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const { children } = state;

        return this._convertStatesToMarkdown(
            children,
            indent,
            listIndent,
            markdownStatePath([...statePath, 'children']),
        );
    }

    private _serializeListItem(
        state: IListItemState | ITaskListItemState,
        indent: string,
        generatedListIndent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        const result: TTrackedMarkdown[] = [];
        const listInfo = this._listType[this._listType.length - 1];
        // `listInfo` is one of three list-meta shapes (bullet / order / task).
        // bullet & task carry `marker`; order carries `delimiter` + `start`.
        // We discriminate on presence of `marker` to pick the right fields.
        const marker = 'marker' in listInfo ? listInfo.marker : undefined;
        const delimiter = 'delimiter' in listInfo ? listInfo.delimiter : undefined;
        const isUnorderedList = !!marker;
        const { children, name } = state;
        const sourceLeadingPrefix =
            state.sourceTrivia?.listItemLeadingPrefix;
        if (
            sourceLeadingPrefix !== undefined
            && !/^[ \t]*$/.test(sourceLeadingPrefix)
        ) {
            throw new TypeError(
                'State source trivia listItemLeadingPrefix must be whitespace.',
            );
        }
        const itemIndent = `${indent}${sourceLeadingPrefix ?? generatedListIndent}`;
        const sourceMarker = state.sourceTrivia?.listItemMarker;
        if (
            sourceMarker !== undefined
            && !/^(?:[*+-]|\d{1,9}[.)])$/.test(sourceMarker)
        ) {
            throw new TypeError(
                'State source trivia listItemMarker is not a CommonMark list marker.',
            );
        }
        const sourceMarkerPadding =
            state.sourceTrivia?.listItemMarkerPadding;
        if (
            sourceMarkerPadding !== undefined
            && !/^[ \t]*$/.test(sourceMarkerPadding)
        ) {
            throw new TypeError(
                'State source trivia listItemMarkerPadding must be whitespace.',
            );
        }
        // Marked trims the final empty item's post-marker space before it
        // recursively tokenizes a parent item. Preserve MarkText's established
        // parseable empty-item spelling instead of serializing a bare marker.
        const isEmptyItem = children.length === 0
            || (
                children.length === 1
                && children[0].name === 'paragraph'
                && children[0].text === ''
            );
        const markerPadding = sourceMarkerPadding === '' && isEmptyItem
            ? ' '
            : sourceMarkerPadding ?? ' ';
        let itemMarker;

        if (isUnorderedList) {
            itemMarker = sourceMarker === marker
                ? sourceMarker
                : marker || '-';
        }
        else if ('start' in listInfo) {
            // NOTE: GitHub and Bitbucket limit the list count to 99 but this is nowhere defined.
            //  We limit the number to 99 for Daring Fireball Markdown to prevent indentation issues.
            let n = listInfo.start;
            if ((this._listIndentation === 'dfm' && n > 99) || n > 999999999)
                n = 1;

            listInfo.start++;

            const generatedMarker = `${n}${delimiter || '.'}`;
            itemMarker = sourceMarker
                && /^\d{1,9}[.)]$/.test(sourceMarker)
                && sourceMarker.endsWith(delimiter || '.')
                ? sourceMarker
                : generatedMarker;
        }
        else {
            itemMarker = '-';
        }

        // Subsequent paragraph indentation
        const itemSyntax = `${itemMarker}${markerPadding}`;
        const newIndent = itemIndent + ' '.repeat(itemSyntax.length);

        // Extra indentation for a NESTED list, added on top of the parent
        // item's content column — `newIndent` above already advanced by the
        // marker width, i.e. the CommonMark-minimal nest (a child list must
        // sit at least past the parent marker to parse as nested). The nested
        // marker therefore lands at: itemMarker.length + (listIndentationCount - 1).
        //
        // So a numeric "N spaces" is an indentation LEVEL relative to the
        // content column, NOT an absolute column count: for a `- ` marker
        // (width 2), N=1 -> 2 cols (tightest), N=4 -> 5 cols. Only `dfm` pins a
        // hard 4-column nest regardless of marker width (4 - itemMarker.length).
        // This matches the legacy muyajs serializer byte-for-byte
        // (muyajs/lib/utils/exportMarkdown.js `normalizeListItem`).
        let childListIndent = '';
        const { _listIndentation: listIndentation } = this;
        if (listIndentation === 'dfm')
            childListIndent = ' '.repeat(Math.max(0, 4 - itemSyntax.length));
        else if (listIndentation === 'number')
            childListIndent = ' '.repeat(this._listIndentationCount - 1);

        // TODO: Indent subsequent paragraphs by one tab. - not important
        //  Problem: "convertStatesToMarkdown" use "indent" in spaces to indent elements. How should
        //  we integrate tabs in block quotes and subsequent paragraphs and how to combine with spaces?
        //  I don't know how to combine tabs and spaces and it seems not specified, so work for another day.

        const itemPrefix = name === 'task-list-item'
            ? concatMarkdown([
                    plainMarkdown(`${itemIndent}${itemSyntax}`),
                    plainMarkdown(state.meta.checked ? '[x]' : '[ ]')
                        .withNode(markdownStatePath([
                            ...statePath,
                            'meta',
                            'checked',
                        ])),
                    plainMarkdown(' '),
                ])
            : plainMarkdown(`${itemIndent}${itemSyntax}`);

        if (!children.length)
            return concatMarkdown([itemPrefix, plainMarkdown('\n')]);

        result.push(itemPrefix);
        const serializedChildren = this._convertStatesToMarkdown(
            children,
            newIndent,
            childListIndent,
            markdownStatePath([...statePath, 'children']),
        );
        const sourcePrefixedChildren = this._applyListItemContinuationPrefixes(
            serializedChildren,
            indent,
            newIndent,
            state.sourceTrivia?.listItemContinuationPrefixes,
        );
        result.push(
            sliceMarkdown(sourcePrefixedChildren, newIndent.length),
        );

        return concatMarkdown(result);
    }

    private _applyListItemContinuationPrefixes(
        markdown: TTrackedMarkdown,
        parentIndent: string,
        generatedPrefix: string,
        prefixes: readonly string[] | undefined,
    ): TTrackedMarkdown {
        if (!prefixes?.length)
            return markdown;

        const lineStarts: number[] = [];
        for (let index = 0; index < markdown.text.length - 1; index++) {
            if (markdown.text[index] === '\n')
                lineStarts.push(index + 1);
        }
        if (lineStarts.length !== prefixes.length)
            return markdown;

        if (!generatedPrefix.startsWith(parentIndent)) {
            throw new TypeError(
                'Generated list-item prefix is outside its parent indentation.',
            );
        }

        const replacements: Array<{
            readonly start: number;
            readonly end: number;
            readonly text: string;
        }> = [];
        const generatedSegment = generatedPrefix.slice(parentIndent.length);
        for (let index = 0; index < lineStarts.length; index++) {
            const start = lineStarts[index];
            const sourcePrefix = prefixes[index];
            if (markdown.text.startsWith(generatedPrefix, start)) {
                if (sourcePrefix === generatedSegment)
                    continue;
                replacements.push({
                    start: start + parentIndent.length,
                    end: start + generatedPrefix.length,
                    text: sourcePrefix,
                });
            }
            else if (
                sourcePrefix === ''
                && (markdown.text[start] === '\n'
                    || start === markdown.text.length)
            ) {
                continue;
            }
            else {
                // A topology or newline edit made this parser-owned physical
                // line layout stale. Normalize the whole item instead of
                // applying only part of an obsolete recursive transform.
                return markdown;
            }
        }
        if (!replacements.length)
            return markdown;

        const parts: TTrackedMarkdown[] = [];
        let cursor = 0;
        for (const replacement of replacements) {
            parts.push(sliceMarkdown(markdown, cursor, replacement.start));
            parts.push(replaceGeneratedMarkdown(
                sliceMarkdown(markdown, replacement.start, replacement.end),
                replacement.text,
            ));
            cursor = replacement.end;
        }
        parts.push(sliceMarkdown(markdown, cursor));
        return concatMarkdown(parts);
    }
}
