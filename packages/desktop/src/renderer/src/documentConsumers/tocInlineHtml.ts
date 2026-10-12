import type { MarkdownAstNode } from '@marktext/document-core'
import { stringAttribute } from './astAttributes'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/gu, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&quot;')

const tags: Partial<Record<MarkdownAstNode['kind'], string>> = {
  strong: 'strong',
  emphasis: 'em',
  strikethrough: 'del',
  mark: 'mark',
  subscript: 'sub',
  superscript: 'sup'
}

/**
 * A heading's text as outline HTML, case for case as upstream's
 * `tokensToInlineHtml`: inline styling stays, while links, images and math
 * flatten to the text the outline's plain label and slug read.
 */
export function tocInlineHtmlOf(node: MarkdownAstNode): string {
  const children = (): string => node.children.map(tocInlineHtmlOf).join('')
  const tag = tags[node.kind]
  if (tag !== undefined) return `<${tag}>${children()}</${tag}>`
  switch (node.kind) {
    case 'text':
      return escapeHtml(
        node.attributes.emojiClosed === true && typeof node.attributes.emojiValue === 'string'
          ? node.attributes.emojiValue
          : stringAttribute(node, 'semanticText') ?? ''
      )
    case 'inline-code':
      return `<code>${escapeHtml(stringAttribute(node, 'semanticContent') ?? '')}</code>`
    case 'inline-diff': {
      const addition = node.attributes.diff === 'addition'
      const element = addition ? 'ins' : 'del'
      return `<${element} class="idiff ${addition ? 'addition' : 'deletion'}">` +
        `${escapeHtml(stringAttribute(node, 'semanticContent') ?? '')}</${element}>`
    }
    case 'inline-math':
      return escapeHtml(stringAttribute(node, 'content') ?? '')
    case 'autolink':
      return escapeHtml(stringAttribute(node, 'rawDestination') ?? '')
    case 'inline-html':
      return ''
    case 'soft-break':
    case 'hard-break':
      return ' '
    case 'footnote-reference':
      return escapeHtml(stringAttribute(node, 'rawLabel') ?? '')
    default:
      return children()
  }
}
