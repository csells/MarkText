import type {
  DocumentRevision,
  MarkdownNode
} from '../revision.js'
import {
  createParseExecutionTracker,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionControl,
  type ParseExecutionTracker
} from '../parseExecutionControl.js'
import {
  materializeMarkdownNodeTextsWithSharedContext,
} from './textMaterializers.js'

export interface DocumentStatistics {
  /** Unicode word tokens plus one word per Han ideograph. */
  readonly word: number
  /** Nonempty parser-emitted paragraph and heading blocks. */
  readonly paragraph: number
  /** Non-whitespace Unicode code points. */
  readonly character: number
  /** UTF-16 units in the semantic text projection. */
  readonly all: number
}

export interface DocumentFacts {
  readonly kind: 'document-facts'
  readonly recommendedTitle: string | null
  readonly statistics: DocumentStatistics
}

const cachedFacts = new WeakMap<DocumentRevision, DocumentFacts>()
const certifiedSimpleTextFacts = new WeakSet<DocumentRevision>()

const HAN_SCALAR = /^\p{Script=Han}$/u
const WORD_SCALAR = /^[\p{L}\p{M}\p{N}_]$/u
const WHITESPACE_SCALAR = /^\s$/u

function isAsciiWord(codeUnit: number): boolean {
  return (
    (codeUnit >= 48 && codeUnit <= 57) ||
    (codeUnit >= 65 && codeUnit <= 90) ||
    codeUnit === 95 ||
    (codeUnit >= 97 && codeUnit <= 122)
  )
}

function isAsciiWhitespace(codeUnit: number): boolean {
  return codeUnit === 32 || (codeUnit >= 9 && codeUnit <= 13)
}

function statistics(
  text: string,
  paragraph: number,
  execution?: ParseExecutionTracker
): DocumentStatistics {
  let word = 0
  let character = 0
  let insideWord = false
  let offset = 0
  let reportedOffset = 0
  while (offset < text.length) {
    const first = text.charCodeAt(offset)
    if (first <= 0x7f) {
      if (!isAsciiWhitespace(first)) character += 1
      if (isAsciiWord(first)) {
        if (!insideWord) word += 1
        insideWord = true
      } else {
        insideWord = false
      }
      offset += 1
      if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
        execution?.examineSource(offset - reportedOffset)
        reportedOffset = offset
      }
      continue
    }

    const scalarUnits =
      first >= 0xd800 &&
      first <= 0xdbff &&
      offset + 1 < text.length &&
      text.charCodeAt(offset + 1) >= 0xdc00 &&
      text.charCodeAt(offset + 1) <= 0xdfff
        ? 2
        : 1
    const scalar = text.slice(offset, offset + scalarUnits)
    if (!WHITESPACE_SCALAR.test(scalar)) character += 1
    if (HAN_SCALAR.test(scalar)) {
      // Existing product semantics count every Han ideograph as one word and
      // separate it from adjacent Unicode word runs.
      word += 1
      insideWord = false
    } else if (WORD_SCALAR.test(scalar)) {
      if (!insideWord) word += 1
      insideWord = true
    } else {
      insideWord = false
    }
    offset += scalarUnits
    if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
      execution?.examineSource(offset - reportedOffset)
      reportedOffset = offset
    }
  }
  execution?.examineSource(offset - reportedOffset)

  return Object.freeze({
    word,
    paragraph,
    character,
    all: text.length
  })
}

function visit(
  node: MarkdownNode,
  callback: (node: MarkdownNode) => void,
  execution?: ParseExecutionTracker
): void {
  const pending = [node]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    callback(current)
    execution?.examineParserWork(1)
    for (let index = current.childCount - 1; index >= 0; index -= 1) {
      pending.push(current.childAt(index))
    }
  }
}

function hasNonWhitespace(
  text: string,
  execution?: ParseExecutionTracker
): boolean {
  let reportedOffset = 0
  for (let offset = 0; offset < text.length;) {
    const first = text.charCodeAt(offset)
    const scalarUnits =
      first <= 0x7f
        ? 1
        : first >= 0xd800 &&
          first <= 0xdbff &&
          offset + 1 < text.length &&
          text.charCodeAt(offset + 1) >= 0xdc00 &&
          text.charCodeAt(offset + 1) <= 0xdfff
          ? 2
          : 1
    const next = offset + scalarUnits
    if (next - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
      execution?.examineSource(next - reportedOffset)
      reportedOffset = next
    }
    if (
      first <= 0x7f
        ? !isAsciiWhitespace(first)
        : !WHITESPACE_SCALAR.test(text.slice(offset, next))
    ) {
      execution?.examineSource(next - reportedOffset)
      return true
    }
    offset = next
  }
  execution?.examineSource(text.length - reportedOffset)
  return false
}

function normalizeWhitespace(
  text: string,
  execution?: ParseExecutionTracker
): string {
  const pieces: string[] = []
  let runStart: number | null = null
  let hasContent = false
  let pendingSpace = false
  let reportedOffset = 0
  for (let offset = 0; offset < text.length;) {
    const first = text.charCodeAt(offset)
    const scalarUnits =
      first <= 0x7f
        ? 1
        : first >= 0xd800 &&
          first <= 0xdbff &&
          offset + 1 < text.length &&
          text.charCodeAt(offset + 1) >= 0xdc00 &&
          text.charCodeAt(offset + 1) <= 0xdfff
          ? 2
          : 1
    const next = offset + scalarUnits
    const whitespace = first <= 0x7f
      ? isAsciiWhitespace(first)
      : WHITESPACE_SCALAR.test(text.slice(offset, next))
    if (whitespace) {
      if (runStart !== null) {
        pieces.push(text.slice(runStart, offset))
        runStart = null
        hasContent = true
      }
      pendingSpace = hasContent
    } else {
      if (pendingSpace) pieces.push(' ')
      pendingSpace = false
      runStart ??= offset
    }
    offset = next
    if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
      execution?.examineSource(offset - reportedOffset)
      reportedOffset = offset
    }
  }
  execution?.examineSource(text.length - reportedOffset)
  if (runStart !== null) {
    pieces.push(text.slice(runStart))
  }
  if (execution !== undefined) {
    let outputUnits = 0
    for (const piece of pieces) {
      outputUnits += piece.length
      execution.examineParserWork(1)
    }
    execution.examineParserWork(outputUnits)
  }
  return pieces.join('')
}

function completeFacts(
  revision: Extract<DocumentRevision, { kind: 'complete' }>,
  execution?: ParseExecutionTracker
): DocumentFacts {
  if (certifiedSimpleTextFacts.has(revision)) {
    return Object.freeze({
      kind: 'document-facts' as const,
      recommendedTitle: null,
      statistics: statistics(revision.source.text, 1, execution)
    })
  }
  const projection = revision.projection('editing')
  const paragraphNodes: MarkdownNode[] = []
  visit(projection.markdown.root, node => {
    if (node.kind === 'paragraph' || node.kind === 'heading') {
      paragraphNodes.push(node)
    }
  }, execution)
  const paragraphTexts = materializeMarkdownNodeTextsWithSharedContext(
    projection.markdown,
    paragraphNodes,
    execution
  )
  const paragraph = paragraphTexts.reduce(
    (count, text) => count + (
      hasNonWhitespace(text, execution) ? 1 : 0
    ),
    0
  )
  const revised = revision.projection('revised')
  const revisedHeading = revised.markdown.headings.count === 0
    ? null
    : revised.markdown.headings.at(0).node
  const revisedHeadingText = revisedHeading === null
    ? ''
    : materializeMarkdownNodeTextsWithSharedContext(
      revised.markdown,
      Object.freeze([revisedHeading]),
      execution
    )[0] ?? ''
  const recommendedTitle = revisedHeading === null
    ? null
    : normalizeWhitespace(revisedHeadingText, execution) || null
  // The count consumer's declared policy reads the committed canonical source
  // including markers and Comment payload, identical in every view
  // (specs/migration/consumer-policy.yml). Counting a projection's semantic
  // text silently shrank the numbers whenever a document carried markers.
  return Object.freeze({
    kind: 'document-facts' as const,
    recommendedTitle,
    statistics: statistics(revision.source.text, paragraph, execution)
  })
}

function sourceOnlyStatistics(
  source: string,
  execution?: ParseExecutionTracker
): DocumentStatistics {
  const lineEndingLengthAt = (offset: number): number => {
    const unit = source.charCodeAt(offset)
    if (unit === 10) return 1
    if (unit !== 13) return 0
    return source.charCodeAt(offset + 1) === 10 ? 2 : 1
  }
  let paragraph = 0
  let paragraphHasContent = false
  let lineHasContent = false
  let word = 0
  let character = 0
  let insideWord = false
  let offset = 0
  let reportedOffset = 0
  while (offset < source.length) {
    const lineEndingLength = lineEndingLengthAt(offset)
    if (lineEndingLength > 0) {
      if (!lineHasContent && paragraphHasContent) {
        paragraph += 1
        paragraphHasContent = false
      }
      lineHasContent = false
      insideWord = false
      offset += lineEndingLength
      if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
        execution?.examineSource(offset - reportedOffset)
        reportedOffset = offset
      }
      continue
    }

    const first = source.charCodeAt(offset)
    if (first <= 0x7f) {
      if (first !== 9 && first !== 32) {
        lineHasContent = true
      }
      if (!isAsciiWhitespace(first)) {
        paragraphHasContent = true
        character += 1
      }
      if (isAsciiWord(first)) {
        if (!insideWord) word += 1
        insideWord = true
      } else {
        insideWord = false
      }
      offset += 1
      if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
        execution?.examineSource(offset - reportedOffset)
        reportedOffset = offset
      }
      continue
    }
    const scalarUnits =
      first >= 0xd800 &&
      first <= 0xdbff &&
      offset + 1 < source.length &&
      source.charCodeAt(offset + 1) >= 0xdc00 &&
      source.charCodeAt(offset + 1) <= 0xdfff
        ? 2
        : 1
    const scalar = source.slice(offset, offset + scalarUnits)
    // Profile 1 blank-line recognition admits only space and tab. Other
    // Unicode whitespace does not terminate the surrounding paragraph.
    lineHasContent = true
    if (!WHITESPACE_SCALAR.test(scalar)) {
      paragraphHasContent = true
      character += 1
    }
    if (HAN_SCALAR.test(scalar)) {
      word += 1
      insideWord = false
    } else if (WORD_SCALAR.test(scalar)) {
      if (!insideWord) word += 1
      insideWord = true
    } else {
      insideWord = false
    }
    offset += scalarUnits
    if (offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
      execution?.examineSource(offset - reportedOffset)
      reportedOffset = offset
    }
  }
  execution?.examineSource(offset - reportedOffset)
  return Object.freeze({
    word,
    paragraph: paragraph + (paragraphHasContent ? 1 : 0),
    character,
    all: source.length
  })
}

/**
 * Derive product metadata from the parser-owned revision.
 *
 * Complete documents use the emitted editing meaning tree, so Markdown
 * delimiters, Comment payloads, and marker-looking text in code cannot become
 * prose or a filename heading. SourceOnly has no semantic tree; it reports
 * explicit exact-source statistics and deliberately has no inferred title.
 */
export function materializeDocumentFacts(
  revision: DocumentRevision,
  executionControl?: ParseExecutionControl
): DocumentFacts {
  const cached = cachedFacts.get(revision)
  if (cached !== undefined) {
    return cached
  }
  const execution = createParseExecutionTracker(executionControl)
  const facts = revision.kind === 'complete'
    ? completeFacts(revision, execution)
    : Object.freeze({
      kind: 'document-facts' as const,
      recommendedTitle: null,
      statistics: sourceOnlyStatistics(revision.source.text, execution)
    })
  execution.finish()
  cachedFacts.set(revision, facts)
  return facts
}

/**
 * Record the engine's structural proof that canonical source and semantic
 * editing text are the same single plain paragraph. This avoids reparsing or
 * re-materializing maximum source merely to compute its exact facts.
 */
export function certifySimpleTextDocumentFacts(
  revision: Extract<DocumentRevision, { kind: 'complete' }>
): void {
  certifiedSimpleTextFacts.add(revision)
}

/**
 * Seed the exact facts implied by the engine's nonempty simple-text
 * certificate. Its accepted alphabet is one ASCII-alphanumeric word, with a
 * terminal period only on a letter-led word so it cannot become a list marker.
 * Every statistic therefore follows from source length.
 */
export function cacheCertifiedSimpleTextDocumentFacts(
  revision: Extract<DocumentRevision, { kind: 'complete' }>
): void {
  certifiedSimpleTextFacts.add(revision)
  cachedFacts.set(revision, Object.freeze({
    kind: 'document-facts',
    recommendedTitle: null,
    statistics: Object.freeze({
      word: 1,
      paragraph: 1,
      character: revision.source.text.length,
      all: revision.source.text.length
    })
  }))
}
