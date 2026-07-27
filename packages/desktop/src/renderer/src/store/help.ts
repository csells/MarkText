import type { IFileState } from '@shared/types/files'
import { getUniqueId, deepClone } from '../util'

// Helper module (NOT a Pinia store): defaults and factories for the editor
// document state objects.

export type { IFileState }

const defaultFileStateWithoutId = {
  isSaved: true,
  pathname: '',
  filename: 'Untitled-1',
  markdown: '',
  documentCoreHistory: null,
  cursor: null,
  wordCount: {
    paragraph: 0,
    word: 0,
    character: 0,
    all: 0
  },
  searchMatches: {
    index: -1,
    matches: [],
    value: ''
  },
  scrollTop: 0,
  notifications: []
} satisfies Omit<IFileState, 'id'>

/**
 * Default internal markdown document with editor options. Acts as the
 * template for cloning into per-tab state. Note: `id` is intentionally
 * omitted — every actual file state must allocate a unique id via
 * `getBlankFileState` / `createDocumentState`.
 */
export const defaultFileState: Omit<IFileState, 'id'> = defaultFileStateWithoutId

const documentStateKeys = [
  'isSaved',
  'pathname',
  'filename',
  'markdown',
  'cursor',
  'wordCount',
  'searchMatches',
  'scrollTop',
  'notifications'
] as const satisfies ReadonlyArray<keyof IFileState>

export const getBlankFileState = (
  tabs: Array<{ pathname: string; filename: string }>,
  markdown: string | null = defaultFileStateWithoutId.markdown
): IFileState => {
  const fileState = deepClone(defaultFileStateWithoutId) as Omit<IFileState, 'id'>
  const defaultFilenamePrefix = defaultFileStateWithoutId.filename.split('-')[0]
  let untitleId = 0
  for (const file of tabs) {
    if (file.pathname === '') {
      untitleId = Math.max(
        untitleId,
        +file.filename.split('-')[1]
      )
    }
  }

  const id = getUniqueId()

  // We may pass markdown=null as a parameter.
  if (markdown == null) {
    markdown = defaultFileStateWithoutId.markdown
  }

  return Object.assign(fileState, {
    id,
    filename: `${defaultFilenamePrefix}-${++untitleId}`,
    markdown
  }) as IFileState
}

/**
 * Creates an internal document from the given document. Accepts loosely
 * typed input (IPC payloads, partial states) and copies through the keys
 * documented by `documentStateKeys`.
 */
export const createDocumentState = (
  markdownDocument: Partial<IFileState> | Record<string, unknown> | null | undefined = {},
  id: string = getUniqueId()
): IFileState => {
  const src = (markdownDocument || {}) as Record<string, unknown>
  const docState = deepClone(defaultFileStateWithoutId) as Omit<IFileState, 'id'>

  for (const key of documentStateKeys) {
    if (src[key] !== undefined) {
      ;(docState as Record<string, unknown>)[key] = src[key]
    }
  }

  return Object.assign(docState, { id }) as IFileState
}

export const getFileStateFromData = (
  data: Partial<IFileState> | Record<string, unknown> | null | undefined
): IFileState => createDocumentState(data)
