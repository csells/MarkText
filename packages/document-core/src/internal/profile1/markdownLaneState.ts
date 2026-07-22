import {
  composeMarkdownLiteralRanges,
  type MarkdownContainerDepthFailure,
  type MarkdownLiteralRange
} from './markdownTypes.js'
import {
  findAutolinkEnd,
  findInlineHtmlEnd,
  findInlineLinkDestinationEnd,
  hasEvenBackslashRunBefore
} from './markdownLexical.js'
import {
  findMarkdownFenceOpening,
  isMarkdownFenceCloser
} from './markdownFence.js'

interface MarkdownLinePath {
  readonly parent: MarkdownLinePath | undefined
  readonly text: string
  readonly sourceStart: number
}

interface MarkdownBlockContainer {
  readonly path: readonly ActiveBlockContainer[]
}

interface MarkdownInlineCodeState {
  readonly openStart: number
  readonly markerLength: number
  readonly closeStart: number
}

interface MarkdownMathState {
  readonly openStart: number
  readonly delimiterLength: number
  readonly closeStart: number
}

interface MarkdownFenceState {
  readonly openStart: number
  readonly openLineStart: number
  readonly markerCodeUnit: number
  readonly openerLength: number
  readonly provider: 'fenced-code' | 'math' | 'diagram'
  readonly container: MarkdownBlockContainer
}

interface MarkdownFrontMatterState {
  readonly openStart: number
  readonly openLineStart: number
}

interface MarkdownIndentedCodeState {
  readonly openStart: number
  readonly lastCodeEnd: number
}

interface MarkdownHtmlBlockState {
  readonly openStart: number
  readonly terminator: string | undefined
  readonly lastOwnedEnd: number
  readonly container: MarkdownBlockContainer
}

interface MarkdownDefinitionState {
  readonly openStart: number
  readonly lastOwnedEnd: number
  readonly lineStart: number
  readonly phase:
    | 'reference-destination'
    | 'reference'
    | 'reference-title'
    | 'footnote'
}

interface MarkdownBracketPath {
  readonly parent: MarkdownBracketPath | undefined
  readonly kind: 'link' | 'image'
  readonly start: number
  readonly labelStart: number
}

interface MarkdownPendingLinkLabel {
  readonly kind: 'link' | 'image'
  readonly start: number
  readonly labelStart: number
  readonly labelEnd: number
  readonly normalizedLabel: string
}

interface MarkdownFixedInlineState {
  readonly kind: 'link-destination' | 'inline-html' | 'autolink'
  readonly openStart: number
  readonly closeEnd: number
  readonly linkLabel?: MarkdownPendingLinkLabel
}

interface MarkdownPendingCarriageReturn {
  readonly sourceStart: number
  readonly sourceEnd: number
}

export interface MarkdownCheckpoint {
  readonly linePath: MarkdownLinePath | undefined
  readonly inlineCode: MarkdownInlineCodeState | undefined
  readonly math: MarkdownMathState | undefined
  readonly bracketPath: MarkdownBracketPath | undefined
  readonly pendingLinkLabel: MarkdownPendingLinkLabel | undefined
  readonly fixedInline: MarkdownFixedInlineState | undefined
  readonly activeContainers: readonly ActiveBlockContainer[]
  readonly paragraphOpen: boolean
  readonly lastLineLazy: boolean
  readonly lineStart: number
  readonly fence: MarkdownFenceState | undefined
  readonly lineBlockClosed: boolean
  readonly trailingBackslashOdd: boolean
  readonly frontMatterEligible: boolean
  readonly frontMatter: MarkdownFrontMatterState | undefined
  readonly indentedCode: MarkdownIndentedCodeState | undefined
  readonly htmlBlock: MarkdownHtmlBlockState | undefined
  readonly definition: MarkdownDefinitionState | undefined
  readonly pendingCarriageReturn: MarkdownPendingCarriageReturn | undefined
  readonly firstContainerDepthFailure: MarkdownContainerDepthFailure | undefined
  readonly atVirtualBof: boolean
}

export interface MarkdownLaneAdvance {
  readonly checkpoint: MarkdownCheckpoint
  readonly completedLiterals: readonly MarkdownLiteralRange[]
}

export interface MarkdownLaneState {
  readonly emptyCheckpoint: MarkdownCheckpoint
  readonly advance: (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    laneStart: number,
    laneEnd: number,
    boundaryEnd: number
  ) => MarkdownLaneAdvance
  readonly forkArm: (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    isolated: boolean
  ) => MarkdownCheckpoint
  readonly markerIsProtected: (checkpoint: MarkdownCheckpoint) => boolean
  readonly markerIsLiteralOwned: (checkpoint: MarkdownCheckpoint) => boolean
  readonly rejoinCarrier: (
    continuation: MarkdownCheckpoint,
    armStart: MarkdownCheckpoint,
    armEnd: MarkdownCheckpoint,
    isolated: boolean,
    atDocumentRoot: boolean
  ) => MarkdownCheckpoint
  readonly finishLane: (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ) => MarkdownLaneAdvance
  readonly releaseAtBoundary: (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ) => MarkdownLaneAdvance
  readonly prepareForMarker: (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    laneEnd: number
  ) => MarkdownLaneAdvance
  readonly containerDepthFailure: (
    checkpoint: MarkdownCheckpoint
  ) => MarkdownContainerDepthFailure | undefined
}

export interface MarkdownReferenceDefinitionLookup {
  readonly has: (
    normalizedLabel: string,
    sourceOffset: number
  ) => boolean
}

export interface PlainMarkdownLaneParse {
  readonly literals: readonly MarkdownLiteralRange[]
  readonly containerDepthFailure: MarkdownContainerDepthFailure | undefined
  readonly lines: readonly PlainMarkdownLine[]
}

export interface PlainMarkdownLine {
  readonly start: number
  readonly contentEnd: number
  readonly end: number
  readonly blank: boolean
  readonly contentOffset: number
  readonly indentation: number
  readonly blockQuoteDepth: number
  readonly listDepth: number
  readonly listMarkers: readonly PlainMarkdownListMarker[]
  /** Parser-owned outermost-to-innermost block-container path for this line. */
  readonly containers: readonly PlainMarkdownContainer[]
}

export type PlainMarkdownContainer =
  | Readonly<{
    readonly kind: 'blockquote'
    readonly continued: boolean
    readonly start: number
    readonly end: number
  }>
  | Readonly<{
    readonly kind: 'list-item'
    readonly continued: boolean
    readonly start: number
    readonly end: number
    readonly ordered: boolean
    readonly startNumber: number
    readonly delimiterCodeUnit: number
    readonly contentOffset: number
  }>

export interface PlainMarkdownListMarker {
  readonly start: number
  readonly end: number
  readonly ordered: boolean
  readonly startNumber: number
  readonly contentOffset: number
}

type NextBacktickRunStart = (
  markerLength: number,
  after: number,
  laneEnd: number
) => number | undefined

type NextMathRunStart = (
  delimiterLength: number,
  after: number,
  laneEnd: number
) => number | undefined

const EMPTY_MARKDOWN_CHECKPOINT: MarkdownCheckpoint = Object.freeze({
  linePath: undefined,
  inlineCode: undefined,
  math: undefined,
  bracketPath: undefined,
  pendingLinkLabel: undefined,
  fixedInline: undefined,
  activeContainers: Object.freeze([]),
  paragraphOpen: false,
  lastLineLazy: false,
  lineStart: 0,
  fence: undefined,
  lineBlockClosed: false,
  trailingBackslashOdd: false,
  frontMatterEligible: true,
  frontMatter: undefined,
  indentedCode: undefined,
  htmlBlock: undefined,
  definition: undefined,
  pendingCarriageReturn: undefined,
  firstContainerDepthFailure: undefined,
  atVirtualBof: true
})

const EMPTY_REFERENCE_DEFINITIONS: MarkdownReferenceDefinitionLookup =
  Object.freeze({
    has: Object.freeze((): boolean => false)
  })

const materializedLinePaths = new WeakMap<MarkdownLinePath, string>()

interface SourceLine {
  readonly start: number
  readonly contentEnd: number
  readonly end: number
}

interface ActiveBlockquoteContainer {
  readonly kind: 'blockquote'
}

interface ActiveListContainer {
  readonly kind: 'list-item'
  /** CommonMark W + N indentation relative to the containing block. */
  readonly contentIndent: number
  readonly ordered: boolean
  readonly startNumber: number
  readonly delimiterCodeUnit: number
}

type ActiveBlockContainer = ActiveBlockquoteContainer | ActiveListContainer

interface ListMarker {
  readonly start: number
  readonly end: number
  readonly ordered: boolean
  readonly startNumber: number
  readonly delimiterCodeUnit: number
}

interface ContainerLineState {
  readonly activeContainers: readonly ActiveBlockContainer[]
  readonly continuedContainerDepth: number
  readonly blockQuoteDepth: number
  readonly blank: boolean
  readonly indentation: number
  readonly contentOffset: number
  readonly containerBaseColumn: number
  readonly openers: readonly MarkdownContainerOpener[]
  readonly lazy: boolean
}

interface MarkdownContainerOpener {
  readonly kind: 'blockquote' | 'list-item'
  readonly start: number
  readonly end: number
  readonly observed: number
  readonly ordered?: boolean
  readonly startNumber?: number
  readonly delimiterCodeUnit?: number
  readonly contentOffset?: number
}

function isSpaceOrTab(codeUnit: number): boolean {
  return codeUnit === 32 || codeUnit === 9
}

function advanceColumn(column: number, codeUnit: number): number {
  return codeUnit === 9 ? column + (4 - (column % 4)) : column + 1
}

function isThematicBreakFrom(source: string, start: number, end: number): boolean {
  const marker = source.charCodeAt(start)
  if (marker !== 42 && marker !== 45 && marker !== 95) {
    return false
  }
  let markerCount = 0
  for (let offset = start; offset < end; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === marker) {
      markerCount += 1
    } else if (!isSpaceOrTab(codeUnit)) {
      return false
    }
  }
  return markerCount >= 3
}

function isAtxHeadingLine(source: string, state: ContainerLineState): boolean {
  if (
    state.blank ||
    state.indentation > 3 ||
    source.charCodeAt(state.contentOffset) !== 35
  ) {
    return false
  }
  let offset = state.contentOffset
  while (offset < source.length && source.charCodeAt(offset) === 35) {
    offset += 1
  }
  const level = offset - state.contentOffset
  return level <= 6 &&
    (offset === source.length || isSpaceOrTab(source.charCodeAt(offset)))
}

function findListMarker(
  source: string,
  offset: number,
  contentEnd: number
): ListMarker | undefined {
  const first = source.charCodeAt(offset)
  let markerEnd = offset
  if (first === 42 || first === 43 || first === 45) {
    markerEnd += 1
    if (markerEnd < contentEnd && !isSpaceOrTab(source.charCodeAt(markerEnd))) {
      return undefined
    }
    return Object.freeze({
      start: offset,
      end: markerEnd,
      ordered: false,
      startNumber: 1,
      delimiterCodeUnit: first
    })
  } else if (first >= 48 && first <= 57) {
    let digits = 0
    let startNumber = 0
    while (
      markerEnd < contentEnd &&
      source.charCodeAt(markerEnd) >= 48 &&
      source.charCodeAt(markerEnd) <= 57 &&
      digits < 9
    ) {
      startNumber = startNumber * 10 + source.charCodeAt(markerEnd) - 48
      markerEnd += 1
      digits += 1
    }
    if (
      digits === 0 ||
      (source.charCodeAt(markerEnd) !== 46 && source.charCodeAt(markerEnd) !== 41)
    ) {
      return undefined
    }
    markerEnd += 1
    if (markerEnd < contentEnd && !isSpaceOrTab(source.charCodeAt(markerEnd))) {
      return undefined
    }
    return Object.freeze({
      start: offset,
      end: markerEnd,
      ordered: true,
      startNumber,
      delimiterCodeUnit: source.charCodeAt(markerEnd - 1)
    })
  } else {
    return undefined
  }
}

function consumeListPadding(
  source: string,
  markerEnd: number,
  contentEnd: number,
  markerEndColumn: number
): Readonly<{ offset: number; column: number }> {
  if (markerEnd >= contentEnd) {
    return Object.freeze({ offset: markerEnd, column: markerEndColumn + 1 })
  }
  let paddingEnd = markerEnd
  let paddingColumn = markerEndColumn
  while (paddingEnd < contentEnd && isSpaceOrTab(source.charCodeAt(paddingEnd))) {
    paddingColumn = advanceColumn(paddingColumn, source.charCodeAt(paddingEnd))
    paddingEnd += 1
  }
  if (paddingColumn - markerEndColumn <= 4) {
    return Object.freeze({ offset: paddingEnd, column: paddingColumn })
  }
  return Object.freeze({
    offset: markerEnd + 1,
    column: advanceColumn(markerEndColumn, source.charCodeAt(markerEnd))
  })
}

function analyzeContainerLine(
  source: string,
  line: SourceLine,
  inheritedContainers: readonly ActiveBlockContainer[],
  paragraphOpen: boolean,
  previousLineLazy: boolean
): ContainerLineState {
  let offset = line.start
  let column = 0
  if (offset === 0 && source.charCodeAt(offset) === 0xfeff) {
    offset += 1
  }

  // CommonMark phase 1 matches existing containers in their source order.
  // List indentation is relative to its parent container, so flattening lists
  // and block quotes into separate counters cannot represent `> -` and `- >`.
  const activeContainers: ActiveBlockContainer[] = []
  let containerBaseColumn = column
  for (const inherited of inheritedContainers) {
    if (inherited.kind === 'blockquote') {
      while (
        offset < line.contentEnd &&
        isSpaceOrTab(source.charCodeAt(offset))
      ) {
        const nextColumn = advanceColumn(column, source.charCodeAt(offset))
        if (nextColumn - containerBaseColumn > 3) {
          break
        }
        column = nextColumn
        offset += 1
      }
      if (source.charCodeAt(offset) !== 62) {
        break
      }
      column += 1
      offset += 1
      if (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
    } else {
      const targetColumn = column + inherited.contentIndent
      while (
        offset < line.contentEnd &&
        isSpaceOrTab(source.charCodeAt(offset)) &&
        column < targetColumn
      ) {
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
      if (column < targetColumn) {
        // Empty lines need not carry list-item indentation. Retain only this
        // list prefix; a following blockquote still has to match explicitly.
        let blankOffset = offset
        while (
          blankOffset < line.contentEnd &&
          isSpaceOrTab(source.charCodeAt(blankOffset))
        ) {
          blankOffset += 1
        }
        if (blankOffset !== line.contentEnd) {
          break
        }
      }
    }
    activeContainers.push(inherited)
    containerBaseColumn = column
  }

  const inheritedMatchDepth = activeContainers.length
  const openers: MarkdownContainerOpener[] = []
  while (offset < line.contentEnd) {
    while (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
      const nextColumn = advanceColumn(column, source.charCodeAt(offset))
      if (nextColumn - containerBaseColumn > 3) {
        break
      }
      column = nextColumn
      offset += 1
    }

    if (source.charCodeAt(offset) === 62) {
      const markerStart = offset
      const container: ActiveBlockquoteContainer = Object.freeze({
        kind: 'blockquote'
      })
      activeContainers.push(container)
      openers.push(Object.freeze({
        kind: 'blockquote',
        start: markerStart,
        end: markerStart + 1,
        observed: activeContainers.length
      }))
      column += 1
      offset += 1
      if (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
      containerBaseColumn = column
      continue
    }

    if (isThematicBreakFrom(source, offset, line.contentEnd)) {
      break
    }
    const listMarker = findListMarker(source, offset, line.contentEnd)
    if (
      listMarker === undefined ||
      (
        paragraphOpen &&
        !inheritedContainers.some((container) => container.kind === 'list-item') &&
        listMarker.ordered &&
        listMarker.startNumber !== 1
      )
    ) {
      break
    }
    const markerStartColumn = column
    while (offset < listMarker.end) {
      column = advanceColumn(column, source.charCodeAt(offset))
      offset += 1
    }
    const padding = consumeListPadding(source, offset, line.contentEnd, column)
    offset = padding.offset
    column = padding.column
    containerBaseColumn = column
    const container: ActiveListContainer = Object.freeze({
      kind: 'list-item',
      contentIndent: column - markerStartColumn,
      ordered: listMarker.ordered,
      startNumber: listMarker.startNumber,
      delimiterCodeUnit: listMarker.delimiterCodeUnit
    })
    activeContainers.push(container)
    openers.push(Object.freeze({
      kind: 'list-item',
      start: listMarker.start,
      end: listMarker.end,
      observed: activeContainers.length,
      ordered: listMarker.ordered,
      startNumber: listMarker.startNumber,
      delimiterCodeUnit: listMarker.delimiterCodeUnit,
      contentOffset: offset
    }))
  }

  let contentColumn = column
  let contentOffset = offset
  while (
    contentOffset < line.contentEnd &&
    isSpaceOrTab(source.charCodeAt(contentOffset))
  ) {
    contentColumn = advanceColumn(contentColumn, source.charCodeAt(contentOffset))
    contentOffset += 1
  }
  const provisionalState: ContainerLineState = Object.freeze({
    activeContainers: Object.freeze(activeContainers),
    continuedContainerDepth: inheritedMatchDepth,
    blockQuoteDepth: activeContainers.reduce(
      (depth, container) => depth + (container.kind === 'blockquote' ? 1 : 0),
      0
    ),
    blank: contentOffset === line.contentEnd,
    indentation: contentColumn - containerBaseColumn,
    contentOffset,
    containerBaseColumn,
    openers: Object.freeze(openers),
    lazy: false
  })
  if (
    paragraphOpen &&
    inheritedMatchDepth < inheritedContainers.length &&
    isLazyParagraphContinuation(source, provisionalState, previousLineLazy)
  ) {
    return Object.freeze({
      ...provisionalState,
      activeContainers: Object.freeze([...inheritedContainers]),
      continuedContainerDepth: inheritedContainers.length,
      blockQuoteDepth: inheritedContainers.reduce(
        (depth, container) =>
          depth + (container.kind === 'blockquote' ? 1 : 0),
        0
      ),
      lazy: true
    })
  }
  return provisionalState
}

const RAW_HTML_BLOCK_TAGS = Object.freeze([
  'script',
  'pre',
  'style',
  'textarea'
] as const)
const RAW_HTML_END_TERMINATOR = 'raw-html-end-tag'
const RAW_HTML_END_TAG = /<\/(?:script|pre|style|textarea)>/i
const BLANK_TERMINATED_HTML_TAG =
  /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\t >]|\/>|$)/i

interface HtmlBlockOpening {
  readonly terminator: string | undefined
}

function htmlBlockOpening(
  lineText: string,
  state: ContainerLineState,
  paragraphOpen: boolean
): HtmlBlockOpening | undefined {
  if (
    state.blank ||
    state.indentation > 3 ||
    lineText.charCodeAt(state.contentOffset) !== 60
  ) {
    return undefined
  }
  const candidate = lineText.slice(state.contentOffset)
  const lowerCandidate = candidate.toLowerCase()
  for (const tag of RAW_HTML_BLOCK_TAGS) {
    if (
      lowerCandidate.startsWith(`<${tag}`) &&
      [' ', '\t', '>', ''].includes(lowerCandidate[tag.length + 1] ?? '')
    ) {
      return Object.freeze({ terminator: RAW_HTML_END_TERMINATOR })
    }
  }
  if (lowerCandidate.startsWith('<!--')) {
    return Object.freeze({ terminator: '-->' })
  }
  if (lowerCandidate.startsWith('<?')) {
    return Object.freeze({ terminator: '?>' })
  }
  if (candidate.startsWith('<![CDATA[')) {
    return Object.freeze({ terminator: ']]>' })
  }
  if (
    candidate.startsWith('<!') &&
    ((candidate.charCodeAt(2) >= 65 && candidate.charCodeAt(2) <= 90) ||
      (candidate.charCodeAt(2) >= 97 && candidate.charCodeAt(2) <= 122))
  ) {
    return Object.freeze({ terminator: '>' })
  }
  if (BLANK_TERMINATED_HTML_TAG.test(candidate)) {
    return Object.freeze({ terminator: undefined })
  }
  if (paragraphOpen) {
    return undefined
  }
  const tagEnd = findInlineHtmlEnd(
    lineText,
    state.contentOffset,
    lineText.length
  )
  if (tagEnd === undefined) {
    return undefined
  }
  for (let offset = tagEnd; offset < lineText.length; offset += 1) {
    if (!isSpaceOrTab(lineText.charCodeAt(offset))) {
      return undefined
    }
  }
  return Object.freeze({ terminator: undefined })
}

function isSetextUnderline(
  source: string,
  start: number,
  end: number
): boolean {
  const marker = source.charCodeAt(start)
  if (marker !== 45 && marker !== 61) {
    return false
  }
  let offset = start
  while (offset < end && source.charCodeAt(offset) === marker) {
    offset += 1
  }
  while (offset < end && isSpaceOrTab(source.charCodeAt(offset))) {
    offset += 1
  }
  return offset === end
}

function isLazyParagraphContinuation(
  source: string,
  state: ContainerLineState,
  previousLineLazy: boolean
): boolean {
  if (
    state.blank ||
    state.openers.length > 0 ||
    isAtxHeadingLine(source, state) ||
    isThematicBreakFrom(source, state.contentOffset, source.length) ||
    (
      !previousLineLazy &&
      isSetextUnderline(source, state.contentOffset, source.length)
    ) ||
    findMarkdownFenceOpening(
      source,
      state.contentOffset,
      state.indentation,
      state.blank
    ) !== undefined
  ) {
    return false
  }
  return htmlBlockOpening(source, state, true) === undefined
}

function htmlBlockTerminatedOnLine(
  lineText: string,
  htmlBlock: MarkdownHtmlBlockState
): boolean {
  return htmlBlock.terminator === RAW_HTML_END_TERMINATOR
    ? RAW_HTML_END_TAG.test(lineText)
    : htmlBlock.terminator !== undefined && lineText.includes(htmlBlock.terminator)
}

function isAsciiPunctuation(codeUnit: number): boolean {
  return (
    (codeUnit >= 33 && codeUnit <= 47) ||
    (codeUnit >= 58 && codeUnit <= 64) ||
    (codeUnit >= 91 && codeUnit <= 96) ||
    (codeUnit >= 123 && codeUnit <= 126)
  )
}

function decodeReferenceEntity(
  source: string,
  start: number,
  end: number
): Readonly<{ value: string; end: number }> | undefined {
  const semicolon = source.indexOf(';', start + 1)
  if (semicolon < 0 || semicolon >= end || semicolon - start > 32) {
    return undefined
  }
  const body = source.slice(start + 1, semicolon)
  const named: Readonly<Record<string, string>> = Object.freeze({
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"'
  })
  const namedValue = named[body]
  if (namedValue !== undefined) {
    return Object.freeze({ value: namedValue, end: semicolon + 1 })
  }
  const numeric = body.startsWith('#x') || body.startsWith('#X')
    ? Number.parseInt(body.slice(2), 16)
    : body.startsWith('#')
      ? Number.parseInt(body.slice(1), 10)
      : Number.NaN
  if (
    !Number.isInteger(numeric) ||
    numeric <= 0 ||
    numeric > 0x10ffff ||
    (numeric >= 0xd800 && numeric <= 0xdfff)
  ) {
    return undefined
  }
  return Object.freeze({
    value: String.fromCodePoint(numeric),
    end: semicolon + 1
  })
}

export function normalizeMarkdownReferenceLabel(
  source: string,
  start: number,
  end: number
): string {
  let normalized = ''
  let pendingWhitespace = false
  for (let offset = start; offset < end;) {
    const codeUnit = source.charCodeAt(offset)
    if (
      codeUnit === 92 &&
      offset + 1 < end &&
      isAsciiPunctuation(source.charCodeAt(offset + 1))
    ) {
      if (pendingWhitespace && normalized.length > 0) {
        normalized += ' '
      }
      pendingWhitespace = false
      normalized += source[offset + 1]
      offset += 2
      continue
    }
    if (codeUnit === 38) {
      const entity = decodeReferenceEntity(source, offset, end)
      if (entity !== undefined) {
        if (pendingWhitespace && normalized.length > 0) {
          normalized += ' '
        }
        pendingWhitespace = false
        normalized += entity.value
        offset = entity.end
        continue
      }
    }
    if (isMarkdownWhitespace(codeUnit)) {
      pendingWhitespace = normalized.length > 0
      offset += 1
      continue
    }
    if (pendingWhitespace && normalized.length > 0) {
      normalized += ' '
    }
    pendingWhitespace = false
    const codePoint = source.codePointAt(offset)
    if (codePoint === undefined) {
      break
    }
    normalized += String.fromCodePoint(codePoint).toLowerCase()
    offset += codePoint > 0xffff ? 2 : 1
  }
  return normalized
}

export function markdownReferenceDefinitionLabel(
  source: string,
  start: number,
  end: number
): string | undefined {
  let offset = start
  while (offset < end) {
    const lineEndCandidates = [source.indexOf('\n', offset), source.indexOf('\r', offset)]
      .filter((candidate) => candidate >= 0 && candidate < end)
    const lineEnd = lineEndCandidates.length === 0
      ? end
      : Math.min(...lineEndCandidates)
    for (let opener = offset; opener < lineEnd; opener += 1) {
      if (
        source.charCodeAt(opener) !== 91 ||
        source.charCodeAt(opener + 1) === 94 ||
        !hasEvenBackslashRunBefore(source, opener)
      ) {
        continue
      }
      for (let closer = opener + 1; closer + 1 < lineEnd; closer += 1) {
        const codeUnit = source.charCodeAt(closer)
        if (codeUnit === 92 && closer + 1 < lineEnd) {
          closer += 1
          continue
        }
        if (codeUnit === 91) {
          break
        }
        if (codeUnit !== 93 || source.charCodeAt(closer + 1) !== 58) {
          continue
        }
        const label = normalizeMarkdownReferenceLabel(source, opener + 1, closer)
        return label.length === 0 || closer - opener - 1 > 999
          ? undefined
          : label
      }
    }
    offset = lineEnd + 1
  }
  return undefined
}

function referenceLabelSuffix(
  source: string,
  start: number,
  laneEnd: number
): Readonly<{ labelStart: number; labelEnd: number; end: number }> | undefined {
  if (source.charCodeAt(start) !== 91) {
    return undefined
  }
  let contentLength = 0
  for (let offset = start + 1; offset < laneEnd; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < laneEnd) {
      contentLength += 1
      offset += 1
      continue
    }
    if (codeUnit === 91) {
      return undefined
    }
    if (codeUnit === 93) {
      return contentLength <= 999
        ? Object.freeze({ labelStart: start + 1, labelEnd: offset, end: offset + 1 })
        : undefined
    }
    contentLength += 1
  }
  return undefined
}

function definitionColonInLine(
  lineText: string,
  state: ContainerLineState
): number | undefined {
  const start = state.contentOffset
  if (state.indentation > 3 || lineText.charCodeAt(start) !== 91) {
    return undefined
  }
  const labelStart = lineText.charCodeAt(start + 1) === 94 ? start + 2 : start + 1
  let hasLabelContent = false
  for (let offset = labelStart; offset + 1 < lineText.length; offset += 1) {
    if (lineText.charCodeAt(offset) === 92) {
      if (offset + 1 < lineText.length) {
        hasLabelContent = true
      }
      offset += 1
      continue
    }
    if (lineText.charCodeAt(offset) === 91) {
      return undefined
    }
    if (
      lineText.charCodeAt(offset) === 93 &&
      lineText.charCodeAt(offset + 1) === 58
    ) {
      const labelLength = offset - labelStart
      return hasLabelContent && labelLength <= 999 ? offset + 1 : undefined
    }
    if (!isMarkdownWhitespace(lineText.charCodeAt(offset))) {
      hasLabelContent = true
    }
  }
  return undefined
}

function referenceDefinitionTailInLine(
  lineText: string,
  start: number
): 'destination' | 'destination-title' | undefined {
  const end = lineText.length
  let offset = start
  while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
    offset += 1
  }
  if (offset >= end) {
    return undefined
  }
  if (lineText.charCodeAt(offset) === 60) {
    offset += 1
    let closed = false
    while (offset < end) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 60 || codeUnit === 10 || codeUnit === 13) {
        return undefined
      }
      if (codeUnit === 62) {
        offset += 1
        closed = true
        break
      }
      offset += 1
    }
    if (!closed) {
      return undefined
    }
  } else {
    const destinationStart = offset
    let depth = 0
    while (offset < end) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 40) {
        depth += 1
        if (depth > 32) {
          return undefined
        }
      } else if (codeUnit === 41) {
        if (depth === 0) {
          break
        }
        depth -= 1
      } else if (codeUnit <= 32 || codeUnit === 127) {
        break
      }
      offset += 1
    }
    if (offset === destinationStart || depth !== 0) {
      return undefined
    }
  }
  const destinationEnd = offset
  while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
    offset += 1
  }
  if (offset === end) {
    return 'destination'
  }
  if (offset === destinationEnd) {
    return undefined
  }
  const titleOpen = lineText.charCodeAt(offset)
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return undefined
  }
  offset += 1
  while (offset < end) {
    const codeUnit = lineText.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < end) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      offset += 1
      while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
        offset += 1
      }
      return offset === end ? 'destination-title' : undefined
    }
    offset += 1
  }
  return undefined
}

function definitionOpening(
  lineText: string,
  state: ContainerLineState
): MarkdownDefinitionState['phase'] | undefined {
  const colon = definitionColonInLine(lineText, state)
  if (colon === undefined) {
    return undefined
  }
  const isFootnote = lineText.charCodeAt(state.contentOffset + 1) === 94
  if (isFootnote) {
    return 'footnote'
  }
  let tailStart = colon + 1
  while (tailStart < lineText.length && isSpaceOrTab(lineText.charCodeAt(tailStart))) {
    tailStart += 1
  }
  if (tailStart === lineText.length) {
    return 'reference-destination'
  }
  return referenceDefinitionTailInLine(lineText, colon + 1) === undefined
    ? undefined
    : 'reference'
}

function isValidReferenceTitleLine(
  lineText: string,
  state: ContainerLineState
): boolean {
  let offset = state.contentOffset
  const titleOpen = lineText.charCodeAt(offset)
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return false
  }
  offset += 1
  while (offset < lineText.length) {
    const codeUnit = lineText.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < lineText.length) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      offset += 1
      while (
        offset < lineText.length &&
        isSpaceOrTab(lineText.charCodeAt(offset))
      ) {
        offset += 1
      }
      return offset === lineText.length
    }
    offset += 1
  }
  return false
}

function definitionContinuationPhase(
  lineText: string,
  state: ContainerLineState,
  definition: MarkdownDefinitionState
): MarkdownDefinitionState['phase'] | undefined {
  if (definition.phase === 'footnote') {
    return state.blank || state.indentation >= 2 ? 'footnote' : undefined
  }
  if (definition.phase === 'reference-destination') {
    const tail = referenceDefinitionTailInLine(lineText, state.contentOffset)
    return tail === 'destination-title'
      ? 'reference-title'
      : tail === 'destination'
        ? 'reference'
        : undefined
  }
  return isValidReferenceTitleLine(lineText, state)
    ? 'reference-title'
    : undefined
}

function completedDefinitionLiteral(
  definition: MarkdownDefinitionState,
  end: number
): MarkdownLiteralRange {
  return Object.freeze({
    kind: 'definition',
    start: definition.openStart,
    end,
    ...(definition.phase === 'footnote'
      ? { blockKind: 'footnote-definition' as const }
      : {})
  })
}

function isFenceCloserLine(
  lineText: string,
  state: ContainerLineState,
  fence: MarkdownFenceState
): boolean {
  if (!continuesBlockContainer(state, fence.container)) {
    return false
  }
  return isMarkdownFenceCloser(
    lineText,
    state.contentOffset,
    state.indentation,
    state.blank,
    fence
  )
}

const DIAGRAM_FENCE_LANGUAGES: ReadonlySet<string> = new Set([
  'flowchart',
  'mermaid',
  'plantuml',
  'sequence',
  'vega-lite'
])

function fencedLiteralProvider(
  lineText: string,
  openerEnd: number
): MarkdownFenceState['provider'] {
  const info = lineText.slice(openerEnd).trim().split(/[\t ]/, 1)[0]?.toLowerCase() ?? ''
  if (info === 'math') {
    return 'math'
  }
  return DIAGRAM_FENCE_LANGUAGES.has(info) ? 'diagram' : 'fenced-code'
}

function blockContainerFrom(state: ContainerLineState): MarkdownBlockContainer {
  return Object.freeze({
    path: Object.freeze([...state.activeContainers])
  })
}

function continuesBlockContainer(
  state: ContainerLineState,
  container: MarkdownBlockContainer
): boolean {
  if (state.continuedContainerDepth < container.path.length) {
    return false
  }
  for (let index = 0; index < container.path.length; index += 1) {
    if (state.activeContainers[index] !== container.path[index]) {
      return false
    }
  }
  return true
}

function createNextBacktickRunStart(source: string): NextBacktickRunStart {
  const startsByLength = new Map<number, number[]>()
  for (let offset = 0; offset < source.length;) {
    if (source.charCodeAt(offset) !== 96) {
      offset += 1
      continue
    }
    let runEnd = offset + 1
    while (runEnd < source.length && source.charCodeAt(runEnd) === 96) {
      runEnd += 1
    }
    const markerLength = runEnd - offset
    const starts = startsByLength.get(markerLength)
    if (starts === undefined) {
      startsByLength.set(markerLength, [offset])
    } else {
      starts.push(offset)
    }
    offset = runEnd
  }

  return (
    markerLength: number,
    after: number,
    laneEnd: number
  ): number | undefined => {
    const starts = startsByLength.get(markerLength) ?? []
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((starts[middle] ?? Number.POSITIVE_INFINITY) < after) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const start = starts[low]
    return start !== undefined && start < laneEnd ? start : undefined
  }
}

function isMarkdownWhitespace(codeUnit: number): boolean {
  return codeUnit === 9 || codeUnit === 10 || codeUnit === 13 || codeUnit === 32
}

function createNextMathRunStart(source: string): NextMathRunStart {
  const startsByLength = new Map<number, number[]>()
  for (let offset = 0; offset < source.length;) {
    if (source.charCodeAt(offset) !== 36) {
      offset += 1
      continue
    }
    let runEnd = offset + 1
    while (runEnd < source.length && source.charCodeAt(runEnd) === 36) {
      runEnd += 1
    }
    const delimiterLength = runEnd - offset
    const canClose =
      hasEvenBackslashRunBefore(source, offset) &&
      (delimiterLength !== 1 ||
        (offset > 0 && !isMarkdownWhitespace(source.charCodeAt(offset - 1))))
    if (canClose) {
      const starts = startsByLength.get(delimiterLength)
      if (starts === undefined) {
        startsByLength.set(delimiterLength, [offset])
      } else {
        starts.push(offset)
      }
    }
    offset = runEnd
  }

  return (
    delimiterLength: number,
    after: number,
    laneEnd: number
  ): number | undefined => {
    const starts = startsByLength.get(delimiterLength) ?? []
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((starts[middle] ?? Number.POSITIVE_INFINITY) < after) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const start = starts[low]
    return start !== undefined && start < laneEnd ? start : undefined
  }
}

function materializeMarkdownLine(path: MarkdownLinePath | undefined): string {
  if (path === undefined) {
    return ''
  }
  const cached = materializedLinePaths.get(path)
  if (cached !== undefined) {
    return cached
  }
  const chunks: string[] = []
  let current: MarkdownLinePath | undefined = path
  while (current !== undefined) {
    chunks.push(current.text)
    current = current.parent
  }
  chunks.reverse()
  const line = chunks.join('')
  materializedLinePaths.set(path, line)
  return line
}

function linePathSourceOffsetAt(
  path: MarkdownLinePath | undefined,
  virtualOffset: number
): number | undefined {
  const chunks: MarkdownLinePath[] = []
  let current = path
  while (current !== undefined) {
    chunks.push(current)
    current = current.parent
  }
  chunks.reverse()
  let remaining = virtualOffset
  for (const chunk of chunks) {
    if (remaining < chunk.text.length) {
      return chunk.sourceStart + remaining
    }
    remaining -= chunk.text.length
  }
  return undefined
}

function probeSourceOffsetAt(
  prefixPath: MarkdownLinePath | undefined,
  prefixLength: number,
  textSourceStart: number,
  textLength: number,
  suffixSourceStart: number,
  virtualOffset: number
): number {
  if (virtualOffset < prefixLength) {
    return linePathSourceOffsetAt(prefixPath, virtualOffset) ?? textSourceStart
  }
  const textOffset = virtualOffset - prefixLength
  return textOffset < textLength
    ? textSourceStart + textOffset
    : suffixSourceStart + textOffset - textLength
}

function sourceLineContentEnd(source: string, start: number, limit: number): number {
  let end = start
  while (
    end < limit &&
    source.charCodeAt(end) !== 10 &&
    source.charCodeAt(end) !== 13
  ) {
    end += 1
  }
  return end
}

function sourceLineEnd(source: string, contentEnd: number, limit: number): number {
  if (contentEnd >= limit) {
    return contentEnd
  }
  if (
    source.charCodeAt(contentEnd) === 13 &&
    contentEnd + 1 < limit &&
    source.charCodeAt(contentEnd + 1) === 10
  ) {
    return contentEnd + 2
  }
  const codeUnit = source.charCodeAt(contentEnd)
  return codeUnit === 10 || codeUnit === 13 ? contentEnd + 1 : contentEnd
}

function trimMarkdownLineWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (
    start < end &&
    (value.charCodeAt(start) === 32 || value.charCodeAt(start) === 9)
  ) {
    start += 1
  }
  while (
    end > start &&
    (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)
  ) {
    end -= 1
  }
  return value.slice(start, end)
}

function isFrontMatterDelimiter(line: string): boolean {
  const delimiter = trimMarkdownLineWhitespace(line)
  return delimiter === '---' || delimiter === '...'
}

function hasEvenLaneBackslashRunBefore(
  source: string,
  offset: number,
  runStart: number,
  inheritedOdd: boolean
): boolean {
  let start = offset
  while (start > runStart && source.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  const localOdd = (offset - start) % 2 === 1
  return start === runStart && inheritedOdd
    ? localOdd
    : !localOdd
}

function trailingBackslashParity(text: string, inheritedOdd: boolean): boolean {
  let start = text.length
  while (start > 0 && text.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  const localOdd = (text.length - start) % 2 === 1
  return start === 0 && inheritedOdd
    ? !localOdd
    : localOdd
}

function hasEvenBackslashRunBeforeText(text: string, offset: number): boolean {
  let start = offset
  while (start > 0 && text.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  return (offset - start) % 2 === 0
}

function retainImageBracketOpeners(
  path: MarkdownBracketPath | undefined
): MarkdownBracketPath | undefined {
  const images: MarkdownBracketPath[] = []
  for (let cursor = path; cursor !== undefined; cursor = cursor.parent) {
    if (cursor.kind === 'image') {
      images.push(cursor)
    }
  }
  let retained: MarkdownBracketPath | undefined
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index]
    if (image !== undefined) {
      retained = Object.freeze({
        parent: retained,
        kind: 'image',
        start: image.start,
        labelStart: image.labelStart
      })
    }
  }
  return retained
}

export function createMarkdownLaneState(
  source: string,
  containerDepthLimit: number = Number.POSITIVE_INFINITY,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS
): MarkdownLaneState {
  const nextBacktickRunStart = createNextBacktickRunStart(source)
  const nextMathRunStart = createNextMathRunStart(source)

  const firstExcessContainer = (
    state: ContainerLineState
  ): MarkdownContainerOpener | undefined =>
    state.openers.find((opener) => opener.observed > containerDepthLimit)

  const advanceCore = (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    laneStart: number,
    laneEnd: number,
    boundaryEnd: number,
    deferTerminalCarriageReturn: boolean
  ): MarkdownLaneAdvance => {
    if (checkpoint.pendingCarriageReturn !== undefined) {
      if (sourceStart < sourceEnd && source.charCodeAt(sourceStart) === 10) {
        checkpoint = Object.freeze({
          ...checkpoint,
          pendingCarriageReturn: undefined
        })
      } else {
        const pending = checkpoint.pendingCarriageReturn
        const completedCarriageReturn = advanceCore(
          Object.freeze({ ...checkpoint, pendingCarriageReturn: undefined }),
          pending.sourceStart,
          pending.sourceEnd,
          laneStart,
          laneEnd,
          boundaryEnd,
          false
        )
        const advanced = advanceCore(
          completedCarriageReturn.checkpoint,
          sourceStart,
          sourceEnd,
          laneStart,
          laneEnd,
          boundaryEnd,
          deferTerminalCarriageReturn
        )
        return Object.freeze({
          checkpoint: advanced.checkpoint,
          completedLiterals: Object.freeze([
            ...completedCarriageReturn.completedLiterals,
            ...advanced.completedLiterals
          ])
        })
      }
    }
    if (
      deferTerminalCarriageReturn &&
      sourceEnd === sourceStart + 1 &&
      source.charCodeAt(sourceStart) === 13
    ) {
      return Object.freeze({
        checkpoint: Object.freeze({
          ...checkpoint,
          trailingBackslashOdd: false,
          pendingCarriageReturn: Object.freeze({ sourceStart, sourceEnd }),
          atVirtualBof: false
        }),
        completedLiterals: Object.freeze([])
      })
    }
    let text = source.slice(sourceStart, sourceEnd)
    let textSourceStart = sourceStart
    if (sourceStart === 0 && text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1)
      textSourceStart += 1
    }
    if (text.length === 0) {
      return Object.freeze({ checkpoint, completedLiterals: Object.freeze([]) })
    }

    const completedLiterals: MarkdownLiteralRange[] = []
    let inlineCode = checkpoint.inlineCode
    let math = checkpoint.math
    let bracketPath = checkpoint.bracketPath
    let pendingLinkLabel = checkpoint.pendingLinkLabel
    let fixedInline = checkpoint.fixedInline
    let activeContainers = checkpoint.activeContainers
    let paragraphOpen = checkpoint.paragraphOpen
    let lastLineLazy = checkpoint.lastLineLazy
    let lineStart = checkpoint.lineStart
    let fence = checkpoint.fence
    let lineBlockClosed = checkpoint.lineBlockClosed
    let frontMatterEligible = checkpoint.frontMatterEligible
    let frontMatter = checkpoint.frontMatter
    let indentedCode = checkpoint.indentedCode
    let htmlBlock = checkpoint.htmlBlock
    let definition = checkpoint.definition
    let firstContainerDepthFailure = checkpoint.firstContainerDepthFailure
    const trailingBackslashOdd = trailingBackslashParity(
      text,
      checkpoint.trailingBackslashOdd
    )
    const containsEol = text.includes('\n') || text.includes('\r')
    if (
      !containsEol &&
      checkpoint.inlineCode === undefined &&
      checkpoint.math === undefined &&
      checkpoint.fixedInline === undefined
    ) {
      const inheritedPrefix = materializeMarkdownLine(checkpoint.linePath)
      const visibleThroughRun = inheritedPrefix + text
      const lookaheadEnd = sourceLineContentEnd(source, sourceEnd, laneEnd)
      const probeLine = visibleThroughRun + source.slice(sourceEnd, lookaheadEnd)
      const probeState = analyzeContainerLine(
        probeLine,
        { start: 0, contentEnd: probeLine.length, end: probeLine.length },
        activeContainers,
        paragraphOpen,
        lastLineLazy
      )
      if (
        fence !== undefined &&
        lineStart !== fence.openLineStart &&
        !continuesBlockContainer(probeState, fence.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: lineStart
        }))
        fence = undefined
      }
      if (
        htmlBlock !== undefined &&
        !continuesBlockContainer(probeState, htmlBlock.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          start: htmlBlock.openStart,
          end: Math.min(htmlBlock.lastOwnedEnd, lineStart)
        }))
        htmlBlock = undefined
      }
      if (
        indentedCode !== undefined &&
        !probeState.blank &&
        probeState.indentation < 4
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'indented-code',
          start: indentedCode.openStart,
          end: indentedCode.lastCodeEnd
        }))
        indentedCode = undefined
      } else if (indentedCode !== undefined && !probeState.blank) {
        indentedCode = Object.freeze({
          ...indentedCode,
          lastCodeEnd: sourceLineEnd(source, lookaheadEnd, laneEnd)
        })
      }
      if (definition !== undefined && definition.lineStart !== lineStart) {
        const continuationPhase = definitionContinuationPhase(
          probeLine,
          probeState,
          definition
        )
        if (continuationPhase === undefined) {
          completedLiterals.push(completedDefinitionLiteral(
            definition,
            definition.lastOwnedEnd
          ))
          definition = undefined
        } else {
          definition = Object.freeze({
            ...definition,
            lineStart,
            phase: continuationPhase,
            lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd)
          })
        }
      }
      if (
        fence === undefined &&
        frontMatter === undefined &&
        indentedCode === undefined &&
        htmlBlock === undefined &&
        definition === undefined
      ) {
        const opening = findMarkdownFenceOpening(
          probeLine,
          probeState.contentOffset,
          probeState.indentation,
          probeState.blank
        )
        if (opening !== undefined) {
          fence = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                inheritedPrefix.length,
                textSourceStart,
                text.length,
                sourceEnd,
                opening.startOffset
              )
            ),
            openLineStart: lineStart,
            markerCodeUnit: opening.markerCodeUnit,
            openerLength: opening.openerLength,
            provider: fencedLiteralProvider(
              probeLine,
              opening.startOffset + opening.openerLength
            ),
            container: blockContainerFrom(probeState)
          })
          activeContainers = probeState.activeContainers
          bracketPath = undefined
          pendingLinkLabel = undefined
        } else if (
          !paragraphOpen &&
          !probeState.blank &&
          probeState.indentation >= 4
        ) {
          indentedCode = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                inheritedPrefix.length,
                textSourceStart,
                text.length,
                sourceEnd,
                0
              )
            ),
            lastCodeEnd: sourceLineEnd(source, lookaheadEnd, laneEnd)
          })
          activeContainers = probeState.activeContainers
          bracketPath = undefined
          pendingLinkLabel = undefined
        } else {
          const htmlOpening = htmlBlockOpening(
            probeLine,
            probeState,
            paragraphOpen
          )
          if (htmlOpening !== undefined) {
            htmlBlock = Object.freeze({
              openStart: Math.max(
                laneStart,
                probeSourceOffsetAt(
                  checkpoint.linePath,
                  inheritedPrefix.length,
                  textSourceStart,
                  text.length,
                  sourceEnd,
                  0
                )
              ),
              terminator: htmlOpening.terminator,
              lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd),
              container: blockContainerFrom(probeState)
            })
            activeContainers = probeState.activeContainers
            bracketPath = undefined
            pendingLinkLabel = undefined
          } else {
            const definitionKind = definitionOpening(probeLine, probeState)
            if (definitionKind !== undefined) {
              definition = Object.freeze({
                openStart: Math.max(
                  laneStart,
                  probeSourceOffsetAt(
                    checkpoint.linePath,
                    inheritedPrefix.length,
                    textSourceStart,
                    text.length,
                    sourceEnd,
                    0
                  )
                ),
                lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd),
                lineStart,
                phase: definitionKind
              })
              activeContainers = probeState.activeContainers
              bracketPath = undefined
              pendingLinkLabel = undefined
            }
          }
        }
      }
    }
    if (
      fence === undefined &&
      frontMatter === undefined &&
      indentedCode === undefined &&
      htmlBlock === undefined &&
      definition === undefined
    ) {
      for (let offset = sourceStart; offset < sourceEnd;) {
        if (fixedInline !== undefined) {
          if (fixedInline.closeEnd > sourceEnd) {
            break
          }
          completedLiterals.push(Object.freeze({
            kind: fixedInline.kind,
            start: fixedInline.openStart,
            end: fixedInline.closeEnd,
            ...(fixedInline.linkLabel === undefined
              ? {}
              : { construct: Object.freeze({ ...fixedInline.linkLabel }) })
          }))
          offset = fixedInline.closeEnd
          fixedInline = undefined
          continue
        }

        if (math !== undefined) {
          if (math.closeStart >= sourceEnd) {
            break
          }
          const closeEnd = math.closeStart + math.delimiterLength
          completedLiterals.push(Object.freeze({
            kind: 'math',
            start: math.openStart,
            end: closeEnd
          }))
          offset = closeEnd
          math = undefined
          continue
        }

        if (inlineCode === undefined && pendingLinkLabel !== undefined) {
          const resolvedLabel = pendingLinkLabel
          pendingLinkLabel = undefined
          if (source.charCodeAt(offset) === 40) {
            const closeEnd = findInlineLinkDestinationEnd(source, offset, laneEnd)
            if (closeEnd !== undefined) {
              fixedInline = Object.freeze({
                kind: 'link-destination',
                openStart: offset,
                closeEnd,
                linkLabel: resolvedLabel
              })
            // Links cannot contain links, but images may contain links and
            // links may contain images. Resolving an image therefore leaves
            // an enclosing link opener active; resolving a link deactivates
            // only earlier link openers while retaining image openers.
              if (resolvedLabel.kind === 'link') {
                bracketPath = retainImageBracketOpeners(bracketPath)
              }
              continue
            }
          }
          const referenceSuffix = referenceLabelSuffix(source, offset, laneEnd)
          if (referenceSuffix !== undefined) {
            const normalizedReference =
            referenceSuffix.labelStart === referenceSuffix.labelEnd
              ? resolvedLabel.normalizedLabel
              : normalizeMarkdownReferenceLabel(
                source,
                referenceSuffix.labelStart,
                referenceSuffix.labelEnd
              )
            if (referenceDefinitions.has(normalizedReference, resolvedLabel.start)) {
              if (resolvedLabel.kind === 'link') {
                bracketPath = retainImageBracketOpeners(bracketPath)
              }
              offset = referenceSuffix.end
              continue
            }
          } else if (
            referenceDefinitions.has(
              resolvedLabel.normalizedLabel,
              resolvedLabel.start
            )
          ) {
            if (resolvedLabel.kind === 'link') {
              bracketPath = retainImageBracketOpeners(bracketPath)
            }
            continue
          }
        }

        if (source.charCodeAt(offset) !== 96) {
          if (
            inlineCode === undefined &&
          hasEvenLaneBackslashRunBefore(
            source,
            offset,
            sourceStart,
            checkpoint.trailingBackslashOdd
          )
          ) {
            if (source.charCodeAt(offset) === 60) {
              const htmlEnd = findInlineHtmlEnd(source, offset, laneEnd)
              const autolinkEnd =
              htmlEnd === undefined
                ? findAutolinkEnd(source, offset, laneEnd)
                : undefined
              const closeEnd = htmlEnd ?? autolinkEnd
              if (closeEnd !== undefined) {
                fixedInline = Object.freeze({
                  kind: htmlEnd === undefined ? 'autolink' : 'inline-html',
                  openStart: offset,
                  closeEnd
                })
                continue
              }
            }
            if (source.charCodeAt(offset) === 36) {
              let runEnd = offset + 1
              while (runEnd < sourceEnd && source.charCodeAt(runEnd) === 36) {
                runEnd += 1
              }
              const delimiterLength = runEnd - offset
              const canOpen =
              delimiterLength !== 1 ||
              (runEnd < source.length &&
                !isMarkdownWhitespace(source.charCodeAt(runEnd)))
              const closeStart = canOpen
                ? nextMathRunStart(delimiterLength, runEnd, laneEnd)
                : undefined
              if (closeStart !== undefined) {
                math = Object.freeze({ openStart: offset, delimiterLength, closeStart })
              }
              offset = runEnd
              continue
            }
            if (source.charCodeAt(offset) === 91) {
              const inheritedLine = materializeMarkdownLine(checkpoint.linePath)
              const previousIsActiveBang =
              offset > sourceStart
                ? source.charCodeAt(offset - 1) === 33 &&
                  hasEvenLaneBackslashRunBefore(
                    source,
                    offset - 1,
                    sourceStart,
                    checkpoint.trailingBackslashOdd
                  )
                : inheritedLine.charCodeAt(inheritedLine.length - 1) === 33 &&
                  hasEvenBackslashRunBeforeText(
                    inheritedLine,
                    inheritedLine.length - 1
                  )
              bracketPath = Object.freeze({
                parent: bracketPath,
                kind: previousIsActiveBang ? 'image' : 'link',
                start: previousIsActiveBang
                  ? offset > sourceStart
                    ? offset - 1
                    : linePathSourceOffsetAt(
                      checkpoint.linePath,
                      inheritedLine.length - 1
                    ) ?? offset
                  : offset,
                labelStart: offset + 1
              })
            } else if (source.charCodeAt(offset) === 93 && bracketPath !== undefined) {
              const label = bracketPath
              bracketPath = bracketPath.parent
              pendingLinkLabel = Object.freeze({
                kind: label.kind,
                start: label.start,
                labelStart: label.labelStart,
                labelEnd: offset,
                normalizedLabel: normalizeMarkdownReferenceLabel(
                  source,
                  label.labelStart,
                  offset
                )
              })
            }
          }
          offset += 1
          continue
        }
        let runEnd = offset + 1
        while (runEnd < sourceEnd && source.charCodeAt(runEnd) === 96) {
          runEnd += 1
        }
        const markerLength = runEnd - offset
        if (
          inlineCode !== undefined &&
        inlineCode.closeStart === offset &&
        inlineCode.markerLength === markerLength
        ) {
          completedLiterals.push(Object.freeze({
            kind: 'inline-code',
            start: inlineCode.openStart,
            end: runEnd
          }))
          inlineCode = undefined
        } else if (
          inlineCode === undefined &&
        hasEvenLaneBackslashRunBefore(
          source,
          offset,
          sourceStart,
          checkpoint.trailingBackslashOdd
        )
        ) {
          const closeStart = nextBacktickRunStart(markerLength, runEnd, laneEnd)
          if (closeStart !== undefined) {
            inlineCode = Object.freeze({ openStart: offset, markerLength, closeStart })
          }
        }
        offset = runEnd
      }
    }

    if (
      fence !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd &&
      lineStart !== fence.openLineStart
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      const boundaryState = analyzeContainerLine(
        boundaryLine,
        { start: 0, contentEnd: boundaryLine.length, end: boundaryLine.length },
        activeContainers,
        paragraphOpen,
        lastLineLazy
      )
      if (isFenceCloserLine(boundaryLine, boundaryState, fence)) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: sourceEnd
        }))
        fence = undefined
        lineBlockClosed = true
      }
    }

    if (
      frontMatter !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      if (isFrontMatterDelimiter(boundaryLine)) {
        completedLiterals.push(Object.freeze({
          kind: 'front-matter',
          start: frontMatter.openStart,
          end: sourceEnd
        }))
        frontMatter = undefined
      }
    }

    if (
      htmlBlock !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      if (htmlBlockTerminatedOnLine(boundaryLine, htmlBlock)) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          start: htmlBlock.openStart,
          end: sourceEnd
        }))
        htmlBlock = undefined
      }
    }

    const lastLineFeed = text.lastIndexOf('\n')
    const lastCarriageReturn = text.lastIndexOf('\r')
    const lastEol = Math.max(lastLineFeed, lastCarriageReturn)
    if (lastEol >= 0) {
      const firstLineFeed = text.indexOf('\n')
      const firstCarriageReturn = text.indexOf('\r')
      const firstEol =
        firstLineFeed < 0
          ? firstCarriageReturn
          : firstCarriageReturn < 0
            ? firstLineFeed
            : Math.min(firstLineFeed, firstCarriageReturn)
      const completedLine =
        materializeMarkdownLine(checkpoint.linePath) + text.slice(0, firstEol)
      const lineState = analyzeContainerLine(
        completedLine,
        { start: 0, contentEnd: completedLine.length, end: completedLine.length },
        activeContainers,
        paragraphOpen,
        lastLineLazy
      )
      if (firstContainerDepthFailure === undefined) {
        const excess = firstExcessContainer(lineState)
        if (excess !== undefined) {
          const prefixLength = materializeMarkdownLine(checkpoint.linePath).length
          const mapOffset = (virtualOffset: number): number =>
            probeSourceOffsetAt(
              checkpoint.linePath,
              prefixLength,
              textSourceStart,
              firstEol,
              textSourceStart + firstEol,
              virtualOffset
            )
          firstContainerDepthFailure = Object.freeze({
            start: mapOffset(excess.start),
            end: mapOffset(excess.end - 1) + 1,
            observed: excess.observed
          })
        }
      }
      if (
        fence !== undefined &&
        lineStart !== fence.openLineStart &&
        !continuesBlockContainer(lineState, fence.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: lineStart
        }))
        fence = undefined
      }
      if (
        htmlBlock !== undefined &&
        !continuesBlockContainer(lineState, htmlBlock.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          start: htmlBlock.openStart,
          end: Math.min(htmlBlock.lastOwnedEnd, lineStart)
        }))
        htmlBlock = undefined
      }
      const lineEnteredWithFence = fence !== undefined
      const lineEnteredWithFrontMatter = frontMatter !== undefined
      let lineOwnedByIndentedCode = false
      if (indentedCode !== undefined) {
        if (!lineState.blank && lineState.indentation >= 4) {
          indentedCode = Object.freeze({
            ...indentedCode,
            lastCodeEnd: sourceEnd
          })
          lineOwnedByIndentedCode = true
        } else if (lineState.blank) {
          lineOwnedByIndentedCode = true
        } else {
          completedLiterals.push(Object.freeze({
            kind: 'indented-code',
            start: indentedCode.openStart,
            end: indentedCode.lastCodeEnd
          }))
          indentedCode = undefined
        }
      }
      let lineOwnedByHtmlBlock = false
      if (htmlBlock !== undefined) {
        if (htmlBlock.terminator !== undefined) {
          lineOwnedByHtmlBlock = true
          if (htmlBlockTerminatedOnLine(completedLine, htmlBlock)) {
            completedLiterals.push(Object.freeze({
              kind: 'html-block',
              start: htmlBlock.openStart,
              end: sourceEnd
            }))
            htmlBlock = undefined
          } else {
            htmlBlock = Object.freeze({
              ...htmlBlock,
              lastOwnedEnd: sourceEnd
            })
          }
        } else if (lineState.blank) {
          completedLiterals.push(Object.freeze({
            kind: 'html-block',
            start: htmlBlock.openStart,
            end: htmlBlock.lastOwnedEnd
          }))
          htmlBlock = undefined
        } else {
          lineOwnedByHtmlBlock = true
          htmlBlock = Object.freeze({
            ...htmlBlock,
            lastOwnedEnd: sourceEnd
          })
        }
      }
      let lineOwnedByDefinition = false
      if (definition !== undefined) {
        if (definition.lineStart !== lineStart) {
          const continuationPhase = definitionContinuationPhase(
            completedLine,
            lineState,
            definition
          )
          if (continuationPhase === undefined) {
            completedLiterals.push(completedDefinitionLiteral(
              definition,
              definition.lastOwnedEnd
            ))
            definition = undefined
          } else {
            definition = Object.freeze({
              ...definition,
              lineStart,
              phase: continuationPhase
            })
          }
        }
        if (definition !== undefined) {
          lineOwnedByDefinition = true
          definition = Object.freeze({
            ...definition,
            lastOwnedEnd: sourceEnd
          })
          if (definition.phase === 'reference-title') {
            completedLiterals.push(completedDefinitionLiteral(
              definition,
              sourceEnd
            ))
            definition = undefined
          }
        }
      }
      if (
        lineOwnedByIndentedCode ||
        lineOwnedByHtmlBlock ||
        lineOwnedByDefinition
      ) {
        activeContainers = lineState.activeContainers
      } else if (frontMatter !== undefined) {
        if (
          lineStart !== frontMatter.openLineStart &&
          isFrontMatterDelimiter(completedLine)
        ) {
          completedLiterals.push(Object.freeze({
            kind: 'front-matter',
            start: frontMatter.openStart,
            end: sourceEnd
          }))
          frontMatter = undefined
        }
      } else if (
        frontMatterEligible &&
        trimMarkdownLineWhitespace(completedLine) === '---'
      ) {
        frontMatter = Object.freeze({
          openStart:
            linePathSourceOffsetAt(checkpoint.linePath, 0) ?? lineStart,
          openLineStart: lineStart
        })
      } else if (fence !== undefined) {
        if (
          lineStart !== fence.openLineStart &&
          isFenceCloserLine(completedLine, lineState, fence)
        ) {
          completedLiterals.push(Object.freeze({
            kind: fence.provider,
            start: fence.openStart,
            end: sourceEnd
          }))
          fence = undefined
        }
      } else if (lineBlockClosed) {
        paragraphOpen = false
        bracketPath = undefined
        pendingLinkLabel = undefined
      } else {
        if (lineState.blank) {
          // Link-label openers belong to a paragraph. A blank line ends that
          // paragraph, so a later `](` cannot resolve an opener from before
          // the boundary.
          bracketPath = undefined
          pendingLinkLabel = undefined
        }
        const opening = findMarkdownFenceOpening(
          completedLine,
          lineState.contentOffset,
          lineState.indentation,
          lineState.blank
        )
        if (opening !== undefined) {
          fence = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                materializeMarkdownLine(checkpoint.linePath).length,
                textSourceStart,
                text.length,
                sourceEnd,
                opening.startOffset
              )
            ),
            openLineStart: lineStart,
            markerCodeUnit: opening.markerCodeUnit,
            openerLength: opening.openerLength,
            provider: fencedLiteralProvider(
              completedLine,
              opening.startOffset + opening.openerLength
            ),
            container: blockContainerFrom(lineState)
          })
          if (inlineCode?.openStart !== undefined && inlineCode.openStart >= lineStart) {
            inlineCode = undefined
          }
          bracketPath = undefined
          pendingLinkLabel = undefined
          fixedInline = undefined
          math = undefined
        }
        activeContainers = lineState.activeContainers
      }
      paragraphOpen =
        !lineBlockClosed &&
        !lineState.blank &&
        !lineOwnedByIndentedCode &&
        !lineOwnedByHtmlBlock &&
        !lineOwnedByDefinition &&
        !lineEnteredWithFence &&
        !lineEnteredWithFrontMatter &&
        fence === undefined &&
        frontMatter === undefined &&
        indentedCode === undefined &&
        htmlBlock === undefined &&
        definition === undefined &&
        !isAtxHeadingLine(completedLine, lineState) &&
        !isThematicBreakFrom(
          completedLine,
          lineState.contentOffset,
          completedLine.length
        )
      lastLineLazy = lineState.lazy
      frontMatterEligible = false
      lineStart = sourceEnd
    }
    const lineText = lastEol < 0 ? text : text.slice(lastEol + 1)
    const linePath =
      lineText.length === 0
        ? undefined
        : Object.freeze({
          parent: lastEol < 0 ? checkpoint.linePath : undefined,
          text: lineText,
          sourceStart:
            lastEol < 0
              ? textSourceStart
              : sourceEnd - lineText.length
        })
    return Object.freeze({
      checkpoint: Object.freeze({
        linePath,
        inlineCode,
        math,
        bracketPath,
        pendingLinkLabel,
        fixedInline,
        activeContainers,
        paragraphOpen,
        lastLineLazy,
        lineStart,
        fence,
        lineBlockClosed: lastEol < 0 && lineBlockClosed,
        trailingBackslashOdd,
        frontMatterEligible,
        frontMatter,
        indentedCode,
        htmlBlock,
        definition,
        pendingCarriageReturn: undefined,
        firstContainerDepthFailure,
        atVirtualBof: false
      }),
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const finishLane = (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ): MarkdownLaneAdvance => {
    const completedLiterals: MarkdownLiteralRange[] = []
    if (checkpoint.fence !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: checkpoint.fence.provider,
        start: checkpoint.fence.openStart,
        end: boundary
      }))
    }
    if (checkpoint.indentedCode !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'indented-code',
        start: checkpoint.indentedCode.openStart,
        end: Math.min(checkpoint.indentedCode.lastCodeEnd, boundary)
      }))
    }
    if (checkpoint.htmlBlock !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        start: checkpoint.htmlBlock.openStart,
        end: boundary
      }))
    }
    if (checkpoint.definition !== undefined) {
      completedLiterals.push(completedDefinitionLiteral(
        checkpoint.definition,
        Math.min(checkpoint.definition.lastOwnedEnd, boundary)
      ))
    }
    const checkpointChanged =
      checkpoint.fence !== undefined ||
      checkpoint.frontMatter !== undefined ||
      checkpoint.indentedCode !== undefined ||
      checkpoint.htmlBlock !== undefined ||
      checkpoint.definition !== undefined
    return Object.freeze({
      checkpoint:
        checkpointChanged
          ? Object.freeze({
            ...checkpoint,
            fence: undefined,
            frontMatter: undefined,
            indentedCode: undefined,
            htmlBlock: undefined,
            definition: undefined
          })
          : checkpoint,
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const releaseAtBoundary = (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ): MarkdownLaneAdvance => {
    if (materializeMarkdownLine(checkpoint.linePath).length !== 0) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    const completedLiterals: MarkdownLiteralRange[] = []
    const releasesHtmlBlock =
      checkpoint.htmlBlock !== undefined &&
      checkpoint.htmlBlock.terminator === undefined
    if (releasesHtmlBlock && checkpoint.htmlBlock !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        start: checkpoint.htmlBlock.openStart,
        end: Math.min(checkpoint.htmlBlock.lastOwnedEnd, boundary)
      }))
    }
    const releasesDefinition = checkpoint.definition !== undefined
    if (checkpoint.definition !== undefined) {
      completedLiterals.push(completedDefinitionLiteral(
        checkpoint.definition,
        Math.min(checkpoint.definition.lastOwnedEnd, boundary)
      ))
    }
    if (!releasesHtmlBlock && !releasesDefinition) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    return Object.freeze({
      checkpoint: Object.freeze({
        ...checkpoint,
        htmlBlock: releasesHtmlBlock ? undefined : checkpoint.htmlBlock,
        definition: undefined
      }),
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const prepareForMarker = (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    laneEnd: number
  ): MarkdownLaneAdvance => {
    if (
      checkpoint.indentedCode === undefined &&
      checkpoint.definition === undefined &&
      checkpoint.fence === undefined &&
      checkpoint.htmlBlock === undefined
    ) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    const contentEnd = sourceLineContentEnd(source, markerOffset, laneEnd)
    const lineText =
      materializeMarkdownLine(checkpoint.linePath) +
      source.slice(markerOffset, contentEnd)
    const lineState = analyzeContainerLine(
      lineText,
      { start: 0, contentEnd: lineText.length, end: lineText.length },
      checkpoint.activeContainers,
      checkpoint.paragraphOpen,
      checkpoint.lastLineLazy
    )
    const completedLiterals: MarkdownLiteralRange[] = []
    let indentedCode = checkpoint.indentedCode
    if (
      indentedCode !== undefined &&
      !lineState.blank &&
      lineState.indentation < 4
    ) {
      completedLiterals.push(Object.freeze({
        kind: 'indented-code',
        start: indentedCode.openStart,
        end: indentedCode.lastCodeEnd
      }))
      indentedCode = undefined
    }
    let definition = checkpoint.definition
    if (definition !== undefined && definition.lineStart !== checkpoint.lineStart) {
      const continuationPhase = definitionContinuationPhase(
        lineText,
        lineState,
        definition
      )
      if (continuationPhase === undefined) {
        completedLiterals.push(completedDefinitionLiteral(
          definition,
          definition.lastOwnedEnd
        ))
        definition = undefined
      } else {
        definition = Object.freeze({
          ...definition,
          lineStart: checkpoint.lineStart,
          phase: continuationPhase,
          lastOwnedEnd: sourceLineEnd(source, contentEnd, laneEnd)
        })
      }
    }
    let fence = checkpoint.fence
    if (
      fence !== undefined &&
      checkpoint.lineStart !== fence.openLineStart &&
      !continuesBlockContainer(lineState, fence.container)
    ) {
      completedLiterals.push(Object.freeze({
        kind: fence.provider,
        start: fence.openStart,
        end: checkpoint.lineStart
      }))
      fence = undefined
    }
    let htmlBlock = checkpoint.htmlBlock
    if (
      htmlBlock !== undefined &&
      !continuesBlockContainer(lineState, htmlBlock.container)
    ) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        start: htmlBlock.openStart,
        end: Math.min(htmlBlock.lastOwnedEnd, checkpoint.lineStart)
      }))
      htmlBlock = undefined
    }
    if (
      indentedCode === checkpoint.indentedCode &&
      definition === checkpoint.definition &&
      fence === checkpoint.fence &&
      htmlBlock === checkpoint.htmlBlock
    ) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze(completedLiterals)
      })
    }
    return Object.freeze({
      checkpoint: Object.freeze({
        ...checkpoint,
        indentedCode,
        definition,
        fence,
        htmlBlock
      }),
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const advance: MarkdownLaneState['advance'] = (
    checkpoint,
    sourceStart,
    sourceEnd,
    laneStart,
    laneEnd,
    boundaryEnd
  ) => advanceCore(
    checkpoint,
    sourceStart,
    sourceEnd,
    laneStart,
    laneEnd,
    boundaryEnd,
    true
  )

  const rejoinCarrier: MarkdownLaneState['rejoinCarrier'] = (
    continuation,
    armStart,
    armEnd,
    isolated,
    atDocumentRoot
  ) => {
    const resumed = isolated
      ? continuation
      : Object.freeze({
        linePath: armEnd.linePath,
        inlineCode: armStart.inlineCode,
        math: armStart.math,
        bracketPath: armEnd.bracketPath,
        pendingLinkLabel: armEnd.pendingLinkLabel,
        fixedInline: armEnd.fixedInline,
        activeContainers: armEnd.activeContainers,
        paragraphOpen: armEnd.paragraphOpen,
        lastLineLazy: armEnd.lastLineLazy,
        lineStart: armEnd.lineStart,
        fence: armStart.fence,
        lineBlockClosed: armEnd.lineBlockClosed,
        trailingBackslashOdd: armEnd.trailingBackslashOdd,
        frontMatterEligible: armEnd.frontMatterEligible,
        frontMatter: armEnd.frontMatter,
        indentedCode: armEnd.indentedCode,
        htmlBlock: armEnd.htmlBlock,
        definition: armEnd.definition,
        pendingCarriageReturn: armEnd.pendingCarriageReturn,
        firstContainerDepthFailure:
          continuation.firstContainerDepthFailure ??
          armEnd.firstContainerDepthFailure,
        atVirtualBof: armEnd.atVirtualBof
      })
    return atDocumentRoot
      ? Object.freeze({
        ...resumed,
        frontMatterEligible: false,
        frontMatter: undefined,
        atVirtualBof: false
      })
      : resumed
  }

  return Object.freeze({
    emptyCheckpoint: EMPTY_MARKDOWN_CHECKPOINT,
    advance: Object.freeze(advance),
    finishLane: Object.freeze(finishLane),
    releaseAtBoundary: Object.freeze(releaseAtBoundary),
    prepareForMarker: Object.freeze(prepareForMarker),
    containerDepthFailure: Object.freeze(
      (checkpoint: MarkdownCheckpoint): MarkdownContainerDepthFailure | undefined => {
        if (checkpoint.firstContainerDepthFailure !== undefined) {
          return checkpoint.firstContainerDepthFailure
        }
        const pendingLine = materializeMarkdownLine(checkpoint.linePath)
        if (pendingLine.length === 0) {
          return undefined
        }
        const lineState = analyzeContainerLine(
          pendingLine,
          { start: 0, contentEnd: pendingLine.length, end: pendingLine.length },
          checkpoint.activeContainers,
          checkpoint.paragraphOpen,
          checkpoint.lastLineLazy
        )
        const excess = firstExcessContainer(lineState)
        if (excess === undefined) {
          return undefined
        }
        const mapOffset = (virtualOffset: number): number =>
          linePathSourceOffsetAt(checkpoint.linePath, virtualOffset) ??
          checkpoint.lineStart
        return Object.freeze({
          start: mapOffset(excess.start),
          end: mapOffset(excess.end - 1) + 1,
          observed: excess.observed
        })
      }
    ),
    markerIsProtected: Object.freeze(
      (checkpoint: MarkdownCheckpoint): boolean => checkpoint.trailingBackslashOdd
    ),
    markerIsLiteralOwned: Object.freeze(
      (checkpoint: MarkdownCheckpoint): boolean =>
        checkpoint.inlineCode !== undefined ||
        checkpoint.math !== undefined ||
        checkpoint.fixedInline !== undefined ||
        checkpoint.fence !== undefined ||
        checkpoint.frontMatter !== undefined ||
        checkpoint.indentedCode !== undefined ||
        checkpoint.htmlBlock !== undefined ||
        checkpoint.definition !== undefined
    ),
    rejoinCarrier: Object.freeze(rejoinCarrier),
    forkArm: Object.freeze((
      checkpoint: MarkdownCheckpoint,
      sourceStart: number,
      isolated: boolean
    ): MarkdownCheckpoint =>
      isolated
        ? Object.freeze({
          ...EMPTY_MARKDOWN_CHECKPOINT,
          lineStart: sourceStart
        })
        : Object.freeze({
          ...checkpoint,
          frontMatterEligible: checkpoint.atVirtualBof
        }))
  })
}

function parsePlainMarkdownLanePass(
  source: string,
  containerDepthLimit: number,
  referenceDefinitions: MarkdownReferenceDefinitionLookup
): PlainMarkdownLaneParse {
  const parser = createMarkdownLaneState(
    source,
    containerDepthLimit,
    referenceDefinitions
  )
  const literals: MarkdownLiteralRange[] = []
  const lines: PlainMarkdownLine[] = []
  let checkpoint = parser.emptyCheckpoint
  const advanceRange = (
    start: number,
    end: number
  ): MarkdownContainerDepthFailure | undefined => {
    if (start === end) {
      return undefined
    }
    const advanced = parser.advance(
      checkpoint,
      start,
      end,
      0,
      source.length,
      source.length
    )
    checkpoint = advanced.checkpoint
    literals.push(...advanced.completedLiterals)
    return parser.containerDepthFailure(checkpoint)
  }
  let start = 0
  while (start < source.length) {
    let contentEnd = start
    while (
      contentEnd < source.length &&
      source.charCodeAt(contentEnd) !== 10 &&
      source.charCodeAt(contentEnd) !== 13
    ) {
      contentEnd += 1
    }
    let end = contentEnd
    if (end < source.length) {
      end +=
        source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10
          ? 2
          : 1
    }
    const lineState = analyzeContainerLine(
      source,
      { start, contentEnd, end },
      checkpoint.activeContainers,
      checkpoint.paragraphOpen,
      checkpoint.lastLineLazy
    )
    let openerIndex = 0
    const containers = lineState.activeContainers.map(
      (container, depth): PlainMarkdownContainer => {
        const continued = depth < lineState.continuedContainerDepth
        const opener = continued ? undefined : lineState.openers[openerIndex++]
        if (container.kind === 'blockquote') {
          return Object.freeze({
            kind: 'blockquote',
            continued,
            start: opener?.start ?? start,
            end: opener?.end ?? start
          })
        }
        return Object.freeze({
          kind: 'list-item',
          continued,
          start: opener?.start ?? start,
          end: opener?.end ?? start,
          ordered: container.ordered,
          startNumber: container.startNumber,
          delimiterCodeUnit: container.delimiterCodeUnit,
          contentOffset: opener?.contentOffset ?? lineState.contentOffset
        })
      }
    )
    lines.push(Object.freeze({
      start,
      contentEnd,
      end,
      blank: lineState.blank,
      contentOffset: lineState.contentOffset,
      indentation: lineState.indentation,
      blockQuoteDepth: lineState.blockQuoteDepth,
      listDepth: lineState.activeContainers.filter(
        (container) => container.kind === 'list-item'
      ).length,
      listMarkers: Object.freeze(
        lineState.openers
          .filter((opener) => opener.kind === 'list-item')
          .map((opener): PlainMarkdownListMarker => Object.freeze({
            start: opener.start,
            end: opener.end,
            ordered: opener.ordered ?? false,
            startNumber: opener.startNumber ?? 1,
            contentOffset: opener.contentOffset ?? opener.end
          }))
      ),
      containers: Object.freeze(containers)
    }))
    const failure =
      advanceRange(start, contentEnd) ?? advanceRange(contentEnd, end)
    if (failure !== undefined) {
      return Object.freeze({
        literals: composeMarkdownLiteralRanges(literals),
        containerDepthFailure: failure,
        lines: Object.freeze(lines)
      })
    }
    start = end
  }
  const finished = parser.finishLane(checkpoint, source.length)
  literals.push(...finished.completedLiterals)
  return Object.freeze({
    literals: composeMarkdownLiteralRanges(literals),
    containerDepthFailure: parser.containerDepthFailure(finished.checkpoint),
    lines: Object.freeze(lines)
  })
}

export function parsePlainMarkdownLane(
  source: string,
  containerDepthLimit: number = Number.POSITIVE_INFINITY
): PlainMarkdownLaneParse {
  const blockStage = parsePlainMarkdownLanePass(
    source,
    containerDepthLimit,
    EMPTY_REFERENCE_DEFINITIONS
  )
  const referenceDefinitions = new Set<string>()
  for (const literal of blockStage.literals) {
    if (literal.kind !== 'definition') {
      continue
    }
    const label = markdownReferenceDefinitionLabel(
      source,
      literal.start,
      literal.end
    )
    if (label !== undefined) {
      referenceDefinitions.add(label)
    }
  }
  return referenceDefinitions.size === 0
    ? blockStage
    : parsePlainMarkdownLanePass(
      source,
      containerDepthLimit,
      referenceDefinitions
    )
}
