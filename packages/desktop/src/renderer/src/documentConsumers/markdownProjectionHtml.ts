import type { MarkdownAstNode, MarkdownProjection } from '@marktext/document-core'
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
  projection: Pick<MarkdownProjection, 'ast'>,
  options: MarkdownProjectionRenderOptions = {}
): string {
  const footnoteDefinitions = new Map<number, MarkdownAstNode>()
  const footnoteNumbers = new Map<number, number>()
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
        return escapeHtml(stringAttribute(node, 'semanticText'))
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
        return `<code>${escapeHtml(stringAttribute(node, 'semanticContent'))}</code>`
      case 'code-block': {
        const info = node.attributes['semanticInfo']
        const language = typeof info === 'string' ? info.trim().split(/\s/u)[0] : undefined
        const className = language ? ` class="language-${escapeHtml(language)}"` : ''
        const content = stringAttribute(node, 'content')
        const highlighted = highlightCode(content, language ?? '')
        return (
          `<pre><code${className}>${highlighted === content ? escapeHtml(content) : highlighted}` +
          '</code></pre>\n'
        )
      }
      case 'link':
        return (
          `<a href="${escapeHtml(stringAttribute(node, 'semanticDestination'))}"` +
          `${titleAttributeOf(node)}>${children()}</a>`
        )
      case 'image':
        return (
          `<img src="${escapeHtml(stringAttribute(node, 'semanticDestination'))}" ` +
          `alt="${escapeHtml(semanticPlainTextOf(node))}"${titleAttributeOf(node)} />`
        )
      case 'autolink':
        return (
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
        return renderMath(stringAttribute(node, 'content'), {
          displayMode: false,
          throwOnError: false
        })
      case 'math-block':
        return (
          renderMath(stringAttribute(node, 'content'), { displayMode: true, throwOnError: false }) +
          '\n'
        )
      case 'diagram':
        return `<pre class="diagram"><code class="language-${escapeHtml(stringAttribute(node, 'language'))}">${escapeHtml(
          stringAttribute(node, 'content')
        )}</code></pre>\n`
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
        if (node.attributes['resolved'] !== true || typeof definitionStart !== 'number') {
          return `[^${escapeHtml(stringAttribute(node, 'rawLabel'))}]`
        }
        if (!footnoteDefinitions.has(definitionStart)) {
          throw new Error('Projected footnote reference has no resolved definition')
        }
        const number = footnoteNumbers.get(definitionStart) ?? footnoteNumbers.size + 1
        footnoteNumbers.set(definitionStart, number)
        return renderFootnoteReference(number, options.footnotePrefix)
      }
    }
  }

  const context: RenderContext = {
    tightList: false,
    allocateHeadingId: createHeadingIdAllocator()
  }
  const body = render(projection.ast.root, context)
  const definitions: Array<{ number: number; html: string }> = []
  for (const [definitionStart, number] of footnoteNumbers) {
    const definition = footnoteDefinitions.get(definitionStart)
    if (definition === undefined) throw new Error('Projected footnote definition is unavailable')
    definitions.push({
      number,
      html: definition.children.map((child) => render(child, context)).join('')
    })
  }
  const html = appendFootnoteSection(body, definitions, options.footnotePrefix)
  return rewriteImageSrcs(sanitize(html, EXPORT_DOMPURIFY_CONFIG))
}

/** Enrich parser-owned HTML with the same media pipeline used by existing MarkText exports. */
export async function presentMarkdownProjectionHtml(html: string, muya?: Muya): Promise<string> {
  const article = await MarkdownToHtml.fromHtml(html, muya).renderHtml({ preview: true })
  const match = /^<article class="markdown-body">([\s\S]*)<\/article>$/.exec(article)
  if (match === null) throw new Error('Markdown presentation did not return an article')
  return match[1]
}
