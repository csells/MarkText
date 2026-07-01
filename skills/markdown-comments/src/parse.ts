import { parseMarkdownComments } from '@muyajs/core/comments'
import type {
  ICommentDiagnostic,
  ICommentRange,
  ICommentThread,
  IParsedMarkdownComments
} from '@muyajs/core/comments'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const compareStrings = (a: string, b: string): number => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

const pathKey = (path: Array<string | number>): string => path.join('/')

const compareRanges = (a: ICommentRange, b: ICommentRange): number => {
  const idOrder = compareStrings(a.id, b.id)
  if (idOrder) return idOrder

  const startPathOrder = compareStrings(pathKey(a.startPath), pathKey(b.startPath))
  if (startPathOrder) return startPathOrder

  const startOffsetOrder = a.startOffset - b.startOffset
  if (startOffsetOrder) return startOffsetOrder

  const endPathOrder = compareStrings(pathKey(a.endPath), pathKey(b.endPath))
  if (endPathOrder) return endPathOrder

  return a.endOffset - b.endOffset
}

const compareDiagnostics = (a: ICommentDiagnostic, b: ICommentDiagnostic): number =>
  compareStrings(a.id, b.id) || compareStrings(a.code, b.code) || compareStrings(a.message, b.message)

const compareThreads = (a: ICommentThread, b: ICommentThread): number => compareStrings(a.id, b.id)

export function readMarkdownComments(markdown: string): IParsedMarkdownComments {
  const parsed = parseMarkdownComments(markdown)
  return {
    threads: [...parsed.threads].sort(compareThreads),
    ranges: [...parsed.ranges].sort(compareRanges),
    diagnostics: [...parsed.diagnostics].sort(compareDiagnostics)
  }
}

function sortJson(value: unknown): JsonValue {
  if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sortJson)
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([key, item]) => [key, sortJson(item)])
    )
  }

  return String(value)
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}
