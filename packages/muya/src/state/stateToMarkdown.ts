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
    IFootnoteBlockState,
    IListItemState,
    IMarkdownParserResidueState,
    IOrderListState,
    IParagraphState,
    ISetextHeadingState,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    IThematicBreakState,
    TState,
} from './types';
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
import {
    assertBlockSpacing,
    insertLineBreak,
    serializeBlockSpacing,
} from './blockSpacingSerialization';
import {
    applyTerminalLineEnding,
    weaveCriticSourceTrivia,
} from './criticMarkupSerialization';
import {
    applyListItemContinuationPrefixes,
    assertListItemChildSourceTrivia,
    readListItemMarkerTrivia,
    startsWithEmptyDashBulletItem,
} from './listItemSerialization';
import {
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
    removeFirstMarkdown,
    sliceMarkdown,
    toMarkdownSourceMap,
} from './markdownSourceMap';
import { serializeTable } from './tableSerialization';
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
        return weaveCriticSourceTrivia(
            states,
            applyTerminalLineEnding(
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
            const markdown = weaveCriticSourceTrivia(
                states,
                applyTerminalLineEnding(
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
            assertBlockSpacing(blockPrefix, 'blockPrefix');
            assertBlockSpacing(
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
                result.push(serializeBlockSpacing(
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
                    && startsWithEmptyDashBulletItem(state)
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
                result.push(serializeBlockSpacing(
                    blockSeparatorAfter,
                    indent,
                ));
            }

            previousState = state;
        });

        return concatMarkdown(result).withNode(parentPath);
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
                insertLineBreak(result, indent);
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
            insertLineBreak(result, indent);

        assertListItemChildSourceTrivia(state.children);
        const usesSourceSpacing = state.children.every(child =>
            child.sourceTrivia?.listItemTrailingBlankLines !== undefined);
        this._listType.push(meta);
        this._listUsesSourceSpacing.push(usesSourceSpacing);
        result.push(this._serializeList(state, indent, listIndent, statePath));
        this._listUsesSourceSpacing.pop();
        this._listType.pop();

        return bulletMarkerOrDelimiter;
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
            insertLineBreak(result, indent);

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

    private _serializeTable(
        state: ITableState,
        indent: string,
        statePath: TMarkdownStatePath,
    ): TTrackedMarkdown {
        return serializeTable(state, indent, statePath, {
            sourceMapEnabled: this._sourceMapEnabled,
            leafPath: path => this._leafPath(path),
            mappedText: (text, path, localStart) =>
                this._mappedText(text, path, localStart),
        });
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
        const {
            markerPadding,
            sourceLeadingPrefix,
            sourceMarker,
        } = readListItemMarkerTrivia(state);
        const itemIndent = `${indent}${sourceLeadingPrefix ?? generatedListIndent}`;
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
        const sourcePrefixedChildren = applyListItemContinuationPrefixes(
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
}
