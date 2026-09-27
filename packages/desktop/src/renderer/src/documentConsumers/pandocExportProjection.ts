import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type DocumentCore,
  type DocumentRevision,
  type MarkdownAstNode,
  type MarkdownOptions
} from '@marktext/document-core'
import { createHeadingIdAllocator } from '@muyajs/core'

import type { PandocJsonNode, PandocTrackedDocument } from '@shared/types/files'

/**
 * Pandoc's own default for a change or comment with no author. MarkText records
 * no authorship, so every tracked change and comment carries this neutral name.
 */
export const PANDOC_NEUTRAL_AUTHOR = 'unknown'

/** Pandoc writer whose output carries suggestions and comments natively. */
export const PANDOC_TRACKED_TARGET = 'docx'

export interface PandocExportInput {
  /** The Revised (accept-all) Markdown, read with the upstream `gfm` reader. */
  readonly markdown: string
  /** Present for `.docx` with CriticMarkup: the Markup view as a Pandoc AST. */
  readonly document?: PandocTrackedDocument
}

type Wrap = 'mark' | 'insertion' | 'deletion'
// Insertion outside deletion is how Word spells text inserted and then deleted.
const WRAP_ORDER: readonly Wrap[] = ['mark', 'insertion', 'deletion']

interface Region {
  readonly start: number
  readonly end: number
  readonly wrap: Wrap
}

interface PointEvent {
  /** Position in the Markup syntax domain the event is emitted before. */
  readonly at: number
  /** Canonical source position; orders events that share `at`. */
  readonly source: number
  readonly order: number
  readonly inline: PandocJsonNode
  emitted: boolean
}

interface Item {
  readonly inline: PandocJsonNode
  /** `|`-joined wraps in `WRAP_ORDER`, or '' for untracked content. */
  readonly key: string
  readonly event?: true
}

const EMPTY_ATTR = Object.freeze(['', [], []])

const str = (text: string): PandocJsonNode => ({ t: 'Str', c: text })

const textTokens = (text: string): PandocJsonNode[] =>
  text
    .split(/([ \t]+)/u)
    .filter((part) => part !== '')
    .map((part) => (/^[ \t]+$/u.test(part) ? { t: 'Space' } : str(part)))

const wrapSpan = (wrap: Wrap, content: PandocJsonNode[]): PandocJsonNode => ({
  t: 'Span',
  c: [['', [wrap], wrap === 'mark' ? [] : [['author', PANDOC_NEUTRAL_AUTHOR]]], content]
})

const wrapItems = (items: readonly Item[]): PandocJsonNode[] => {
  const inlines: PandocJsonNode[] = []
  let index = 0
  while (index < items.length) {
    const key = items[index]!.key
    const run: PandocJsonNode[] = []
    while (index < items.length && items[index]!.key === key) {
      run.push(items[index]!.inline)
      index += 1
    }
    if (key === '') {
      inlines.push(...run)
      continue
    }
    let content = run
    for (const wrap of (key.split('|') as Wrap[]).reverse()) content = [wrapSpan(wrap, content)]
    inlines.push(...content)
  }
  return inlines
}

const stringAttribute = (node: MarkdownAstNode, name: string): string => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : ''
}

const plainTextOf = (node: MarkdownAstNode): string => {
  switch (node.kind) {
    case 'text':
      return stringAttribute(node, 'semanticText')
    case 'soft-break':
    case 'hard-break':
      return ' '
    case 'inline-code':
      return stringAttribute(node, 'semanticContent')
    default:
      return node.children.map(plainTextOf).join('')
  }
}

// Pandoc drops the newline that closes a fenced code block's content.
const withoutFinalNewline = (content: string): string => content.replace(/\r?\n$/u, '')

const ALIGNMENTS: Readonly<Record<string, string>> = {
  left: 'AlignLeft',
  center: 'AlignCenter',
  right: 'AlignRight'
}

interface TrackingContext {
  /** The wrap key for a position in the AST's coordinate domain. */
  readonly keyAt: (position: number) => string
  /** Comment markers owed to one inline block, in emission order. */
  readonly eventsOf: (block: MarkdownAstNode) => readonly PointEvent[]
}

const UNTRACKED: TrackingContext = {
  keyAt: () => '',
  eventsOf: () => []
}

/** Converts one parser-owned Markdown AST into Pandoc blocks, tracked or not. */
const createAstConverter = (
  root: MarkdownAstNode,
  context: TrackingContext,
  isGenerated: (position: number) => boolean
) => {
  const allocateHeadingId = createHeadingIdAllocator()
  const footnotes = new Map<number, MarkdownAstNode>()
  const collectFootnotes = (node: MarkdownAstNode): void => {
    if (node.kind === 'footnote-definition') footnotes.set(node.range.start, node)
    node.children.forEach(collectFootnotes)
  }
  collectFootnotes(root)
  // A definition renders at its first reference; later ones reuse its blocks.
  const renderedNotes = new Map<number, PandocJsonNode[]>()

  // Pairs each code unit of a text node's semantic value with its position.
  // Normalized spellings are positioned at their segment; protective text the
  // parser generates carries no value of its own.
  const textPieces = (node: MarkdownAstNode): Array<{ at: number; text: string }> => {
    const value = stringAttribute(node, 'semanticText')
    if (node.attributes['emojiClosed'] === true) {
      return [{ at: node.range.start, text: stringAttribute(node, 'emojiValue') || value }]
    }
    const segments = [...(node.semanticTextSegments ?? [])].sort(
      (left, right) => left.range.start - right.range.start
    )
    const align = (skipGenerated: boolean): Array<{ at: number; text: string }> | undefined => {
      const pieces: Array<{ at: number; text: string }> = []
      let offset = 0
      let segment = 0
      for (let position = node.range.start; position < node.range.end;) {
        const next = segments[segment]
        if (next !== undefined && next.range.start <= position) {
          if (next.range.start === position && next.value !== '') {
            pieces.push({ at: position, text: next.value })
          }
          offset += next.range.start === position ? next.value.length : 0
          position = Math.max(position + 1, next.range.end)
          segment += 1
          continue
        }
        if (!(skipGenerated && isGenerated(position))) {
          if (offset >= value.length) return undefined
          pieces.push({ at: position, text: value[offset]! })
          offset += 1
        }
        position += 1
      }
      return offset === value.length ? pieces : undefined
    }
    return align(false) ?? align(true) ?? [{ at: node.range.start, text: value }]
  }

  const convertInlines = (
    nodes: readonly MarkdownAstNode[],
    flush: (position: number) => Item[]
  ): Item[] => {
    const items: Item[] = []
    const atom = (node: MarkdownAstNode, inline: PandocJsonNode): void => {
      items.push(...flush(node.range.start))
      items.push({ inline, key: context.keyAt(node.range.start) })
    }
    const container = (node: MarkdownAstNode, build: (content: PandocJsonNode[]) => PandocJsonNode, children = node.children): void => {
      items.push(...flush(node.range.start))
      const inner = convertInlines(children, flush)
      const key = inner[0]?.key ?? context.keyAt(node.range.start)
      const uniform = inner.every((item) => item.event !== true && item.key === key)
      items.push(
        uniform
          ? { inline: build(inner.map((item) => item.inline)), key }
          : { inline: build(wrapItems(inner)), key: '' }
      )
    }
    for (const node of nodes) {
      switch (node.kind) {
        case 'text': {
          let run = ''
          let runKey = ''
          const close = (): void => {
            for (const token of textTokens(run)) items.push({ inline: token, key: runKey })
            run = ''
          }
          for (const piece of textPieces(node)) {
            const pending = flush(piece.at)
            const key = context.keyAt(piece.at)
            if (pending.length > 0 || key !== runKey) {
              close()
              items.push(...pending)
              runKey = key
            }
            run += piece.text
          }
          close()
          break
        }
        case 'soft-break':
          atom(node, { t: 'SoftBreak' })
          break
        case 'hard-break':
          atom(node, { t: 'LineBreak' })
          break
        case 'inline-code':
          atom(node, { t: 'Code', c: [EMPTY_ATTR, stringAttribute(node, 'semanticContent')] })
          break
        case 'inline-math':
          atom(node, { t: 'Math', c: [{ t: 'InlineMath' }, stringAttribute(node, 'content')] })
          break
        case 'inline-html':
          atom(node, { t: 'RawInline', c: ['html', stringAttribute(node, 'content')] })
          break
        case 'autolink':
          atom(node, {
            t: 'Link',
            c: [
              EMPTY_ATTR,
              [str(stringAttribute(node, 'rawDestination'))],
              [stringAttribute(node, 'semanticDestination'), '']
            ]
          })
          break
        case 'image': {
          const layout = [
            ['width', 'semanticWidth'],
            ['height', 'semanticHeight']
          ].flatMap(([name, attribute]) => {
            const value = stringAttribute(node, attribute!)
            return value ? [[name, value]] : []
          })
          const alt = convertInlines(node.children, () => []).map((item) => item.inline)
          atom(node, {
            t: 'Image',
            c: [
              ['', [], layout],
              alt,
              [stringAttribute(node, 'semanticDestination'), stringAttribute(node, 'semanticTitle')]
            ]
          })
          break
        }
        case 'footnote-reference': {
          const start = node.attributes['resolvedDefinitionStart']
          const definition =
            node.attributes['resolved'] === true && typeof start === 'number'
              ? footnotes.get(start)
              : undefined
          if (definition === undefined) {
            atom(node, str(`[^${stringAttribute(node, 'rawLabel')}]`))
            break
          }
          let blocks = renderedNotes.get(definition.range.start)
          if (blocks === undefined) {
            blocks = convertBlocks(definition.children, false)
            renderedNotes.set(definition.range.start, blocks)
          }
          atom(node, { t: 'Note', c: blocks })
          break
        }
        case 'emphasis':
          container(node, (content) => ({ t: 'Emph', c: content }))
          break
        case 'strong':
          container(
            node,
            (content) => ({ t: 'Strong', c: content }),
            node.attributes['semanticFlattenStrongChildren'] === true
              ? node.children.flatMap((child) => (child.kind === 'strong' ? child.children : [child]))
              : node.children
          )
          break
        case 'strikethrough':
          container(node, (content) => ({ t: 'Strikeout', c: content }))
          break
        case 'subscript':
          container(node, (content) => ({ t: 'Subscript', c: content }))
          break
        case 'superscript':
          container(node, (content) => ({ t: 'Superscript', c: content }))
          break
        case 'link':
          container(node, (content) => ({
            t: 'Link',
            c: [
              EMPTY_ATTR,
              content,
              [stringAttribute(node, 'semanticDestination'), stringAttribute(node, 'semanticTitle')]
            ]
          }))
          break
        default:
          // Block kinds never occur among inline children.
          break
      }
    }
    return items
  }

  /** Inline content of one paragraph, heading or table cell, with its comment markers. */
  const blockInlines = (node: MarkdownAstNode): PandocJsonNode[] => {
    const events = context.eventsOf(node).filter((event) => !event.emitted)
    let next = 0
    const flush = (position: number): Item[] => {
      const due: Item[] = []
      while (next < events.length && events[next]!.at <= position) {
        const event = events[next]!
        next += 1
        if (event.emitted) continue
        event.emitted = true
        due.push({ inline: event.inline, key: '', event: true })
      }
      return due
    }
    const items = convertInlines(node.children, flush)
    items.push(...flush(Number.POSITIVE_INFINITY))
    return wrapItems(items)
  }

  // A literal block has no inline to carry a tracked change, so a tracked one is
  // written as a paragraph of its lines, which can.
  const literalBlock = (node: MarkdownAstNode, content: string, untracked: () => PandocJsonNode): PandocJsonNode => {
    const start = node.attributes['contentStart']
    const key = context.keyAt(typeof start === 'number' ? start : node.range.start)
    if (key === '') return untracked()
    const lines = withoutFinalNewline(content).split(/\r\n|\r|\n/u)
    const inlines = lines.flatMap((line, index) => [
      ...(index > 0 ? [{ t: 'LineBreak' }] : []),
      { t: 'Code', c: [EMPTY_ATTR, line] }
    ])
    return { t: 'Para', c: wrapItems(inlines.map((inline) => ({ inline, key }))) }
  }

  const convertBlocks = (nodes: readonly MarkdownAstNode[], tight: boolean): PandocJsonNode[] =>
    nodes.flatMap((node) => convertBlock(node, tight))

  const convertBlock = (node: MarkdownAstNode, tight: boolean): PandocJsonNode[] => {
    switch (node.kind) {
      case 'document':
        return convertBlocks(node.children, false)
      case 'paragraph': {
        const inlines = blockInlines(node)
        if (inlines.length === 0) return []
        return [{ t: tight ? 'Plain' : 'Para', c: inlines }]
      }
      case 'heading': {
        const level = node.attributes['level']
        return [
          {
            t: 'Header',
            c: [
              typeof level === 'number' ? level : 1,
              [allocateHeadingId(plainTextOf(node)), [], []],
              blockInlines(node)
            ]
          }
        ]
      }
      case 'blockquote':
        return [{ t: 'BlockQuote', c: convertBlocks(node.children, false) }]
      case 'list': {
        const listTight = node.attributes['tight'] === true
        const items = node.children.map((item) => {
          const blocks = convertBlocks(item.children, listTight)
          if (item.attributes['task'] === true) {
            const box = [str(item.attributes['checked'] === true ? '☒' : '☐'), { t: 'Space' }]
            const first = blocks[0]
            if (first !== undefined && (first.t === 'Plain' || first.t === 'Para')) {
              const content = first.c as PandocJsonNode[]
              while (content[0]?.t === 'Space') content.shift()
              first.c = [...box, ...content]
            } else {
              blocks.unshift({ t: 'Plain', c: box.slice(0, 1) })
            }
          }
          return blocks
        })
        if (node.attributes['ordered'] !== true) return [{ t: 'BulletList', c: items }]
        const start = node.attributes['start']
        return [
          {
            t: 'OrderedList',
            c: [[typeof start === 'number' ? start : 1, { t: 'Decimal' }, { t: 'Period' }], items]
          }
        ]
      }
      case 'thematic-break':
        return [{ t: 'HorizontalRule' }]
      case 'code-block': {
        const info = stringAttribute(node, 'semanticInfo').trim().split(/\s/u)[0] ?? ''
        const content = stringAttribute(node, 'content')
        return [
          literalBlock(node, content, () => ({
            t: 'CodeBlock',
            c: [['', info ? [info] : [], []], withoutFinalNewline(content)]
          }))
        ]
      }
      case 'diagram': {
        const content = stringAttribute(node, 'content')
        return [
          literalBlock(node, content, () => ({
            t: 'CodeBlock',
            c: [['', [stringAttribute(node, 'language')], []], withoutFinalNewline(content)]
          }))
        ]
      }
      case 'math-block': {
        const content = stringAttribute(node, 'content')
        const math = { t: 'Math', c: [{ t: 'DisplayMath' }, content] }
        const start = node.attributes['contentStart']
        const key = context.keyAt(typeof start === 'number' ? start : node.range.start)
        return [{ t: 'Para', c: wrapItems([{ inline: math, key }]) }]
      }
      case 'html-block':
        return [{ t: 'RawBlock', c: ['html', stringAttribute(node, 'content')] }]
      case 'table': {
        const rows = node.children
        const columns = Math.max(
          Number(node.attributes['columns']) || 0,
          ...rows.map((row) => row.children.length)
        )
        const header = rows.find((row) => row.attributes['header'] === true)
        const alignments = Array.from({ length: columns }, (_, index) => {
          const alignment = header?.children[index]?.attributes['alignment']
          return { t: (typeof alignment === 'string' && ALIGNMENTS[alignment]) || 'AlignDefault' }
        })
        const row = (tableRow: MarkdownAstNode): unknown => [
          EMPTY_ATTR,
          Array.from({ length: columns }, (_, index) => {
            const cell = tableRow.children[index]
            const inlines = cell === undefined ? [] : blockInlines(cell)
            return [
              EMPTY_ATTR,
              { t: 'AlignDefault' },
              1,
              1,
              inlines.length > 0 ? [{ t: 'Plain', c: inlines }] : []
            ]
          })
        ]
        const headRows = rows.filter((tableRow) => tableRow.attributes['header'] === true)
        const bodyRows = rows.filter((tableRow) => tableRow.attributes['header'] !== true)
        return [
          {
            t: 'Table',
            c: [
              EMPTY_ATTR,
              [null, []],
              alignments.map((alignment) => [alignment, { t: 'ColWidthDefault' }]),
              [EMPTY_ATTR, headRows.map(row)],
              [[EMPTY_ATTR, 0, [], bodyRows.map(row)]],
              [EMPTY_ATTR, []]
            ]
          }
        ]
      }
      // Front matter becomes metadata; definitions render where they are used.
      case 'front-matter':
      case 'definition':
      case 'footnote-definition':
        return []
      default:
        return []
    }
  }

  return { convertBlocks, blockInlines }
}

/** A Comment's Markdown body as the inline content Pandoc gives a comment. */
const commentBody = (core: DocumentCore, revision: DocumentRevision, comment: CriticMarkupAnnotation): PandocJsonNode[] => {
  const projection = core.projectComment(revision, comment)
  const blocks = createAstConverter(projection.ast.root, UNTRACKED, () => false).convertBlocks(
    [projection.ast.root],
    false
  )
  const inlinesOf = (block: PandocJsonNode): PandocJsonNode[][] => {
    switch (block.t) {
      case 'Plain':
      case 'Para':
        return [block.c as PandocJsonNode[]]
      case 'Header':
        return [(block.c as [number, unknown, PandocJsonNode[]])[2]]
      case 'CodeBlock':
        return [[{ t: 'Code', c: [EMPTY_ATTR, (block.c as [unknown, string])[1]] }]]
      case 'BlockQuote':
        return (block.c as PandocJsonNode[]).flatMap(inlinesOf)
      case 'BulletList':
        return (block.c as PandocJsonNode[][]).flatMap((item) => item.flatMap(inlinesOf))
      case 'OrderedList':
        return (block.c as [unknown, PandocJsonNode[][]])[1].flatMap((item) => item.flatMap(inlinesOf))
      default:
        return []
    }
  }
  return blocks
    .flatMap(inlinesOf)
    .flatMap((inlines, index) => (index > 0 ? [{ t: 'LineBreak' }, ...inlines] : inlines))
}

const commentMarker = (
  kind: 'comment-start' | 'comment-end',
  id: string,
  body: PandocJsonNode[] = []
): PandocJsonNode => ({
  t: 'Span',
  c: [
    ['', [kind], kind === 'comment-start' ? [['id', id], ['author', PANDOC_NEUTRAL_AUTHOR]] : [['id', id]]],
    body
  ]
})

/**
 * The Markup view of a document as a Pandoc AST: additions and deletions are
 * insertion/deletion spans (Word tracked changes), a substitution is both, a
 * commented highlight is a comment over its text, a lone comment is anchored
 * where it stands, and a lone highlight is highlighted text.
 */
export const buildTrackedPandocDocument = (
  core: DocumentCore,
  revision: DocumentRevision
): PandocTrackedDocument => {
  const markup = core.project(revision, 'markup')
  const { ast, coordinates } = markup.syntax
  const regions: Region[] = []
  const events: PointEvent[] = []
  let nextCommentId = 0
  const addComment = (comment: CriticMarkupAnnotation, start: number, end: number): void => {
    const id = String(nextCommentId)
    nextCommentId += 1
    const body = commentBody(core, revision, comment)
    const at = (source: number, affinity: 'previous' | 'next'): number =>
      coordinates.toProjected(source, affinity)
    events.push(
      {
        at: at(start, start === end ? 'previous' : 'next'),
        source: start,
        order: events.length,
        inline: commentMarker('comment-start', id, body),
        emitted: false
      },
      {
        at: at(end, 'previous'),
        source: end,
        order: events.length + 1,
        inline: commentMarker('comment-end', id),
        emitted: false
      }
    )
  }
  const collect = (annotations: readonly CriticMarkupAnnotation[]): void => {
    for (let index = 0; index < annotations.length; index += 1) {
      const annotation = annotations[index]!
      const next = annotations[index + 1]
      for (const arm of annotation.arms) {
        if (arm.name === 'comment') continue
        const wrap: Wrap | undefined =
          annotation.kind === 'addition' || arm.name === 'new'
            ? 'insertion'
            : annotation.kind === 'deletion' || arm.name === 'old'
              ? 'deletion'
              : undefined
        if (annotation.kind === 'highlight') {
          if (next?.kind === 'comment' && next.range.start === annotation.range.end) {
            addComment(next, arm.range.start, arm.range.end)
          } else {
            regions.push({ start: arm.range.start, end: arm.range.end, wrap: 'mark' })
          }
        } else if (wrap !== undefined) {
          regions.push({ start: arm.range.start, end: arm.range.end, wrap })
        }
        collect(arm.annotations)
      }
      if (annotation.kind === 'highlight' && next?.kind === 'comment' && next.range.start === annotation.range.end) {
        index += 1
      } else if (annotation.kind === 'comment') {
        addComment(annotation, annotation.range.start, annotation.range.start)
      }
    }
  }
  collect(revision.annotations)

  const keyAtSource = createRegionIndex(regions)
  const sourceOf = (position: number): number => {
    const origin = coordinates.originAt(position)
    return origin.kind === 'source' ? origin.sourceOffset : origin.sourcePosition
  }
  const isGenerated = (position: number): boolean =>
    coordinates.originAt(position).kind === 'generated'

  // Each comment marker belongs to the last paragraph, heading or cell that
  // starts at or before it, so a marker between blocks stays with the text it follows.
  const inlineBlocks: MarkdownAstNode[] = []
  const collectBlocks = (node: MarkdownAstNode): void => {
    if (node.kind === 'paragraph' || node.kind === 'heading' || node.kind === 'table-cell') {
      inlineBlocks.push(node)
      return
    }
    node.children.forEach(collectBlocks)
  }
  collectBlocks(ast.root)
  const eventsByBlock = new Map<MarkdownAstNode, PointEvent[]>()
  events.sort((left, right) => left.at - right.at || left.source - right.source || left.order - right.order)
  for (const event of events) {
    let low = 0
    let high = inlineBlocks.length - 1
    let owner = inlineBlocks[0]
    while (low <= high) {
      const middle = (low + high) >> 1
      if (inlineBlocks[middle]!.range.start <= event.at) {
        owner = inlineBlocks[middle]
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (owner === undefined) continue
    const list = eventsByBlock.get(owner) ?? []
    list.push(event)
    eventsByBlock.set(owner, list)
  }

  const converter = createAstConverter(
    ast.root,
    {
      keyAt: (position) => keyAtSource(sourceOf(position)),
      eventsOf: (block) => eventsByBlock.get(block) ?? []
    },
    isGenerated
  )
  const blocks = converter.convertBlocks([ast.root], false)
  // Markers owed to blocks that never render (an unreferenced footnote) still
  // close their comment.
  const orphans = events.filter((event) => !event.emitted).map((event) => event.inline)
  if (orphans.length > 0) blocks.push({ t: 'Para', c: orphans })

  const frontMatter = ast.root.children[0]
  return frontMatter?.kind === 'front-matter' && frontMatter.attributes['lang'] === 'yaml'
    ? { blocks, frontMatter: stringAttribute(frontMatter, 'content') }
    : { blocks }
}

/** Looks up the wraps covering a canonical source position. */
const createRegionIndex = (regions: readonly Region[]): ((source: number) => string) => {
  const boundaries = [...new Set(regions.flatMap((region) => [region.start, region.end]))].sort(
    (left, right) => left - right
  )
  const keys = boundaries.map((boundary) => {
    const wraps = new Set(
      regions
        .filter((region) => region.start <= boundary && boundary < region.end)
        .map((region) => region.wrap)
    )
    return WRAP_ORDER.filter((wrap) => wraps.has(wrap)).join('|')
  })
  return (source) => {
    let low = 0
    let high = boundaries.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (boundaries[middle]! <= source) {
        found = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return found < 0 ? '' : keys[found]!
  }
}

/**
 * The Pandoc input for one export. Every format reads the Revised projection
 * through the upstream `gfm` reader; `.docx` of a document with CriticMarkup
 * instead receives the Markup view as a Pandoc AST so Word shows tracked
 * changes and comments.
 */
export const projectPandocExport = (
  source: string,
  options: Readonly<Partial<MarkdownOptions>>,
  target: string
): PandocExportInput => {
  const core = createDocumentCore()
  const revision = core.open(source, options)
  const markdown = core.project(revision, 'revised').markdown
  if (target !== PANDOC_TRACKED_TARGET || revision.annotations.length === 0) return { markdown }
  return { markdown, document: buildTrackedPandocDocument(core, revision) }
}
