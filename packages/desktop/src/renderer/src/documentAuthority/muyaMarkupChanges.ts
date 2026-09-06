import type {
  MarkdownAstNode, MarkupCoordinateSegment, MarkupRegionProjectionChange,
  MarkupRegionReplacement, ProjectionAffinity, ProjectionCoordinateMap, SourceRange
} from '@marktext/document-core'
import { createMuyaMarkupView, type MuyaMarkupBinding, type MuyaMarkupView } from './muyaMarkupView'

const shiftRange = (range: SourceRange, delta: number): SourceRange => ({ start: range.start + delta, end: range.end + delta })

/** A regional reply carries only canonical runs; gaps are omitted/generated text. */
const coordinatesOf = (replacement: MarkupRegionReplacement): ProjectionCoordinateMap => {
  const runs = replacement.coordinates
  const position = (offset: number, from: 'source' | 'projected', affinity: ProjectionAffinity): number => {
    const to = from === 'source' ? 'projected' : 'source'
    let low = 0
    let high = runs.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (runs[middle][from].end < offset || (affinity === 'next' && runs[middle][from].end === offset)) low = middle + 1
      else high = middle
    }
    const next = runs[low]
    if (next !== undefined && next[from].start <= offset) return next[to].start + offset - next[from].start
    const previous = runs[low - 1]
    if (affinity === 'previous') return previous?.[to].end ?? next?.[to].start ?? replacement.next[to === 'source' ? 'source' : 'syntax'].start
    return next?.[to].start ?? previous?.[to].end ?? replacement.next[to === 'source' ? 'source' : 'syntax'].end
  }
  return {
    toSource: (offset, affinity) => position(offset, 'projected', affinity),
    toProjected: (offset, affinity) => position(offset, 'source', affinity),
    intersectsSource: range => range.start < range.end && runs.some(run => run.source.start < range.end && run.source.end > range.start),
    originAt: offset => {
      const run = runs.find(run => run.projected.start <= offset && run.projected.end > offset)
      return run === undefined
        ? { kind: 'generated', sourcePosition: position(offset, 'projected', 'next'), affinity: 'next' }
        : { kind: 'source', sourceOffset: run.source.start + offset - run.projected.start }
    }
  }
}

// Refuse missing Comment content rather than silently dropping its anchor.
// Text plus the delimiters of balanced visible marks must cover the source.
const completeSourceCoverage = (replacement: MarkupRegionReplacement): boolean => {
  const covered: SourceRange[] = []
  const active: Array<{ mark: Extract<MarkupRegionReplacement['events'][number], { kind: 'enter' }>['mark'], end: number }> = []
  for (const event of replacement.events) {
    if (event.kind === 'text') {
      if (event.text.length !== event.sourceRange.end - event.sourceRange.start) return false
      covered.push(event.sourceRange)
      for (const owner of active) owner.end = event.sourceRange.end
    } else if (event.kind === 'enter') {
      const range = event.mark.annotationRange
      covered.push({ start: range.start, end: range.start + 3 }, { start: range.end - 3, end: range.end })
      active.push({ mark: event.mark, end: range.start + 3 })
    } else {
      const owner = active.pop()
      if (owner?.mark !== event.mark || owner.end === owner.mark.annotationRange.start + 3) return false
      if (event.mark.kind === 'substitution' && event.mark.arm === 'old') covered.push({ start: owner.end, end: owner.end + 2 })
      for (const parent of active) parent.end = event.mark.annotationRange.end
    }
  }
  if (active.length > 0) return false
  covered.sort((left, right) => left.start - right.start)
  let cursor = replacement.next.source.start
  for (const range of covered) {
    if (range.start > cursor) return false
    cursor = Math.max(cursor, range.end)
  }
  return cursor === replacement.next.source.end
}

/** Locate paragraph spelling in compatibility text without interpreting Markdown. */
const markdownOffsets = (view: MuyaMarkupView): ((syntax: number) => number | undefined) | undefined => {
  const anchors: Array<{ syntax: number, text: number }> = [{ syntax: 0, text: 0 }]
  let cursor = 0
  for (const binding of view.bindings) {
    if (binding.text.length === 0) continue
    const start = view.markdown.indexOf(binding.text, cursor)
    if (start < 0) return undefined
    for (const segment of binding.segments) {
      anchors.push(
        { syntax: segment.syntax.start, text: start + segment.text.start },
        { syntax: segment.syntax.end, text: start + segment.text.end }
      )
    }
    cursor = start + binding.text.length
  }
  const last = anchors[anchors.length - 1]
  anchors.push({ syntax: last.syntax + view.markdown.length - last.text, text: view.markdown.length })
  return syntax => {
    let previous = anchors[0]
    for (const next of anchors) {
      if (syntax === next.syntax) return next.text
      if (syntax < next.syntax) {
        if (next.text === previous.text) return previous.text
        return next.syntax - previous.syntax === next.text - previous.text
          ? previous.text + syntax - previous.syntax
          : undefined
      }
      previous = next
    }
    return undefined
  }
}

const shiftSyntax = (node: MarkdownAstNode, delta: number): MarkdownAstNode => delta === 0
  ? node
  : ({
    ...node,
    range: shiftRange(node.range, delta),
    attributes: Object.fromEntries(Object.entries(node.attributes).map(([key, value]) =>
      [key, typeof value === 'number' && /(?:Start|End)$/u.test(key) ? value + delta : value])),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: node.semanticTextSegments.map(segment => ({ ...segment, range: shiftRange(segment.range, delta) }))
      }),
    children: node.children.map(child => shiftSyntax(child, delta))
  })

const validCoordinates = (coordinates: readonly MarkupCoordinateSegment[]): boolean => coordinates.length > 0 && coordinates.every((segment, index) =>
  segment.projected.end - segment.projected.start === segment.source.end - segment.source.start &&
  segment.projected.end >= segment.projected.start && (index === 0 ||
    (segment.projected.start >= coordinates[index - 1].projected.end && segment.source.start >= coordinates[index - 1].source.end)))

/**
 * Consume portable Core regions replacing top-level paragraphs. Untouched block shapes
 * retain their native state and mapped leaves. Changed structural blocks,
 * missing comment inventory, or ambiguous ranges request the full-view fallback.
 * Retained state objects are reused; only changed regions visit the view builder.
 */
export function applyMuyaMarkupChanges(previous: MuyaMarkupView, change: MarkupRegionProjectionChange): MuyaMarkupView | undefined {
  if (change.replacements.length === 0) return previous
  const byRoot = new Map<number, MuyaMarkupBinding[]>()
  for (const binding of previous.bindings) {
    const root = binding.path[0]
    if (typeof root !== 'number' || !Number.isSafeInteger(root) || root < 0 || root >= previous.state.length) return undefined
    const group = byRoot.get(root) ?? []
    group.push(binding)
    byRoot.set(root, group)
  }
  const offset = markdownOffsets(previous)
  if (offset === undefined) return undefined
  const replacements = [...change.replacements].sort((left, right) => left.previous.syntax.start - right.previous.syntax.start)
  const state: MuyaMarkupView['state'][number][] = []
  const bindings: MuyaMarkupBinding[] = []
  const decorations: MuyaMarkupView['decorations'][number][] = []
  const comments: MuyaMarkupView['comments'][number][] = []
  const markdown: string[] = []
  let previousIndex = 0
  let markdownIndex = 0
  let sourceDelta = 0
  let syntaxDelta = 0
  const retainUntil = (end: number): void => {
    const start = previousIndex
    const pathDelta = state.length - start
    for (; previousIndex < end; previousIndex += 1) {
      state.push(previous.state[previousIndex])
      for (const binding of byRoot.get(previousIndex) ?? []) {
        bindings.push(sourceDelta === 0 && syntaxDelta === 0 && pathDelta === 0
          ? binding
          : {
            ...binding,
            path: [previousIndex + pathDelta, ...binding.path.slice(1)],
            sourceRange: shiftRange(binding.sourceRange, sourceDelta),
            ...(binding.documentEnd === undefined
              ? {}
              : {
                documentEnd: { ...binding.documentEnd, offset: binding.documentEnd.offset + sourceDelta }
              }),
            ...(binding.containerPrefix === undefined
              ? {}
              : {
                containerPrefix: { ...binding.containerPrefix, range: shiftRange(binding.containerPrefix.range, sourceDelta) }
              }),
            ...(binding.paragraphPrefixPosition === undefined
              ? {}
              : {
                paragraphPrefixPosition: binding.paragraphPrefixPosition + sourceDelta
              }),
            ...(binding.outerBlock === undefined
              ? {}
              : {
                outerBlock: {
                  ...binding.outerBlock, range: shiftRange(binding.outerBlock.range, sourceDelta)
                }
              }),
            ...(binding.sourceStructure === undefined
              ? {}
              : {
                sourceStructure: {
                  ...binding.sourceStructure,
                  range: shiftRange(binding.sourceStructure.range, sourceDelta),
                  nodes: binding.sourceStructure.nodes.map(node => ({
                    ...node,
                    path: [Number(node.path[0]) + pathDelta, ...node.path.slice(1)],
                    range: shiftRange(node.range, sourceDelta),
                    ...(node.lineStarts === undefined ? {} : { lineStarts: node.lineStarts.map(offset => offset + sourceDelta) }),
                    ...(node.delimiterRange === undefined ? {} : { delimiterRange: shiftRange(node.delimiterRange, sourceDelta) }),
                    ...(node.delimiterCells === undefined ? {} : { delimiterCells: node.delimiterCells.map(range => shiftRange(range, sourceDelta)) })
                  }))
                }
              }),
            syntax: shiftSyntax(binding.syntax, syntaxDelta),
            segments: binding.segments.map(segment => ({ ...segment, source: shiftRange(segment.source, sourceDelta), syntax: shiftRange(segment.syntax, syntaxDelta) }))
          })
      }
    }
    for (const decoration of previous.decorations) {
      const index = Number(decoration.path[0])
      if (index >= start && index < end) {
        decorations.push({
          ...decoration, path: [index + pathDelta, ...decoration.path.slice(1)], mark: { ...decoration.mark, annotationRange: shiftRange(decoration.mark.annotationRange, sourceDelta) }
        })
      }
    }
    for (const comment of previous.comments) {
      const index = Number(comment.path[0])
      if (index >= start && index < end) {
        comments.push({
          ...comment, path: [index + pathDelta, ...comment.path.slice(1)], annotationRange: shiftRange(comment.annotationRange, sourceDelta)
        })
      }
    }
  }
  for (const replacement of replacements) {
    if (replacement.next.source.start !== replacement.previous.source.start + sourceDelta ||
        replacement.next.syntax.start !== replacement.previous.syntax.start + syntaxDelta) return undefined
    if (replacement.syntaxBlocks.some(node => node.kind !== 'paragraph') || replacement.syntaxBlocks.length === 0 ||
        !validCoordinates(replacement.coordinates) || !completeSourceCoverage(replacement)) return undefined
    const firstBinding = previous.bindings.find(binding => binding.syntax.range.end > replacement.previous.syntax.start ||
      (binding.text.length === 0 && binding.syntax.range.start >= replacement.previous.syntax.start))
    const start = firstBinding?.path[0]
    if (typeof start !== 'number' || firstBinding?.syntax.range.start !== replacement.previous.syntax.start) return undefined
    if (start < previousIndex || start < 0) return undefined
    let end = start
    while (end < previous.state.length) {
      const group = byRoot.get(end)
      const binding = group?.[0]
      if (binding === undefined || !(binding.syntax.range.start < replacement.previous.syntax.end ||
          (binding.text.length === 0 && binding.syntax.range.start === replacement.previous.syntax.end))) break
      if (group?.length !== 1 || previous.state[end].name !== 'paragraph' || binding.syntax.kind !== 'paragraph' ||
          binding.path.length !== 2 || binding.path[1] !== 'text' ||
          binding.syntax.range.start < replacement.previous.syntax.start || binding.syntax.range.end > replacement.previous.syntax.end ||
          binding.sourceRange.start < replacement.previous.source.start || binding.sourceRange.end > replacement.previous.source.end) return undefined
      end += 1
    }
    if (end === start) return undefined
    const from = offset(replacement.previous.syntax.start)
    const to = offset(replacement.previous.syntax.end)
    if (from === undefined || to === undefined || from < markdownIndex) return undefined
    if (previous.comments.some(comment => {
      const index = Number(comment.path[0])
      return index >= start && index < end || comment.annotationRange.start < replacement.previous.source.end && comment.annotationRange.end > replacement.previous.source.start
    })) return undefined
    // Multi-paragraph annotation owners and reference dependencies require a
    // complete inventory, which this first paragraph slice deliberately lacks.
    for (const decoration of previous.decorations) {
      const range = decoration.mark.annotationRange
      if (range.start < replacement.previous.source.start && range.end > replacement.previous.source.start ||
          range.start < replacement.previous.source.end && range.end > replacement.previous.source.end) return undefined
    }
    retainUntil(start)
    const local = createMuyaMarkupView({
      kind: 'markup',
      name: 'markup',
      events: replacement.events,
      syntax: { ast: { root: { kind: 'document', range: replacement.next.syntax, attributes: {}, children: replacement.syntaxBlocks } }, coordinates: coordinatesOf(replacement) }
    })
    const localLength = end === previous.state.length ? local.bindings.length : replacement.syntaxBlocks.length
    const base = state.length
    state.push(...local.state.slice(0, localLength))
    const expectedEnd = previous.bindings.at(-1)?.documentEnd
    if (end === previous.state.length && expectedEnd !== undefined && local.bindings.at(-1)?.documentEnd?.offset !==
        expectedEnd.offset + replacement.next.source.end - replacement.previous.source.end) return undefined
    bindings.push(...local.bindings.slice(0, localLength).map(binding => {
      const { documentEnd, ...rest } = binding
      return {
        ...rest,
        ...(end === previous.state.length && documentEnd !== undefined ? { documentEnd } : {}),
        path: [Number(binding.path[0]) + base, 'text']
      }
    }))
    decorations.push(...local.decorations.filter(decoration => Number(decoration.path[0]) < localLength).map(decoration =>
      ({ ...decoration, path: [Number(decoration.path[0]) + base, 'text'] })))
    markdown.push(previous.markdown.slice(markdownIndex, from), local.markdown)
    markdownIndex = to
    previousIndex = end
    sourceDelta = replacement.next.source.end - replacement.previous.source.end
    syntaxDelta = replacement.next.syntax.end - replacement.previous.syntax.end
  }
  retainUntil(previous.state.length)
  markdown.push(previous.markdown.slice(markdownIndex))
  return { kind: 'view', markdown: markdown.join(''), state, bindings, decorations, comments }
}
