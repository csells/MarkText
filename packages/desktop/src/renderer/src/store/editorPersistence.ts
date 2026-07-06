import equal from 'deep-equal'
import type { IFileState, LineEnding } from '@shared/types/files'

export interface FileChangePayload {
  pathname: string
  data: {
    isMixedLineEndings?: boolean
    lineEnding?: LineEnding | string
    adjustLineEndingOnSave?: boolean
    trimTrailingNewline?: number
    encoding?: IFileState['encoding']
    markdown: string
    filename: string
  }
}

export const markTabSavedAtCurrentHistory = (tab: IFileState): void => {
  const lastEditIndex = tab.history.lastEditIndex
  if (
    typeof lastEditIndex === 'number' &&
    lastEditIndex >= 0 &&
    lastEditIndex < tab.history.stack.length
  ) {
    const entry = tab.history.stack[lastEditIndex]
    if (entry && typeof entry.id === 'number') {
      tab.lastSavedHistoryId = entry.id
    }
  }
  tab.diskBaseMarkdown = tab.markdown
  tab.isSaved = true
}

export const clearExclusiveTabNotification = (tab: IFileState, exclusiveType: string): void => {
  tab.notifications = tab.notifications.filter((n) => n.exclusiveType !== exclusiveType)
}

const normalizeEncodingForComparison = (encoding: unknown): unknown => {
  if (!encoding || typeof encoding !== 'object') return encoding

  const record = encoding as Record<string, unknown>
  return {
    encoding: record.encoding,
    isBom: record.isBom ?? record.hasBOM ?? false
  }
}

const filePersistenceSnapshot = (data: {
  encoding?: unknown
  lineEnding?: unknown
  adjustLineEndingOnSave?: unknown
  trimTrailingNewline?: unknown
  isMixedLineEndings?: unknown
}): Record<string, unknown> => ({
  encoding: normalizeEncodingForComparison(data.encoding),
  lineEnding: data.lineEnding,
  adjustLineEndingOnSave: data.adjustLineEndingOnSave,
  trimTrailingNewline: data.trimTrailingNewline,
  isMixedLineEndings: data.isMixedLineEndings ?? false
})

export const isSamePersistenceSnapshot = (
  tab: IFileState,
  data: FileChangePayload['data']
): boolean => equal(filePersistenceSnapshot(data), filePersistenceSnapshot(tab))

export const requireDiskBaseMarkdown = (tab: IFileState): string => {
  if (typeof tab.diskBaseMarkdown !== 'string') {
    throw new Error(`dirty external merge requires diskBaseMarkdown for tab ${tab.id}`)
  }
  return tab.diskBaseMarkdown
}
