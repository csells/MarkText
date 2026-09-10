import { decodeHTMLAttribute } from 'entities'
import { findInlineHtmlEnd } from './markdownLexical.js'

/** Attribute facts emitted by the same grammar that admits an HTML token. */
export function htmlTagAttributes(
  source: string,
  start: number,
  limit: number,
  onlyTag = false
): Readonly<Record<string, string | number | boolean>> {
  if (onlyTag) while (start < limit && /\s/.test(source[start] ?? '')) start += 1
  if (source.charCodeAt(start) !== 60) return {}
  let result: Record<string, string | number | boolean> = {}
  findInlineHtmlEnd(source, start, limit, tag => {
    if (onlyTag && source.slice(tag.end, limit).trim() !== '') return
    result = {
      tagName: tag.name,
      closingTag: tag.closing,
      selfClosing: tag.selfClosing,
      tagStart: tag.start,
      tagEnd: tag.end,
      tagCloseStart: tag.closeStart
    }
    if (tag.name !== 'img' || tag.closing) return
    const semanticKeys = { src: 'semanticDestination', alt: 'semanticAlt', title: 'semanticTitle', width: 'semanticWidth', height: 'semanticHeight', 'data-align': 'semanticAlign' } as const
    for (const key of Object.values(semanticKeys)) result[key] = ''
    for (const attribute of tag.attributes) {
      if (!Object.hasOwn(semanticKeys, attribute.name) || Object.hasOwn(result, `${attribute.name}AttributeStart`)) continue
      const name = attribute.name as keyof typeof semanticKeys
      result[`${name}AttributeStart`] = attribute.start
      result[`${name}AttributeEnd`] = attribute.end
      result[`${name}Quote`] = attribute.quote
      result[`${name}HasValue`] = attribute.valueStart !== undefined
      if (attribute.valueStart !== undefined && attribute.valueEnd !== undefined) {
        result[`${name}ValueStart`] = attribute.valueStart
        result[`${name}ValueEnd`] = attribute.valueEnd
        result[semanticKeys[name]] = decodeHTMLAttribute(source.slice(attribute.valueStart, attribute.valueEnd))
      }
    }
  })
  return Object.freeze(result)
}
