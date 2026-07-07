/* eslint-disable @typescript-eslint/no-explicit-any --
 * Type surface for the TypeScript muya engine published as `@muyajs/core`
 * (packages/muya), scoped to what the desktop consumes.
 *
 * Why a hand-written declaration instead of the package's own types: the
 * `@muyajs/core` package `exports` map points `.` at `./src/index.ts`, and it
 * ships no built `lib/types/*.d.ts` at install time. If vue-tsc resolved the
 * import to that source it would type-check the entire muya tree under the
 * desktop's program — where muya's own `src/types/global.d.ts` globals (e.g.
 * `Element.__MUYA_BLOCK__`) are absent — producing spurious errors. A `paths`
 * entry in tsconfig.base.json redirects `@muyajs/core` here, cutting the
 * dependency graph at the import boundary (the same shielding the legacy
 * `@marktext/muyajs` engine gets via `muya.d.ts`). Vite/electron-vite still
 * resolve the real runtime module via the package `exports` map at build time.
 *
 * Delete this file (and the `paths` entry) once `@muyajs/core` ships built
 * `lib/types/*.d.ts` and can be resolved as a normal typed dependency.
 */

declare module '@muyajs/core' {
  export interface ILocale {
    name: string
    resource: Record<string, string>
  }

  // Bundled locale objects.
  export const en: ILocale
  export const de: ILocale
  export const es: ILocale
  export const fr: ILocale
  export const ja: ILocale
  export const ko: ILocale
  export const pt: ILocale
  export const tr: ILocale
  export const zhCN: ILocale
  export const zhTW: ILocale

  export interface ITocItem {
    content: string
    lvl: number
    slug: string
    githubSlug: string
  }

  export type TCommentDisplayMetadata = Record<string, unknown>

  export interface ICommentReply {
    author: string
    createdAt: string
    body: string
    display?: TCommentDisplayMetadata
  }

  export interface ICommentReplyInput {
    author: string
    body: string
    createdAt?: string
  }

  export interface ICommentMetadata {
    version: 1
    status: 'open' | 'resolved'
    authors?: string[]
    createdAt?: string
    updatedAt?: string
    display?: TCommentDisplayMetadata
    replies: ICommentReply[]
  }

  export interface ICommentThread extends ICommentMetadata {
    id: string
  }

  export interface ICommentRange {
    id: string
    startPath: Array<string | number>
    endPath: Array<string | number>
    startOffset: number
    endOffset: number
    preview: string
  }

  export interface ICommentDiagnostic {
    code:
      | 'duplicate-open-marker'
      | 'duplicate-close-marker'
      | 'duplicate-metadata'
      | 'invalid-metadata'
      | 'malformed-marker'
      | 'missing-metadata'
      | 'orphan-close-marker'
      | 'orphan-metadata'
      | 'parse-error'
      | 'unclosed-open-marker'
    id: string
    message: string
  }

  export interface IParsedMarkdownComments {
    threads: ICommentThread[]
    ranges: ICommentRange[]
    diagnostics: ICommentDiagnostic[]
  }

  // Mirrors muya's exported TCommentAnalysisOptions (comments/analyze.ts).
  export interface TCommentAnalysisOptions {
    footnote?: boolean
    math?: boolean
    isGitlabCompatibilityEnabled?: boolean
    trimUnnecessaryCodeBlockEmptyLines?: boolean
    frontMatter?: boolean
  }

  export interface ICommentSourceIndexRange {
    start: number
    end: number
  }

  export interface ICommentSourceMarker extends ICommentSourceIndexRange {
    id: string
    kind: 'open' | 'close'
    raw: string
    idStart: number
    idEnd: number
  }

  export interface ICommentSourceMetadataDefinition extends ICommentSourceIndexRange {
    id: string
    dataUri: string
    idStart: number
    idEnd: number
  }

  export interface ICommentSourceRange extends ICommentSourceIndexRange {
    id: string
  }

  export interface ICommentSourceIndex {
    ignoredRanges: ICommentSourceIndexRange[]
    markers: ICommentSourceMarker[]
    metadataDefinitions: ICommentSourceMetadataDefinition[]
    commentRanges: ICommentSourceRange[]
    syntaxRanges: ICommentSourceIndexRange[]
  }

  export interface ICommentRangeSourceMap {
    id: string
    range: ICommentRange
    sourceRange: ICommentSourceRange | null
    openMarker: ICommentSourceMarker | null
    closeMarker: ICommentSourceMarker | null
    metadataDefinition: ICommentSourceMetadataDefinition | null
    syntaxRemovalRanges: ICommentSourceIndexRange[]
  }

  export interface ICommentDiagnosticSourceMap {
    id: string
    diagnostic: ICommentDiagnostic
    syntaxRange: ICommentSourceIndexRange | null
  }

  export interface ICommentAnalysis {
    comments: IParsedMarkdownComments
    ids: Set<string>
    sourceIndex: ICommentSourceIndex
    sourceMaps: {
      ranges: ICommentRangeSourceMap[]
      diagnostics: ICommentDiagnosticSourceMap[]
    }
  }

  export interface ICommentSourceLineState {
    seenFirstLine: boolean
    frontMatterMarker: string | null
    fence: { char: '`' | '~'; length: number } | null
    inMathBlock: boolean
    htmlClosing: RegExp | null
    ignoreLine: boolean
    openParagraph: boolean
  }

  export interface IParsedCommentMetadataDefinition {
    id: string
    dataUri: string
  }

  export interface IAddCommentInput {
    id?: string
    author?: string
    body?: string
    createdAt?: string
    updatedAt?: string
  }

  export interface ICommentSourceIndexOptions {
    frontMatter?: boolean
    math?: boolean
  }

  export type TUpdateCommentThreadPatch = Partial<Omit<ICommentMetadata, 'version'>>

  export const COMMENT_METADATA_DATA_URI_PREFIX: string
  export const COMMENT_MARKER_PATTERN: string

  export function serializeCommentMarker(id: string, kind?: 'open' | 'close'): string
  export function serializeCommentMetadataDefinition(id: string, dataUri: string): string
  export function commentMarkerRegExpForId(id: string, flags?: string): RegExp
  export function appendCommentReplyMetadata(
    metadata: ICommentMetadata,
    reply: ICommentReplyInput
  ): ICommentMetadata
  export function analyzeMarkdownComments(
    markdownOrStates: string | unknown[],
    options?: TCommentAnalysisOptions
  ): ICommentAnalysis
  export function stripAnalyzedCommentSyntaxFromMarkdown(
    markdown: string,
    options?: TCommentAnalysisOptions
  ): string
  export function createCommentMetadata(input: IAddCommentInput): ICommentMetadata
  export function createCommentSourceLineState(): ICommentSourceLineState
  export function decodeCommentMetadata(dataUri: string): ICommentMetadata
  export function encodeCommentMetadata(metadata: ICommentMetadata): string
  export function nextCommentId(existingIds: Iterable<string>): string
  export function parseCommentMetadataDefinition(
    text: string
  ): IParsedCommentMetadataDefinition | null
  export function prepareCommentSourceLine(
    state: ICommentSourceLineState,
    line: string,
    options?: ICommentSourceIndexOptions
  ): void
  export function updateCommentMetadataInMarkdown(
    markdown: string,
    id: string,
    updater: (metadata: ICommentMetadata) => ICommentMetadata
  ): string | null
  export function mergeCommentMetadataPatch(
    metadata: ICommentMetadata,
    patch: TUpdateCommentThreadPatch
  ): ICommentMetadata
  export function validateCommentGraph(
    markdownOrStates: string | unknown[],
    options?: TCommentAnalysisOptions
  ): ICommentDiagnostic[]
  export function sourceCommentIgnoredIndexRanges(
    markdown: string,
    options?: ICommentSourceIndexOptions
  ): ICommentSourceIndexRange[]
  export function sourceInlineCodeRanges(line: string): ICommentSourceIndexRange[]
  export function sourceLinePositionInsideInlineCode(line: string, position: number): boolean
  export function sourceRangesOverlap(
    start: number,
    end: number,
    ranges: ICommentSourceIndexRange[]
  ): boolean

  // The editor instance surface is kept permissive (`any`) — every member
  // that crosses the editor boundary was already `any` in editor.vue.
  export class Muya {
    static use(plugin: any, options?: Record<string, unknown>): void
    constructor(element: HTMLElement, options?: Record<string, unknown>)
    init(): void
    getComments(): IParsedMarkdownComments
    getMarkdown(): string
    getTOC(): Array<{ content: string; lvl: number; slug: string; githubSlug: string }>
    getActiveComments(): string[]
    canAddComment(input?: Pick<IAddCommentInput, 'id'>): boolean
    addComment(input?: IAddCommentInput): boolean
    removeComment(id: string): boolean
    updateCommentThread(id: string, patch: TUpdateCommentThreadPatch): boolean
    replyToComment(id: string, reply: ICommentReplyInput): boolean
    resolveComment(id: string, updatedAt?: string): boolean
    reopenComment(id: string, updatedAt?: string): boolean
    focusComment(id: string): boolean
  }

  // UI plugins (constructors registered via `Muya.use`).
  export const CodeBlockLanguageSelector: any
  export const EmojiSelector: any
  export const FootnoteTool: any
  export const ImageEditTool: any
  export const ImagePathPicker: any
  export const ImageResizeBar: any
  export const ImageToolBar: any
  export const InlineFormatToolbar: any
  export const LinkTools: any
  export const ParagraphFrontButton: any
  export const ParagraphFrontMenu: any
  export const ParagraphQuickInsertMenu: any
  export const PreviewToolBar: any
  export const TableChessboard: any
  export const TableColumnToolbar: any
  export const TableDragBar: any
  export const TableRowColumMenu: any

  export class MarkdownToHtml {
    markdown: string
    constructor(markdown: string, muya?: unknown)
    renderHtml(): Promise<string>
    generate(options?: {
      title?: string
      extraCSS?: string
      inlineStyles?: boolean
      dir?: string
    }): Promise<string>
  }

  export function renderToStaticHTML(...args: any[]): any

  export function escapeHTML(str: string): string
  export function escapeRegExp(value: string): string
  export function unescapeHTML(str: string): string
  export function sanitize(html: string, config?: any, isInline?: boolean): string
  export function generateGithubSlug(text: string): string
  export function getImageInfo(src: string): {
    isUnknownType: boolean
    src: string
  }
  export function wordCount(markdown: string): {
    word: number
    paragraph: number
    character: number
    all: number
  }
}
