/* eslint-disable no-use-before-define */

export type MarkedToken = (
  Tokens.ParserResidue
  | Tokens.CriticMarkupFragment
  | Tokens.Blockquote
  | Tokens.Br
  | Tokens.Checkbox
  | Tokens.Code
  | Tokens.Codespan
  | Tokens.Def
  | Tokens.Del
  | Tokens.Em
  | Tokens.Escape
  | Tokens.Heading
  | Tokens.Hr
  | Tokens.HTML
  | Tokens.Image
  | Tokens.Link
  | Tokens.List
  | Tokens.ListItem
  | Tokens.Paragraph
  | Tokens.Space
  | Tokens.Strong
  | Tokens.Table
  | Tokens.Tag
  | Tokens.Text
) & Tokens.CriticMarkupBoundaryCarrier;

export type Token = (
  MarkedToken
  | (Tokens.Generic & Tokens.CriticMarkupBoundaryCarrier));

export namespace Tokens {
  export type CriticMarkupType =
    | 'addition'
    | 'deletion'
    | 'substitution'
    | 'highlight'
    | 'comment';

  export interface CriticMarkupRange {
    readonly start: number;
    readonly end: number;
  }

  export interface CriticMarkupMarker {
    readonly name: 'open' | 'separator' | 'close';
    readonly raw: string;
    /** Canonical document range. */
    readonly range: CriticMarkupRange;
  }

  export interface CriticMarkupArm {
    readonly name: 'content' | 'old' | 'new' | 'comment';
    readonly raw: string;
    readonly range: CriticMarkupRange;
  }

  export interface CriticMarkupItem {
    readonly id: string;
    readonly parentId: string | null;
    readonly depth: number;
    readonly criticType: CriticMarkupType;
    readonly raw: string;
    readonly range: CriticMarkupRange;
    readonly markers: Readonly<{
      readonly open: CriticMarkupMarker;
      readonly separator?: CriticMarkupMarker;
      readonly close: CriticMarkupMarker;
    }>;
    readonly arms: readonly CriticMarkupArm[];
  }

  /**
   * A zero-content CriticMarkup item cannot be emitted as a zero-length lexer
   * token. The parser instead binds it to the nearest native Markdown token
   * at the same mapped source boundary.
   */
  export interface CriticMarkupBoundaryAttachment {
    readonly itemId: string;
    readonly criticType: CriticMarkupType;
    readonly arm: CriticMarkupArm['name'];
    readonly role: 'only' | 'start' | 'middle' | 'end';
    readonly edge: 'before' | 'after';
    /**
     * `empty` binds zero-width syntax to the nearest token boundary.
     * `content` marks one edge of a structural arm whose covered Markdown
     * parses natively; the consumer pairs both edges to recover coverage.
     */
    readonly coverage: 'content' | 'empty';
    /** Arm content envelope for `content` coverage; zero-width otherwise. */
    readonly contentRange: CriticMarkupRange;
    readonly range: CriticMarkupRange;
    readonly markers: readonly CriticMarkupMarker[];
    /**
     * Exact whitespace crossed while binding this zero-width syntax to the
     * nearest semantic Markdown token. It follows the markers on a `before`
     * attachment and precedes them on an `after` attachment.
     */
    readonly trivia: Readonly<{
      readonly raw: string;
      readonly range: CriticMarkupRange;
    }>;
    /** Exact whitespace immediately following this marker envelope. */
    readonly followingTrivia: Readonly<{
      readonly raw: string;
      readonly range: CriticMarkupRange;
    }>;
  }

  export interface CriticMarkupBoundaryCarrier {
    criticMarkupBefore?: readonly CriticMarkupBoundaryAttachment[];
    criticMarkupAfter?: readonly CriticMarkupBoundaryAttachment[];
  }

  /**
   * Immutable semantic CriticMarkup table owned by one Marked token list.
   * Fragments in the ordinary token tree link back to these item identities.
   */
  export interface CriticMarkupDocument {
    readonly roots: readonly string[];
    readonly items: readonly CriticMarkupItem[];
  }

  interface CriticMarkupFragmentBase {
    level: 'block' | 'inline';
    /** Marker bytes were removed from this fragment's active parser view. */
    markersTransparent: boolean;
    fragmentKind: 'content' | 'boundary';
    itemId: string;
    arm: 'content' | 'old' | 'new' | 'comment';
    role: 'only' | 'start' | 'middle' | 'end';
    raw: string;
    /** Parser-view fragment envelope before Marked attaches terminal EOL. */
    fragmentRaw: string;
    /** The next linked fragment starts at this fragment's source boundary. */
    suppressBlockSeparatorAfter: boolean;
    /** Canonical source envelope owned by this fragment. */
    range: CriticMarkupRange;
    /** Canonical source range represented by `contentRaw`. */
    contentRange: CriticMarkupRange;
    contentRaw: string;
    tokens: Token[];
    before: readonly CriticMarkupMarker[];
    after: readonly CriticMarkupMarker[];
  }

  export interface CriticAddition extends CriticMarkupFragmentBase {
    type: 'critic_addition';
  }

  export interface CriticDeletion extends CriticMarkupFragmentBase {
    type: 'critic_deletion';
  }

  export interface CriticSubstitution extends CriticMarkupFragmentBase {
    type: 'critic_substitution';
  }

  export interface CriticHighlight extends CriticMarkupFragmentBase {
    type: 'critic_highlight';
  }

  export interface CriticComment extends CriticMarkupFragmentBase {
    type: 'critic_comment';
  }

  export type CriticMarkupFragment
    = | CriticAddition
      | CriticDeletion
      | CriticSubstitution
      | CriticHighlight
      | CriticComment;

  export interface ParserResidue {
    type: 'parser_residue';
    raw: string;
    text: string;
    level: 'block';
    diagnostic: {
      code: 'marked-block-nesting-limit';
      depth: number;
      limit: number;
      message: string;
    };
  }

  export interface Blockquote {
    type: 'blockquote';
    raw: string;
    text: string;
    tokens: Token[];
  }

  export interface Br {
    type: 'br';
    raw: string;
  }

  export interface Checkbox {
    type: 'checkbox';
    raw: string;
    checked: boolean;
  }

  export interface Code {
    type: 'code';
    raw: string;
    codeBlockStyle?: 'indented';
    lang?: string;
    text: string;
    escaped?: boolean;
    readonly sourceSyntax?: Readonly<{
      readonly openingFence: string;
      readonly closingFence: string | null;
    }>;
  }

  export interface Codespan {
    type: 'codespan';
    raw: string;
    text: string;
  }

  export interface Def {
    type: 'def';
    raw: string;
    tag: string;
    href: string;
    title: string;
  }

  export interface Del {
    type: 'del';
    raw: string;
    text: string;
    tokens: Token[];
  }

  export interface Em {
    type: 'em';
    raw: string;
    text: string;
    tokens: Token[];
  }

  export interface Escape {
    type: 'escape';
    raw: string;
    text: string;
  }

  export interface Generic {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [index: string]: any;
    type: string;
    raw: string;
    tokens?: Token[];
  }

  export interface Heading {
    type: 'heading';
    raw: string;
    depth: number;
    text: string;
    tokens: Token[];
  }

  export interface Hr {
    type: 'hr';
    raw: string;
  }

  export interface HTML {
    type: 'html';
    raw: string;
    pre: boolean;
    text: string;
    block: boolean;
  }

  export interface Image {
    type: 'image';
    raw: string;
    href: string;
    title: string | null;
    text: string;
    tokens: Token[];
  }

  export interface Link {
    type: 'link';
    raw: string;
    href: string;
    title?: string | null;
    text: string;
    tokens: Token[];
  }

  export interface List {
    type: 'list';
    raw: string;
    ordered: boolean;
    start: number | '';
    loose: boolean;
    items: ListItem[];
    /** Native block annotation follows without an ordinary block separator. */
    suppressBlockSeparatorAfter?: true;
  }

  export interface ListItem {
    type: 'list_item';
    raw: string;
    /** Exact parser-view whitespace preceding this item's marker. */
    leadingPrefix: string;
    /** Exact parser-captured list marker, excluding indentation/whitespace. */
    marker: string;
    /** Parser-view whitespace consumed between the marker and first content. */
    markerPadding: string;
    /** Blank source lines following this item, excluding its terminal EOL. */
    trailingBlankLines: number;
    /**
     * Parser-view prefix consumed by this tokenizer invocation for each
     * physical continuation line. Descendant indentation is not included.
     */
    continuationPrefixes: string[];
    task: boolean;
    checked?: boolean;
    loose: boolean;
    text: string;
    tokens: Token[];
  }

  export interface Paragraph {
    type: 'paragraph';
    raw: string;
    pre?: boolean;
    text: string;
    tokens: Token[];
  }

  export interface Space {
    type: 'space';
    raw: string;
  }

  export interface Strong {
    type: 'strong';
    raw: string;
    text: string;
    tokens: Token[];
  }

  export interface Table {
    type: 'table';
    raw: string;
    align: Array<'center' | 'left' | 'right' | null>;
    header: TableCell[];
    rows: TableCell[][];
    /** Exact parser-view table layout, captured atomically by the tokenizer. */
    readonly sourceSyntax: TableSourceSyntax;
  }

  export interface TableSourceSyntax {
    readonly header: TableRowSourceSyntax;
    readonly delimiter: TableRowSourceSyntax;
    readonly rows: readonly TableRowSourceSyntax[];
  }

  export interface TableRowSourceSyntax {
    /** Trimmed raw cell contents before Markdown escape decoding. */
    readonly cells: readonly string[];
    /** Exact source before, between, and after cells. */
    readonly segments: readonly string[];
  }

  export interface TableCell {
    text: string;
    tokens: Token[];
    header: boolean;
    align: 'center' | 'left' | 'right' | null;
  }

  export interface TableRow<P = string> {
    text: P;
  }

  export interface Tag {
    type: 'html';
    raw: string;
    inLink: boolean;
    inRawBlock: boolean;
    text: string;
    block: boolean;
  }

  export interface Text {
    type: 'text';
    raw: string;
    text: string;
    tokens?: Token[];
    escaped?: boolean;
  }
}

export type Links = Record<string, Pick<Tokens.Link | Tokens.Image, 'href' | 'title'>>;

export type TokensList = Token[] & {
  links: Links;
  criticMarkup: Tokens.CriticMarkupDocument | null;
  criticMarkupUnanchored: readonly Tokens.CriticMarkupBoundaryAttachment[];
};
