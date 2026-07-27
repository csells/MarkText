import type {
  DocumentLiveRenderPlan,
  ModelRange
} from '../documentSession.js'
import type {
  CompleteDocumentRevision,
  MarkdownDocument,
  MarkdownNode,
  MarkdownNodeKind,
  MarkupMark,
  SourceOffset,
  SourceRange
} from '../revision.js'
import {
  markdownTextValue,
  markdownTextValueSegments
} from '../materialize/htmlRender.js'

/**
 * The block AST of a revision's canonical (marker-bearing) editing view — the
 * structure a WYSIWYG editor renders, which the engine must own so the view
 * mounts rather than re-parses it.
 *
 * ADR 0013: the engine parses once and reads every view off it; the editing view
 * is that parse. The block AST is the editing view's Markdown tree — markers
 * zero-width, all content present (both Substitution arms, old then new). For a
 * CriticMarkup-free document the editing view is the source itself, so this is
 * the shared parse the engine already builds; the projection is lazy, so reading
 * it here never adds a parse to `open()`.
 */
export function canonicalMarkupDocument(
  revision: CompleteDocumentRevision
): MarkdownDocument {
  return revision.projection('editing').markdown
}

/**
 * The editing-view element a CriticMarkup mark renders as, following the
 * documented CriticMarkup presentation: additions are insertions, deletions and
 * a substitution's old arm are deletions, a substitution's new arm is an
 * insertion, and a highlight is a mark. Comments have no Markup-view element —
 * they are hidden and shown only in the sidebar — so no mark maps to them here.
 */
export type MarkupRenderElement = 'ins' | 'del' | 'mark'

/**
 * One render run: the run's text plus the ordered element wrappers (outermost
 * first) a view mounts around it, keeping the model↔source mapping the view
 * needs for selection and editing. A run with no marks has no wrappers and is
 * plain text.
 */
export interface MarkupRenderRun {
  readonly key: string
  readonly text: string
  readonly elements: readonly MarkupRenderElement[]
  readonly modelRange: ModelRange
  readonly sourceRange: SourceRange
}

/**
 * One visible text carrier in the semantic live tree.
 *
 * `boundaryMapping` carries the parser-issued coordinate rule without a
 * source-unit-sized vector. Identity text maps interior boundaries linearly;
 * collapsed syntax (for example `&amp;`) maps nonterminal rendered
 * boundaries to each range's start and the terminal boundary to its end.
 */
export interface MarkupRenderText {
  readonly key: string
  readonly text: string
  readonly elements: readonly MarkupRenderElement[]
  readonly modelRange: ModelRange
  readonly sourceRange: SourceRange
  readonly boundaryMapping: 'identity' | 'collapsed'
}

/**
 * Parser-owned hierarchical descriptor for one Markdown semantic node.
 *
 * The descriptor is functions-free and can cross the main/renderer wire
 * unchanged. A renderer chooses inert DOM elements for these already-decided
 * semantics; it never reads source syntax or recognizes Markdown itself.
 */
export interface MarkupRenderNode {
  readonly key: string
  readonly kind: MarkdownNodeKind
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly modelRange: ModelRange
  readonly elements: readonly MarkupRenderElement[]
  readonly text: readonly MarkupRenderText[]
  readonly children: readonly MarkupRenderNode[]
}

/**
 * One rendered line: the render runs whose text falls on this line (none
 * containing `\n`) and whether a newline terminates it. A view mounts one block
 * element per line; markdown block *semantics* (which lines form a heading or a
 * list) are the view's concern, computed from these lines' model↔source ranges.
 */
export interface MarkupRenderLine {
  readonly runs: readonly MarkupRenderRun[]
  /**
   * The line's content span in model offsets, excluding the terminating
   * newline. Present even for a blank line (a zero-width span), so a view can
   * place a caret on any line — including empty ones — and translate it back to
   * a model position.
   */
  readonly modelRange: ModelRange
  readonly endsWithNewline: boolean
}

export function markupRenderElement(mark: MarkupMark): MarkupRenderElement {
  switch (mark.kind) {
    case 'addition':
      return 'ins'
    case 'deletion':
      return 'del'
    case 'highlight':
      return 'mark'
    case 'substitution':
      return mark.arm === 'old' ? 'del' : 'ins'
  }
}

/**
 * Turn an engine-produced `MarkupLiveRenderPlan` into the render runs a WYSIWYG
 * view mounts. Pure and DOM-free: the view owns the actual DOM/vdom; this owns
 * the plan→structure mapping so the two are testable apart. Nested marks (CM
 * inside CM) become nested wrappers, outermost mark first.
 */
export function renderMarkupPlan(
  plan: DocumentLiveRenderPlan
): readonly MarkupRenderRun[] {
  return Object.freeze(plan.runs.map((run) => Object.freeze({
    key: run.key,
    text: run.text,
    elements: Object.freeze(run.marks.map(markupRenderElement)),
    modelRange: run.modelRange,
    sourceRange: run.sourceRange
  })))
}

/**
 * One block a view mounts: the engine-emitted block node's kind and span, plus
 * the CriticMarkup-marked inline runs that fall inside it. A run straddling a
 * block boundary is split so each block carries only its own text.
 */
export interface MarkupRenderBlock {
  readonly kind: MarkdownNodeKind
  /**
   * The block node's parser-owned attributes — a heading's `level`, a list's
   * ordering. The view mounts these; deriving them itself would be a second
   * authority guessing at what the parser already decided.
   */
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly modelRange: ModelRange
  readonly runs: readonly MarkupRenderRun[]
  /** Complete semantic subtree rooted at this parser-emitted block. */
  readonly tree: MarkupRenderNode
}

/**
 * Join the engine's editing-view block AST with the CriticMarkup-marked inline
 * runs into the tree a WYSIWYG view mounts. The view never computes block
 * structure — it mounts what the parser emitted (ADR-0009/0013) — and never
 * loses the marks or the model↔source map it needs for selection and editing.
 *
 * Both inputs share one coordinate space: the editing projection's source is the
 * session's model text, so a block's range and a run's `modelRange` are directly
 * comparable.
 */
export function groupRenderBlocks(
  document: MarkdownDocument,
  runs: readonly MarkupRenderRun[]
): readonly MarkupRenderBlock[] {
  const state = createSemanticRenderState(document, runs)
  const root = document.root
  return Object.freeze(Array.from({ length: root.childCount }, (_, ordinal) => {
    const block = root.childAt(ordinal)
    const start = block.range.start
    const end = block.range.end
    const blockRuns: MarkupRenderRun[] = []
    for (const run of runs) {
      const overlapStart = Math.max(run.modelRange.start, start)
      const overlapEnd = Math.min(run.modelRange.end, end)
      if (overlapStart >= overlapEnd) {
        continue
      }
      blockRuns.push(
        overlapStart === run.modelRange.start && overlapEnd === run.modelRange.end
          ? run
          : sliceRenderRun(run, overlapStart, overlapEnd)
      )
    }
    return Object.freeze({
      kind: block.kind,
      attributes: block.attributes,
      modelRange: Object.freeze({ start, end }),
      runs: Object.freeze(blockRuns),
      tree: semanticRenderNode(block, state)
    })
  }))
}

interface SemanticRenderState {
  readonly document: MarkdownDocument
  readonly runs: readonly MarkupRenderRun[]
  readonly footnoteOrdinals: ReadonlyMap<string, number>
  readonly footnoteReferenceTotals: ReadonlyMap<string, number>
  readonly emittedFootnoteReferences: Map<string, number>
  readonly emittedNodeIdentities: Map<string, number>
}

function createSemanticRenderState(
  document: MarkdownDocument,
  runs: readonly MarkupRenderRun[]
): SemanticRenderState {
  const footnoteOrdinals = new Map<string, number>()
  const footnoteReferenceTotals = new Map<string, number>()
  for (
    let ordinal = 0;
    ordinal < document.references.footnoteReferenceCount;
    ordinal += 1
  ) {
    const reference = document.references.footnoteReferenceAt(ordinal)
    if (reference.definition === undefined) { continue }
    const label = reference.label
    if (!footnoteOrdinals.has(label)) {
      footnoteOrdinals.set(label, footnoteOrdinals.size + 1)
    }
    footnoteReferenceTotals.set(
      label,
      (footnoteReferenceTotals.get(label) ?? 0) + 1
    )
  }
  return {
    document,
    runs,
    footnoteOrdinals,
    footnoteReferenceTotals,
    emittedFootnoteReferences: new Map(),
    emittedNodeIdentities: new Map()
  }
}

function renderNodeIdentity(
  node: MarkdownNode,
  state: SemanticRenderState
): string {
  const identity = String(node.nodeId)
  const occurrence = (state.emittedNodeIdentities.get(identity) ?? 0) + 1
  state.emittedNodeIdentities.set(identity, occurrence)
  return occurrence === 1 ? identity : `${identity}#${String(occurrence)}`
}

function semanticRenderNode(
  node: MarkdownNode,
  state: SemanticRenderState
): MarkupRenderNode {
  const attributes: Record<string, string | number | boolean> = {
    ...node.attributes
  }
  const text: MarkupRenderText[] = []
  let children: readonly MarkupRenderNode[] = Object.freeze([])

  if (node.kind === 'text') {
    text.push(...markdownTextRuns(node.range.start, node.range.end, state))
  } else if (node.kind === 'soft-break') {
    text.push(...identityTextRuns(
      node.range.start,
      node.range.end,
      '\n',
      'collapsed',
      state
    ))
  } else if (node.kind === 'inline-code') {
    text.push(...inlineCodeTextRuns(node, state))
  } else if (
    node.kind === 'inline-math' ||
    node.kind === 'math-block' ||
    node.kind === 'diagram' ||
    node.kind === 'code-block' ||
    node.kind === 'html-block'
  ) {
    text.push(...literalContentTextRuns(node, state))
  } else if (node.kind === 'inline-html') {
    text.push(...identityTextRuns(
      node.range.start,
      node.range.end,
      state.document.source.slice(node.range.start, node.range.end),
      'identity',
      state
    ))
  } else if (node.kind === 'autolink') {
    const valueStart = Math.min(node.range.end, node.range.start + 1)
    const valueEnd = Math.max(valueStart, node.range.end - 1)
    const content = state.document.source.slice(valueStart, valueEnd)
    attributes['href'] = safeLiveUrl(
      AUTOLINK_EMAIL.test(content) ? `mailto:${content}` : content,
      'link'
    )
    text.push(...identityTextRuns(
      valueStart,
      valueEnd,
      content,
      'identity',
      state
    ))
  } else if (node.kind === 'footnote-reference') {
    const label = node.attributes['label']
    const ordinal = typeof label === 'string'
      ? state.footnoteOrdinals.get(label)
      : undefined
    if (typeof label === 'string' && ordinal !== undefined) {
      const occurrence =
        (state.emittedFootnoteReferences.get(label) ?? 0) + 1
      state.emittedFootnoteReferences.set(label, occurrence)
      attributes['resolved'] = true
      attributes['ordinal'] = ordinal
      attributes['referenceId'] = footnoteReferenceId(label, occurrence)
      attributes['definitionId'] = footnoteDefinitionId(label)
    } else {
      attributes['resolved'] = false
      text.push(...markdownTextRuns(node.range.start, node.range.end, state))
    }
  } else {
    children = semanticRenderChildren(node, state)
  }

  if (node.kind === 'link' || node.kind === 'image') {
    const target = resolveSemanticLinkTarget(node, state)
    if (target === undefined) {
      attributes['resolved'] = false
      children = Object.freeze([])
      text.push(...markdownTextRuns(
        node.range.start,
        node.range.end,
        state
      ))
    } else {
      attributes['resolved'] = true
      attributes[node.kind === 'image' ? 'src' : 'href'] =
        safeLiveUrl(
          markdownTextValue(target.destination),
          node.kind === 'image' ? 'image' : 'link'
        )
      if (target.title !== undefined) { attributes['title'] = markdownTextValue(target.title) }
      if (node.kind === 'image') {
        attributes['alt'] = semanticPlainText(node, state.document)
        children = Object.freeze([])
      }
    }
  }

  if (
    node.kind === 'code-block' &&
    typeof node.attributes['info'] === 'string'
  ) {
    attributes['language'] = markdownTextValue(
      node.attributes['info'].trim().split(/[\t ]/, 1)[0] ?? ''
    )
  }

  if (node.kind === 'footnote-definition') {
    const label = node.attributes['label']
    const ordinal = typeof label === 'string'
      ? state.footnoteOrdinals.get(label)
      : undefined
    attributes['referenced'] = ordinal !== undefined
    if (typeof label === 'string' && ordinal !== undefined) {
      attributes['ordinal'] = ordinal
      attributes['definitionId'] = footnoteDefinitionId(label)
      attributes['referenceTotal'] =
        state.footnoteReferenceTotals.get(label) ?? 0
    }
  }

  return Object.freeze({
    key: renderNodeIdentity(node, state),
    kind: node.kind,
    attributes: Object.freeze(attributes),
    modelRange: Object.freeze({
      start: node.range.start,
      end: node.range.end
    }),
    elements: elementsForRange(node.range.start, node.range.end, state.runs),
    text: Object.freeze(text),
    children
  })
}

/**
 * Inline-family parents need the CommonMark whitespace semantics the parser
 * already assigned to their text children. This trims only parser-owned text
 * ranges at line boundaries; it does not inspect source for structure.
 */
function semanticRenderChildren(
  parent: MarkdownNode,
  state: SemanticRenderState
): readonly MarkupRenderNode[] {
  const children: MarkupRenderNode[] = []
  const inlineFamily =
    parent.kind === 'paragraph' ||
    parent.kind === 'heading' ||
    parent.kind === 'table-cell'
  let atLineStart = true
  for (let ordinal = 0; ordinal < parent.childCount; ordinal += 1) {
    const child = parent.childAt(ordinal)
    if (!inlineFamily || child.kind !== 'text') {
      children.push(semanticRenderNode(child, state))
      atLineStart =
        child.kind === 'soft-break' || child.kind === 'hard-break'
      continue
    }
    let start = child.range.start
    let end = child.range.end
    if (atLineStart) {
      while (
        start < end &&
        (
          state.document.source.charCodeAt(start) === 32 ||
          state.document.source.charCodeAt(start) === 9
        )
      ) {
        start += 1
      }
    }
    const next = ordinal + 1 < parent.childCount
      ? parent.childAt(ordinal + 1)
      : undefined
    if (next === undefined || next.kind === 'soft-break') {
      while (
        end > start &&
        (
          state.document.source.charCodeAt(end - 1) === 32 ||
          state.document.source.charCodeAt(end - 1) === 9
        )
      ) {
        end -= 1
      }
    }
    const rendered = semanticRenderNode(child, state)
    children.push(Object.freeze({
      ...rendered,
      text: Object.freeze(markdownTextRuns(
        start,
        end,
        state,
        end < child.range.end ? child.range.end : end
      ))
    }))
    atLineStart = false
  }
  return Object.freeze(children)
}

function markdownTextRuns(
  start: number,
  end: number,
  state: SemanticRenderState,
  trailingBoundary: number = end
): readonly MarkupRenderText[] {
  if (end <= start) return Object.freeze([])
  const raw = state.document.source.slice(start, end)
  const decoded = markdownTextValueSegments(raw, start)
  const result: MarkupRenderText[] = []
  for (const segment of decoded) {
    result.push(...identityTextRuns(
      segment.inputRange.start,
      segment.inputRange.end,
      segment.text,
      segment.boundaryMapping,
      state
    ))
  }
  if (result.length === 0 || trailingBoundary === end) { return Object.freeze(result) }

  const lastIndex = result.length - 1
  const last = result[lastIndex]
  if (last === undefined) { return Object.freeze(result) }

  const owner = state.runs.find(
    (run) =>
      trailingBoundary >= run.modelRange.start &&
      trailingBoundary <= run.modelRange.end
  ) ?? state.runs.find(
    (run) => run.modelRange.end === trailingBoundary
  )
  const sourceBoundary = owner === undefined
    ? last.sourceRange.end
    : owner.sourceRange.start +
      trailingBoundary -
      owner.modelRange.start
  result[lastIndex] = Object.freeze({
    ...last,
    modelRange: Object.freeze({
      start: last.modelRange.start,
      end: trailingBoundary
    }),
    sourceRange: Object.freeze({
      start: last.sourceRange.start,
      end: sourceBoundary as SourceOffset
    })
  })
  return Object.freeze(result)
}

function identityTextRuns(
  start: number,
  end: number,
  text: string,
  boundaryMapping: MarkupRenderText['boundaryMapping'],
  state: SemanticRenderState
): readonly MarkupRenderText[] {
  if (text.length === 0) return Object.freeze([])
  const owners = state.runs.filter(
    (run) => run.modelRange.start < end && start < run.modelRange.end
  )
  const owner = owners[0] ?? state.runs.find(
    (run) => start >= run.modelRange.start && start <= run.modelRange.end
  )
  if (owner === undefined) return Object.freeze([])

  const isIdentity =
    boundaryMapping === 'identity' &&
    text.length === end - start &&
    end >= start
  if (isIdentity && owners.length > 1) {
    const parts: MarkupRenderText[] = []
    for (const run of owners) {
      const partStart = Math.max(start, run.modelRange.start)
      const partEnd = Math.min(end, run.modelRange.end)
      if (partStart >= partEnd) continue
      parts.push(makeTextRun(
        text.slice(partStart - start, partEnd - start),
        partStart,
        partEnd,
        'identity',
        run
      ))
    }
    return Object.freeze(parts)
  }
  return Object.freeze([
    makeTextRun(text, start, end, boundaryMapping, owner)
  ])
}

function makeTextRun(
  text: string,
  modelStart: number,
  modelEnd: number,
  boundaryMapping: MarkupRenderText['boundaryMapping'],
  owner: MarkupRenderRun
): MarkupRenderText {
  const sourceOffset = (offset: number): number => {
    const bounded = Math.max(
      owner.modelRange.start,
      Math.min(owner.modelRange.end, offset)
    )
    return owner.sourceRange.start + bounded - owner.modelRange.start
  }
  const sourceStart = sourceOffset(modelStart)
  const sourceEnd = sourceOffset(modelEnd)
  return Object.freeze({
    key: `${owner.key}:semantic:${String(modelStart)}`,
    text,
    elements: owner.elements,
    modelRange: Object.freeze({ start: modelStart, end: modelEnd }),
    sourceRange: Object.freeze({
      start: sourceStart as SourceOffset,
      end: sourceEnd as SourceOffset
    }),
    boundaryMapping
  })
}

function inlineCodeTextRuns(
  node: MarkdownNode,
  state: SemanticRenderState
): readonly MarkupRenderText[] {
  const markerLength = Number(node.attributes['markerLength'] ?? 1)
  let start = Number(
    node.attributes['contentStart'] ?? node.range.start + markerLength
  )
  let end = Number(
    node.attributes['contentEnd'] ?? node.range.end - markerLength
  )
  let raw = state.document.source.slice(start, end)
  if (
    raw.length >= 2 &&
    raw.startsWith(' ') &&
    raw.endsWith(' ') &&
    raw.trim() !== ''
  ) {
    start += 1
    end -= 1
    raw = raw.slice(1, -1)
  }
  const parts: MarkupRenderText[] = []
  let cursor = 0
  while (cursor < raw.length) {
    const code = raw.charCodeAt(cursor)
    if (code === 10 || code === 13) {
      const width =
        code === 13 && raw.charCodeAt(cursor + 1) === 10 ? 2 : 1
      parts.push(...identityTextRuns(
        start + cursor,
        start + cursor + width,
        ' ',
        'collapsed',
        state
      ))
      cursor += width
      continue
    }
    let next = cursor + 1
    while (
      next < raw.length &&
      raw.charCodeAt(next) !== 10 &&
      raw.charCodeAt(next) !== 13
    ) {
      next += 1
    }
    parts.push(...identityTextRuns(
      start + cursor,
      start + next,
      raw.slice(cursor, next),
      'identity',
      state
    ))
    cursor = next
  }
  return Object.freeze(parts)
}

function literalContentTextRuns(
  node: MarkdownNode,
  state: SemanticRenderState
): readonly MarkupRenderText[] {
  const content = String(
    node.attributes['content'] ??
    state.document.source.slice(node.range.start, node.range.end)
  )
  const start = Number(node.attributes['contentStart'] ?? node.range.start)
  const end = Number(node.attributes['contentEnd'] ?? node.range.end)
  return identityTextRuns(
    start,
    end,
    content,
    content.length === end - start ? 'identity' : 'collapsed',
    state
  )
}

function elementsForRange(
  start: number,
  end: number,
  runs: readonly MarkupRenderRun[]
): readonly MarkupRenderElement[] {
  return runs.find(
    (run) => run.modelRange.start < end && start < run.modelRange.end
  )?.elements ?? Object.freeze([])
}

interface SemanticLinkTarget {
  readonly destination: string
  readonly title?: string
}

function resolveSemanticLinkTarget(
  node: MarkdownNode,
  state: SemanticRenderState
): SemanticLinkTarget | undefined {
  const target = state.document.references.linkForNode(node.nodeId)
  return target === undefined
    ? undefined
    : {
      destination: target.destination,
      ...(target.title === undefined ? {} : { title: target.title })
    }
}

function semanticPlainText(
  node: MarkdownNode,
  document: MarkdownDocument
): string {
  const parts: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const child = node.childAt(ordinal)
    if (child.kind === 'text') {
      parts.push(markdownTextValue(
        document.source.slice(child.range.start, child.range.end)
      ))
    } else if (child.kind === 'inline-code') {
      const markerLength = Number(child.attributes['markerLength'] ?? 1)
      parts.push(document.source.slice(
        child.range.start + markerLength,
        child.range.end - markerLength
      ))
    } else if (child.kind === 'soft-break' || child.kind === 'hard-break') {
      parts.push(' ')
    } else {
      parts.push(semanticPlainText(child, document))
    }
  }
  return parts.join('')
}

const AUTOLINK_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function safeLiveUrl(url: string, consumer: 'image' | 'link'): string {
  let normalized = ''
  for (const character of url) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint > 0x20 && codePoint !== 0x7f) { normalized += character.toLowerCase() }
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1]
  if (scheme === undefined) return url
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
    return url
  }
  if (
    consumer === 'image' &&
    (
      scheme === 'blob' ||
      (
        scheme === 'data' &&
        /^data:image\/(?:jpeg|png|gif|webp|svg\+xml)(?:[;,])/i.test(url)
      )
    )
  ) {
    return url
  }
  return ''
}

function footnoteAddress(label: string): string {
  return encodeURIComponent(label)
}

function footnoteReferenceId(label: string, occurrence: number): string {
  const suffix = occurrence === 1 ? '' : `-${String(occurrence)}`
  return `fnref-${footnoteAddress(label)}${suffix}`
}

function footnoteDefinitionId(label: string): string {
  return `fn-${footnoteAddress(label)}`
}

/**
 * Where the caret or a click sits in view terms: which mounted block, which run
 * inside it, and how many UTF-16 code units into that run's text. `offset` may
 * equal the run's length, meaning the boundary just past its last character.
 */
export interface MarkupViewPosition {
  readonly blockIndex: number
  readonly runIndex: number
  readonly offset: number
}

/**
 * The model offset a view position denotes. Every editor intent addresses the
 * model, so this is the translation a view performs before dispatching one — it
 * reads the engine-emitted mapping the run already carries rather than counting
 * rendered DOM text.
 *
 * @throws RangeError when the position is not a position in these blocks.
 */
export function modelOffsetAt(
  blocks: readonly MarkupRenderBlock[],
  position: MarkupViewPosition
): number {
  const block = blocks[position.blockIndex]
  if (block === undefined) {
    throw new RangeError(`No mounted block at index ${position.blockIndex}`)
  }
  const run = block.runs[position.runIndex]
  if (run === undefined) {
    // A block with no runs (an empty paragraph) still has a caret position.
    if (position.runIndex === 0 && position.offset === 0) {
      return block.modelRange.start
    }
    throw new RangeError(`No run at index ${position.runIndex}`)
  }
  if (position.offset < 0 || position.offset > run.text.length) {
    throw new RangeError(`Offset ${position.offset} is outside the run`)
  }
  return run.modelRange.start + position.offset
}

/**
 * The view position that renders a model offset — the reverse of
 * `modelOffsetAt`, used to place the caret after the model changes.
 *
 * An offset between two runs is genuinely two positions: the trailing edge of
 * the earlier run and the leading edge of the later one. `affinity` picks the
 * side, matching `ModelPosition.affinity`. At a CriticMarkup boundary the choice
 * is meaningful — `'next'` puts the caret inside the following run, so typing at
 * the start of an addition extends the addition, while `'previous'` keeps it in
 * the preceding text.
 *
 * @throws RangeError when the offset is not rendered by these blocks.
 */
export function viewPositionAt(
  blocks: readonly MarkupRenderBlock[],
  modelOffset: number,
  affinity: 'previous' | 'next' = 'next'
): MarkupViewPosition {
  const candidates: MarkupViewPosition[] = []
  for (const [blockIndex, block] of blocks.entries()) {
    if (modelOffset < block.modelRange.start || modelOffset > block.modelRange.end) {
      continue
    }
    for (const [runIndex, run] of block.runs.entries()) {
      if (modelOffset < run.modelRange.start || modelOffset > run.modelRange.end) {
        continue
      }
      candidates.push({
        blockIndex,
        runIndex,
        offset: modelOffset - run.modelRange.start
      })
    }
    // A block with no runs (an empty paragraph) still hosts a caret.
    if (block.runs.length === 0 && modelOffset === block.modelRange.start) {
      candidates.push({ blockIndex, runIndex: 0, offset: 0 })
    }
  }
  const preferred = affinity === 'next'
    // Leading edge of the later run; fall back to the only candidate there is.
    ? candidates.find((candidate) => candidate.offset === 0) ?? candidates[0]
    // Trailing edge of the earlier run.
    : candidates.find((candidate) => candidate.offset !== 0) ?? candidates[0]
  if (preferred === undefined) {
    throw new RangeError(`Model offset ${modelOffset} is not rendered`)
  }
  return Object.freeze(preferred)
}

/** The `[from, to)` model-offset slice of a run, keeping its marks and mapping. */
function sliceRenderRun(
  run: MarkupRenderRun,
  from: number,
  to: number
): MarkupRenderRun {
  const offset = from - run.modelRange.start
  const length = to - from
  return Object.freeze({
    key: `${run.key}:${offset}`,
    text: run.text.slice(offset, offset + length),
    elements: run.elements,
    modelRange: Object.freeze({ start: from, end: to }),
    sourceRange: Object.freeze({
      start: (run.sourceRange.start + offset) as SourceOffset,
      end: (run.sourceRange.start + offset + length) as SourceOffset
    })
  })
}

/**
 * Split render runs into lines at newline boundaries. A run whose text spans a
 * newline is divided into per-line sub-runs that keep the run's element
 * wrappers and carry the exact model/source sub-ranges, so a CriticMarkup mark
 * spanning a newline stays on both halves and the view keeps a total
 * model↔source map. The `\n` itself is a line terminator, not run content;
 * joining line texts with `\n` reproduces the model text.
 */
export function groupRenderLines(
  runs: readonly MarkupRenderRun[]
): readonly MarkupRenderLine[] {
  const lines: MarkupRenderLine[] = []
  let current: MarkupRenderRun[] = []
  let lineStart = runs[0]?.modelRange.start ?? 0
  let modelEnd = lineStart
  const closeLine = (contentEnd: number, endsWithNewline: boolean): void => {
    lines.push(Object.freeze({
      runs: Object.freeze(current),
      modelRange: Object.freeze({ start: lineStart, end: contentEnd }),
      endsWithNewline
    }))
    current = []
    lineStart = endsWithNewline ? contentEnd + 1 : contentEnd
  }

  for (const run of runs) {
    let segmentStart = 0
    for (let index = 0; index <= run.text.length; index += 1) {
      const atNewline = index < run.text.length && run.text.charCodeAt(index) === 10
      if (!atNewline && index !== run.text.length) {
        continue
      }
      // Emit a sub-run for [segmentStart, index) only when it has content; a
      // zero-length segment (e.g. an empty line) contributes no zero-width run.
      if (index > segmentStart) {
        current.push(Object.freeze({
          key: `${run.key}:${segmentStart}`,
          text: run.text.slice(segmentStart, index),
          elements: run.elements,
          modelRange: Object.freeze({
            start: run.modelRange.start + segmentStart,
            end: run.modelRange.start + index
          }),
          sourceRange: Object.freeze({
            start: (run.sourceRange.start + segmentStart) as SourceOffset,
            end: (run.sourceRange.start + index) as SourceOffset
          })
        }))
      }
      if (atNewline) {
        closeLine(run.modelRange.start + index, true)
        segmentStart = index + 1
      }
    }
    modelEnd = run.modelRange.end
  }
  closeLine(Math.max(lineStart, modelEnd), false)
  return Object.freeze(lines)
}
