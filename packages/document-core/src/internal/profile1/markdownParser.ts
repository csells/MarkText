import type {
  MarkdownDocument,
  MarkdownLiteralProvider,
  MarkdownNode,
  MarkdownNodeKind,
  ViewRange
} from '../../revision.js'
import {
  markdownReferenceDefinitionLabel,
  normalizeMarkdownReferenceLabel,
  parsePlainMarkdownLane,
  type PlainMarkdownContainer,
  type PlainMarkdownLine
} from './markdownLaneState.js'
import type {
  MarkdownContainerDepthFailure,
  MarkdownInlineConstruct
} from './markdownTypes.js'

interface MappedMarkdownLiteral {
  readonly provider: MarkdownLiteralProvider
  readonly start: number
  readonly end: number
  readonly construct?: MarkdownInlineConstruct
  readonly blockKind?: 'footnote-definition'
}

export interface MappedMarkdownLane {
  readonly source: string
}

export interface Profile1MarkdownParse {
  readonly document: MarkdownDocument
  readonly containerDepthFailure: MarkdownContainerDepthFailure | undefined
}

const EMPTY_ATTRIBUTES = Object.freeze({})
const EMPTY_INLINE_CONSTRUCTS: ReadonlyMap<number, MappedMarkdownLiteral> = new Map()
const EMPTY_REFERENCE_DEFINITIONS: ReadonlySet<string> = new Set()

function viewRange(start: number, end: number): ViewRange {
  return Object.freeze({ start, end })
}

function createNode(
  kind: MarkdownNodeKind,
  start: number,
  end: number,
  children: readonly MarkdownNode[] = Object.freeze([]),
  attributes: Readonly<Record<string, string | number | boolean>> = EMPTY_ATTRIBUTES
): MarkdownNode {
  const stableChildren = Object.freeze([...children])
  const childAt = Object.freeze((ordinal: number): MarkdownNode => {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= stableChildren.length) {
      throw new RangeError('Markdown child ordinal is outside the node')
    }
    const child = stableChildren[ordinal]
    if (child === undefined) {
      throw new Error('Markdown child index invariant failed')
    }
    return child
  })
  return Object.freeze({
    kind,
    range: viewRange(start, end),
    attributes: Object.freeze({ ...attributes }),
    childCount: stableChildren.length,
    childAt
  })
}

function hasOddBackslashRunBefore(source: string, offset: number, floor: number): boolean {
  let count = 0
  for (
    let cursor = offset - 1;
    cursor >= floor && source.charCodeAt(cursor) === 92;
    cursor -= 1
  ) {
    count += 1
  }
  return count % 2 === 1
}

interface ParsedReferenceLink {
  readonly kind: 'link' | 'image'
  readonly start: number
  readonly labelStart: number
  readonly labelEnd: number
  readonly end: number
  readonly referenceLabel: string
}

function findBalancedLabelEnd(
  source: string,
  opener: number,
  end: number
): number | undefined {
  let depth = 0
  for (let offset = opener; offset < end; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < end) {
      offset += 1
      continue
    }
    if (codeUnit === 91) {
      depth += 1
    } else if (codeUnit === 93) {
      depth -= 1
      if (depth === 0) {
        return offset
      }
    }
  }
  return undefined
}

function findReferenceLink(
  source: string,
  start: number,
  end: number,
  referenceDefinitions: ReadonlySet<string>
): ParsedReferenceLink | undefined {
  const image =
    source.charCodeAt(start) === 33 && source.charCodeAt(start + 1) === 91
  const opener = image ? start + 1 : start
  if (
    source.charCodeAt(opener) !== 91 ||
    hasOddBackslashRunBefore(source, opener, start)
  ) {
    return undefined
  }
  const labelEnd = findBalancedLabelEnd(source, opener, end)
  if (labelEnd === undefined || labelEnd === opener + 1) {
    return undefined
  }
  const normalizedLabel = normalizeMarkdownReferenceLabel(
    source,
    opener + 1,
    labelEnd
  )
  let constructEnd = labelEnd + 1
  let referenceLabel = normalizedLabel
  if (source.charCodeAt(constructEnd) === 91) {
    const referenceEnd = findBalancedLabelEnd(source, constructEnd, end)
    if (referenceEnd === undefined) {
      return undefined
    }
    referenceLabel = referenceEnd === constructEnd + 1
      ? normalizedLabel
      : normalizeMarkdownReferenceLabel(
        source,
        constructEnd + 1,
        referenceEnd
      )
    constructEnd = referenceEnd + 1
  } else if (
    source.charCodeAt(constructEnd) === 40 ||
    source.charCodeAt(constructEnd) === 91
  ) {
    return undefined
  }
  if (!referenceDefinitions.has(referenceLabel)) {
    return undefined
  }
  return Object.freeze({
    kind: image ? 'image' : 'link',
    start,
    labelStart: opener + 1,
    labelEnd,
    end: constructEnd,
    referenceLabel
  })
}

interface InlineNodeItem {
  readonly kind: 'node'
  readonly node: MarkdownNode
  previous: InlineItem | undefined
  next: InlineItem | undefined
}

interface InlineDelimiterItem {
  readonly kind: 'delimiter'
  readonly markerCodeUnit: number
  readonly canOpen: boolean
  readonly canClose: boolean
  start: number
  end: number
  length: number
  active: boolean
  previous: InlineItem | undefined
  next: InlineItem | undefined
}

type InlineItem = InlineNodeItem | InlineDelimiterItem

interface InlineList {
  head: InlineItem | undefined
  tail: InlineItem | undefined
}

interface InlineDelimiterRun {
  readonly markerCodeUnit: number
  readonly start: number
  readonly end: number
  readonly length: number
  readonly canOpen: boolean
  readonly canClose: boolean
}

const UNICODE_WHITESPACE = /^\s$/u
const UNICODE_PUNCTUATION_OR_SYMBOL = /^[\p{P}\p{S}]$/u

function unicodeScalarBefore(
  source: string,
  offset: number,
  floor: number
): string | undefined {
  if (offset <= floor) {
    return undefined
  }
  let start = offset - 1
  const trailing = source.charCodeAt(start)
  if (
    trailing >= 0xdc00 &&
    trailing <= 0xdfff &&
    start > floor
  ) {
    const leading = source.charCodeAt(start - 1)
    if (leading >= 0xd800 && leading <= 0xdbff) {
      start -= 1
    }
  }
  return source.slice(start, offset)
}

function unicodeScalarAt(
  source: string,
  offset: number,
  ceiling: number
): string | undefined {
  if (offset >= ceiling) {
    return undefined
  }
  const codePoint = source.codePointAt(offset)
  if (codePoint === undefined) {
    return undefined
  }
  return String.fromCodePoint(codePoint)
}

function delimiterRunAt(
  source: string,
  offset: number,
  start: number,
  end: number
): InlineDelimiterRun | undefined {
  const markerCodeUnit = source.charCodeAt(offset)
  if (
    (markerCodeUnit !== 42 && markerCodeUnit !== 95 && markerCodeUnit !== 126) ||
    (
      source.charCodeAt(offset - 1) === markerCodeUnit &&
      !hasOddBackslashRunBefore(source, offset - 1, start)
    ) ||
    hasOddBackslashRunBefore(source, offset, start)
  ) {
    return undefined
  }
  let runEnd = offset + 1
  while (runEnd < end && source.charCodeAt(runEnd) === markerCodeUnit) {
    runEnd += 1
  }
  const length = runEnd - offset
  if (markerCodeUnit === 126 && length > 2) {
    return undefined
  }

  const previous = unicodeScalarBefore(source, offset, start)
  const next = unicodeScalarAt(source, runEnd, end)
  const previousIsWhitespace =
    previous === undefined || UNICODE_WHITESPACE.test(previous)
  const nextIsWhitespace = next === undefined || UNICODE_WHITESPACE.test(next)
  const previousIsPunctuation =
    previous !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(previous)
  const nextIsPunctuation =
    next !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(next)
  const leftFlanking =
    !nextIsWhitespace &&
    (!nextIsPunctuation || previousIsWhitespace || previousIsPunctuation)
  const rightFlanking =
    !previousIsWhitespace &&
    (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation)
  const canOpen = markerCodeUnit === 95
    ? leftFlanking && (!rightFlanking || previousIsPunctuation)
    : leftFlanking
  const canClose = markerCodeUnit === 95
    ? rightFlanking && (!leftFlanking || nextIsPunctuation)
    : rightFlanking
  return Object.freeze({
    markerCodeUnit,
    start: offset,
    end: runEnd,
    length,
    canOpen,
    canClose
  })
}

function appendInlineItem(list: InlineList, item: InlineItem): void {
  item.previous = list.tail
  item.next = undefined
  if (list.tail === undefined) {
    list.head = item
  } else {
    list.tail.next = item
  }
  list.tail = item
}

function appendMergedMarkdownNode(
  nodes: MarkdownNode[],
  node: MarkdownNode
): void {
  const previous = nodes.at(-1)
  if (
    previous?.kind === 'text' &&
    node.kind === 'text' &&
    previous.range.end === node.range.start
  ) {
    nodes[nodes.length - 1] = createNode(
      'text',
      previous.range.start,
      node.range.end
    )
    return
  }
  nodes.push(node)
}

function markdownNodeFromInlineItem(item: InlineItem): MarkdownNode {
  return item.kind === 'node'
    ? item.node
    : createNode('text', item.start, item.end)
}

function delimiterPairIsAllowed(
  opener: InlineDelimiterItem,
  closer: InlineDelimiterItem
): boolean {
  if (
    opener.markerCodeUnit !== closer.markerCodeUnit ||
    !opener.canOpen ||
    !closer.canClose
  ) {
    return false
  }
  if (opener.markerCodeUnit === 126) {
    return true
  }
  return !(
    (opener.canClose || closer.canOpen) &&
    (opener.length + closer.length) % 3 === 0 &&
    (opener.length % 3 !== 0 || closer.length % 3 !== 0)
  )
}

function wrapInlineDelimiterPair(
  list: InlineList,
  opener: InlineDelimiterItem,
  closer: InlineDelimiterItem
): void {
  const useCount =
    opener.length >= 2 && closer.length >= 2 ? 2 : 1
  const openerMarkerStart = opener.end - useCount
  const closerMarkerEnd = closer.start + useCount
  const children: MarkdownNode[] = []
  for (let item = opener.next; item !== undefined && item !== closer;) {
    const next = item.next
    if (item.kind === 'delimiter') {
      item.active = false
    }
    appendMergedMarkdownNode(children, markdownNodeFromInlineItem(item))
    item = next
  }

  opener.end -= useCount
  opener.length -= useCount
  closer.start += useCount
  closer.length -= useCount
  const nodeKind: MarkdownNodeKind =
    opener.markerCodeUnit === 126
      ? 'strikethrough'
      : useCount === 2
        ? 'strong'
        : 'emphasis'
  const nodeItem: InlineNodeItem = {
    kind: 'node',
    node: createNode(
      nodeKind,
      openerMarkerStart,
      closerMarkerEnd,
      children
    ),
    previous: undefined,
    next: undefined
  }

  const before = opener.length === 0 ? opener.previous : opener
  const after = closer.length === 0 ? closer.next : closer
  if (opener.length === 0) {
    opener.active = false
  }
  if (closer.length === 0) {
    closer.active = false
  }
  nodeItem.previous = before
  nodeItem.next = after
  if (before === undefined) {
    list.head = nodeItem
  } else {
    before.next = nodeItem
  }
  if (after === undefined) {
    list.tail = nodeItem
  } else {
    after.previous = nodeItem
  }
}

function resolveInlineDelimiterItems(
  list: InlineList,
  delimiters: readonly InlineDelimiterItem[]
): readonly MarkdownNode[] {
  const openerStacks = new Map<number, InlineDelimiterItem[]>()
  const openerBottoms = new Map<number, Map<string, number>>()
  for (const closer of delimiters) {
    if (!closer.active) {
      continue
    }
    if (closer.canClose) {
      while (closer.active && closer.length > 0) {
        const openers = openerStacks.get(closer.markerCodeUnit) ?? []
        const bottoms = openerBottoms.get(closer.markerCodeUnit) ?? new Map()
        if (!openerBottoms.has(closer.markerCodeUnit)) {
          openerBottoms.set(closer.markerCodeUnit, bottoms)
        }
        const closerClass = closer.markerCodeUnit === 126
          ? 'tilde'
          : `${closer.length % 3}:${closer.canOpen ? 1 : 0}`
        const lowerBound = Math.min(
          bottoms.get(closerClass) ?? 0,
          openers.length
        )
        let openerIndex = openers.length - 1
        while (openerIndex >= lowerBound) {
          const opener = openers[openerIndex]
          if (
            opener !== undefined &&
            opener.active &&
            delimiterPairIsAllowed(opener, closer)
          ) {
            break
          }
          openerIndex -= 1
        }
        const opener = openers[openerIndex]
        if (openerIndex < lowerBound || opener === undefined) {
          bottoms.set(closerClass, openers.length)
          break
        }
        wrapInlineDelimiterPair(list, opener, closer)
        openers.length = openerIndex + (opener.active ? 1 : 0)
        for (const [key, bottom] of bottoms) {
          if (bottom > openers.length) {
            bottoms.set(key, openers.length)
          }
        }
      }
    }
    if (closer.active && closer.length > 0 && closer.canOpen) {
      const openers = openerStacks.get(closer.markerCodeUnit)
      if (openers === undefined) {
        openerStacks.set(closer.markerCodeUnit, [closer])
      } else if (openers.at(-1) !== closer) {
        openers.push(closer)
      }
    }
  }

  const nodes: MarkdownNode[] = []
  for (let item = list.head; item !== undefined; item = item.next) {
    appendMergedMarkdownNode(nodes, markdownNodeFromInlineItem(item))
  }
  return Object.freeze(nodes)
}

function appendInlineRange(
  list: InlineList,
  delimiters: InlineDelimiterItem[],
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: ReadonlySet<string> = EMPTY_REFERENCE_DEFINITIONS
): void {
  const appendNode = (node: MarkdownNode): void => {
    appendInlineItem(list, {
      kind: 'node',
      node,
      previous: undefined,
      next: undefined
    })
  }
  let textStart = start
  let offset = start
  while (offset < end) {
    const literal = constructs.get(offset)
    const construct = literal?.construct
    if (
      literal !== undefined &&
      construct !== undefined &&
      literal.end <= end
    ) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      appendNode(createNode(
        construct.kind,
        construct.start,
        literal.end,
        parseInlineNodes(
          source,
          construct.labelStart,
          construct.labelEnd,
          constructs,
          referenceDefinitions
        ),
        {
          destinationStart: literal.start,
          destinationEnd: literal.end
        }
      ))
      offset = literal.end
      textStart = offset
      continue
    }
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10 || codeUnit === 13) {
      const lineEndingEnd =
        codeUnit === 13 && source.charCodeAt(offset + 1) === 10
          ? offset + 2
          : offset + 1
      let breakStart = offset
      let kind: MarkdownNodeKind = 'soft-break'
      let spaces = 0
      while (breakStart > textStart && source.charCodeAt(breakStart - 1) === 32) {
        breakStart -= 1
        spaces += 1
      }
      if (spaces >= 2) {
        kind = 'hard-break'
      } else {
        breakStart = offset
        if (
          offset > textStart &&
          source.charCodeAt(offset - 1) === 92 &&
          !hasOddBackslashRunBefore(source, offset - 1, textStart)
        ) {
          breakStart = offset - 1
          kind = 'hard-break'
        }
      }
      if (textStart < breakStart) {
        appendNode(createNode('text', textStart, breakStart))
      }
      appendNode(createNode(kind, breakStart, lineEndingEnd))
      offset = lineEndingEnd
      textStart = offset
      continue
    }
    if (
      source.charCodeAt(offset) === 91 &&
      source.charCodeAt(offset + 1) === 94 &&
      !hasOddBackslashRunBefore(source, offset, start)
    ) {
      const close = source.indexOf(']', offset + 2)
      if (close > offset + 2 && close < end) {
        if (textStart < offset) {
          appendNode(createNode('text', textStart, offset))
        }
        appendNode(createNode(
          'footnote-reference',
          offset,
          close + 1,
          [],
          {
            label: normalizeMarkdownReferenceLabel(
              source,
              offset + 2,
              close
            )
          }
        ))
        offset = close + 1
        textStart = offset
        continue
      }
    }
    const referenceLink = findReferenceLink(
      source,
      offset,
      end,
      referenceDefinitions
    )
    if (referenceLink !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      appendNode(createNode(
        referenceLink.kind,
        referenceLink.start,
        referenceLink.end,
        parseInlineNodes(
          source,
          referenceLink.labelStart,
          referenceLink.labelEnd,
          constructs,
          referenceDefinitions
        ),
        { referenceLabel: referenceLink.referenceLabel }
      ))
      offset = referenceLink.end
      textStart = offset
      continue
    }
    if (
      literal !== undefined &&
      literal.end <= end &&
      (
        literal.provider === 'inline-code' ||
        literal.provider === 'inline-html' ||
        literal.provider === 'autolink' ||
        literal.provider === 'math'
      )
    ) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      const kind: MarkdownNodeKind =
        literal.provider === 'math' ? 'inline-math' : literal.provider
      let markerLength = 0
      if (literal.provider === 'inline-code') {
        while (
          offset + markerLength < literal.end &&
          source.charCodeAt(offset + markerLength) === 96
        ) {
          markerLength += 1
        }
      }
      appendNode(createNode(
        kind,
        offset,
        literal.end,
        [],
        markerLength === 0 ? EMPTY_ATTRIBUTES : { markerLength }
      ))
      offset = literal.end
      textStart = offset
      continue
    }
    const delimiterRun = delimiterRunAt(source, offset, start, end)
    if (delimiterRun !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      const delimiter: InlineDelimiterItem = {
        kind: 'delimiter',
        markerCodeUnit: delimiterRun.markerCodeUnit,
        canOpen: delimiterRun.canOpen,
        canClose: delimiterRun.canClose,
        start: delimiterRun.start,
        end: delimiterRun.end,
        length: delimiterRun.length,
        active: true,
        previous: undefined,
        next: undefined
      }
      appendInlineItem(list, delimiter)
      delimiters.push(delimiter)
      offset = delimiterRun.end
      textStart = offset
      continue
    }
    offset += 1
  }
  if (textStart < end) {
    appendNode(createNode('text', textStart, end))
  }
}

function parseInlineNodes(
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: ReadonlySet<string> = EMPTY_REFERENCE_DEFINITIONS
): readonly MarkdownNode[] {
  const list: InlineList = { head: undefined, tail: undefined }
  const delimiters: InlineDelimiterItem[] = []
  appendInlineRange(
    list,
    delimiters,
    source,
    start,
    end,
    constructs,
    referenceDefinitions
  )
  return resolveInlineDelimiterItems(list, delimiters)
}

function parseInlineLineSequence(
  source: string,
  lines: readonly PlainMarkdownLine[],
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: ReadonlySet<string>
): readonly MarkdownNode[] {
  const list: InlineList = { head: undefined, tail: undefined }
  const delimiters: InlineDelimiterItem[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    appendInlineRange(
      list,
      delimiters,
      source,
      line.contentOffset,
      index + 1 < lines.length ? line.end : line.contentEnd,
      constructs,
      referenceDefinitions
    )
  }
  return resolveInlineDelimiterItems(list, delimiters)
}

function leadingIndent(source: string, start: number, end: number): number {
  let offset = start
  while (offset < end && offset - start < 4 && source.charCodeAt(offset) === 32) {
    offset += 1
  }
  return offset - start
}

function parseAtxHeading(
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: ReadonlySet<string> = EMPTY_REFERENCE_DEFINITIONS
): MarkdownNode | undefined {
  const indentation = leadingIndent(source, start, end)
  let offset = start + indentation
  if (indentation > 3 || source.charCodeAt(offset) !== 35) {
    return undefined
  }
  const markerStart = offset
  while (offset < end && source.charCodeAt(offset) === 35) {
    offset += 1
  }
  const level = offset - markerStart
  if (
    level > 6 ||
    (offset < end && source.charCodeAt(offset) !== 32 && source.charCodeAt(offset) !== 9)
  ) {
    return undefined
  }
  while (
    offset < end &&
    (source.charCodeAt(offset) === 32 || source.charCodeAt(offset) === 9)
  ) {
    offset += 1
  }
  let contentEnd = end
  while (
    contentEnd > offset &&
    (source.charCodeAt(contentEnd - 1) === 32 || source.charCodeAt(contentEnd - 1) === 9)
  ) {
    contentEnd -= 1
  }
  let closingStart = contentEnd
  while (closingStart > offset && source.charCodeAt(closingStart - 1) === 35) {
    closingStart -= 1
  }
  if (
    closingStart < contentEnd &&
    closingStart > offset &&
    (source.charCodeAt(closingStart - 1) === 32 || source.charCodeAt(closingStart - 1) === 9)
  ) {
    contentEnd = closingStart - 1
    while (
      contentEnd > offset &&
      (source.charCodeAt(contentEnd - 1) === 32 || source.charCodeAt(contentEnd - 1) === 9)
    ) {
      contentEnd -= 1
    }
  }
  const children = offset < contentEnd
    ? parseInlineNodes(
      source,
      offset,
      contentEnd,
      constructs,
      referenceDefinitions
    )
    : []
  return createNode('heading', start, end, children, { level })
}

function blockLiteralNode(
  source: string,
  literal: MappedMarkdownLiteral,
  start: number = literal.start
): MarkdownNode | undefined {
  if (literal.provider === 'fenced-code' || literal.provider === 'indented-code') {
    return createNode('code-block', start, literal.end, [], {
      provider: literal.provider
    })
  }
  if (literal.provider === 'html-block') {
    return createNode('html-block', start, literal.end)
  }
  if (literal.provider === 'front-matter') {
    return createNode('front-matter', start, literal.end)
  }
  if (literal.provider === 'definition') {
    return createNode(
      literal.blockKind === 'footnote-definition'
        ? 'footnote-definition'
        : 'definition',
      start,
      literal.end
    )
  }
  if (literal.provider === 'diagram') {
    return createNode('diagram', start, literal.end)
  }
  if (literal.provider === 'math') {
    const firstLineEndCandidates = [
      source.indexOf('\n', literal.start),
      source.indexOf('\r', literal.start)
    ].filter((candidate) => candidate >= literal.start && candidate < literal.end)
    const firstLineEnd = firstLineEndCandidates.length === 0
      ? literal.end
      : Math.min(...firstLineEndCandidates)
    const firstLine = source.slice(literal.start, firstLineEnd).trim()
    if (
      firstLine === '$$' ||
      /^(?:`{3,}|~{3,})[\t ]*math(?:[\t ].*)?$/i.test(firstLine)
    ) {
      return createNode('math-block', start, literal.end)
    }
  }
  return undefined
}

interface MutableContainerNode {
  readonly mutable: true
  readonly kind: 'document' | 'blockquote' | 'list' | 'list-item' | 'paragraph'
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly children: Array<MutableContainerNode | MarkdownNode>
  start: number
  end: number
  readonly listDelimiterCodeUnit?: number
}

interface OpenContainerContext {
  readonly descriptor: PlainMarkdownContainer
  readonly content: MutableContainerNode
  readonly extents: readonly MutableContainerNode[]
}

interface ParsedContainerSequence {
  readonly nodes: readonly MarkdownNode[]
  readonly nextLineIndex: number
}

function mutableContainerNode(
  kind: MutableContainerNode['kind'],
  start: number,
  end: number,
  attributes: Readonly<Record<string, string | number | boolean>> = EMPTY_ATTRIBUTES,
  listDelimiterCodeUnit?: number
): MutableContainerNode {
  return {
    mutable: true,
    kind,
    start,
    end,
    attributes,
    children: [],
    ...(listDelimiterCodeUnit === undefined ? {} : { listDelimiterCodeUnit })
  }
}

function isMutableContainerNode(
  node: MutableContainerNode | MarkdownNode
): node is MutableContainerNode {
  return 'mutable' in node && node.mutable
}

function finalizeMutableContainer(node: MutableContainerNode): MarkdownNode {
  return createNode(
    node.kind,
    node.start,
    node.end,
    node.children.map((child) =>
      isMutableContainerNode(child) ? finalizeMutableContainer(child) : child
    ),
    node.attributes
  )
}

function sameContainerKind(
  context: OpenContainerContext,
  descriptor: PlainMarkdownContainer
): boolean {
  if (context.descriptor.kind !== descriptor.kind) {
    return false
  }
  return descriptor.kind !== 'list-item' || (
    context.descriptor.kind === 'list-item' &&
    context.descriptor.ordered === descriptor.ordered &&
    context.descriptor.delimiterCodeUnit === descriptor.delimiterCodeUnit
  )
}

function parseOrderedContainerSequence(
  source: string,
  lines: readonly PlainMarkdownLine[],
  lineIndex: number,
  literals: readonly MappedMarkdownLiteral[],
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: ReadonlySet<string>
): ParsedContainerSequence | undefined {
  if ((lines[lineIndex]?.containers.length ?? 0) === 0) {
    return undefined
  }

  const root = mutableContainerNode('document', 0, source.length)
  const stack: OpenContainerContext[] = []
  let paragraphOwner: MutableContainerNode | undefined
  let paragraph: MutableContainerNode | undefined
  let paragraphLines: PlainMarkdownLine[] = []
  let literalEnd = -1
  let nextLineIndex = lineIndex

  const currentParent = (): MutableContainerNode =>
    stack.at(-1)?.content ?? root
  const extendOpenContainers = (end: number): void => {
    for (const context of stack) {
      for (const extent of context.extents) {
        extent.end = Math.max(extent.end, end)
      }
    }
  }
  const closeParagraph = (): void => {
    if (paragraph !== undefined && paragraphLines.length > 0) {
      paragraph.children.push(...parseInlineLineSequence(
        source,
        paragraphLines,
        constructs,
        referenceDefinitions
      ))
    }
    paragraphOwner = undefined
    paragraph = undefined
    paragraphLines = []
  }

  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex]
    if (line === undefined) {
      break
    }
    if (line.containers.length === 0) {
      break
    }

    let reusedDepth = 0
    while (
      reusedDepth < line.containers.length &&
      reusedDepth < stack.length
    ) {
      const descriptor = line.containers[reusedDepth]
      const context = stack[reusedDepth]
      if (
        descriptor === undefined ||
        context === undefined ||
        !descriptor.continued ||
        !sameContainerKind(context, descriptor)
      ) {
        break
      }
      reusedDepth += 1
    }
    if (reusedDepth < stack.length) {
      stack.splice(reusedDepth)
      closeParagraph()
    }

    for (let depth = reusedDepth; depth < line.containers.length; depth += 1) {
      const descriptor = line.containers[depth]
      if (descriptor === undefined) {
        continue
      }
      const parent = currentParent()
      if (descriptor.kind === 'blockquote') {
        const quote = mutableContainerNode(
          'blockquote',
          descriptor.start,
          descriptor.end
        )
        parent.children.push(quote)
        stack.push(Object.freeze({
          descriptor,
          content: quote,
          extents: Object.freeze([quote])
        }))
        continue
      }

      const previousChild = parent.children.at(-1)
      const compatibleList =
        previousChild !== undefined &&
        isMutableContainerNode(previousChild) &&
        previousChild.kind === 'list' &&
        previousChild.attributes.ordered === descriptor.ordered &&
        previousChild.listDelimiterCodeUnit === descriptor.delimiterCodeUnit
          ? previousChild
          : undefined
      const list = compatibleList ?? mutableContainerNode(
        'list',
        descriptor.start,
        descriptor.end,
        descriptor.ordered
          ? Object.freeze({ ordered: true, start: descriptor.startNumber })
          : Object.freeze({ ordered: false }),
        descriptor.delimiterCodeUnit
      )
      if (compatibleList === undefined) {
        parent.children.push(list)
      }
      const item = mutableContainerNode(
        'list-item',
        descriptor.start,
        descriptor.end,
        descriptor.ordered
          ? Object.freeze({ ordinal: descriptor.startNumber })
          : EMPTY_ATTRIBUTES
      )
      list.children.push(item)
      stack.push(Object.freeze({
        descriptor,
        content: item,
        extents: Object.freeze([list, item])
      }))
    }

    const parent = currentParent()
    if (line.blank) {
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (line.start < literalEnd) {
      extendOpenContainers(Math.min(literalEnd, line.contentEnd))
      closeParagraph()
      nextLineIndex += 1
      continue
    }
    const literal = literals.find(
      (candidate) =>
        candidate.start <= line.contentOffset &&
        line.contentOffset < candidate.end
    )
    const literalNode =
      literal !== undefined && literal.start >= line.start
        ? blockLiteralNode(source, literal, line.contentOffset)
        : undefined
    if (literal !== undefined && literalNode !== undefined) {
      parent.children.push(literalNode)
      literalEnd = literal.end
      extendOpenContainers(literal.end)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    const heading = parseAtxHeading(
      source,
      line.contentOffset,
      line.contentEnd,
      constructs,
      referenceDefinitions
    )
    if (heading !== undefined) {
      parent.children.push(heading)
      extendOpenContainers(heading.range.end)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (paragraphOwner !== parent || paragraph === undefined) {
      closeParagraph()
      paragraph = mutableContainerNode(
        'paragraph',
        line.contentOffset,
        line.contentEnd
      )
      parent.children.push(paragraph)
      paragraphOwner = parent
    }
    paragraphLines.push(line)
    paragraph.end = line.contentEnd
    extendOpenContainers(line.contentEnd)
    nextLineIndex += 1
  }

  closeParagraph()

  return Object.freeze({
    nodes: Object.freeze(root.children.map((child) =>
      isMutableContainerNode(child) ? finalizeMutableContainer(child) : child
    )),
    nextLineIndex
  })
}

function setextHeadingLevel(
  source: string,
  line: PlainMarkdownLine
): 1 | 2 | undefined {
  if (line.indentation > 3 || line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return undefined
  }
  let start = line.contentOffset
  while (
    start < line.contentEnd &&
    (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)
  ) {
    start += 1
  }
  let end = line.contentEnd
  while (
    end > start &&
    (source.charCodeAt(end - 1) === 32 || source.charCodeAt(end - 1) === 9)
  ) {
    end -= 1
  }
  const marker = source.charCodeAt(start)
  if (marker !== 61 && marker !== 45) {
    return undefined
  }
  for (let offset = start + 1; offset < end; offset += 1) {
    if (source.charCodeAt(offset) !== marker) {
      return undefined
    }
  }
  return marker === 61 ? 1 : 2
}

function isThematicBreak(source: string, line: PlainMarkdownLine): boolean {
  if (line.indentation > 3 || line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return false
  }
  let marker: number | undefined
  let count = 0
  for (let offset = line.contentOffset; offset < line.contentEnd; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 32 || codeUnit === 9) {
      continue
    }
    if (codeUnit !== 42 && codeUnit !== 45 && codeUnit !== 95) {
      return false
    }
    marker ??= codeUnit
    if (codeUnit !== marker) {
      return false
    }
    count += 1
  }
  return count >= 3
}

interface TableCellRange {
  readonly start: number
  readonly end: number
}

function splitTableCells(
  source: string,
  line: PlainMarkdownLine
): readonly TableCellRange[] | undefined {
  const separators: number[] = []
  for (let offset = line.contentOffset; offset < line.contentEnd; offset += 1) {
    if (
      source.charCodeAt(offset) === 124 &&
      !hasOddBackslashRunBefore(source, offset, line.contentOffset)
    ) {
      separators.push(offset)
    }
  }
  if (separators.length === 0) {
    return undefined
  }
  const boundaries = [line.contentOffset, ...separators, line.contentEnd]
  const cells: TableCellRange[] = []
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    let start = boundaries[index] ?? line.contentOffset
    let end = boundaries[index + 1] ?? line.contentEnd
    if (index > 0) {
      start += 1
    }
    while (
      start < end &&
      (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)
    ) {
      start += 1
    }
    while (
      end > start &&
      (source.charCodeAt(end - 1) === 32 || source.charCodeAt(end - 1) === 9)
    ) {
      end -= 1
    }
    const isLeadingEmpty = index === 0 && start === end
    const isTrailingEmpty = index + 2 === boundaries.length && start === end
    if (!isLeadingEmpty && !isTrailingEmpty) {
      cells.push(Object.freeze({ start, end }))
    }
  }
  return cells.length === 0 ? undefined : Object.freeze(cells)
}

type TableAlignment = 'none' | 'left' | 'center' | 'right'

function tableDelimiterAlignments(
  source: string,
  line: PlainMarkdownLine
): readonly TableAlignment[] | undefined {
  const cells = splitTableCells(source, line)
  if (cells === undefined) {
    return undefined
  }
  const alignments: TableAlignment[] = []
  for (const cell of cells) {
    const value = source.slice(cell.start, cell.end)
    if (!/^:?-{3,}:?$/.test(value)) {
      return undefined
    }
    alignments.push(
      value.startsWith(':') && value.endsWith(':')
        ? 'center'
        : value.startsWith(':')
          ? 'left'
          : value.endsWith(':')
            ? 'right'
            : 'none'
    )
  }
  return Object.freeze(alignments)
}

interface ParsedTable {
  readonly node: MarkdownNode
  readonly nextLineIndex: number
}

function parseTable(
  source: string,
  lines: readonly PlainMarkdownLine[],
  lineIndex: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: ReadonlySet<string>
): ParsedTable | undefined {
  const headerLine = lines[lineIndex]
  const delimiterLine = lines[lineIndex + 1]
  if (
    headerLine === undefined ||
    delimiterLine === undefined ||
    headerLine.blank ||
    delimiterLine.blank ||
    headerLine.blockQuoteDepth !== 0 ||
    headerLine.listDepth !== 0
  ) {
    return undefined
  }
  const headerCells = splitTableCells(source, headerLine)
  const alignments = tableDelimiterAlignments(source, delimiterLine)
  if (
    headerCells === undefined ||
    alignments === undefined ||
    headerCells.length !== alignments.length
  ) {
    return undefined
  }
  const rows: MarkdownNode[] = []
  const createRow = (
    line: PlainMarkdownLine,
    cells: readonly TableCellRange[],
    header: boolean
  ): MarkdownNode => createNode(
    'table-row',
    line.start,
    line.contentEnd,
    alignments.map((alignment, index) => {
      const cell = cells[index] ?? Object.freeze({
        start: line.contentEnd,
        end: line.contentEnd
      })
      return createNode(
        'table-cell',
        cell.start,
        cell.end,
        parseInlineNodes(
          source,
          cell.start,
          cell.end,
          constructs,
          referenceDefinitions
        ),
        { header, alignment }
      )
    }),
    { header }
  )
  rows.push(createRow(headerLine, headerCells, true))
  let nextLineIndex = lineIndex + 2
  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex]
    if (line === undefined || line.blank || line.blockQuoteDepth > 0 || line.listDepth > 0) {
      break
    }
    const cells = splitTableCells(source, line)
    if (cells === undefined) {
      break
    }
    rows.push(createRow(line, cells, false))
    nextLineIndex += 1
  }
  const lastLine = lines[nextLineIndex - 1] ?? delimiterLine
  return Object.freeze({
    node: createNode(
      'table',
      headerLine.start,
      lastLine.contentEnd,
      rows,
      { columns: alignments.length }
    ),
    nextLineIndex
  })
}

function parseBlocks(
  source: string,
  literals: readonly MappedMarkdownLiteral[],
  lines: readonly PlainMarkdownLine[],
  referenceDefinitions: ReadonlySet<string>
): readonly MarkdownNode[] {
  const blocks: MarkdownNode[] = []
  const constructs = new Map<number, MappedMarkdownLiteral>()
  for (const literal of literals) {
    if (
      literal.construct !== undefined ||
      literal.provider === 'inline-code' ||
      literal.provider === 'inline-html' ||
      literal.provider === 'autolink' ||
      literal.provider === 'math'
    ) {
      constructs.set(literal.construct?.start ?? literal.start, literal)
    }
  }
  let literalIndex = 0
  let lineIndex = 0
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (line === undefined) {
      break
    }
    if (line.blank) {
      lineIndex += 1
      continue
    }
    const containerSequence = parseOrderedContainerSequence(
      source,
      lines,
      lineIndex,
      literals,
      constructs,
      referenceDefinitions
    )
    if (containerSequence !== undefined) {
      blocks.push(...containerSequence.nodes)
      lineIndex = containerSequence.nextLineIndex
      while (
        literalIndex < literals.length &&
        (literals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <=
          (containerSequence.nodes.at(-1)?.range.end ?? line.start)
      ) {
        literalIndex += 1
      }
      continue
    }
    const table = parseTable(
      source,
      lines,
      lineIndex,
      constructs,
      referenceDefinitions
    )
    if (table !== undefined) {
      blocks.push(table.node)
      lineIndex = table.nextLineIndex
      continue
    }
    while ((literals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <= line.start) {
      literalIndex += 1
    }
    const literal = literals[literalIndex]
    const standalone = parseAtxHeading(
      source,
      line.start,
      line.contentEnd,
      constructs,
      referenceDefinitions
    )
    if (standalone !== undefined) {
      blocks.push(standalone)
      lineIndex += 1
      while (
        lineIndex < lines.length &&
        (lines[lineIndex]?.start ?? Number.POSITIVE_INFINITY) < standalone.range.end
      ) {
        lineIndex += 1
      }
      if (literal !== undefined && literal.end === standalone.range.end) {
        literalIndex += 1
      }
      continue
    }
    const setextLine = lines[lineIndex + 1]
    const setextLevel =
      setextLine === undefined ? undefined : setextHeadingLevel(source, setextLine)
    if (setextLine !== undefined && setextLevel !== undefined) {
      blocks.push(createNode(
        'heading',
        line.start,
        setextLine.contentEnd,
        parseInlineNodes(
          source,
          line.contentOffset,
          line.contentEnd,
          constructs,
          referenceDefinitions
        ),
        { level: setextLevel, style: 'setext' }
      ))
      lineIndex += 2
      continue
    }
    if (isThematicBreak(source, line)) {
      blocks.push(createNode('thematic-break', line.start, line.contentEnd))
      lineIndex += 1
      continue
    }
    const literalNode =
      literal !== undefined && literal.start === line.start
        ? blockLiteralNode(source, literal)
        : undefined
    if (literal !== undefined && literalNode !== undefined) {
      blocks.push(literalNode)
      lineIndex += 1
      while (
        lineIndex < lines.length &&
        (lines[lineIndex]?.start ?? Number.POSITIVE_INFINITY) < literal.end
      ) {
        lineIndex += 1
      }
      literalIndex += 1
      continue
    }
    const paragraphStart = line.start
    let paragraphEnd = line.contentEnd
    let nextLineIndex = lineIndex + 1
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex]
      if (
        nextLine === undefined ||
        nextLine.blank ||
        nextLine.blockQuoteDepth > 0 ||
        parseAtxHeading(
          source,
          nextLine.start,
          nextLine.contentEnd,
          constructs,
          referenceDefinitions
        ) !== undefined ||
        nextLine.listMarkers.length > 0
      ) {
        break
      }
      paragraphEnd = nextLine.contentEnd
      nextLineIndex += 1
    }
    blocks.push(createNode(
      'paragraph',
      paragraphStart,
      paragraphEnd,
      parseInlineNodes(
        source,
        paragraphStart,
        paragraphEnd,
        constructs,
        referenceDefinitions
      )
    ))
    lineIndex = nextLineIndex
  }
  return Object.freeze(blocks)
}

function containsPosition(
  range: ViewRange,
  offset: number,
  affinity: 'previous' | 'next'
): boolean {
  if (range.start === range.end) {
    return offset === range.start
  }
  return (
    (range.start < offset && offset < range.end) ||
    (offset === range.start && affinity === 'next') ||
    (offset === range.end && affinity === 'previous')
  )
}

export function parseMarkdownDocument(
  lane: MappedMarkdownLane,
  containerDepthLimit: number = Number.POSITIVE_INFINITY
): Profile1MarkdownParse {
  const source = lane.source
  const parsedLane = parsePlainMarkdownLane(source, containerDepthLimit)
  const literals = parsedLane.literals.map(
    (literal): MappedMarkdownLiteral => Object.freeze({
      provider: literal.kind,
      start: literal.start,
      end: literal.end,
      ...(literal.construct === undefined
        ? {}
        : { construct: literal.construct }),
      ...(literal.blockKind === undefined
        ? {}
        : { blockKind: literal.blockKind })
    })
  )
  const referenceDefinitions = new Set<string>()
  for (const literal of parsedLane.literals) {
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
  const children =
    source.length === 0
      ? Object.freeze([])
      : parseBlocks(
        source,
        literals,
        parsedLane.lines,
        referenceDefinitions
      )
  const root = createNode('document', 0, source.length, children)
  const nodeAt = Object.freeze((
    projectedOffset: number,
    affinity: 'previous' | 'next'
  ): readonly MarkdownNode[] => {
    if (
      !Number.isInteger(projectedOffset) ||
      projectedOffset < 0 ||
      projectedOffset > source.length
    ) {
      throw new RangeError('Projected Markdown position is outside the document')
    }
    if (affinity !== 'previous' && affinity !== 'next') {
      throw new RangeError(`Unknown projected Markdown affinity: ${String(affinity)}`)
    }
    const path: MarkdownNode[] = [root]
    let current = root
    while (current.childCount > 0) {
      let selected: MarkdownNode | undefined
      for (let ordinal = 0; ordinal < current.childCount; ordinal += 1) {
        const child = current.childAt(ordinal)
        if (containsPosition(child.range, projectedOffset, affinity)) {
          selected = child
          break
        }
      }
      if (selected === undefined) {
        break
      }
      path.push(selected)
      current = selected
    }
    return Object.freeze(path)
  })
  return Object.freeze({
    document: Object.freeze({ source, root, nodeAt }),
    containerDepthFailure: parsedLane.containerDepthFailure
  })
}
