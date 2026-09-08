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
  export function applyNativeOperation(previous: unknown, operation: unknown): unknown
  export function serializeNativeTable(
    state: unknown,
    maximumSourceUnits: number
  ): string | undefined
  export function serializeNativeState(
    states: unknown,
    options?: {
      maximumUnits?: number
      sourceLineEndings?: string
    }
  ): string | undefined
  export interface IInlinePresentationImage {
    readonly raw: string
    readonly range: { readonly start: number; readonly end: number }
    readonly src: string
    readonly alt: string
    readonly title: string
  }
  export interface IInlinePresentationContext {
    readonly highlights?: readonly Readonly<{
      start: number
      end: number
      active: boolean | undefined
    }>[]
    renderImage: (image: IInlinePresentationImage) => { open: string; close: string } | undefined
  }
  export function validEmoji(text: string): { emoji: string } | undefined
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

  // The editor instance surface is kept permissive (`any`) — every member
  // that crosses the editor boundary was already `any` in editor.vue.
  export class Muya {
    showImageSelectorAtSelection(): boolean
    static use(plugin: any, options?: Record<string, unknown>): void
    constructor(element: HTMLElement, options?: Record<string, unknown>)
    init(): void
    [key: string]: any
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
    static fromHtml(html: string, muya?: Muya): MarkdownToHtml
    markdown: string
    constructor(markdown: string, muya?: unknown)
    renderHtml(options?: { preview?: boolean }): Promise<string>
    generate(options?: {
      title?: string
      extraCSS?: string
      inlineStyles?: boolean
      dir?: string
    }): Promise<string>
  }

  export function renderToStaticHTML(...args: any[]): any

  export function escapeHTML(str: string): string
  export function unescapeHTML(str: string): string
  export function sanitize(html: string, config?: any, isInline?: boolean): string
  export function createHeadingIdAllocator(reservedIds?: Iterable<string>): (text: string) => string
  export function generateGithubSlug(text: string): string
  export function renderFootnoteReference(number: number, prefix?: string): string
  export function appendFootnoteSection(
    body: string,
    definitions: readonly {
      readonly number: number
      readonly html: string
    }[],
    prefix?: string
  ): string
  export function highlightCode(code: string, language: string): string
  export function renderMath(
    text: string,
    options?: { displayMode?: boolean; throwOnError?: boolean }
  ): string
  export interface ISearchQueryOptions {
    readonly isCaseSensitive?: boolean
    readonly isWholeWord?: boolean
    readonly isRegexp?: boolean
  }
  export interface IRegexMatch {
    readonly match: string
    readonly subMatches: readonly string[]
  }
  export function matchString(
    text: string,
    value: string,
    options: ISearchQueryOptions
  ): Array<{
    match: string
    subMatches: string[]
    index: number
  }>
  export function buildRegexValue(match: IRegexMatch, value: string): string
  export function getImageInfo(src: string): {
    isUnknownType: boolean
    src: string
    [key: string]: any
  }
  export function wordCount(markdown: string): {
    word: number
    paragraph: number
    character: number
    all: number
  }
}
