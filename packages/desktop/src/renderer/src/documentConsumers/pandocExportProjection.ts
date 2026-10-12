import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type DocumentCore,
  type DocumentRevision,
  type MarkdownAstNode,
  type MarkdownOptions
} from '@marktext/document-core'
import { DISPLAY_MATH_MARKERS } from '@muyajs/core'
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'

import type { PandocDocument, PandocJsonNode } from '@shared/types/files'

import { stringAttribute } from './astAttributes'
import { semanticTextPieces, type SemanticTextPiece } from './semanticTextPieces'

/**
 * Pandoc's own default for a change or comment with no author. MarkText records
 * no authorship, so every tracked change and comment carries this neutral name.
 */
export const PANDOC_NEUTRAL_AUTHOR = 'unknown'

/** Pandoc writer whose output carries suggestions and comments natively. */
const PANDOC_TRACKED_TARGET = 'docx'

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

// Containers pandoc-types' builder joins when two of the same kind meet.
const MELDED_CONTAINERS = new Set(['Emph', 'Underline', 'Strong', 'Subscript', 'Superscript', 'Strikeout'])

/**
 * Joins neighbouring inlines exactly as pandoc-types' `Inlines` builder does,
 * so the AST is the one pandoc's own readers would produce. Writers split runs
 * and escape text per node, so unjoined neighbours change their output.
 */
const normalizeInlines = (inlines: readonly PandocJsonNode[]): PandocJsonNode[] => {
  const joined: PandocJsonNode[] = []
  for (const inline of inlines) {
    const last = joined[joined.length - 1]
    const kinds = `${last?.t ?? ''} ${inline.t}`
    if (last === undefined) {
      joined.push(inline)
    } else if (kinds === 'Str Str') {
      joined[joined.length - 1] = str(`${last.c as string}${inline.c as string}`)
    } else if (kinds === 'Space Space' || kinds === 'SoftBreak SoftBreak') {
      continue
    } else if (kinds === 'Space SoftBreak' || kinds === 'SoftBreak Space') {
      joined[joined.length - 1] = { t: 'SoftBreak' }
    } else if (/^(Space|SoftBreak) LineBreak$|^LineBreak (Space|SoftBreak)$/u.test(kinds)) {
      joined[joined.length - 1] = { t: 'LineBreak' }
    } else if (last.t === inline.t && MELDED_CONTAINERS.has(inline.t)) {
      joined[joined.length - 1] = {
        t: inline.t,
        c: normalizeInlines([...(last.c as PandocJsonNode[]), ...(inline.c as PandocJsonNode[])])
      }
    } else {
      joined.push(inline)
    }
  }
  return joined
}

const wrapSpan = (wrap: Wrap, content: PandocJsonNode[]): PandocJsonNode => ({
  t: 'Span',
  c: [['', [wrap], wrap === 'mark' ? [] : [['author', PANDOC_NEUTRAL_AUTHOR]]], normalizeInlines(content)]
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
  return normalizeInlines(inlines)
}

// pandoc keeps a link's path as written: escapes resolved, nothing percent-encoded.
const destinationOf = (node: MarkdownAstNode): string =>
  stringAttribute(node, 'decodedDestination') || stringAttribute(node, 'semanticDestination') || ''

/** pandoc's `stringify`, with emoji spelled by name as its identifiers use them. */
const identifierText = (inlines: readonly PandocJsonNode[]): string =>
  inlines
    .map((inline) => {
      const content = inline.c as unknown[]
      switch (inline.t) {
        case 'Str':
          return inline.c as string
        case 'Space':
        case 'SoftBreak':
        case 'LineBreak':
          return ' '
        case 'Code':
        case 'Math':
          return content[1] as string
        case 'RawInline':
          // pandoc #2105: an HTML line break separates words.
          return content[0] === 'html' && (content[1] as string).startsWith('<br') ? ' ' : ''
        case 'Span': {
          const [[, classes, pairs], children] = content as [[string, string[], string[][]], PandocJsonNode[]]
          const emoji = classes.includes('emoji') ? pairs.find(([name]) => name === 'data-emoji') : undefined
          return emoji?.[1] ?? identifierText(children)
        }
        case 'Link':
        case 'Image':
          return identifierText(content[1] as PandocJsonNode[])
        case 'Note':
          return ''
        default:
          return MELDED_CONTAINERS.has(inline.t) ? identifierText(inline.c as PandocJsonNode[]) : ''
      }
    })
    .join('')

// Haskell's `isSpace` and the characters `gfm_auto_identifiers` keeps.
const IDENTIFIER_SPACE = /[\t\n\v\f\r\p{Zs}]/gu
const IDENTIFIER_DROPPED = /[^\p{L}\p{N}\p{Mn}\p{Mc}\p{Me}\p{Pc}_-]/gu

/**
 * Heading identifiers as pandoc's `gfm` reader assigns them: GitHub's slug
 * (each space a hyphen, punctuation dropped), repeated slugs numbered by how
 * often that slug occurred before, even when the number collides.
 */
const createPandocIdentifierAllocator = (): ((inlines: readonly PandocJsonNode[]) => string) => {
  const occurrences = new Map<string, number>()
  return (inlines) => {
    const base = identifierText(inlines)
      .toLowerCase()
      .replace(IDENTIFIER_SPACE, '-')
      .replace(IDENTIFIER_DROPPED, '')
    const seen = occurrences.get(base) ?? 0
    occurrences.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
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
  /** Whether a position holds protective text the parser generated. */
  readonly isGenerated: (position: number) => boolean
}

const UNTRACKED: TrackingContext = {
  keyAt: () => '',
  eventsOf: () => [],
  isGenerated: () => false
}

/**
 * Converts one parser-owned Markdown AST into Pandoc blocks, tracked or not.
 * `markdown` is the projection the AST ranges index, when it has one; front
 * matter's exact lines come from it.
 */
const createAstConverter = (root: MarkdownAstNode, context: TrackingContext, markdown?: string) => {
  const allocateHeadingId = createPandocIdentifierAllocator()
  const footnotes = new Map<number, MarkdownAstNode>()
  const collectFootnotes = (node: MarkdownAstNode): void => {
    if (node.kind === 'footnote-definition') footnotes.set(node.range.start, node)
    node.children.forEach(collectFootnotes)
  }
  collectFootnotes(root)
  // A definition renders at its first reference; later ones reuse its blocks.
  const renderedNotes = new Map<number, PandocJsonNode[]>()

  const textPieces = (node: MarkdownAstNode): SemanticTextPiece[] =>
    semanticTextPieces(node, context.isGenerated)

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
          ? { inline: build(normalizeInlines(inner.map((item) => item.inline))), key }
          : { inline: build(wrapItems(inner)), key: '' }
      )
    }
    for (const node of nodes) {
      switch (node.kind) {
        case 'text': {
          const emoji = stringAttribute(node, 'emojiValue') ?? ''
          if (node.attributes['emojiClosed'] === true && emoji !== '') {
            atom(node, {
              t: 'Span',
              c: [['', ['emoji'], [['data-emoji', stringAttribute(node, 'emojiAlias') ?? '']]], [str(emoji)]]
            })
            break
          }
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
            if (piece.literal === true && /\s/u.test(piece.text)) {
              close()
              items.push({ inline: str(piece.text), key })
            } else {
              run += piece.text
            }
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
          atom(node, { t: 'Code', c: [EMPTY_ATTR, stringAttribute(node, 'semanticContent') ?? ''] })
          break
        case 'inline-math':
          atom(node, {
            t: 'Math',
            c: [
              { t: DISPLAY_MATH_MARKERS.has(stringAttribute(node, 'marker') ?? '') ? 'DisplayMath' : 'InlineMath' },
              stringAttribute(node, 'content') ?? ''
            ]
          })
          break
        case 'inline-html':
          atom(node, { t: 'RawInline', c: ['html', stringAttribute(node, 'content') ?? ''] })
          break
        case 'autolink':
          atom(node, {
            t: 'Link',
            c: [
              EMPTY_ATTR,
              [str(stringAttribute(node, 'rawDestination') ?? '')],
              [destinationOf(node), '']
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
          const alt = normalizeInlines(convertInlines(node.children, () => []).map((item) => item.inline))
          atom(node, {
            t: 'Image',
            c: [
              ['', [], layout],
              alt,
              [destinationOf(node), stringAttribute(node, 'semanticTitle') ?? '']
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
            atom(node, str(`[^${stringAttribute(node, 'rawLabel') ?? ''}]`))
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
        // Nested strong stays nested, as CommonMark and pandoc's readers keep it.
        case 'strong':
          container(node, (content) => ({ t: 'Strong', c: content }))
          break
        case 'strikethrough':
          container(node, (content) => ({ t: 'Strikeout', c: content }))
          break
        // pandoc's own `mark` extension reads `==…==` as this span.
        case 'mark':
          container(node, (content) => ({ t: 'Span', c: [['', ['mark'], []], content] }))
          break
        case 'inline-diff':
          atom(node, {
            t: 'Span',
            c: [
              ['', ['idiff', node.attributes['diff'] === 'addition' ? 'addition' : 'deletion'], []],
              textTokens(stringAttribute(node, 'semanticContent') ?? '')
            ]
          })
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
              [destinationOf(node), stringAttribute(node, 'semanticTitle') ?? '']
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
        const inlines = blockInlines(node)
        return [
          {
            t: 'Header',
            c: [typeof level === 'number' ? level : 1, [allocateHeadingId(inlines), [], []], inlines]
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
              first.c = normalizeInlines([...box, ...content])
            } else {
              blocks.unshift({ t: 'Plain', c: box.slice(0, 1) })
            }
          }
          return blocks
        })
        if (node.attributes['ordered'] !== true) return [{ t: 'BulletList', c: items }]
        const start = node.attributes['start']
        const delimiter = node.attributes['delimiter'] === ')' ? 'OneParen' : 'Period'
        return [
          {
            t: 'OrderedList',
            c: [[typeof start === 'number' ? start : 1, { t: 'Decimal' }, { t: delimiter }], items]
          }
        ]
      }
      case 'thematic-break':
        return [{ t: 'HorizontalRule' }]
      case 'code-block': {
        const info = (stringAttribute(node, 'semanticInfo') ?? '').trim().split(/\s/u)[0] ?? ''
        const content = stringAttribute(node, 'content') ?? ''
        // pandoc keeps the last newline of a fence left open to the end of the document.
        const unclosed =
          node.attributes['provider'] === 'fenced-code' &&
          node.attributes['contentEnd'] === node.range.end &&
          node.range.end === root.range.end
        return [
          literalBlock(node, content, () => ({
            t: 'CodeBlock',
            c: [['', info ? [info] : [], []], unclosed ? content : withoutFinalNewline(content)]
          }))
        ]
      }
      case 'diagram': {
        const content = stringAttribute(node, 'content') ?? ''
        return [
          literalBlock(node, content, () => ({
            t: 'CodeBlock',
            c: [['', [stringAttribute(node, 'language') ?? ''], []], withoutFinalNewline(content)]
          }))
        ]
      }
      case 'math-block': {
        const content = stringAttribute(node, 'content') ?? ''
        // pandoc keeps the line breaks inside `$$`…`$$`; a ```math fence loses its last.
        const tex = node.attributes['syntax'] === 'dollar' ? `\n${content}` : withoutFinalNewline(content)
        const math = { t: 'Math', c: [{ t: 'DisplayMath' }, tex] }
        const start = node.attributes['contentStart']
        const key = context.keyAt(typeof start === 'number' ? start : node.range.start)
        return [{ t: 'Para', c: wrapItems([{ inline: math, key }]) }]
      }
      case 'html-block':
        return [{ t: 'RawBlock', c: ['html', stringAttribute(node, 'content') ?? ''] }]
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
      case 'front-matter':
        // Only YAML is metadata to pandoc; its `gfm` reader shows other front
        // matter as the paragraph of lines it is.
        return node.attributes['lang'] === 'yaml' ? [] : [literalLines(node)]
      // Definitions render where they are used.
      case 'definition':
      case 'footnote-definition':
        return []
      default:
        return []
    }
  }

  const literalLines = (node: MarkdownAstNode): PandocJsonNode => {
    const lines = [
      stringAttribute(node, 'opener') ?? '',
      ...withoutFinalNewline(contentText(node) ?? stringAttribute(node, 'content') ?? '').split(/\r\n|\r|\n/u),
      stringAttribute(node, 'closer') ?? ''
    ].filter((line) => line !== '')
    return {
      t: 'Para',
      c: normalizeInlines(lines.flatMap((line, index) => [...(index > 0 ? [{ t: 'SoftBreak' }] : []), ...textTokens(line)]))
    }
  }

  // Front matter's exact lines, which its parsed content strips of indentation.
  const contentText = (node: MarkdownAstNode): string | undefined => {
    const { contentStart, contentEnd } = node.attributes
    return markdown !== undefined && typeof contentStart === 'number' && typeof contentEnd === 'number'
      ? markdown.slice(contentStart, contentEnd)
      : undefined
  }

  return { convertBlocks, blockInlines, contentText }
}

/** A Comment's Markdown body as the inline content Pandoc gives a comment. */
const commentBody = (core: DocumentCore, revision: DocumentRevision, comment: CriticMarkupAnnotation): PandocJsonNode[] => {
  const projection = core.projectComment(revision, comment)
  const blocks = createAstConverter(projection.ast.root, UNTRACKED).convertBlocks([projection.ast.root], false)
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
 * The Markup view of a document as Pandoc blocks: additions and deletions are
 * insertion/deletion spans (Word tracked changes), a substitution is both, a
 * commented highlight is a comment over its text, a lone comment is anchored
 * where it stands, and a lone highlight is highlighted text.
 */
const buildTrackedBlocks = (core: DocumentCore, revision: DocumentRevision): PandocJsonNode[] => {
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

  const converter = createAstConverter(ast.root, {
    keyAt: (position) => keyAtSource(sourceOf(position)),
    eventsOf: (block) => eventsByBlock.get(block) ?? [],
    isGenerated: (position) => coordinates.originAt(position).kind === 'generated'
  })
  const blocks = converter.convertBlocks([ast.root], false)
  // Markers owed to blocks that never render (an unreferenced footnote) still
  // close their comment.
  const orphans = events.filter((event) => !event.emitted).map((event) => event.inline)
  if (orphans.length > 0) blocks.push({ t: 'Para', c: orphans })
  return blocks
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

// How pandoc resolves an unquoted YAML scalar that is not text.
const YAML_NULL = /^(?:~|null|Null|NULL|)$/u
const YAML_TRUE = /^(?:true|True|TRUE|yes|Yes|YES|on|On|ON)$/u
const YAML_FALSE = /^(?:false|False|FALSE|no|No|NO|off|Off|OFF)$/u
const YAML_NUMBER = /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?)$/u

/**
 * pandoc's `blocksToInlines`, which a metadata value written on one line uses
 * when its Markdown is more than one paragraph: blocks run on after a line
 * break, and a heading or code block ends with one.
 */
const blocksToInlines = (blocks: readonly PandocJsonNode[]): PandocJsonNode[] =>
  blocks.flatMap((block, index) => {
    const separator = index > 0 ? [{ t: 'LineBreak' }] : []
    const content = block.c as unknown[]
    switch (block.t) {
      case 'Plain':
      case 'Para':
        return [...separator, ...(content as PandocJsonNode[])]
      case 'Header':
        return [...separator, ...(content[2] as PandocJsonNode[]), { t: 'LineBreak' }]
      case 'CodeBlock':
        return [...separator, { t: 'Code', c: [content[0], content[1]] }, { t: 'LineBreak' }]
      case 'RawBlock':
        return [...separator, { t: 'RawInline', c: content }]
      case 'BlockQuote':
        return [...separator, ...blocksToInlines(content as PandocJsonNode[])]
      case 'BulletList':
        return [...separator, ...(content as PandocJsonNode[][]).flatMap(blocksToInlines)]
      case 'OrderedList':
        return [...separator, ...(content[1] as PandocJsonNode[][]).flatMap(blocksToInlines)]
      default:
        return separator
    }
  })

/**
 * Front matter as pandoc's metadata. pandoc reads YAML string values as
 * Markdown; here Core reads them, with the document's own options, so the
 * metadata means what the editor shows. Unreadable YAML is no metadata.
 */
const frontMatterMeta = (
  core: DocumentCore,
  yamlText: string,
  options: Readonly<Partial<MarkdownOptions>>
): Record<string, PandocJsonNode> => {
  const yaml = parseDocument(yamlText, { schema: 'core' })
  if (yaml.errors.length > 0 || !isMap(yaml.contents)) return {}

  // Front matter is literal to Core, so CriticMarkup in a value is text: every
  // opener Core recognizes is escaped until none is left.
  const literalCriticMarkup = (text: string): DocumentRevision => {
    let source = text
    for (;;) {
      const revision = core.open(source, options)
      if (revision.annotations.length === 0) return revision
      const openers = revision.annotations.map((annotation) => annotation.range.start).sort((left, right) => right - left)
      for (const opener of openers) source = `${source.slice(0, opener)}\\${source.slice(opener)}`
    }
  }
  const markdownValue = (text: string): PandocJsonNode => {
    const revised = core.project(literalCriticMarkup(text), 'revised')
    const blocks = createAstConverter(revised.ast.root, UNTRACKED, revised.markdown).convertBlocks([revised.ast.root], false)
    if (text.endsWith('\n')) return { t: 'MetaBlocks', c: blocks }
    const [only] = blocks
    const single = blocks.length === 1 && (only?.t === 'Para' || only?.t === 'Plain')
    return { t: 'MetaInlines', c: single ? only.c : normalizeInlines(blocksToInlines(blocks)) }
  }
  const value = (node: unknown, document: Document): PandocJsonNode => {
    if (isAlias(node)) return value(node.resolve(document), document)
    if (isMap(node)) {
      const entries: Record<string, PandocJsonNode> = {}
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
        if (!key.endsWith('_')) entries[key] = value(pair.value, document)
      }
      return { t: 'MetaMap', c: entries }
    }
    if (isSeq(node)) return { t: 'MetaList', c: node.items.map((item) => value(item, document)) }
    if (!isScalar(node)) return { t: 'MetaString', c: '' }
    if (node.type === 'PLAIN') {
      const plain = node.source ?? ''
      if (YAML_NULL.test(plain)) return { t: 'MetaString', c: '' }
      if (YAML_TRUE.test(plain)) return { t: 'MetaBool', c: true }
      if (YAML_FALSE.test(plain)) return { t: 'MetaBool', c: false }
      if (YAML_NUMBER.test(plain)) return { t: 'MetaInlines', c: [str(String(Number(plain)))] }
    }
    return markdownValue(String(node.value ?? ''))
  }
  return (value(yaml.contents, yaml) as { c: Record<string, PandocJsonNode> }).c
}

/**
 * The Pandoc AST for one export, built from Core's parse so pandoc never reads
 * Markdown itself. Every format carries the Revised projection; `.docx` of a
 * document with CriticMarkup carries the Markup view instead, so Word shows
 * tracked changes and comments. Front matter becomes metadata either way.
 */
export const projectPandocExport = (
  source: string,
  options: Readonly<Partial<MarkdownOptions>>,
  target: string
): PandocDocument => {
  const core = createDocumentCore()
  const revision = core.open(source, options)
  const revised = core.project(revision, 'revised')
  const converter = createAstConverter(revised.ast.root, UNTRACKED, revised.markdown)
  const [frontMatter] = revised.ast.root.children
  const yaml =
    frontMatter?.kind === 'front-matter' && frontMatter.attributes['lang'] === 'yaml'
      ? converter.contentText(frontMatter)
      : undefined
  const blocks =
    target === PANDOC_TRACKED_TARGET && revision.annotations.length > 0
      ? buildTrackedBlocks(core, revision)
      : converter.convertBlocks([revised.ast.root], false)
  return { meta: yaml === undefined ? {} : frontMatterMeta(core, yaml, options), blocks }
}
