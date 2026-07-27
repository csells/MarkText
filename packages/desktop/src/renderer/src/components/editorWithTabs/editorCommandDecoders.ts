import {
  freezeDocumentCoreExportOptions,
  type DocumentCoreExportOptions
} from '@shared/types/documentCore'
import {
  createDocumentSearchQuery,
  type DocumentSearchQuery
} from '@marktext/document-core'

type PlainRecord = Record<string, unknown>

function closedRecord(
  value: unknown,
  label: string,
  keys: readonly string[]
): PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`)
  }
  const record = value as PlainRecord
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new TypeError(`Unknown ${label} option: ${key}`)
    }
  }
  return record
}

export type EditorExportCommand = Readonly<{
  type: 'pdf' | 'print' | 'styledHtml'
  options: DocumentCoreExportOptions
}>

export function decodeEditorExportCommand(
  value: unknown
): EditorExportCommand {
  const record = closedRecord(value, 'export', ['type', 'options'])
  const type = record.type
  if (type !== 'pdf' && type !== 'print' && type !== 'styledHtml') {
    throw new TypeError(`Invalid export type: ${String(type)}`)
  }
  return Object.freeze({
    type,
    options: freezeDocumentCoreExportOptions(record.options)
  })
}

export type CopyPasteCommand =
  | 'copyAsRich'
  | 'copyAsHtml'
  | 'pasteAsPlainText'

export function decodeCopyPasteCommand(value: unknown): CopyPasteCommand {
  if (
    value !== 'copyAsRich' &&
    value !== 'copyAsHtml' &&
    value !== 'pasteAsPlainText'
  ) {
    throw new TypeError(`Unknown copy command: ${String(value)}`)
  }
  return value
}

export type ParagraphAction =
  | 'duplicate'
  | 'createParagraph'
  | 'deleteParagraph'

export function decodeParagraphAction(value: unknown): ParagraphAction {
  if (
    value !== 'duplicate' &&
    value !== 'createParagraph' &&
    value !== 'deleteParagraph'
  ) {
    throw new TypeError(`Unknown paragraph command: ${String(value)}`)
  }
  return value
}

export function decodeSearchRequest(
  value: unknown
): Readonly<{ query: DocumentSearchQuery }> {
  const record = closedRecord(value, 'search', ['value', 'opt'])
  if (typeof record.value !== 'string') {
    throw new TypeError('search value must be a string')
  }
  const options = decodeSearchOptions(record.opt, 'search')
  return Object.freeze({
    query: createDocumentSearchQuery(record.value, options)
  })
}

export function decodeReplaceRequest(
  value: unknown
): Readonly<{
    query: DocumentSearchQuery
    replacement: string
    isSingle: boolean
  }> {
  const record = closedRecord(value, 'replace', ['query', 'value', 'opt'])
  if (
    typeof record.query !== 'string' ||
    typeof record.value !== 'string'
  ) {
    throw new TypeError('replace query and value must be strings')
  }
  const option = closedRecord(record.opt, 'replace', [
    'isSingle',
    'isCaseSensitive',
    'isWholeWord',
    'isRegexp'
  ])
  if (typeof option.isSingle !== 'boolean') {
    throw new TypeError('replace isSingle must be a boolean')
  }
  const searchOptions = decodeSearchOptions({
    isCaseSensitive: option.isCaseSensitive,
    isWholeWord: option.isWholeWord,
    isRegexp: option.isRegexp
  }, 'replace')
  return Object.freeze({
    query: createDocumentSearchQuery(record.query, searchOptions),
    replacement: record.value,
    isSingle: option.isSingle
  })
}

function decodeSearchOptions(
  value: unknown,
  label: string
): Readonly<{
    syntax: 'literal' | 'regexp'
    caseSensitive: boolean
    wholeWord: boolean
  }> {
  const option = closedRecord(value, label, [
    'isCaseSensitive',
    'isWholeWord',
    'isRegexp'
  ])
  if (
    typeof option.isCaseSensitive !== 'boolean' ||
    typeof option.isWholeWord !== 'boolean' ||
    typeof option.isRegexp !== 'boolean'
  ) {
    throw new TypeError(`${label} search options must be booleans`)
  }
  return Object.freeze({
    syntax: option.isRegexp ? 'regexp' : 'literal',
    caseSensitive: option.isCaseSensitive,
    wholeWord: option.isWholeWord
  })
}

export function decodeMisspellingRequest(
  value: unknown
): Readonly<{ word: string; replacement: string }> {
  const record = closedRecord(value, 'misspelling', [
    'word',
    'replacement'
  ])
  if (
    typeof record.word !== 'string' ||
    typeof record.replacement !== 'string'
  ) {
    throw new TypeError('misspelling fields must be strings')
  }
  return Object.freeze({
    word: record.word,
    replacement: record.replacement
  })
}
