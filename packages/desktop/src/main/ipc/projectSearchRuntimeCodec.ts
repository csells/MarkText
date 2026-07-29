import { closedRecord } from '@shared/types/closedRecord'
import type {
  ProjectSearchRequest,
  ProjectSearchRequestOptions
} from '@shared/types/projectSearch'

const MAX_PATTERN_LENGTH = 4096
const MAX_GLOB_COUNT = 128
const MAX_GLOB_LENGTH = 1024
const MAX_CONTEXT_LINES = 20

function optionalBoolean(
  record: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new TypeError(`Project-search ${field} must be a boolean`)
  }
  return value
}

function optionalContextCount(
  record: Record<string, unknown>,
  field: string
): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_CONTEXT_LINES
  ) {
    throw new TypeError(
      `Project-search ${field} must be an integer from 0 through ${MAX_CONTEXT_LINES}`
    )
  }
  return value
}

function optionalGlobs(
  record: Record<string, unknown>
): readonly string[] | undefined {
  const value = record.inclusions
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length > MAX_GLOB_COUNT ||
    value.some(glob =>
      typeof glob !== 'string' ||
      glob.length === 0 ||
      glob.length > MAX_GLOB_LENGTH ||
      glob.includes('\0') ||
      glob.includes('\n') ||
      glob.includes('\r')
    )
  ) {
    throw new TypeError('Project-search inclusions must be bounded glob strings')
  }
  return Object.freeze([...value])
}

export function decodeProjectSearchRequest(
  value: unknown
): ProjectSearchRequest {
  const record = closedRecord(value, 'project-search request', {
    required: ['schema', 'mode', 'pattern', 'options']
  })
  if (record.schema !== 'project-search-request-1') {
    throw new TypeError('Invalid project-search request schema')
  }
  if (record.mode !== 'text' && record.mode !== 'files') {
    throw new TypeError('Invalid project-search mode')
  }
  if (
    typeof record.pattern !== 'string' ||
    record.pattern.length > MAX_PATTERN_LENGTH ||
    record.pattern.includes('\0')
  ) {
    throw new TypeError('Project-search pattern must be a bounded string')
  }
  if (
    (record.mode === 'text' && record.pattern.length === 0) ||
    (record.mode === 'files' && record.pattern.length !== 0)
  ) {
    throw new TypeError('Project-search pattern does not match its mode')
  }

  // Every search option means "use the default" when absent, which is what a
  // declared-optional key is for.
  const rawOptions = closedRecord(record.options, 'project-search options', {
    required: [],
    optional: [
      'isRegexp',
      'isCaseSensitive',
      'isWholeWord',
      'leadingContextLineCount',
      'trailingContextLineCount',
      'inclusions'
    ]
  })
  const isRegexp = optionalBoolean(rawOptions, 'isRegexp')
  const isCaseSensitive =
    optionalBoolean(rawOptions, 'isCaseSensitive')
  const isWholeWord = optionalBoolean(rawOptions, 'isWholeWord')
  const leadingContextLineCount =
    optionalContextCount(rawOptions, 'leadingContextLineCount')
  const trailingContextLineCount =
    optionalContextCount(rawOptions, 'trailingContextLineCount')
  const inclusions = optionalGlobs(rawOptions)
  const options: ProjectSearchRequestOptions = Object.freeze({
    ...(isRegexp === undefined
      ? {}
      : { isRegexp }),
    ...(isCaseSensitive === undefined
      ? {}
      : { isCaseSensitive }),
    ...(isWholeWord === undefined
      ? {}
      : { isWholeWord }),
    ...(leadingContextLineCount === undefined
      ? {}
      : { leadingContextLineCount }),
    ...(trailingContextLineCount === undefined
      ? {}
      : { trailingContextLineCount }),
    ...(inclusions === undefined
      ? {}
      : { inclusions })
  })

  return Object.freeze({
    schema: 'project-search-request-1',
    mode: record.mode,
    pattern: record.pattern,
    options
  })
}
