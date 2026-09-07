import type { MarkdownAstNode, SourceRange } from '@marktext/document-core'
import type { IInlinePresentationContext } from '@muyajs/core'
import { validEmoji } from '@muyajs/core'
import { sanitize, PREVIEW_DOMPURIFY_CONFIG, EXPORT_DOMPURIFY_CONFIG } from '../util/dompurify'
import type { MuyaMarkupBinding, MuyaMarkupComment, MuyaMarkupDecoration } from './muyaMarkupView'

interface PresentationSpan {
  readonly range: SourceRange
  readonly open: string
  readonly close: string
}

interface PresentationMarker {
  readonly offset: number
  readonly html: string
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const rebaseMarks = (before: string, after: string): ((range: SourceRange) => SourceRange | undefined) => {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let oldEnd = before.length
  let newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  const delta = newEnd - oldEnd
  return range => {
    if (range.end <= start) return range
    if (range.start >= oldEnd) return { start: range.start + delta, end: range.end + delta }
    if (range.start <= start && range.end >= oldEnd) return { start: range.start, end: range.end + delta }
    // A replacement crossing a mark boundary has no acknowledged attribution.
    // Keep only the unchanged part rather than inventing a new marked extent.
    if (range.start < start) return { start: range.start, end: start }
    if (range.end > oldEnd) return { start: newEnd, end: range.end + delta }
    return undefined
  }
}

const imageAlt = (node: MarkdownAstNode): string => node.kind === 'text'
  ? String(node.attributes.semanticText ?? '')
  : node.kind === 'inline-code'
    ? String(node.attributes.semanticContent ?? '')
    : node.kind === 'soft-break' || node.kind === 'hard-break'
      ? '\n'
      : node.children.map(imageAlt).join('')

const syntaxSpans = (binding: MuyaMarkupBinding, context?: IInlinePresentationContext): readonly PresentationSpan[] => {
  const spans: PresentationSpan[] = []
  const nativeRange = (syntax: SourceRange): SourceRange | undefined => {
    const first = binding.segments.find(segment => segment.syntax.start <= syntax.start && segment.syntax.end > syntax.start)
    const last = binding.segments.find(segment => segment.syntax.start < syntax.end && segment.syntax.end >= syntax.end)
    return first === undefined || last === undefined
      ? undefined
      : {
        start: first.text.start + syntax.start - first.syntax.start,
        end: last.text.start + syntax.end - last.syntax.start
      }
  }
  const add = (range: SourceRange, open: string, close: string): void => {
    let previous: PresentationSpan | undefined
    for (const segment of binding.segments) {
      const start = Math.max(range.start, segment.syntax.start)
      const end = Math.min(range.end, segment.syntax.end)
      if (end <= start) continue
      const mapped = {
        start: segment.text.start + start - segment.syntax.start,
        end: segment.text.start + end - segment.syntax.start
      }
      if (previous !== undefined && previous.range.end === mapped.start) {
        previous = { range: { start: previous.range.start, end: mapped.end }, open, close }
        spans[spans.length - 1] = previous
      } else {
        previous = { range: mapped, open, close }
        spans.push(previous)
      }
    }
  }
  const hide = (range: SourceRange): void => add(
    range, '<span class="mu-hide mu-remove">', '</span>'
  )
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'image') {
      const range = nativeRange(node.range)
      if (range !== undefined) {
        const widget = context?.renderImage({
          range,
          raw: binding.text.slice(range.start, range.end),
          src: String(node.attributes.semanticDestination ?? ''),
          alt: imageAlt(node),
          title: String(node.attributes.semanticTitle ?? '')
        })
        if (widget !== undefined) add(node.range, widget.open, widget.close)
      }
      return
    }
    if (node.kind === 'text') {
      for (const spelling of node.semanticTextSegments ?? []) {
        add(spelling.range,
          `<span class="mu-hide mu-html-escape" data-character="${escapeHtml(spelling.value)}"><span class="mu-html-escape-marker">`,
          '</span></span>')
      }
      // Emoji is a Muya presentation extension. Match its aliases only inside
      // a Core-owned literal text leaf, never in flattened Markdown or code.
      for (const segment of binding.segments) {
        const start = Math.max(node.range.start, segment.syntax.start)
        const end = Math.min(node.range.end, segment.syntax.end)
        if (end <= start) continue
        const value = binding.text.slice(segment.text.start + start - segment.syntax.start,
          segment.text.start + end - segment.syntax.start)
        for (const match of value.matchAll(/(?<![\w]):([a-z_\d+-]+):/gu)) {
          const emoji = validEmoji(match[1])
          if (emoji === undefined) continue
          const range = { start: start + match.index, end: start + match.index + match[0].length }
          if (node.semanticTextSegments?.some(spelling => spelling.range.start < range.end && spelling.range.end > range.start)) continue
          hide({ start: range.start, end: range.start + 1 })
          add({ start: range.start + 1, end: range.end - 1 },
            `<span class="mu-hide mu-inline-rule mu-emoji-marked-text" data-emoji="${escapeHtml(emoji.emoji)}">`, '</span>')
          hide({ start: range.end - 1, end: range.end })
        }
      }
    }
    const tags: Partial<Record<MarkdownAstNode['kind'], string>> = {
      strong: 'strong',
      emphasis: 'em',
      strikethrough: 'del',
      subscript: 'sub',
      superscript: 'sup',
      'inline-code': 'code',
      link: 'a',
      autolink: 'a'
    }
    const tag = tags[node.kind]
    const content = node.kind === 'inline-code'
      ? { start: Number(node.attributes.contentStart), end: Number(node.attributes.contentEnd) }
      : node.kind === 'autolink'
        ? { start: node.range.start + 1, end: node.range.end - 1 }
        : node.children.length > 0
          ? { start: node.children[0].range.start, end: node.children[node.children.length - 1].range.end }
          : undefined
    if (tag !== undefined && content !== undefined &&
        Number.isSafeInteger(content.start) && Number.isSafeInteger(content.end)) {
      hide({ start: node.range.start, end: content.start })
      const destination = (node.kind === 'link' || node.kind === 'autolink') && typeof node.attributes.semanticDestination === 'string'
        ? ` href="${escapeHtml(node.attributes.semanticDestination)}"`
        : ''
      const linkRange = node.kind === 'link' || node.kind === 'autolink' ? nativeRange(node.range) : undefined
      const linkClass = node.kind === 'autolink'
        ? ' mu-auto-link'
        : node.attributes.extendedAutolink === true ? ' mu-auto-link-extension' : ' mu-link'
      const linkData = linkRange === undefined
        ? ''
        : ` data-start="${linkRange.start}" data-end="${linkRange.end}" data-raw="${escapeHtml(binding.text.slice(linkRange.start, linkRange.end))}"`
      add(content, `<${tag} class="mu-inline-rule${linkRange === undefined ? '' : linkClass}"${destination}${linkData}>`, `</${tag}>`)
      hide({ start: content.end, end: node.range.end })
    }
    if (node.kind === 'hard-break') {
      // Core already recognized the break. Only locate its authored newline,
      // which may occupy two UTF-16 positions in CRLF documents.
      const last = binding.segments.find(segment =>
        segment.syntax.start < node.range.end && segment.syntax.end >= node.range.end)
      const end = last === undefined ? undefined : last.text.start + node.range.end - last.syntax.start
      const newlineLength = end !== undefined && binding.text.slice(end - 2, end) === '\r\n' ? 2 : 1
      const newline = { start: node.range.end - newlineLength, end: node.range.end }
      add({ start: node.range.start, end: newline.start }, '<span class="mu-hard-line-break-space">', '</span>')
      add(newline, '<span class="mu-line-end">', '</span>')
    }
    for (const child of node.children) visit(child)
  }
  visit(binding.syntax)
  return spans
}

/** Keeps every raw editing character in the DOM; wrappers only present it. */
const renderSpans = (text: string, spans: readonly PresentationSpan[], markers: readonly PresentationMarker[]): string => {
  const markersAt = new Map<number, string[]>()
  for (const marker of markers) {
    const group = markersAt.get(marker.offset)
    if (group === undefined) markersAt.set(marker.offset, [marker.html])
    else group.push(marker.html)
  }
  const boundaries = [...new Set([0, text.length, ...markersAt.keys(), ...spans.flatMap(span =>
    [span.range.start, span.range.end]
  )])].filter(offset => offset >= 0 && offset <= text.length).sort((a, b) => a - b)
  const output: string[] = []
  let active: readonly PresentationSpan[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    const next = spans.filter(span => span.range.start <= start && span.range.end >= end)
    let common = 0
    while (common < active.length && active[common] === next[common]) common += 1
    for (let close = active.length - 1; close >= common; close -= 1) output.push(active[close].close)
    output.push(...markersAt.get(start) ?? [])
    for (let open = common; open < next.length; open += 1) output.push(next[open].open)
    output.push(escapeHtml(text.slice(start, end)))
    active = next
  }
  for (let close = active.length - 1; close >= 0; close -= 1) output.push(active[close].close)
  output.push(...markersAt.get(text.length) ?? [])
  return output.join('')
}

/** Presents Core-owned syntax and marks without recognizing flattened Markdown. */
export function renderMuyaMarkupBinding(
  binding: MuyaMarkupBinding,
  decorations: readonly MuyaMarkupDecoration[],
  currentText: string,
  context?: IInlinePresentationContext,
  comments: readonly MuyaMarkupComment[] = []
): string {
  const spans: PresentationSpan[] = []
  for (const highlight of context?.highlights ?? []) {
    if (!Number.isSafeInteger(highlight.start) || !Number.isSafeInteger(highlight.end) ||
        highlight.start < 0 || highlight.end > currentText.length || highlight.end <= highlight.start) continue
    spans.push({ range: highlight, open: `<span class="${highlight.active ? 'mu-highlight' : 'mu-selection'}">`, close: '</span>' })
  }
  const rebase = currentText === binding.text
    ? (range: SourceRange): SourceRange => range
    : rebaseMarks(binding.text, currentText)
  const markers: PresentationMarker[] = []
  for (const comment of comments) {
    if (comment.path.length !== binding.path.length ||
        comment.path.some((part, index) => part !== binding.path[index])) continue
    const location = rebase({ start: comment.offset, end: comment.offset })
    if (location === undefined || location.start < 0 || location.start > currentText.length) continue
    // An empty native affordance adds neither hidden payload nor a caret
    // character to Muya's editable text. Core remains the annotation owner.
    markers.push({
      offset: location.start,
      html: `<span class="mu-critic-comment-marker mu-remove" contenteditable="false" role="button" tabindex="0" aria-label="Comment" data-critic-kind="comment" data-critic-start="${comment.annotationRange.start - binding.sourceRange.start}" data-critic-end="${comment.annotationRange.end - binding.sourceRange.start}"></span>`
    })
  }
  for (const decoration of decorations) {
    if (decoration.path.length !== binding.path.length ||
        decoration.path.some((part, index) => part !== binding.path[index])) continue
    const range = rebase(decoration.range)
    if (range === undefined || range.end <= range.start) continue
    const { mark } = decoration
    // Leaf-relative locations survive cached sibling rendering when an earlier
    // edit uniformly shifts the Core source coordinates.
    const arm = mark.kind === 'substitution' ? ` data-critic-arm="${escapeHtml(mark.arm)}"` : ''
    spans.push({
      range,
      open: `<span data-critic-kind="${escapeHtml(mark.kind)}" data-critic-start="${mark.annotationRange.start - binding.sourceRange.start}" data-critic-end="${mark.annotationRange.end - binding.sourceRange.start}"${arm}>`,
      close: '</span>'
    })
  }
  if (currentText === binding.text) spans.push(...syntaxSpans(binding, context))
  return sanitize(renderSpans(currentText, spans, markers), {
    ...PREVIEW_DOMPURIFY_CONFIG,
    // Styles and contenteditable are generated only by the trusted native
    // widget renderer. All authored text and scalar values are escaped.
    FORBID_ATTR: [],
    ALLOWED_URI_REGEXP: EXPORT_DOMPURIFY_CONFIG.ALLOWED_URI_REGEXP,
    ADD_ATTR: ['contenteditable', 'data-critic-kind', 'data-critic-arm', 'data-critic-start', 'data-critic-end', 'data-character', 'data-emoji', 'data-raw', 'data-start', 'data-end', 'data-core-image', 'data-title']
  })
}
