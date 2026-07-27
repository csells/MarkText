import type { MarkdownNodeKind } from '@marktext/document-core'

export const DOCUMENT_SELECTION_BLOCK_KINDS = Object.freeze([
  'document',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'list-item',
  'thematic-break',
  'code-block',
  'html-block',
  'front-matter',
  'math-block',
  'diagram',
  'table',
  'table-row',
  'table-cell',
  'footnote-definition'
] as const satisfies readonly MarkdownNodeKind[])

/** Closed, serializable selection state consumed by Desktop's native menus. */
export interface DocumentSelectionMenuState {
  readonly activeBlockKinds: readonly MarkdownNodeKind[]
  readonly headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null
  readonly isDisabled: boolean
  readonly isMultiblock: boolean
  readonly isLooseList: boolean
  readonly isTaskList: boolean
  readonly isOrderedList: boolean
  readonly isUnorderedList: boolean
  readonly isCodeLike: boolean
  readonly isCodeBlock: boolean
  readonly isTable: boolean
  readonly hasFrontMatter: boolean
}

export interface DocumentFormatMenuState {
  readonly strong: boolean
  readonly em: boolean
  readonly u: boolean
  readonly sup: boolean
  readonly sub: boolean
  readonly mark: boolean
  readonly inline_code: boolean
  readonly inline_math: boolean
  readonly del: boolean
  readonly link: boolean
  readonly image: boolean
}

export interface WindowLayoutMenuState {
  readonly showSideBar?: boolean
  readonly showTabBar?: boolean
  readonly sourceCode?: boolean
  readonly typewriter?: boolean
  readonly focus?: boolean
}
