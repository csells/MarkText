import htmlTags, { voidHtmlTags } from 'html-tags'

export const HTML_TAGS: readonly string[] = htmlTags
export const VOID_HTML_TAGS: readonly string[] = voidHtmlTags

const HTML_BLOCK_OPENER = /^<([a-z\d-]+)(?=\s|>)[^<>]*>$/i

/**
 * The element whose Enter template a lone opening tag produces. The pattern is
 * case-insensitive but the table is lowercase, so `<DIV>` stays literal text.
 */
export function htmlBlockTemplateTag(text: string): string | undefined {
  const name = HTML_BLOCK_OPENER.exec(text)?.[1]
  return name !== undefined && HTML_TAGS.includes(name) && !VOID_HTML_TAGS.includes(name) ? name : undefined
}

/**
 * An empty element with an editable middle line. The opener drops any typed
 * attributes, as MarkText always has; `continuation` prefixes each new line.
 */
export function htmlBlockTemplate(tagName: string, lineEnding: string, continuation: string): { markdown: string; caret: number } {
  const opener = `<${tagName}>`
  return {
    markdown: opener + lineEnding + continuation + lineEnding + continuation + `</${tagName}>`,
    caret: opener.length + lineEnding.length + continuation.length
  }
}
