import type {
    TCriticMarkupMarkerName,
    TCriticMarkupType,
} from '../criticMarkup/reviewContract';

export interface ICriticMarkupStateMarker {
    readonly type: TCriticMarkupType;
    readonly marker: TCriticMarkupMarkerName;
    readonly raw: string;
    /** Canonical parser source offset used to order co-located markers. */
    readonly sourceOffset?: number;
}

export interface ITableRowSourceSyntax {
    readonly cells: readonly string[];
    readonly segments: readonly string[];
}

export interface ITableSourceSyntax {
    readonly header: ITableRowSourceSyntax;
    readonly delimiter: ITableRowSourceSyntax;
    readonly rows: readonly ITableRowSourceSyntax[];
    readonly alignments: readonly ('none' | 'left' | 'center' | 'right')[];
}

export interface IStateSourceTrivia {
    readonly criticBefore?: readonly ICriticMarkupStateMarker[];
    readonly criticAfter?: readonly ICriticMarkupStateMarker[];
    /** Parser whitespace after before-markers and before their native block. */
    readonly criticBeforeSuffix?: string;
    /** Parser whitespace immediately before after-markers on this native block. */
    readonly criticAfterPrefix?: string;
    /** Parser whitespace immediately after after-markers on this native block. */
    readonly criticAfterSuffix?: string;
    /** Parser-view whitespace before this block within its parent sequence. */
    readonly blockPrefix?: string;
    /**
     * Parser-view whitespace after this block's serializer-owned terminal LF.
     * This is emitted outside the block's source-mapped node range.
     */
    readonly blockSeparatorAfter?: string;
    /** Exact terminal EOL owned by the final top-level parser state. */
    readonly terminalLineEnding?: '' | '\n' | '\r\n';
    /** Atomic parser-owned GFM table row and delimiter layout. */
    readonly tableSourceSyntax?: ITableSourceSyntax;
    /** Exact parser-view whitespace preceding this list item's marker. */
    readonly listItemLeadingPrefix?: string;
    /** Exact parser-captured list marker, without indentation or whitespace. */
    readonly listItemMarker?: string;
    /** Parser-view whitespace consumed after the marker on its first line. */
    readonly listItemMarkerPadding?: string;
    /** Blank lines after this item, excluding the item's terminal EOL. */
    readonly listItemTrailingBlankLines?: number;
    /** Prefix consumed at this parser recursion level for each continuation. */
    readonly listItemContinuationPrefixes?: readonly string[];
}

export interface IStateSourceTriviaCarrier {
    readonly sourceTrivia?: IStateSourceTrivia;
}

export type IMarkdownParserDiagnostic
    = | {
        code: 'marked-block-nesting-limit';
        depth: number;
        limit: number;
        message: string;
    }
    | {
        code: 'critic-markup-structural-residue';
        message: string;
    };

export interface IParagraphState {
    name: 'paragraph';
    text: string;
}

export interface IMarkdownParserResidueState {
    name: 'markdown-parser-residue';
    text: string;
    meta: {
        parserDiagnostic: IMarkdownParserDiagnostic;
        /** Whether the parser-owned source envelope ended in one LF byte. */
        trailingNewline: boolean;
    };
}

export interface IAtxHeadingState {
    name: 'atx-heading';
    meta: {
        level: number;
    };
    text: string;
}

export interface ISetextHeadingState {
    name: 'setext-heading';
    meta: {
        level: number;
        underline: string; // "===" | "---";
    };
    text: string;
}

export interface IThematicBreakState {
    name: 'thematic-break';
    text: string;
}

export interface ICodeBlockState {
    name: 'code-block';
    meta: {
        type: string; // "indented" | "fenced";
        // The full fenced info string, verbatim (e.g. `js`, `js title="x"`, or a
        // Pandoc/RMarkdown `{…}` block). The language for highlighting is its
        // first word — derive via `firstWordOfInfo()`, never assume a single word.
        lang: string;
        fenceLength?: number;
        /** False preserves an EOF-terminated fenced block without inventing a close. */
        fenceClosed?: false;
    };
    text: string;
}

export interface IHtmlBlockState {
    name: 'html-block';
    text: string;
}

/**
 * @deprecated Reference definitions are stored as paragraph state nodes whose
 * `text` is the raw `[label]: url "title"` line (matches marktext's
 * "definition is paragraph text" model). `InlineRenderer.collectReferenceDefinitions`
 * regex-scans paragraphs to build the labels Map. This interface is unused
 * across the codebase and exists only for legacy type compatibility; remove
 * in v0.3.
 */
export interface ILinkReferenceDefinitionState {
    name: 'link-reference-definition';
    text: string;
}

export interface IBlockQuoteState {
    name: 'block-quote';
    children: TState[];
}

export interface IListItemState extends IStateSourceTriviaCarrier {
    name: 'list-item';
    children: TState[];
}

export interface IOrderListState {
    name: 'order-list';
    meta: {
        start: number;
        loose: boolean;
        delimiter: string; // "." | ")";
    };
    children: IListItemState[];
}

export interface IBulletListState {
    name: 'bullet-list';
    meta: {
        marker: string; // "-" | "+" | "*";
        loose: boolean;
    };
    children: IListItemState[];
}

export interface ITableRowState {
    name: 'table.row';
    children: ITableCellState[];
}

export interface ITableCellMeta {
    align: string; // 'none' | 'left' | 'center' | 'right';
}

export interface ITableCellState {
    name: 'table.cell';
    meta: ITableCellMeta;
    text: string;
}

export interface ITableState extends IStateSourceTriviaCarrier {
    name: 'table';
    children: ITableRowState[];
}

export interface ITaskListItemMeta {
    checked: boolean;
}

export interface ITaskListItemState extends IStateSourceTriviaCarrier {
    name: 'task-list-item';
    meta: ITaskListItemMeta;
    children: TState[];
}

export interface ITaskListMeta {
    marker: string; // "-" | "+" | "*";
    loose: boolean;
}

export interface ITaskListState {
    name: 'task-list';
    meta: ITaskListMeta;
    children: ITaskListItemState[];
}

export interface IMathMeta {
    mathStyle: string; // "" | "gitlab";
}

export interface IMathBlockState {
    name: 'math-block';
    meta: IMathMeta;
    text: string;
}

export interface IFrontmatterMeta {
    lang: string; // "yaml" | "toml" | "json";
    style: string; //  "-" | "+" | ";" | "{";
}

export interface IFrontmatterState {
    name: 'frontmatter';
    meta: IFrontmatterMeta;
    text: string;
}

export interface IDiagramMeta {
    lang: string; // 'yaml' | 'json';
    type: 'mermaid' | 'plantuml' | 'vega-lite' | 'flowchart' | 'sequence';
}

export interface IDiagramState {
    name: 'diagram';
    meta: IDiagramMeta;
    text: string;
}

export interface IFootnoteBlockMeta {
    identifier: string;
}

export interface IFootnoteBlockState {
    name: 'footnote';
    meta: IFootnoteBlockMeta;
    children: TState[];
}

export type TLeafState
    = | IParagraphState
        | IMarkdownParserResidueState
        | IAtxHeadingState
        | ISetextHeadingState
        | IThematicBreakState
        | ICodeBlockState
        | IHtmlBlockState
        | ILinkReferenceDefinitionState
        | IMathBlockState
        | IFrontmatterState
        | IDiagramState
        | ITableCellState;

export type TContainerState
    = | IBlockQuoteState
        | IOrderListState
        | IBulletListState
        | ITableState
        | ITaskListState
        | ITaskListItemState
        | IListItemState
        | ITableRowState
        | IFootnoteBlockState;

export type TState = (TLeafState | TContainerState) & IStateSourceTriviaCarrier;

export type CodeContentState = ICodeBlockState | IHtmlBlockState | IDiagramState | IMathBlockState | IFrontmatterState;

// Discriminated-union type guards. `TState` is keyed by `name`, so consumers can
// narrow without `as I<X>State` casts. Use `isStateOfName(state, 'atx-heading')`
// for ad-hoc narrowing or the per-name shorthands.
export function isStateOfName<N extends TState['name']>(
    state: TState,
    name: N,
): state is Extract<TState, { name: N }> {
    return state.name === name;
}

export const isParagraphState = (s: TState): s is IParagraphState => s.name === 'paragraph';
export const isAtxHeadingState = (s: TState): s is IAtxHeadingState => s.name === 'atx-heading';
export const isSetextHeadingState = (s: TState): s is ISetextHeadingState => s.name === 'setext-heading';
export const isThematicBreakState = (s: TState): s is IThematicBreakState => s.name === 'thematic-break';
export const isCodeBlockState = (s: TState): s is ICodeBlockState => s.name === 'code-block';
export const isHtmlBlockState = (s: TState): s is IHtmlBlockState => s.name === 'html-block';
export const isLinkReferenceDefinitionState = (s: TState): s is ILinkReferenceDefinitionState => s.name === 'link-reference-definition';
export const isMathBlockState = (s: TState): s is IMathBlockState => s.name === 'math-block';
export const isFrontmatterState = (s: TState): s is IFrontmatterState => s.name === 'frontmatter';
export const isDiagramState = (s: TState): s is IDiagramState => s.name === 'diagram';
export const isTableCellState = (s: TState): s is ITableCellState => s.name === 'table.cell';

export const isBlockQuoteState = (s: TState): s is IBlockQuoteState => s.name === 'block-quote';
export const isOrderListState = (s: TState): s is IOrderListState => s.name === 'order-list';
export const isBulletListState = (s: TState): s is IBulletListState => s.name === 'bullet-list';
export const isTableState = (s: TState): s is ITableState => s.name === 'table';
export const isTaskListState = (s: TState): s is ITaskListState => s.name === 'task-list';
export const isTaskListItemState = (s: TState): s is ITaskListItemState => s.name === 'task-list-item';
export const isListItemState = (s: TState): s is IListItemState => s.name === 'list-item';
export const isTableRowState = (s: TState): s is ITableRowState => s.name === 'table.row';
export const isFootnoteBlockState = (s: TState): s is IFootnoteBlockState => s.name === 'footnote';

export function isAnyListState(s: TState): s is IOrderListState | IBulletListState | ITaskListState {
    return s.name === 'order-list' || s.name === 'bullet-list' || s.name === 'task-list';
}

export interface ITurnoverOptions {
    headingStyle: 'atx' | 'setext'; // setext or atx
    hr: '---';
    bulletListMarker: '-' | '+' | '*'; // -, +, or *
    codeBlockStyle: 'fenced' | 'indented'; // fenced or indented
    fence: '```' | '~~~'; // ``` or ~~~
    emDelimiter: '*' | '_'; // _ or *
    strongDelimiter: '**' | '__'; // ** or __
    linkStyle: 'inlined';
    linkReferenceStyle: 'full';
    blankReplacement: (content: unknown, node: unknown, options: unknown) => string;
}
