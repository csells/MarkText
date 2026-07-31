import {
  freezeDocumentCoreExportOptions,
  type DocumentCoreExportOptions
} from '@shared/types/documentCore'
import {
  createDocumentSearchQuery,
  type DocumentSearchQuery
} from '@marktext/document-core'
import { closedRecord } from '@shared/types/closedRecord'

export type EditorExportCommand = Readonly<{
  type: 'pdf' | 'print' | 'styledHtml'
  options: DocumentCoreExportOptions
}>

export function decodeEditorExportCommand(
  value: unknown
): EditorExportCommand {
  const record = closedRecord(value, 'export', { required: ['type', 'options'] })
  const type = record.type
  if (type !== 'pdf' && type !== 'print' && type !== 'styledHtml') {
    throw new TypeError(`Invalid export type: ${String(type)}`)
  }
  return Object.freeze({
    type,
    options: freezeDocumentCoreExportOptions(record.options)
  })
}

export function decodeSearchRequest(
  value: unknown
): Readonly<{ query: DocumentSearchQuery; selectActiveMatch: boolean }> {
  const record = closedRecord(value, 'search', {
    required: ['value', 'opt'],
    // Escape tears the find bar down and hands the caret to the active
    // match; a click-away must not, so the flag is explicit and optional.
    optional: ['selectActiveMatch']
  })
  if (typeof record.value !== 'string') {
    throw new TypeError('search value must be a string')
  }
  const options = decodeSearchOptions(record.opt, 'search')
  return Object.freeze({
    query: createDocumentSearchQuery(record.value, options),
    selectActiveMatch: record.selectActiveMatch === true
  })
}

export function decodeReplaceRequest(
  value: unknown
): Readonly<{
    query: DocumentSearchQuery
    replacement: string
    isSingle: boolean
  }> {
  const record = closedRecord(value, 'replace', { required: ['query', 'value', 'opt'] })
  if (
    typeof record.query !== 'string' ||
    typeof record.value !== 'string'
  ) {
    throw new TypeError('replace query and value must be strings')
  }
  const option = closedRecord(record.opt, 'replace', {
    required: ['isSingle', 'isCaseSensitive', 'isWholeWord', 'isRegexp']
  })
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
  const option = closedRecord(value, label, {
    required: ['isCaseSensitive', 'isWholeWord', 'isRegexp']
  })
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
  const record = closedRecord(value, 'misspelling', {
    required: ['word', 'replacement']
  })
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
