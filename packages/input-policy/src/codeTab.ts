import HTML_TAGS, { voidHtmlTags as VOID_HTML_TAGS } from 'html-tags'

function parseSelector(str = '') {
  const REG_EXP = /(#|\.)([^#.]+)/
  let tag = ''
  let id = ''
  let className = ''
  let isVoid = false
  let cap

  for (const tagName of HTML_TAGS) {
    const next = str[tagName.length]
    if (str.startsWith(tagName) && (next === undefined || /#|\./.test(next))) {
      tag = tagName
      if ((VOID_HTML_TAGS as readonly string[]).includes(tagName)) isVoid = true

      str = str.substring(tagName.length)
    }
  }

  if (tag !== '') {
    cap = REG_EXP.exec(str)
    while (cap && str.length && cap[2] !== undefined) {
      if (cap[1] === '#') id = cap[2]
      else className = cap[2]

      str = str.substring(cap[0].length)
      cap = REG_EXP.exec(str)
    }
  }

  return { tag, id, className, isVoid }
}

/** Existing native selector expansion, with exact replacement and selection. */
export function codeTabExpansion(
  text: string,
  start: number,
  end: number,
  language: string
):
  | { start: number; end: number; insert: string; selection: { start: number; end: number } }
  | undefined {
  if (!/markup|html|xml|svg|mathml/.test(language)) return undefined
  const word = text.substring(0, start).split(/\s+/).pop() ?? ''
  const { tag, isVoid, id, className } = parseSelector(word)
  if (!tag) return undefined
  const from = start - word.length
  let html = `<${tag}`
  let anchor = 0
  let focus = 0
  switch (tag) {
    case 'img':
      html += ' alt="" src=""'
      anchor = focus = html.length - 1
      break
    case 'input':
      html += ' type="text"'
      anchor = html.length - 5
      focus = html.length - 1
      break
    case 'a':
      html += ' href=""'
      anchor = focus = html.length - 1
      break
    case 'link':
      html += ' rel="stylesheet" href=""'
      anchor = focus = html.length - 1
      break
  }
  if (id) html += ` id="${id}"`
  if (className) html += ` class="${className}"`
  html += '>'
  if (anchor === 0 && focus === 0) anchor = focus = html.length
  if (!isVoid) html += `</${tag}>`
  return { start: from, end, insert: html, selection: { start: from + anchor, end: from + focus } }
}
