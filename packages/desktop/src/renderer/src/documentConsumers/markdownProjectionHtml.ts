import type { MarkdownAstNode, MarkdownProjection, SourceRange } from '@marktext/document-core'
import {
  appendFootnoteSection,
  renderFootnoteReference,
  createHeadingIdAllocator,
  renderMath,
  highlightCode,
  MarkdownToHtml,
  type Muya
} from '@muyajs/core'

import { sanitize, EXPORT_DOMPURIFY_CONFIG } from '@/util/dompurify'
import { rewriteImageSrcs } from '@/util/rewriteImageSrcs'

import type { MarkupPassage, MarkupPassageMark } from './markupPassage'
import { semanticTextPieces } from './semanticTextPieces'

// Suggested text is announced by its review meaning, as the editor announces it.
const markRole = (mark: MarkupPassageMark): 'insertion' | 'deletion' | 'mark' => {
  if (mark.kind === 'addition' || (mark.kind === 'substitution' && mark.arm === 'new')) {
    return 'insertion'
  }
  return mark.kind === 'highlight' ? 'mark' : 'deletion'
}

const markOpenTag = (mark: MarkupPassageMark, element = 'span'): string => {
  const arm = mark.arm === undefined ? '' : ` core-critic-${mark.kind}-${mark.arm}`
  return `<${element} class="core-critic-mark core-critic-${mark.kind}${arm}" role="${markRole(mark)}">`
}

const marksAt = (marks: readonly MarkupPassageMark[], position: number): MarkupPassageMark[] =>
  marks.filter((mark) => mark.start <= position && position < mark.end)

/**
 * Writes HTML whose text runs sit inside the marks covering them. Marks are
 * closed at every element boundary, so the output stays well nested.
 */
const createMarkedWriter = (marks: readonly MarkupPassageMark[]) => {
  let html = ''
  const open: MarkupPassageMark[] = []
  const closeMarks = (): void => {
    html += '</span>'.repeat(open.length)
    open.length = 0
  }
  const markTo = (position: number): void => {
    const target = marksAt(marks, position)
    let shared = 0
    while (shared < open.length && shared < target.length && open[shared] === target[shared]) shared += 1
    html += '</span>'.repeat(open.length - shared)
    open.length = shared
    for (const mark of target.slice(shared)) {
      html += markOpenTag(mark)
      open.push(mark)
    }
  }
  return {
    /** Text or an atom at `position`, inside the marks covering it. */
    write(position: number, content: string): void {
      markTo(position)
      html += content
    },
    /** Markup that must not sit inside a mark span, such as an element tag. */
    raw(content: string): void {
      closeMarks()
      html += content
    },
    finish(): string {
      closeMarks()
      return html
    }
  }
}

/** Marked HTML for one text node, limited to `range` when one is given. */
const markedTextHtml = (
  node: MarkdownAstNode,
  marks: readonly MarkupPassageMark[],
  range?: SourceRange
): { html: string; text: string } => {
  const writer = createMarkedWriter(marks)
  let text = ''
  for (const piece of semanticTextPieces(node)) {
    if (range !== undefined && (piece.at < range.start || piece.at >= range.end)) continue
    writer.write(piece.at, escapeHtml(piece.text))
    text += piece.text
  }
  return { html: writer.finish(), text }
}

/** Wraps an atom in the marks covering its start. */
const markedAtomHtml = (
  marks: readonly MarkupPassageMark[],
  position: number,
  html: string,
  element = 'span'
): string =>
  marksAt(marks, position).reduceRight(
    (inner, mark) => `${markOpenTag(mark, element)}${inner}</${element}>`,
    html
  )

interface RenderContext {
  readonly tightList: boolean
  readonly allocateHeadingId: (text: string) => string
}

export interface MarkdownProjectionRenderOptions {
  readonly footnotePrefix?: string
  readonly htmlEnabled?: boolean
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const stringAttribute = (node: MarkdownAstNode, name: string): string => {
  const value = node.attributes[name]
  if (typeof value !== 'string') {
    throw new Error(`Projected Markdown ${node.kind} has no ${name} string`)
  }
  return value
}

const semanticPlainTextOf = (node: MarkdownAstNode): string => {
  switch (node.kind) {
    case 'text':
      return stringAttribute(node, 'semanticText')
    case 'soft-break':
    case 'hard-break':
      return '\n'
    case 'inline-code':
      return stringAttribute(node, 'semanticContent')
    default:
      return node.children.map(semanticPlainTextOf).join('')
  }
}

const titleAttributeOf = (node: MarkdownAstNode): string => {
  const title = node.attributes['semanticTitle']
  return typeof title === 'string' ? ` title="${escapeHtml(title)}"` : ''
}

const imageLayoutAttributesOf = (node: MarkdownAstNode): string =>
  [
    ['width', 'semanticWidth'],
    ['height', 'semanticHeight'],
    ['data-align', 'semanticAlign']
  ]
    .map(([name, attribute]) => {
      const value = node.attributes[attribute]
      return typeof value === 'string' ? ` ${name}="${escapeHtml(value)}"` : ''
    })
    .join('')

const filteredHtmlContentOf = (node: MarkdownAstNode): string => {
  const content = stringAttribute(node, 'content')
  if (node.attributes['gfmTagFilter'] !== true) return content
  return content.replace(
    /<(\/?)(title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\s>])/giu,
    '&lt;$1$2'
  )
}

const taskCheckboxOf = (node: MarkdownAstNode): string => {
  if (node.attributes['task'] !== true) return ''
  return node.attributes['checked'] === true
    ? '<input checked="" disabled="" type="checkbox">'
    : '<input disabled="" type="checkbox">'
}

const renderListItem = (
  node: MarkdownAstNode,
  context: RenderContext,
  render: (node: MarkdownAstNode, context: RenderContext) => string
): string => {
  const rendered = node.children.map((child) =>
    render(child, child.kind === 'paragraph' ? context : { ...context, tightList: false })
  )
  let body = ''
  for (const child of rendered) {
    if (body && !body.endsWith('\n')) body += '\n'
    body += child
  }
  const checkbox = taskCheckboxOf(node)
  const leadingBreak =
    checkbox === '' && body && (!context.tightList || node.children[0]?.kind !== 'paragraph')
      ? '\n'
      : ''
  return `<li>${checkbox}${leadingBreak}${body}</li>\n`
}

/**
 * Renders a public, parser-owned Markdown projection without reading source,
 * renderer state, or DOM serialization. Raw HTML remains part of Markdown
 * semantics during rendering and the complete fragment is sanitized once at
 * the desktop trust boundary.
 */
export function renderMarkdownProjectionToSafeHtml(
  projection: Pick<MarkdownProjection, 'ast'> & Partial<Pick<MarkupPassage, 'marks'>>,
  options: MarkdownProjectionRenderOptions = {}
): string {
  const marks = projection.marks ?? []
  // Leaf blocks and inline atoms take the marks covering their start.
  const marked = (node: MarkdownAstNode, html: string, element?: string): string =>
    marks.length === 0 ? html : markedAtomHtml(marks, node.range.start, html, element)
  const footnoteDefinitions = new Map<number, MarkdownAstNode>()
  const footnoteNumbers = new Map<number, number>()
  const footnoteReferences = new Map<number, number>()
  let renderingDefinitions = false
  const collectFootnotes = (node: MarkdownAstNode): void => {
    if (node.kind === 'footnote-definition') {
      footnoteDefinitions.set(node.range.start, node)
    }
    for (const child of node.children) collectFootnotes(child)
  }
  collectFootnotes(projection.ast.root)
  const render = (node: MarkdownAstNode, context: RenderContext): string => {
    const children = (childContext: RenderContext = context): string =>
      node.children.map((child) => render(child, childContext)).join('')

    switch (node.kind) {
      case 'document':
        return children()
      case 'paragraph':
        if (node.range.start === node.range.end && node.children.length === 0) return ''
        return context.tightList ? children() : `<p>${children()}</p>\n`
      case 'heading': {
        const level = node.attributes['level']
        if (!Number.isInteger(level) || typeof level !== 'number' || level < 1 || level > 6) {
          throw new Error('Projected Markdown heading has no valid level')
        }
        const id = context.allocateHeadingId(semanticPlainTextOf(node))
        return `<h${String(level)} id="${escapeHtml(id)}">${children()}</h${String(level)}>\n`
      }
      case 'blockquote':
        return `<blockquote>\n${children()}</blockquote>\n`
      case 'list': {
        const tag = node.attributes['ordered'] === true ? 'ol' : 'ul'
        const content = children({
          tightList: node.attributes['tight'] === true,
          allocateHeadingId: context.allocateHeadingId
        })
        const start =
          tag === 'ol' &&
          typeof node.attributes['start'] === 'number' &&
          node.attributes['start'] !== 1
            ? ` start="${String(node.attributes['start'])}"`
            : ''
        return `<${tag}${start}>\n${content}</${tag}>\n`
      }
      case 'list-item':
        return renderListItem(node, context, render)
      case 'thematic-break':
        return '<hr />\n'
      case 'text':
        if (node.attributes.emojiClosed === true && typeof node.attributes.emojiValue === 'string') {
          return marked(node, escapeHtml(node.attributes.emojiValue))
        }
        return marks.length === 0
          ? escapeHtml(stringAttribute(node, 'semanticText'))
          : markedTextHtml(node, marks).html
      case 'soft-break':
        return '\n'
      case 'hard-break':
        return '<br />\n'
      case 'emphasis':
        return `<em>${children()}</em>`
      case 'strong':
        return `<strong>${
          node.attributes['semanticFlattenStrongChildren'] === true
            ? node.children
              .map((child) =>
                child.kind === 'strong'
                  ? child.children.map((grandchild) => render(grandchild, context)).join('')
                  : render(child, context)
              )
              .join('')
            : children()
        }</strong>`
      case 'strikethrough':
        return `<del>${children()}</del>`
      case 'subscript':
        return `<sub>${children()}</sub>`
      case 'superscript':
        return `<sup>${children()}</sup>`
      case 'inline-code':
        return marked(node, `<code>${escapeHtml(stringAttribute(node, 'semanticContent'))}</code>`)
      case 'code-block': {
        const info = node.attributes['semanticInfo']
        const language = typeof info === 'string' ? info.trim().split(/\s/u)[0] : undefined
        const className = language ? ` class="language-${escapeHtml(language)}"` : ''
        const content = stringAttribute(node, 'content')
        const highlighted = highlightCode(content, language ?? '')
        return marked(
          node,
          `<pre><code${className}>${highlighted === content ? escapeHtml(content) : highlighted}` +
            '</code></pre>\n',
          'div'
        )
      }
      case 'link':
        return (
          `<a href="${escapeHtml(stringAttribute(node, 'semanticDestination'))}"` +
          `${titleAttributeOf(node)}>${children()}</a>`
        )
      case 'image':
        return marked(
          node,
          `<img src="${escapeHtml(stringAttribute(node, 'semanticDestination'))}" ` +
          `alt="${escapeHtml(semanticPlainTextOf(node))}"${titleAttributeOf(node)}${imageLayoutAttributesOf(node)} />`
        )
      case 'autolink':
        return marked(
          node,
          `<a href="${escapeHtml(stringAttribute(node, 'semanticDestination'))}">` +
          `${escapeHtml(stringAttribute(node, 'rawDestination'))}</a>`
        )
      case 'inline-html':
      case 'html-block':
        return options.htmlEnabled === false
          ? escapeHtml(stringAttribute(node, 'content'))
          : filteredHtmlContentOf(node)
      case 'definition':
        return ''
      case 'front-matter':
        return `<pre class="front-matter"><code>${escapeHtml(
          stringAttribute(node, 'content')
        )}</code></pre>\n`
      case 'inline-math':
        return marked(
          node,
          renderMath(stringAttribute(node, 'content'), {
            displayMode: false,
            throwOnError: false
          })
        )
      case 'math-block':
        return marked(
          node,
          renderMath(stringAttribute(node, 'content'), { displayMode: true, throwOnError: false }) +
            '\n',
          'div'
        )
      case 'diagram':
        return marked(
          node,
          `<pre class="diagram"><code class="language-${escapeHtml(stringAttribute(node, 'language'))}">${escapeHtml(
            stringAttribute(node, 'content')
          )}</code></pre>\n`,
          'div'
        )
      case 'table': {
        const header = node.children
          .filter((child) => child.attributes['header'] === true)
          .map((child) => render(child, context))
          .join('')
        const body = node.children
          .filter((child) => child.attributes['header'] !== true)
          .map((child) => render(child, context))
          .join('')
        return (
          '<table>\n' +
          (header ? `<thead>\n${header}</thead>\n` : '') +
          (body ? `<tbody>\n${body}</tbody>\n` : '') +
          '</table>\n'
        )
      }
      case 'table-row':
        return `<tr>\n${children()}</tr>\n`
      case 'table-cell': {
        const alignment = node.attributes['alignment']
        if (
          alignment !== undefined &&
          alignment !== 'none' &&
          alignment !== 'left' &&
          alignment !== 'center' &&
          alignment !== 'right'
        ) {
          throw new Error('Projected Markdown table cell has an invalid alignment')
        }
        const tag = node.attributes['header'] === true ? 'th' : 'td'
        const align =
          typeof alignment === 'string' && alignment !== 'none' ? ` align="${alignment}"` : ''
        return `<${tag}${align}>${children()}</${tag}>\n`
      }
      case 'footnote-definition':
        return ''
      case 'footnote-reference': {
        const definitionStart = node.attributes['resolvedDefinitionStart']
        // A note body is no place a reference resolves; it stays literal, as
        // upstream writes it (#5492).
        if (node.attributes['resolved'] !== true || typeof definitionStart !== 'number' || renderingDefinitions) {
          return `[^${escapeHtml(stringAttribute(node, 'rawLabel'))}]`
        }
        if (!footnoteDefinitions.has(definitionStart)) {
          throw new Error('Projected footnote reference has no resolved definition')
        }
        const number = footnoteNumbers.get(definitionStart) ?? footnoteNumbers.size + 1
        footnoteNumbers.set(definitionStart, number)
        // Every reference gets its own id and backref (#5492).
        const occurrence = (footnoteReferences.get(definitionStart) ?? 0) + 1
        footnoteReferences.set(definitionStart, occurrence)
        return renderFootnoteReference(number, options.footnotePrefix, occurrence)
      }
    }
  }

  const context: RenderContext = {
    tightList: false,
    allocateHeadingId: createHeadingIdAllocator()
  }
  const body = render(projection.ast.root, context)
  const definitions: Array<{ number: number; html: string; references: number }> = []
  renderingDefinitions = true
  for (const [definitionStart, number] of footnoteNumbers) {
    const definition = footnoteDefinitions.get(definitionStart)
    if (definition === undefined) throw new Error('Projected footnote definition is unavailable')
    definitions.push({
      number,
      html: definition.children.map((child) => render(child, context)).join(''),
      references: footnoteReferences.get(definitionStart) ?? 1
    })
  }
  const html = appendFootnoteSection(body, definitions, options.footnotePrefix)
  return rewriteImageSrcs(sanitize(html, EXPORT_DOMPURIFY_CONFIG))
}

export interface MarkupPassageExcerpt {
  /** Sanitized phrasing content; block boundaries are line breaks. */
  readonly html: string
  /** The same passage as plain text, for an accessible name. */
  readonly text: string
}

const EXCERPT_BLOCKS = new Set([
  'document',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'list-item',
  'table',
  'table-row',
  'footnote-definition'
])

/**
 * Presents a Markup passage as a compact excerpt that fits inside a control:
 * text formatting and review marks as the editor shows them, with blocks
 * flattened to lines and links, images and raw HTML reduced to their text.
 */
export function renderMarkupPassageExcerpt(passage: MarkupPassage): MarkupPassageExcerpt {
  const { marks, range } = passage
  const inRange = (node: MarkdownAstNode): boolean =>
    range === undefined || (node.range.start < range.end && node.range.end > range.start)
  let html = ''
  let text = ''
  let pendingBreak = false
  const emit = (fragment: MarkupPassageExcerpt): void => {
    if (fragment.html === '' && fragment.text === '') return
    if (pendingBreak && (html !== '' || text !== '')) {
      html += '\n'
      text += '\n'
    }
    pendingBreak = false
    html += fragment.html
    text += fragment.text
  }
  const atom = (node: MarkdownAstNode, content: string, plain: string): MarkupPassageExcerpt =>
    inRange(node) ? { html: markedAtomHtml(marks, node.range.start, content), text: plain } : { html: '', text: '' }

  const inline = (node: MarkdownAstNode): MarkupPassageExcerpt => {
    const wrap = (tag: string): MarkupPassageExcerpt => {
      const inner = inlines(node.children)
      return inner.html === '' ? inner : { html: `<${tag}>${inner.html}</${tag}>`, text: inner.text }
    }
    switch (node.kind) {
      case 'text':
        if (node.attributes.emojiClosed === true && typeof node.attributes.emojiValue === 'string') {
          return atom(node, escapeHtml(node.attributes.emojiValue), node.attributes.emojiValue)
        }
        return markedTextHtml(node, marks, range)
      case 'soft-break':
      case 'hard-break':
        return atom(node, '\n', ' ')
      case 'emphasis':
        return wrap('em')
      case 'strong':
        return wrap('strong')
      // <del> would announce a formatting strike as a review deletion.
      case 'strikethrough':
        return wrap('s')
      case 'subscript':
        return wrap('sub')
      case 'superscript':
        return wrap('sup')
      case 'link':
        return inlines(node.children)
      case 'inline-code': {
        const content = stringAttribute(node, 'semanticContent')
        return atom(node, `<code>${escapeHtml(content)}</code>`, content)
      }
      case 'inline-math': {
        const content = stringAttribute(node, 'content')
        return atom(node, renderMath(content, { displayMode: false, throwOnError: false }), content)
      }
      // An image reads as its alt text, which a suggestion in it may hold only
      // part of: that part is the excerpt, as for any other text.
      case 'image':
        return inlines(node.children)
      case 'autolink': {
        const destination = stringAttribute(node, 'rawDestination')
        return atom(node, escapeHtml(destination), destination)
      }
      case 'inline-html': {
        const content = stringAttribute(node, 'content')
        return atom(node, escapeHtml(content), content)
      }
      case 'footnote-reference': {
        const label = `[^${stringAttribute(node, 'rawLabel')}]`
        return atom(node, escapeHtml(label), label)
      }
      default:
        return { html: '', text: '' }
    }
  }
  const inlines = (nodes: readonly MarkdownAstNode[]): MarkupPassageExcerpt => {
    let innerHtml = ''
    let innerText = ''
    for (const child of nodes) {
      const fragment = inline(child)
      innerHtml += fragment.html
      innerText += fragment.text
    }
    return { html: innerHtml, text: innerText }
  }
  const block = (node: MarkdownAstNode): void => {
    if (!inRange(node)) return
    if (EXCERPT_BLOCKS.has(node.kind)) {
      if (node.kind === 'paragraph' || node.kind === 'heading') {
        emit(inlines(node.children))
      } else {
        for (const child of node.children) block(child)
      }
      pendingBreak = true
      return
    }
    switch (node.kind) {
      case 'table-cell': {
        const cell = inlines(node.children)
        emit(cell.html === '' ? cell : { html: `${cell.html} `, text: `${cell.text} ` })
        return
      }
      case 'code-block':
      case 'diagram':
      case 'math-block':
      case 'front-matter':
      case 'html-block': {
        const content = stringAttribute(node, 'content')
        emit(atom(node, `<code>${escapeHtml(content)}</code>`, content))
        pendingBreak = true
        return
      }
      default:
        emit(inline(node))
    }
  }
  block(passage.ast.root)
  return { html: sanitize(html, EXPORT_DOMPURIFY_CONFIG), text: text.replace(/\s+/gu, ' ').trim() }
}

/** Enrich parser-owned HTML with the same media pipeline used by existing MarkText exports. */
export async function presentMarkdownProjectionHtml(html: string, muya?: Muya): Promise<string> {
  const article = await MarkdownToHtml.fromHtml(html, muya).renderHtml({ preview: true })
  const match = /^<article class="markdown-body">([\s\S]*)<\/article>$/.exec(article)
  if (match === null) throw new Error('Markdown presentation did not return an article')
  return match[1]
}
