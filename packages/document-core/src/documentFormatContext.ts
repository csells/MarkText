import type { MarkdownAstNode, SourceRange } from './documentCore.js'

export interface DocumentActiveFormat { readonly type: string; readonly tag?: string }

const formats: Readonly<Record<string, string>> = {
  strong: 'strong',
  emphasis: 'em',
  strikethrough: 'del',
  'inline-code': 'inline_code',
  'inline-math': 'inline_math',
  link: 'link',
  image: 'image',
  autolink: 'link',
  subscript: 'sub',
  superscript: 'sup'
}
const htmlStyles = new Set(['u', 'mark', 'sub', 'sup'])

/** Active inline formatting in the retained syntax, including explicit HTML styles. */
export function documentActiveFormats(root: MarkdownAstNode, selection: SourceRange): readonly DocumentActiveFormat[] {
  const result: DocumentActiveFormat[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (selection.start < node.range.start || selection.end > node.range.end) return
    const type = formats[node.kind]
    if (type !== undefined) result.push({ type })
    for (const pair of inlineHtmlFormatPairs(node)) {
      if (selection.start >= pair.open.range.start && selection.end <= pair.close.range.end) {
        result.push({ type: 'html_tag', tag: String(pair.open.attributes.tagName) })
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(root)
  return result
}

/** Match style tags already recognized by the common inline lexer. */
export function inlineHtmlFormatPairs(node: MarkdownAstNode): readonly { open: MarkdownAstNode; close: MarkdownAstNode }[] {
  return inlineHtmlPairs(node).filter(pair => htmlStyles.has(String(pair.open.attributes.tagName)))
}

/** Pair already-recognized inline HTML tags without interpreting text again. */
export function inlineHtmlPairs(node: MarkdownAstNode): readonly { open: MarkdownAstNode; close: MarkdownAstNode }[] {
  const result: { open: MarkdownAstNode; close: MarkdownAstNode }[] = []
  const tags: MarkdownAstNode[] = []
  for (const child of node.children) {
    if (child.kind !== 'inline-html' || typeof child.attributes.tagName !== 'string') continue
    if (child.attributes.closingTag === true) {
      let index = tags.length - 1
      while (index >= 0 && tags[index]?.attributes.tagName !== child.attributes.tagName) index -= 1
      if (index >= 0) {
        const [open] = tags.splice(index)
        if (open !== undefined) result.push({ open, close: child })
      }
    } else if (child.attributes.selfClosing !== true) tags.push(child)
  }
  return result
}
