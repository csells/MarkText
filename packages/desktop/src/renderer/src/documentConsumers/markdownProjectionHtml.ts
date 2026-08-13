import type {
  MarkdownAstNode,
  MarkdownProjection
} from '@marktext/document-core'
import { generateGithubSlug } from '@muyajs/core'

import { sanitize, EXPORT_DOMPURIFY_CONFIG } from '@/util/dompurify'

interface RenderContext {
  readonly tightList: boolean
  readonly headingSlugs: Map<string, number>
}

const escapeHtml = (value: string): string => value
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

const headingIdOf = (
  node: MarkdownAstNode,
  headingSlugs: Map<string, number>
): string => {
  const base = generateGithubSlug(semanticPlainTextOf(node)) || 'heading'
  const count = headingSlugs.get(base) ?? 0
  headingSlugs.set(base, count + 1)
  return count === 0 ? base : `${base}-${String(count)}`
}

const renderListItem = (
  node: MarkdownAstNode,
  context: RenderContext,
  render: (node: MarkdownAstNode, context: RenderContext) => string
): string => {
  const rendered = node.children.map(child => render(
    child,
    child.kind === 'paragraph' ? context : { ...context, tightList: false }
  ))
  let body = ''
  for (const child of rendered) {
    if (body && !body.endsWith('\n')) body += '\n'
    body += child
  }
  const checkbox = taskCheckboxOf(node)
  const leadingBreak = checkbox === '' && body &&
      (!context.tightList || node.children[0]?.kind !== 'paragraph')
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
  projection: Pick<MarkdownProjection, 'ast'>
): string {
  const render = (node: MarkdownAstNode, context: RenderContext): string => {
    const children = (childContext: RenderContext = context): string => node.children
      .map(child => render(child, childContext))
      .join('')

    switch (node.kind) {
      case 'document':
        return children()
      case 'paragraph':
        return context.tightList ? children() : `<p>${children()}</p>\n`
      case 'heading': {
        const level = node.attributes['level']
        if (!Number.isInteger(level) || typeof level !== 'number' || level < 1 || level > 6) {
          throw new Error('Projected Markdown heading has no valid level')
        }
        const id = headingIdOf(node, context.headingSlugs)
        return `<h${String(level)} id="${escapeHtml(id)}">${children()}</h${String(level)}>\n`
      }
      case 'blockquote':
        return `<blockquote>\n${children()}</blockquote>\n`
      case 'list': {
        const tag = node.attributes['ordered'] === true ? 'ol' : 'ul'
        const content = children({
          tightList: node.attributes['tight'] === true,
          headingSlugs: context.headingSlugs
        })
        const start = tag === 'ol' && typeof node.attributes['start'] === 'number' &&
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
            ? node.children.map(child => child.kind === 'strong'
              ? child.children.map(grandchild => render(grandchild, context)).join('')
              : render(child, context)).join('')
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
        return `<pre><code${className}>${escapeHtml(stringAttribute(node, 'content'))}` +
          '</code></pre>\n'
      }
      case 'link':
        return `<a href="${escapeHtml(stringAttribute(node, 'semanticDestination'))}"` +
          `${titleAttributeOf(node)}>${children()}</a>`
      case 'image':
        return `<img src="${escapeHtml(stringAttribute(node, 'semanticDestination'))}" ` +
          `alt="${escapeHtml(semanticPlainTextOf(node))}"${titleAttributeOf(node)} />`
      case 'autolink':
        return `<a href="${escapeHtml(stringAttribute(node, 'semanticDestination'))}">` +
          `${escapeHtml(stringAttribute(node, 'rawDestination'))}</a>`
      case 'inline-html':
      case 'html-block':
        return filteredHtmlContentOf(node)
      case 'definition':
        return ''
      case 'front-matter':
        return `<pre class="front-matter"><code>${
          escapeHtml(stringAttribute(node, 'content'))
        }</code></pre>\n`
      case 'inline-math':
        return `<span class="math">${escapeHtml(stringAttribute(node, 'content'))}</span>`
      case 'math-block':
        return `<div class="math-block">${escapeHtml(stringAttribute(node, 'content'))}</div>\n`
      case 'diagram':
        return `<pre class="diagram"><code>${
          escapeHtml(stringAttribute(node, 'content'))
        }</code></pre>\n`
      case 'table': {
        const header = node.children
          .filter(child => child.attributes['header'] === true)
          .map(child => render(child, context))
          .join('')
        const body = node.children
          .filter(child => child.attributes['header'] !== true)
          .map(child => render(child, context))
          .join('')
        return '<table>\n' +
          (header ? `<thead>\n${header}</thead>\n` : '') +
          (body ? `<tbody>\n${body}</tbody>\n` : '') +
          '</table>\n'
      }
      case 'table-row':
        return `<tr>\n${children()}</tr>\n`
      case 'table-cell': {
        const alignment = node.attributes['alignment']
        if (alignment !== undefined && alignment !== 'none' && alignment !== 'left' &&
            alignment !== 'center' && alignment !== 'right') {
          throw new Error('Projected Markdown table cell has an invalid alignment')
        }
        const tag = node.attributes['header'] === true ? 'th' : 'td'
        const align = typeof alignment === 'string' && alignment !== 'none'
          ? ` align="${alignment}"`
          : ''
        return `<${tag}${align}>${children()}</${tag}>\n`
      }
      case 'footnote-definition':
        return `<div class="footnote-definition">${children()}</div>\n`
      case 'footnote-reference': {
        const label = stringAttribute(node, 'label')
        return `<sup class="footnote-reference">${escapeHtml(label)}</sup>`
      }
    }
  }

  const html = render(projection.ast.root, {
    tightList: false,
    headingSlugs: new Map()
  })
  return sanitize(html, EXPORT_DOMPURIFY_CONFIG)
}
