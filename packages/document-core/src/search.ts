import type {
  MarkupRenderBlock,
  MarkupRenderNode,
  MarkupRenderText
} from './view/markupRender.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import {
  createParseExecutionTracker,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionControl,
  type ParseExecutionTracker
} from './parseExecutionControl.js'

export interface SearchMatchRange {
  readonly start: number
  readonly end: number
}

export type DocumentSearchSyntax = 'literal' | 'regexp'

export interface DocumentSearchQuery {
  readonly schema: 'document-search-query-1'
  readonly text: string
  readonly syntax: DocumentSearchSyntax
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
}

export interface DocumentSearchQueryOptions {
  readonly syntax?: DocumentSearchSyntax
  readonly caseSensitive?: boolean
  readonly wholeWord?: boolean
}

export class DocumentSearchQueryError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentSearchQueryError'
  }
}

/**
 * Engine-owned, non-configurable search limits.
 *
 * They bound both find results and the candidate transaction before parsing.
 * Hosts cannot raise them, so every consumer observes the same decision.
 */
export const DOCUMENT_SEARCH_RESOURCE_POLICY_V1 = Object.freeze({
  schema: 'document-search-resource-policy-1' as const,
  maximumQueryUnits: 4_096,
  maximumMatchUnits: 4_096,
  maximumMatches:
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction,
  maximumGeneratedReplacementUnits: 1_048_576
})

const DOCUMENT_SEARCH_QUERY_FIELDS = Object.freeze([
  'schema',
  'text',
  'syntax',
  'caseSensitive',
  'wholeWord'
])

function hasQuantifiedGroup(pattern: string): boolean {
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const unit = pattern[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (unit === '\\') {
      escaped = true
      continue
    }
    if (unit === '[') {
      inCharacterClass = true
      continue
    }
    if (unit === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (unit !== ')' || inCharacterClass) continue
    const quantifier = pattern[index + 1]
    if (
      quantifier === '*' ||
      quantifier === '+' ||
      quantifier === '?' ||
      quantifier === '{'
    ) {
      return true
    }
  }
  return false
}

interface RegexpBoundedQuantifier {
  readonly end: number
  readonly minimum: number
  readonly maximum: number | null
}

function regexpBoundedQuantifierAt(
  pattern: string,
  start: number
): RegexpBoundedQuantifier | undefined {
  const match = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(start))
  if (match === null) return undefined
  const minimum = Number(match[1])
  const maximum =
    match[2] === undefined
      ? minimum
      : match[3] === ''
        ? null
        : Number(match[3])
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    (
      maximum !== null &&
      (
        !Number.isSafeInteger(maximum) ||
        maximum < minimum
      )
    )
  ) {
    return undefined
  }
  return Object.freeze({
    end: start + match[0].length - 1,
    minimum,
    maximum
  })
}

function regexpPolicyViolation(pattern: string): boolean {
  // Native JavaScript regexp evaluation has no cooperative interruption seam.
  // Admit only a conservatively linear subset: no anchors, lookaround, or
  // backreferences; no quantified groups; at most one variable repetition;
  // and an unbounded repetition only at the consuming end (optionally followed
  // by a word-boundary assertion). Each admitted evaluation then runs inside
  // one bounded source window.
  let variableQuantifiers = 0
  let unboundedQuantifier = -1
  let lastQuantifierEnd = -1
  let maximumExpandedUnits = pattern.length * 2
  let escaped = false
  let inCharacterClass = false
  if (
    maximumExpandedUnits >
      DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumMatchUnits
  ) {
    return true
  }

  for (let index = 0; index < pattern.length; index += 1) {
    const unit = pattern[index]
    if (escaped) {
      escaped = false
      if (
        unit === undefined ||
        /^[1-9]$/.test(unit) ||
        unit === 'k' ||
        unit === 'p' ||
        unit === 'P'
      ) {
        return true
      }
      continue
    }
    if (unit === '\\') {
      escaped = true
      continue
    }
    if (inCharacterClass) {
      if (unit === ']') inCharacterClass = false
      continue
    }
    if (unit === '[') {
      inCharacterClass = true
      continue
    }
    if (unit === '^' || unit === '$' || unit === '}') {
      return true
    }
    if (unit === '{') {
      const quantifier = regexpBoundedQuantifierAt(pattern, index)
      if (
        quantifier === undefined ||
        quantifier.minimum > 256 ||
        (
          quantifier.maximum !== null &&
          quantifier.maximum > 256
        )
      ) {
        return true
      }
      if (
        quantifier.maximum === null ||
        quantifier.minimum !== quantifier.maximum
      ) {
        variableQuantifiers += 1
        if (variableQuantifiers > 1) return true
      }
      if (quantifier.maximum === null) {
        unboundedQuantifier = quantifier.end
      } else {
        maximumExpandedUnits += quantifier.maximum * 2
        if (
          maximumExpandedUnits >
            DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumMatchUnits
        ) {
          return true
        }
      }
      lastQuantifierEnd = quantifier.end
      index = quantifier.end
      continue
    }
    if (unit === '(' && pattern[index + 1] === '?') {
      if (pattern[index + 2] !== ':') return true
      index += 2
      continue
    }
    if (unit !== '*' && unit !== '+' && unit !== '?') continue
    if (
      unit === '?' &&
      (
        index === lastQuantifierEnd + 1 ||
        pattern[index - 1] === '*' ||
        pattern[index - 1] === '+' ||
        pattern[index - 1] === '?'
      )
    ) {
      continue
    }
    variableQuantifiers += 1
    if (variableQuantifiers > 1) return true
    lastQuantifierEnd = index
    if (unit === '*' || unit === '+') unboundedQuantifier = index
  }

  if (escaped || inCharacterClass) return true
  if (unboundedQuantifier < 0) return false

  let afterEscaped = false
  let afterCharacterClass = false
  for (
    let index = unboundedQuantifier + 1;
    index < pattern.length;
    index += 1
  ) {
    const unit = pattern[index]
    if (afterEscaped) {
      afterEscaped = false
      if (unit !== 'b' && unit !== 'B') return true
      continue
    }
    if (unit === '\\') {
      afterEscaped = true
      continue
    }
    if (afterCharacterClass) {
      if (unit === ']') afterCharacterClass = false
      continue
    }
    if (unit === '[') return true
    if (
      unit !== undefined &&
      unit !== '?' &&
      unit !== ')' &&
      unit !== '|' &&
      unit !== ':'
    ) {
      return true
    }
  }
  return afterEscaped || afterCharacterClass
}

export function decodeDocumentSearchQuery(
  value: unknown
): DocumentSearchQuery {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocumentSearchQueryError(
      'Document search query must be a closed record'
    )
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DocumentSearchQueryError(
      'Document search query must have a plain prototype'
    )
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== DOCUMENT_SEARCH_QUERY_FIELDS.length ||
    ownKeys.some((key) =>
      typeof key !== 'string' ||
      !DOCUMENT_SEARCH_QUERY_FIELDS.includes(key)
    )
  ) {
    throw new DocumentSearchQueryError(
      'Document search query fields are not closed'
    )
  }
  const record = value as Record<string, unknown>
  for (const key of DOCUMENT_SEARCH_QUERY_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new DocumentSearchQueryError(
        `Document search query ${key} must be an enumerable data field`
      )
    }
  }
  if (record.schema !== 'document-search-query-1') {
    throw new DocumentSearchQueryError(
      'Document search query has an invalid schema'
    )
  }
  if (typeof record.text !== 'string') {
    throw new DocumentSearchQueryError(
      'Document search query text must be a string'
    )
  }
  if (
    record.text.length >
      DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumQueryUnits
  ) {
    throw new DocumentSearchQueryError(
      'Document search query exceeds the search resource policy'
    )
  }
  if (record.syntax !== 'literal' && record.syntax !== 'regexp') {
    throw new DocumentSearchQueryError(
      'Document search query has an invalid syntax'
    )
  }
  if (
    typeof record.caseSensitive !== 'boolean' ||
    typeof record.wholeWord !== 'boolean'
  ) {
    throw new DocumentSearchQueryError(
      'Document search query options must be booleans'
    )
  }
  const query = Object.freeze({
    schema: 'document-search-query-1' as const,
    text: record.text,
    syntax: record.syntax,
    caseSensitive: record.caseSensitive,
    wholeWord: record.wholeWord
  })
  if (query.syntax === 'regexp' && query.text.length > 0) {
    let expression: RegExp
    try {
      expression = new RegExp(
        query.text,
        query.caseSensitive ? 'u' : 'iu'
      )
    } catch {
      throw new DocumentSearchQueryError(
        'Document search query has an invalid regular expression'
      )
    }
    if (
      hasQuantifiedGroup(query.text) ||
      regexpPolicyViolation(query.text)
    ) {
      throw new DocumentSearchQueryError(
        'Document search regular expression exceeds the search resource policy'
      )
    }
    if (expression.test('')) {
      throw new DocumentSearchQueryError(
        'Document search regular expression matches empty text'
      )
    }
  }
  return query
}

export function createDocumentSearchQuery(
  text: string,
  options: DocumentSearchQueryOptions = Object.freeze({})
): DocumentSearchQuery {
  return decodeDocumentSearchQuery({
    schema: 'document-search-query-1',
    text,
    syntax: options.syntax ?? 'literal',
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false
  })
}

function escapedRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const UNICODE_WORD_CHARACTER =
  /[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Connector_Punctuation}\u200C\u200D]/u

function codePointBefore(text: string, offset: number): string | undefined {
  if (offset <= 0) return undefined
  let start = offset - 1
  const unit = text.charCodeAt(start)
  if (
    unit >= 0xdc00 &&
    unit <= 0xdfff &&
    start > 0
  ) {
    const previous = text.charCodeAt(start - 1)
    if (previous >= 0xd800 && previous <= 0xdbff) start -= 1
  }
  const point = text.codePointAt(start)
  return point === undefined ? undefined : String.fromCodePoint(point)
}

function codePointAt(text: string, offset: number): string | undefined {
  const point = text.codePointAt(offset)
  return point === undefined ? undefined : String.fromCodePoint(point)
}

function isWholeWordMatch(
  text: string,
  start: number,
  end: number
): boolean {
  const before = codePointBefore(text, start)
  const after = codePointAt(text, end)
  return (
    (before === undefined || !UNICODE_WORD_CHARACTER.test(before)) &&
    (after === undefined || !UNICODE_WORD_CHARACTER.test(after))
  )
}

/**
 * Find non-overlapping literal matches in parser-owned visible text.
 *
 * Search syntax belongs to the document engine so every host observes the same
 * ranges and mutating commands can recompute them against the authenticated
 * current revision instead of trusting renderer-supplied offsets.
 */
export function findSearchMatches(
  text: string,
  query: DocumentSearchQuery,
  executionControl?: ParseExecutionControl
): readonly SearchMatchRange[] {
  const execution = createSearchExecution(executionControl)
  const matches = findValidatedSearchMatches(
    text,
    decodeDocumentSearchQuery(query),
    execution
  )
  execution.tracker.finish()
  return matches
}

interface SearchExecution {
  readonly tracker: ParseExecutionTracker
  matches: number
}

function createSearchExecution(
  executionControl?: ParseExecutionControl
): SearchExecution {
  return {
    tracker: createParseExecutionTracker(executionControl),
    matches: 0
  }
}

function findValidatedSearchMatches(
  text: string,
  query: DocumentSearchQuery,
  execution: SearchExecution
): readonly SearchMatchRange[] {
  if (query.text.length === 0) return Object.freeze([])
  const matches: SearchMatchRange[] = []
  const pattern =
    query.syntax === 'literal' ? escapedRegExp(query.text) : query.text
  const flags = query.caseSensitive ? 'gu' : 'giu'
  let searchOffset = 0

  while (searchOffset < text.length) {
    const committedThrough = Math.min(
      text.length,
      searchOffset + PARSE_SOURCE_CHECKPOINT_INTERVAL
    )
    const windowStart = Math.max(0, searchOffset - 2)
    const windowEnd = Math.min(
      text.length,
      committedThrough +
        DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumMatchUnits +
        2
    )
    execution.tracker.examineSource(committedThrough - searchOffset)
    const window = text.slice(windowStart, windowEnd)
    const expression = new RegExp(pattern, flags)
    expression.lastIndex = searchOffset - windowStart
    let acceptedEnd = searchOffset

    for (let match = expression.exec(window);
      match !== null;
      match = expression.exec(window)) {
      if (match[0].length === 0) {
        throw new DocumentSearchQueryError(
          'Document search regular expression matches empty text'
        )
      }
      const start = windowStart + match.index
      if (start >= committedThrough) break
      const end = start + match[0].length
      if (
        match[0].length >
          DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumMatchUnits
      ) {
        throw new DocumentSearchQueryError(
          'Document search match exceeds the search resource policy'
        )
      }
      acceptedEnd = Math.max(acceptedEnd, end)
      if (query.wholeWord && !isWholeWordMatch(text, start, end)) continue
      if (
        execution.matches ===
          DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumMatches
      ) {
        throw new DocumentSearchQueryError(
          'Document search match set exceeds the search resource policy'
        )
      }
      execution.matches += 1
      matches.push(Object.freeze({
        start,
        end
      }))
    }

    if (acceptedEnd > committedThrough) {
      execution.tracker.examineSource(acceptedEnd - committedThrough)
    }
    const nextOffset = Math.max(committedThrough, acceptedEnd)
    if (nextOffset <= searchOffset) {
      throw new Error('Document search did not advance its source cursor')
    }
    searchOffset = nextOffset
  }

  return Object.freeze(matches)
}

interface VisibleSearchSegment {
  readonly text: string
  readonly visibleStart: number
  readonly visibleEnd: number
  readonly render: MarkupRenderText
}

function collectVisibleText(
  node: MarkupRenderNode,
  target: MarkupRenderText[]
): void {
  target.push(...node.text)
  for (const child of node.children) collectVisibleText(child, target)
}

function modelBoundaryAt(
  segment: MarkupRenderText,
  textOffset: number
): number {
  if (
    segment.boundaryMapping === 'identity' &&
    segment.modelRange.end - segment.modelRange.start === segment.text.length
  ) {
    return segment.modelRange.start + textOffset
  }
  return textOffset === segment.text.length
    ? segment.modelRange.end
    : segment.modelRange.start
}

function mappedVisibleSegments(
  block: MarkupRenderBlock
): readonly VisibleSearchSegment[] {
  const rendered: MarkupRenderText[] = []
  collectVisibleText(block.tree, rendered)
  let visibleOffset = 0
  return Object.freeze(rendered
    .filter((segment) => segment.text.length > 0)
    .map((segment) => {
      const visibleStart = visibleOffset
      visibleOffset += segment.text.length
      return Object.freeze({
        text: segment.text,
        visibleStart,
        visibleEnd: visibleOffset,
        render: segment
      })
    }))
}

function visibleSegmentAt(
  segments: readonly VisibleSearchSegment[],
  visibleOffset: number
): VisibleSearchSegment | undefined {
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]
    if (segment === undefined) return undefined
    if (visibleOffset < segment.visibleStart) {
      high = middle - 1
    } else if (visibleOffset >= segment.visibleEnd) {
      low = middle + 1
    } else {
      return segment
    }
  }
  return undefined
}

/**
 * Find literal matches in the parser-emitted text users can actually see.
 *
 * Markdown delimiters and link destinations occupy model coordinates but do
 * not become searchable text. Matches may cross adjacent semantic text nodes;
 * their returned bounds map back to the authenticated Markup coordinate space
 * used by editor intents.
 */
export function findMarkupSearchMatches(
  blocks: readonly MarkupRenderBlock[],
  query: DocumentSearchQuery,
  executionControl?: ParseExecutionControl
): readonly SearchMatchRange[] {
  const decodedQuery = decodeDocumentSearchQuery(query)
  if (decodedQuery.text.length === 0) return Object.freeze([])

  const execution = createSearchExecution(executionControl)
  const matches: SearchMatchRange[] = []
  for (const block of blocks) {
    const segments = mappedVisibleSegments(block)
    const visibleText = segments.map((segment) => segment.text).join('')
    for (const match of findValidatedSearchMatches(
      visibleText,
      decodedQuery,
      execution
    )) {
      const first = visibleSegmentAt(segments, match.start)
      const last = visibleSegmentAt(segments, match.end - 1)
      if (first === undefined || last === undefined) {
        throw new Error('Visible search match has no parser text boundary')
      }
      matches.push(Object.freeze({
        start: modelBoundaryAt(
          first.render,
          match.start - first.visibleStart
        ),
        end: modelBoundaryAt(
          last.render,
          match.end - last.visibleStart
        )
      }))
    }
  }
  execution.tracker.finish()
  return Object.freeze(matches)
}
