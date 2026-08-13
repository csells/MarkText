import type {
  MarkdownAstNode,
  MarkdownProjection
} from '../../src/index.js'

/**
 * One-way semantic consumer for public document-core Markdown projections.
 *
 * This intentionally supports only the node kinds owned by the standards
 * ledger. Unsupported kinds remain red instead of falling back to reparsing
 * `projection.markdown` through another Markdown engine.
 */
export const renderPublicMarkdownProjectionToHtml = (
  projection: MarkdownProjection
): string => renderNode(projection.ast.root, projection.markdown)

interface RenderContext {
  readonly tightList: boolean
}

const renderNode = (
  node: MarkdownAstNode,
  markdown: string,
  context: RenderContext = { tightList: false }
): string => {
  const children = (childContext: RenderContext = context): string => node.children
    .map(child => renderNode(child, markdown, childContext))
    .join('')

  switch (node.kind) {
    case 'document':
      return children()
    case 'paragraph':
      return context.tightList ? children() : `<p>${children()}</p>\n`
    case 'heading': {
      const level = node.attributes['level']
      if (!Number.isInteger(level) || typeof level !== 'number' || level < 1 || level > 6) {
        throw new Error('Public Markdown heading has no valid level')
      }
      return `<h${String(level)}>${children()}</h${String(level)}>\n`
    }
    case 'blockquote':
      return `<blockquote>\n${children()}</blockquote>\n`
    case 'list': {
      const tag = node.attributes['ordered'] === true ? 'ol' : 'ul'
      const content = children({ tightList: node.attributes['tight'] === true })
      const start = tag === 'ol' && typeof node.attributes['start'] === 'number' &&
          node.attributes['start'] !== 1
        ? ` start="${String(node.attributes['start'])}"`
        : ''
      return `<${tag}${start}>\n${content}</${tag}>\n`
    }
    case 'list-item':
      return renderListItem(node, markdown, context)
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
          ? flattenedStrongChildren(node, markdown, context)
          : children()
      }</strong>`
    case 'strikethrough':
      return `<del>${children()}</del>`
    case 'inline-code':
      return `<code>${escapeHtml(stringAttribute(node, 'semanticContent'))}</code>`
    case 'code-block': {
      const info = node.attributes['semanticInfo']
      const language = typeof info === 'string' ? info.trim().split(/\s/u)[0] : undefined
      const className = language ? ` class="language-${escapeHtml(language)}"` : ''
      return `<pre><code${className}>${escapeHtml(stringAttribute(node, 'content'))}` +
        '</code></pre>\n'
    }
    case 'link': {
      const destination = stringAttribute(node, 'semanticDestination')
      return `<a href="${escapeHtml(destination)}"${titleAttributeOf(node)}>` +
        `${children()}</a>`
    }
    case 'image':
      return `<img src="${escapeHtml(stringAttribute(node, 'semanticDestination'))}" ` +
        `alt="${escapeHtml(plainTextOf(node, markdown))}"${titleAttributeOf(node)} />`
    case 'autolink': {
      const rawDestination = stringAttribute(node, 'rawDestination')
      const destination = stringAttribute(node, 'semanticDestination')
      return `<a href="${escapeHtml(destination)}">${escapeHtml(rawDestination)}</a>`
    }
    case 'inline-html':
      return filteredHtmlContentOf(node)
    case 'html-block':
      return filteredHtmlContentOf(node)
    case 'definition':
      return ''
    case 'table': {
      const header = node.children
        .filter(child => child.attributes['header'] === true)
        .map(child => renderNode(child, markdown, context))
        .join('')
      const body = node.children
        .filter(child => child.attributes['header'] !== true)
        .map(child => renderNode(child, markdown, context))
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
        throw new Error('Public Markdown table cell has an invalid alignment')
      }
      const tag = node.attributes['header'] === true ? 'th' : 'td'
      const align = typeof alignment === 'string' && alignment !== 'none'
        ? ` align="${alignment}"`
        : ''
      return `<${tag}${align}>${children()}</${tag}>\n`
    }
    default:
      throw new Error(`Public Markdown semantic HTML consumer does not cover ${node.kind}`)
  }
}

const stringAttribute = (node: MarkdownAstNode, name: string): string => {
  const value = node.attributes[name]
  if (typeof value !== 'string') {
    throw new Error(`Public Markdown ${node.kind} has no ${name} string`)
  }
  return value
}

const titleAttributeOf = (node: MarkdownAstNode): string => {
  const title = node.attributes['semanticTitle']
  return typeof title === 'string' ? ` title="${escapeHtml(title)}"` : ''
}

const plainTextOf = (node: MarkdownAstNode, markdown: string): string => {
  if (node.kind === 'text') {
    return markdown.slice(node.range.start, node.range.end)
  }
  if (node.kind === 'soft-break' || node.kind === 'hard-break') return '\n'
  if (node.kind === 'inline-code') return stringAttribute(node, 'content')
  return node.children.map(child => plainTextOf(child, markdown)).join('')
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

const flattenedStrongChildren = (
  node: MarkdownAstNode,
  markdown: string,
  context: RenderContext
): string => node.children.map(child => child.kind === 'strong'
  ? flattenedStrongChildren(child, markdown, context)
  : renderNode(child, markdown, context)).join('')

const renderListItem = (
  node: MarkdownAstNode,
  markdown: string,
  context: RenderContext
): string => {
  const rendered = node.children.map(child => renderNode(
    child,
    markdown,
    child.kind === 'paragraph' ? context : { tightList: false }
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

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
