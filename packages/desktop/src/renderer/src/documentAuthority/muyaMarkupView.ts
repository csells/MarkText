import type {
  CriticMarkupAnnotation,
  MarkdownAstNode,
  MarkupMark,
  MarkupProjection,
  ProjectionAffinity,
  SourceRange
} from '@marktext/document-core'

export interface MuyaMarkupSourceSegment {
  readonly text: SourceRange
  readonly source: SourceRange
  /** Coordinates in the Core-owned editing syntax, including generated protection. */
  readonly syntax: SourceRange
}

export type MuyaMarkupPath = readonly (number | string)[]

export interface MuyaMarkupState {
  readonly name: string
  text?: string
  readonly meta?: Readonly<Record<string, string | number | boolean>>
  readonly children?: readonly MuyaMarkupState[]
}

export interface MuyaDocumentEnd {
  readonly offset: number
  readonly trailingLineEndings: string
  readonly lineEnding: string
}

export interface MuyaSourceStructure {
  readonly range: SourceRange
  readonly source: string
  readonly linePrefix?: string
  readonly nodes: readonly Readonly<{
    path: MuyaMarkupPath
    kind: string
    range: SourceRange
    lineStarts?: readonly number[]
    delimiterRange?: SourceRange
    delimiterCells?: readonly SourceRange[]
    checkboxRange?: SourceRange
  }>[]
}

export interface MuyaMarkupBinding {
  readonly path: MuyaMarkupPath
  readonly text: string
  readonly sourceRange: SourceRange
  readonly segments: readonly MuyaMarkupSourceSegment[]
  readonly syntax: MarkdownAstNode
  readonly listContinuation?: Readonly<{ prefix: string, lineEnding: string }>
  readonly annotationContext?: true
  readonly outerBlock?: Readonly<{ range: SourceRange, source: string, followingSource?: string }>
  readonly documentEnd?: MuyaDocumentEnd
  readonly sourceStructure?: MuyaSourceStructure
  readonly paragraphPrefixPosition?: number
  readonly containerPrefix?: Readonly<{ range: SourceRange, source: string }>
  readonly editable?: false
  readonly emptyLiteralLineEnding?: string
}

export interface MuyaMarkupDecoration {
  readonly path: MuyaMarkupPath
  readonly range: SourceRange
  readonly mark: MarkupMark
}

export interface MuyaMarkupComment {
  readonly annotationRange: SourceRange
  readonly path: MuyaMarkupPath
  readonly offset: number
}

export interface MuyaMarkupView {
  readonly kind: 'view'
  /** Display-only compatibility text. Never parse or persist this value. */
  readonly markdown: string
  /** Blocks are taken from the Core syntax, never recognized from flattened arms. */
  readonly state: readonly MuyaMarkupState[]
  readonly bindings: readonly MuyaMarkupBinding[]
  readonly decorations: readonly MuyaMarkupDecoration[]
  readonly comments: readonly MuyaMarkupComment[]
}

/**
 * Maps a text operation only when its selected source is contiguous. Insertions
 * choose the preceding payload at an elided closer, so continued typing remains
 * inside the suggestion. A selection crossing hidden syntax needs a semantic
 * transaction and must not be turned into a destructive raw-source splice.
 */
export function mappedMuyaSourceRange(
  binding: Readonly<{
    text: string
    sourceRange: SourceRange
    segments?: readonly Readonly<{ text: SourceRange, source: SourceRange }>[]
  }>,
  range: SourceRange,
  affinity: ProjectionAffinity = 'previous'
): SourceRange | undefined {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end > binding.text.length) {
    return undefined
  }
  const segments = binding.segments ?? [{
    text: { start: 0, end: binding.text.length }, source: binding.sourceRange
  }]
  const sourceOffset = (segment: typeof segments[number], offset: number): number | undefined => {
    if (offset === segment.text.start) return segment.source.start
    if (offset === segment.text.end) return segment.source.end
    return segment.text.end - segment.text.start === segment.source.end - segment.source.start
      ? segment.source.start + offset - segment.text.start
      : undefined
  }
  if (segments.length === 0 && binding.text.length === 0 && range.start === 0) {
    return { start: binding.sourceRange.end, end: binding.sourceRange.end }
  }
  if (range.start === range.end) {
    const candidates = segments.filter(segment =>
      segment.text.start <= range.start && segment.text.end >= range.start
    )
    const segment = affinity === 'previous' ? candidates[0] : candidates.at(-1)
    if (segment === undefined) return undefined
    const offset = sourceOffset(segment, range.start)
    return offset === undefined ? undefined : { start: offset, end: offset }
  }
  const selected = segments.filter(segment =>
    segment.text.start < range.end && segment.text.end > range.start
  )
  if (selected.length === 0) return undefined
  let end: number | undefined
  let start: number | undefined
  for (const segment of selected) {
    const segmentStart = sourceOffset(segment, Math.max(range.start, segment.text.start))
    const segmentEnd = sourceOffset(segment, Math.min(range.end, segment.text.end))
    if (segmentStart === undefined || segmentEnd === undefined) return undefined
    if (end !== undefined && segmentStart !== end) return undefined
    start ??= segmentStart
    end = segmentEnd
  }
  return start === undefined || end === undefined ? undefined : { start, end }
}

/** Detaches Core Markup syntax, source maps and marks for the Muya presentation. */
export function createMuyaMarkupView(
  projection: MarkupProjection,
  annotations: readonly CriticMarkupAnnotation[] = [],
  canonicalSource?: string
): MuyaMarkupView {
  const sourceEvents = projection.events.filter(event => event.kind === 'text')
  const sourceText = (start: number, end: number): string => sourceEvents.flatMap(event => {
    const from = Math.max(start, event.sourceRange.start)
    const to = Math.min(end, event.sourceRange.end)
    return from < to ? [event.text.slice(from - event.sourceRange.start, to - event.sourceRange.start)] : []
  }).join('')
  const sourceCharacter = (offset: number): string => sourceText(offset, offset + 1)
  const continuations = new Map<string, Readonly<{ prefix: string, lineEnding: string }>>()
  const taskContentStarts = new Map<string, number>()
  const blocks: MarkdownAstNode[] = projection.syntax.ast.root.children.length > 0
    ? [...projection.syntax.ast.root.children]
    : [{ kind: 'paragraph', range: { start: 0, end: 0 }, attributes: {}, children: [] }]
  // A Markdown AST omits blank paragraphs. Preserve insertion points created by
  // native Enter after a block; a lone final line ending creates none.
  const lastBlock = projection.syntax.ast.root.children.at(-1)
  if (lastBlock !== undefined) {
    const tail: Array<{ text: string, syntax: number }> = []
    const tailSourceStart = projection.syntax.coordinates.toSource(lastBlock.range.end, 'previous')
    for (const event of projection.events) {
      if (event.kind !== 'text' || event.sourceRange.end <= tailSourceStart) continue
      for (let index = Math.max(0, tailSourceStart - event.sourceRange.start); index < event.text.length; index += 1) {
        const syntax = projection.syntax.coordinates.toProjected(event.sourceRange.start + index, 'next')
        if (syntax >= lastBlock.range.end) tail.push({ text: event.text[index], syntax })
      }
    }
    if (tail.every(unit => /[\t \r\n]/u.test(unit.text))) {
      const lineEnds: number[] = []
      for (let index = 0; index < tail.length; index += 1) {
        if (tail[index].text !== '\r' && tail[index].text !== '\n') continue
        if (tail[index].text === '\r' && tail[index + 1]?.text === '\n') index += 1
        lineEnds.push(index + 1)
      }
      for (let line = 1; line < lineEnds.length; line += 2) {
        const position = tail[lineEnds[line]]?.syntax ?? (tail.at(-1)?.syntax ?? lastBlock.range.end) + 1
        blocks.push({ kind: 'paragraph', range: { start: position, end: position }, attributes: {}, children: [] })
      }
    }
  }
  const builders: Array<{
    syntax: MarkdownAstNode
    range: SourceRange
    path: MuyaMarkupPath
    state: MuyaMarkupState
    text: string
    segments: Array<{ text: { start: number, end: number }, source: { start: number, end: number }, syntax: { start: number, end: number } }>
    marks: Map<MarkupMark, { start: number, end: number }>
    emptyLiteralLineEnding?: string
  }> = []
  const sourceNodes: MuyaSourceStructure['nodes'][number][] = []
  const typedState = (syntax: MarkdownAstNode, path: MuyaMarkupPath): MuyaMarkupState => {
    const attrs = syntax.attributes
    if (canonicalSource !== undefined && ['table', 'list', 'blockquote'].includes(blocks[Number(path[0])]?.kind)) {
      const delimiterCells: SourceRange[] = []
      if (syntax.kind === 'table') {
        const start = projection.syntax.coordinates.toSource(Number(attrs.delimiterStart), 'previous')
        const end = projection.syntax.coordinates.toSource(Number(attrs.delimiterEnd), 'next')
        const characters = sourceEvents.flatMap(event => Array.from(
          { length: Math.max(0, Math.min(end, event.sourceRange.end) - Math.max(start, event.sourceRange.start)) },
          (_value, index) => {
            const offset = Math.max(start, event.sourceRange.start) + index
            return { offset, text: event.text[offset - event.sourceRange.start] }
          }
        ))
        for (const match of characters.map(character => character.text).join('').matchAll(/:?-+:?/gu)) {
          const first = characters[match.index].offset
          const last = characters[match.index + match[0].length - 1].offset + 1
          delimiterCells.push({
            start: projection.syntax.coordinates.toSource(projection.syntax.coordinates.toProjected(first, 'next'), 'previous'),
            end: projection.syntax.coordinates.toSource(projection.syntax.coordinates.toProjected(last, 'previous'), 'next')
          })
        }
      }
      sourceNodes.push({
        path,
        kind: syntax.kind,
        ...(attrs.task === true
          ? {
            checkboxRange: {
              start: projection.syntax.coordinates.toSource(Number(attrs.taskMarkerStart) + 1, 'previous'),
              end: projection.syntax.coordinates.toSource(Number(attrs.taskMarkerStart) + 2, 'next')
            }
          }
          : {}),
        range: {
          start: projection.syntax.coordinates.toSource(syntax.range.start, 'previous'),
          end: projection.syntax.coordinates.toSource(syntax.range.end, 'next')
        },
        ...(!['paragraph', 'code-block', 'heading', 'math-block', 'html-block', 'diagram'].includes(syntax.kind)
          ? {}
          : {
            lineStarts: sourceEvents.flatMap(event =>
              [...event.text.matchAll(/\r\n|\r|\n/gu)].flatMap(match => {
                const offset = event.sourceRange.start + match.index + match[0].length
                const projected = projection.syntax.coordinates.toProjected(offset, 'next')
                return projected > syntax.range.start && projected < syntax.range.end ? [offset] : []
              })
            )
          }),
        ...(syntax.kind !== 'table'
          ? {}
          : {
            delimiterCells,
            delimiterRange: {
              start: projection.syntax.coordinates.toSource(Number(attrs.delimiterStart), 'previous'),
              end: projection.syntax.coordinates.toSource(Number(attrs.delimiterEnd), 'next')
            }
          })
      })
    }
    const children = (): readonly MuyaMarkupState[] => {
      let emptyPosition = syntax.range.end
      if (syntax.kind === 'list-item') {
        let source = projection.syntax.coordinates.toSource(emptyPosition, 'next')
        while (sourceCharacter(source) === ' ' || sourceCharacter(source) === '\t') source += 1
        emptyPosition = projection.syntax.coordinates.toProjected(source, 'next')
      }
      const childNodes: readonly MarkdownAstNode[] = syntax.children.length === 0 &&
        ['blockquote', 'list-item', 'footnote-definition'].includes(syntax.kind)
        ? [{ kind: 'paragraph', range: { start: emptyPosition, end: emptyPosition }, attributes: {}, children: [] }]
        : syntax.children
      if (syntax.kind === 'list-item' && childNodes[0]?.kind === 'paragraph') {
        const start = projection.syntax.coordinates.toSource(syntax.range.start, 'next')
        const contentStart = childNodes[0].children[0]?.range.start ?? childNodes[0].range.start
        let end = projection.syntax.coordinates.toSource(contentStart, 'next')
        if (syntax.attributes.task === true && (sourceCharacter(end) === ' ' || sourceCharacter(end) === '\t')) {
          end += 1
          taskContentStarts.set(JSON.stringify([...path, 'children', 0]), projection.syntax.coordinates.toProjected(end, 'next'))
        }
        let lineStart = start
        while (lineStart > 0 && sourceCharacter(lineStart - 1) !== '\n' && sourceCharacter(lineStart - 1) !== '\r') lineStart -= 1
        let sourceEnd = projection.syntax.coordinates.toSource(syntax.range.end, 'previous')
        while (sourceCharacter(sourceEnd) === ' ' || sourceCharacter(sourceEnd) === '\t') sourceEnd += 1
        const lineEnding = sourceCharacter(sourceEnd) === '\r' && sourceCharacter(sourceEnd + 1) === '\n' ? '\r\n' : '\n'
        let prefix = sourceText(lineStart, end)
        if (syntax.attributes.task === true) {
          const checkbox = prefix.lastIndexOf('[')
          if (checkbox < 0 || prefix[checkbox + 2] !== ']') throw new Error('Core task prefix has no checkbox spelling')
          prefix = prefix.slice(0, checkbox + 1) + ' ' + prefix.slice(checkbox + 2)
        }
        continuations.set(JSON.stringify([...path, 'children', 0, 'text']), {
          prefix, lineEnding
        })
      }
      return childNodes.map((child, index) => typedState(child, [...path, 'children', index]))
    }
    const leaf = (name: string, meta?: MuyaMarkupState['meta'], range = syntax.range): MuyaMarkupState => {
      const taskStart = taskContentStarts.get(JSON.stringify(path))
      if (taskStart !== undefined) range = { ...range, start: taskStart }
      const state: MuyaMarkupState = { name, text: '', ...(meta === undefined ? {} : { meta }) }
      builders.push({ syntax, range, path: [...path, 'text'], state, text: '', segments: [], marks: new Map() })
      return state
    }
    const contentRange = (): SourceRange => ({
      start: Number(attrs.contentStart),
      end: Number(attrs.contentEnd)
    })
    switch (syntax.kind) {
      case 'paragraph': return leaf('paragraph')
      case 'definition': return leaf('paragraph')
      case 'thematic-break': return leaf('thematic-break')
      case 'html-block': return leaf('html-block', undefined, contentRange())
      case 'front-matter': return leaf('frontmatter', { lang: 'yaml', style: '-' }, contentRange())
      case 'diagram': return leaf('diagram', {
        type: String(attrs.language), lang: attrs.language === 'vega-lite' ? 'json' : 'yaml'
      }, contentRange())
      case 'footnote-definition': return {
        name: 'footnote', meta: { identifier: String(attrs.label) }, children: children()
      }
      case 'heading': return attrs.style === 'setext'
        ? leaf('setext-heading', { level: Number(attrs.level), underline: attrs.level === 1 ? '===' : '---' }, {
          start: syntax.children[0]?.range.start ?? syntax.range.start,
          end: syntax.children.at(-1)?.range.end ?? syntax.range.end
        })
        : leaf('atx-heading', { level: Number(attrs.level) })
      case 'blockquote': return { name: 'block-quote', children: children() }
      case 'list': return {
        name: attrs.taskList ? 'task-list' : attrs.ordered ? 'order-list' : 'bullet-list',
        meta: attrs.ordered
          ? { start: Number(attrs.start ?? 1), loose: !attrs.tight, delimiter: '.' }
          : { marker: '-', loose: !attrs.tight },
        children: children()
      }
      case 'list-item': return {
        name: attrs.task ? 'task-list-item' : 'list-item',
        ...(attrs.task ? { meta: { checked: Boolean(attrs.checked) } } : {}),
        children: children()
      }
      case 'table': return { name: 'table', children: children() }
      case 'table-row': return { name: 'table.row', children: children() }
      case 'table-cell': return leaf('table.cell', { align: String(attrs.alignment ?? 'none') })
      case 'math-block': return leaf('math-block', { mathStyle: attrs.syntax === 'gitlab' ? 'gitlab' : '' }, contentRange())
      case 'code-block': {
        return leaf('code-block', {
          type: attrs.provider === 'fenced-code' ? 'fenced' : 'indented',
          lang: String(attrs.semanticInfo ?? attrs.info ?? '')
        }, contentRange())
      }
      default: throw new Error(`Core Markup view requires a typed adapter for ${syntax.kind}`)
    }
  }
  const state = blocks.map((block, index) => typedState(block, [index]))
  const activeMarks: MarkupMark[] = []
  const marksInOrder: MarkupMark[] = []
  let blockIndex = 0
  for (const event of projection.events) {
    if (event.kind === 'enter') {
      activeMarks.push(event.mark)
      marksInOrder.push(event.mark)
      continue
    }
    if (event.kind === 'exit') {
      if (activeMarks.pop() !== event.mark) throw new Error('Unbalanced Core Markup events')
      continue
    }
    for (let offset = 0; offset < event.text.length; offset += 1) {
      const source = event.sourceRange.start + offset
      const syntax = projection.syntax.coordinates.toProjected(source, 'next')
      while (blockIndex < builders.length && syntax >= builders[blockIndex].range.end) blockIndex += 1
      const builder = builders[blockIndex]
      if (builder === undefined || syntax < builder.range.start) continue
      if (builder.syntax.kind === 'paragraph' && builder.syntax.children.length > 0 &&
          !builder.syntax.children.some(child => child.range.start <= syntax && syntax < child.range.end)) continue
      const text = builder.text.length
      builder.text += event.text[offset]
      const last = builder.segments.at(-1)
      if (last !== undefined && last.source.end === source && last.syntax.end === syntax) {
        last.text.end += 1
        last.source.end += 1
        last.syntax.end += 1
      } else {
        builder.segments.push({
          text: { start: text, end: text + 1 },
          source: { start: source, end: source + 1 },
          syntax: { start: syntax, end: syntax + 1 }
        })
      }
      for (const mark of activeMarks) {
        const range = builder.marks.get(mark)
        if (range === undefined) builder.marks.set(mark, { start: text, end: text + 1 })
        else range.end = text + 1
      }
    }
  }
  for (const builder of builders) {
    if (!['code-block', 'math-block', 'diagram', 'html-block', 'front-matter'].includes(builder.syntax.kind)) continue
    const desired = String(builder.syntax.attributes.content).replace(/(?:\r\n|\r|\n)$/, '')
    const rawLines = builder.text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(line => line.length > 0) ?? []
    if (rawLines.length === 0) rawLines.push('')
    const desiredLines = desired.split('\n')
    if (rawLines.length !== desiredLines.length) throw new Error('Core literal line mapping is inconsistent')
    const retained: Array<SourceRange & { normalizedNewline?: true }> = []
    let rawOffset = 0
    for (let index = 0; index < rawLines.length; index += 1) {
      const ending = rawLines[index].match(/(?:\r\n|\r|\n)$/)?.[0] ?? ''
      const rawLine = rawLines[index].slice(0, rawLines[index].length - ending.length)
      const desiredLine = desiredLines[index]
      if (!rawLine.endsWith(desiredLine)) throw new Error('Core literal content requires a generated coordinate adapter')
      retained.push({ start: rawOffset + rawLine.length - desiredLine.length, end: rawOffset + rawLine.length })
      if (index + 1 < rawLines.length) {
        retained.push({ start: rawOffset + rawLine.length, end: rawOffset + rawLines[index].length, normalizedNewline: true })
      }
      rawOffset += rawLines[index].length
    }
    const segments: typeof builder.segments = []
    let textOffset = 0
    for (const range of retained) {
      if (range.normalizedNewline) {
        const first = builder.segments.find(segment => segment.text.start <= range.start && segment.text.end > range.start)
        const last = builder.segments.find(segment => segment.text.start < range.end && segment.text.end >= range.end)
        if (first === undefined || last === undefined) throw new Error('Core literal newline mapping is incomplete')
        segments.push({
          text: { start: textOffset, end: textOffset + 1 },
          source: { start: first.source.start + range.start - first.text.start, end: last.source.end - last.text.end + range.end },
          syntax: { start: first.syntax.start + range.start - first.text.start, end: last.syntax.end - last.text.end + range.end }
        })
        textOffset += 1
        continue
      }
      for (const segment of builder.segments) {
        const start = Math.max(range.start, segment.text.start)
        const end = Math.min(range.end, segment.text.end)
        if (start >= end) continue
        const delta = start - segment.text.start
        segments.push({
          text: { start: textOffset, end: textOffset + end - start },
          source: { start: segment.source.start + delta, end: segment.source.start + delta + end - start },
          syntax: { start: segment.syntax.start + delta, end: segment.syntax.start + delta + end - start }
        })
        textOffset += end - start
      }
    }
    const marks = new Map<MarkupMark, { start: number, end: number }>()
    let retainedOffset = 0
    for (const range of retained) {
      for (const [mark, marked] of builder.marks) {
        const start = Math.max(range.start, marked.start)
        const end = Math.min(range.end, marked.end)
        if (start >= end) continue
        const mapped = {
          start: retainedOffset + (range.normalizedNewline ? 0 : start - range.start),
          end: retainedOffset + (range.normalizedNewline ? 1 : end - range.start)
        }
        const previous = marks.get(mark)
        if (previous === undefined) marks.set(mark, mapped)
        else previous.end = mapped.end
      }
      retainedOffset += range.normalizedNewline ? 1 : range.end - range.start
    }
    builder.text = desired
    builder.segments = segments
    builder.marks = marks
    if (desired.length === 0) {
      if (builder.range.start === builder.range.end && builder.range.end < builder.syntax.range.end) {
        const source = projection.syntax.coordinates.toSource(builder.range.start, 'next')
        builder.emptyLiteralLineEnding = sourceText(Math.max(0, source - 2), source).match(/(?:\r\n|\r|\n)$/u)?.[0]
      }
      // The native body omits its final EOL; an empty caret stays before it.
      const position = builder.range.start + retained[0].start
      builder.range = { start: position, end: position }
    }
  }
  const bindings = builders.map((builder): MuyaMarkupBinding => ({
    path: builder.path,
    text: builder.text,
    segments: builder.segments,
    syntax: builder.syntax,
    ...(builder.emptyLiteralLineEnding === undefined ? {} : { emptyLiteralLineEnding: builder.emptyLiteralLineEnding }),
    ...(continuations.has(JSON.stringify(builder.path))
      ? { listContinuation: continuations.get(JSON.stringify(builder.path)) }
      : {}),
    sourceRange: {
      start: builder.segments[0]?.source.start ?? projection.syntax.coordinates.toSource(builder.range.start, 'next'),
      end: builder.segments.at(-1)?.source.end ?? projection.syntax.coordinates.toSource(builder.range.end, 'next')
    }
  }))
  const visibleAnnotations: CriticMarkupAnnotation[] = []
  const annotationQueue = [...annotations].reverse()
  while (annotationQueue.length > 0) {
    const annotation = annotationQueue.pop()
    if (annotation === undefined) break
    visibleAnnotations.push(annotation)
    if (annotation.kind !== 'comment') {
      for (const arm of annotation.arms) annotationQueue.push(...[...arm.annotations].reverse())
    }
  }
  const visiblePoint = (source: number): { binding: MuyaMarkupBinding, offset: number } => {
    const position = projection.syntax.coordinates.toProjected(source, 'previous')
    let index = builders.findIndex(builder => position <= builder.range.end)
    if (index === -1) index = builders.length - 1
    const binding = bindings[index]
    let offset = 0
    for (const segment of binding.segments) {
      if (segment.source.start >= source) break
      offset = segment.text.start + Math.min(segment.text.end - segment.text.start, source - segment.source.start)
    }
    return { binding, offset }
  }
  const decorations: MuyaMarkupDecoration[] = marksInOrder.flatMap(mark => {
    const ranges = builders.flatMap(builder => {
      const range = builder.marks.get(mark)
      return range === undefined ? [] : [{ path: builder.path, range, mark }]
    })
    if (ranges.length > 0) return ranges
    const annotation = visibleAnnotations.find(item =>
      item.kind === mark.kind && item.range.start === mark.annotationRange.start && item.range.end === mark.annotationRange.end
    )
    const arm = annotation?.arms.find(item => item.name === (mark.kind === 'substitution' ? mark.arm : 'content'))
    if (arm === undefined) return []
    const { binding, offset } = visiblePoint(arm.range.start)
    return [{ path: binding.path, range: { start: offset, end: offset }, mark }]
  })
  const comments: MuyaMarkupComment[] = []
  for (const annotation of visibleAnnotations) {
    if (annotation.kind !== 'comment') continue
    const { binding, offset } = visiblePoint(annotation.range.start)
    comments.push({ annotationRange: annotation.range, path: binding.path, offset })
  }
  for (const builder of builders) builder.state.text = builder.text
  const annotationPaths = new Set([
    ...decorations.map(item => JSON.stringify(item.path)),
    ...comments.map(item => JSON.stringify(item.path))
  ])
  const outerBlocks = new Map<number, Readonly<{ range: SourceRange, source: string, followingSource?: string }>>()
  const paragraphPrefixes = new Map<number, number>()
  const containerPrefixes = new Map<number, Readonly<{ range: SourceRange, source: string }>>()
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const range = {
      start: projection.syntax.coordinates.toSource(block.range.start, 'next'),
      end: projection.syntax.coordinates.toSource(block.range.end, 'previous')
    }
    if (block.kind === 'blockquote' || block.kind === 'list') {
      const leaves = builders.filter(builder => builder.path[0] === index)
      const leaf = leaves[0]
      if (leaves.length === 1 && leaf.syntax.kind === 'paragraph') {
        const prefixRange = {
          start: range.start,
          end: projection.syntax.coordinates.toSource(leaf.range.start, 'previous')
        }
        const prefix = sourceText(prefixRange.start, prefixRange.end)
        if (prefix.length > 0 && prefix.length === prefixRange.end - prefixRange.start && !/[\r\n]/u.test(prefix)) {
          containerPrefixes.set(index, { range: prefixRange, source: prefix })
        }
      }
    }
    if (block.kind === 'paragraph') {
      const containing = visibleAnnotations.filter(annotation => annotation.range.start <= range.start &&
        annotation.range.end > range.start)
      if (containing.every(annotation => annotation.kind === 'addition' || annotation.kind === 'highlight')) {
        let position = Math.min(range.start, ...containing.map(annotation => annotation.range.start))
        for (const annotation of [...visibleAnnotations].reverse()) {
          if (annotation.kind === 'comment' && annotation.range.end === position) position = annotation.range.start
        }
        paragraphPrefixes.set(index, position)
      } else {
        const shared = containing.filter(annotation => annotation.kind === 'substitution' &&
          annotation.arms.length === 2 && annotation.arms[0].range.start === range.start &&
          annotation.arms[1].range.end <= range.end)
        const position = Math.min(range.start, ...shared.map(annotation => annotation.range.start))
        if (containing.every(annotation => shared.includes(annotation) || annotation.arms.some(arm =>
          arm.range.start <= position && arm.range.end >= range.end))) {
          // Whole-paragraph formatting surrounds both shared replacement arms.
          // A deleted paragraph or an independently rendered arm keeps its prefix
          // inside that arm, without changing the other projection's structure.
          paragraphPrefixes.set(index, position)
        }
      }
    }
    if (visibleAnnotations.some(annotation => annotation.range.start < range.end &&
        annotation.range.end > range.start)) continue
    const source = sourceText(range.start, range.end)
    if (source.length === range.end - range.start) {
      const followingEnd = projection.syntax.coordinates.toSource(
        blocks[index + 1]?.range.start ?? projection.syntax.ast.root.range.end, 'previous'
      )
      const followingSource = sourceText(range.end, followingEnd)
      outerBlocks.set(index, {
        range,
        source,
        ...(followingSource.length === followingEnd - range.end && /^[\t \r\n]*$/u.test(followingSource)
          ? { followingSource }
          : {})
      })
    }
  }
  const endOffset = projection.syntax.coordinates.toSource(projection.syntax.ast.root.range.end, 'next')
  let suffixStart = endOffset
  while (suffixStart > 0 && /[\r\n]/u.test(sourceCharacter(suffixStart - 1))) suffixStart -= 1
  const trailingLineEndings = sourceText(suffixStart, endOffset)
  const lineEnding = [...sourceEvents].reverse().find(event => /[\r\n]/u.test(event.text))?.text.match(/\r\n|\r|\n/gu)?.at(-1) ?? '\n'
  const documentEnd = { offset: endOffset, trailingLineEndings, lineEnding }
  const sourceStructures = new Map<number, MuyaSourceStructure>()
  if (canonicalSource !== undefined) {
    for (const [index, block] of blocks.entries()) {
      if (!['table', 'list', 'blockquote'].includes(block.kind)) continue
      const nodes = sourceNodes.filter(node => node.path[0] === index)
      const range = nodes[0].range
      sourceStructures.set(index, { range, source: canonicalSource.slice(range.start, range.end), nodes })
    }
  }
  const structuralOwners = new Set<number>()
  return {
    kind: 'view',
    markdown: projection.events.flatMap(event => event.kind === 'text' ? [event.text] : []).join(''),
    state,
    bindings: bindings.map((binding, bindingIndex) => {
      const index = binding.path[0] as number
      const outerBlock = structuralOwners.has(index) ? undefined : outerBlocks.get(index)
      const sourceStructure = structuralOwners.has(index) ? undefined : sourceStructures.get(index)
      structuralOwners.add(index)
      return {
        ...binding,
        ...(bindingIndex === bindings.length - 1 ? { documentEnd } : {}),
        ...(paragraphPrefixes.has(index) ? { paragraphPrefixPosition: paragraphPrefixes.get(index) } : {}),
        ...(containerPrefixes.has(index) ? { containerPrefix: containerPrefixes.get(index) } : {}),
        ...(annotationPaths.has(JSON.stringify(binding.path)) ? { annotationContext: true as const } : {}),
        ...(outerBlock === undefined ? {} : { outerBlock }),
        ...(sourceStructure === undefined ? {} : { sourceStructure })
      }
    }),
    decorations,
    comments
  }
}
