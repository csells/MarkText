import { imageAltText } from '@marktext/document-core'
import type { MarkdownAstNode, SourceRange } from '@marktext/document-core'
import { htmlEscapeCharacters, type IInlinePresentationContext } from '@muyajs/core'
import { sanitize, PREVIEW_DOMPURIFY_CONFIG, EXPORT_DOMPURIFY_CONFIG } from '../util/dompurify'
import type { MuyaMarkupBinding, MuyaMarkupComment, MuyaMarkupDecoration } from './muyaMarkupView'

/** Parser-owned nodes rendered by the existing native image widget. */
// Assistive technology announces suggested text by its review meaning instead
// of reading a deletion as live text.
const criticRole = (mark: MuyaMarkupDecoration['mark']): 'insertion' | 'deletion' | 'mark' | undefined => {
  if (mark.kind === 'addition') return 'insertion'
  if (mark.kind === 'deletion') return 'deletion'
  if (mark.kind === 'highlight') return 'mark'
  if (mark.kind === 'substitution') return mark.arm === 'new' ? 'insertion' : 'deletion'
  return undefined
}

export const isMuyaImageSyntax = (node: MarkdownAstNode): boolean =>
  node.kind === 'image' ||
  ((node.kind === 'inline-html' || node.kind === 'html-block') &&
    node.attributes.tagName === 'img' &&
    node.attributes.closingTag !== true)

interface PresentationSpan {
  readonly range: SourceRange
  readonly open: string
  readonly close: string
  readonly atomic?: boolean
}

interface PresentationMarker {
  readonly offset: number
  readonly html: string
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

type Caret = NonNullable<IInlinePresentationContext['cursor']>

const knownHtmlEscapes = new Set(Object.keys(htmlEscapeCharacters).map((name) => name.toLowerCase()))

/**
 * Whether the caret's anchor or focus lies in `range`, ends included. Upstream
 * Muya shows a syntax's markers in gray then, and hides them otherwise.
 */
export const caretReveals = (range: SourceRange, caret: Caret | undefined): boolean =>
  caret !== undefined &&
  [caret.anchor, caret.focus].some((offset) => range.start <= offset && offset <= range.end)

const syntaxSpans = (
  binding: MuyaMarkupBinding,
  context: IInlinePresentationContext | undefined,
  /** Whether the caret shows the markers of the syntax at this text range. */
  revealed: (range: SourceRange) => boolean
): readonly PresentationSpan[] => {
  const spans: PresentationSpan[] = []
  const nativeRange = (syntax: SourceRange): SourceRange | undefined => {
    const first = binding.segments.find(
      (segment) => segment.syntax.start <= syntax.start && segment.syntax.end > syntax.start
    )
    const last = binding.segments.find(
      (segment) => segment.syntax.start < syntax.end && segment.syntax.end >= syntax.end
    )
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
  const addNative = (range: SourceRange, open: string): void => {
    if (range.end > range.start) spans.push({ range, open, close: '</span>' })
  }
  /** Upstream's class for a syntax's markers: gray while the caret is in it. */
  const markerClass = (node: MarkdownAstNode): 'mu-gray' | 'mu-hide' => {
    const range = nativeRange(node.range)
    return range !== undefined && revealed(range) ? 'mu-gray' : 'mu-hide'
  }
  // Upstream presents an ATX heading's opening `#`s, with any indentation,
  // as hidden syntax and the spaces after them pulled tight against the
  // text; both are gray while the caret is on the `#`s. A closing sequence,
  // with the spaces before it, is hidden unless the caret is in it.
  const atxHeadingMarkers = (heading: MarkdownAstNode): void => {
    const opening = nativeRange({
      start: heading.range.start,
      end: Number(heading.attributes.contentStart)
    })
    if (opening !== undefined) {
      const hashes = binding.text.slice(opening.start, opening.end).lastIndexOf('#') + 1
      const marker = { start: opening.start, end: opening.start + hashes }
      const gray = revealed(marker)
      addNative(marker, `<span class="${gray ? 'mu-gray' : 'mu-hide'} mu-remove">`)
      addNative(
        { start: marker.end, end: opening.end },
        `<span class="${gray ? 'mu-gray' : 'mu-header-tight-space'} mu-remove">`
      )
    }
    const after = nativeRange({
      start: Number(heading.attributes.contentEnd),
      end: heading.range.end
    })
    const closing =
      after === undefined ? null : /^\s+#+/u.exec(binding.text.slice(after.start, after.end))
    if (after !== undefined && closing !== null) {
      const sequence = { start: after.start, end: after.start + closing[0].length }
      addNative(sequence, `<span class="${revealed(sequence) ? 'mu-gray' : 'mu-hide'}">`)
    }
  }
  // Upstream draws a display formula (`$$`, `\[`, `\\[`) in display mode
  // only in a paragraph holding nothing else (#4904, #5446).
  const displayMarker = (node: MarkdownAstNode): boolean =>
    node.kind === 'inline-math' &&
    ['$$', '\\[', '\\\\['].includes(String(node.attributes.marker))
  const displayParagraph =
    binding.syntax.kind === 'paragraph' &&
    binding.syntax.children.some(displayMarker) &&
    binding.syntax.children.every((child) =>
      displayMarker(child) ||
      child.kind === 'soft-break' ||
      child.kind === 'hard-break' ||
      (child.kind === 'text' &&
        binding.text.slice(nativeRange(child.range)?.start ?? 0, nativeRange(child.range)?.end ?? 0).trim() === '')
    )
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'heading' && node.attributes.style !== 'setext') atxHeadingMarkers(node)
    if (node.kind === 'inline-math') {
      const range = nativeRange(node.range)
      if (range !== undefined && typeof node.attributes.content === 'string') {
        const widget = context?.renderMath?.({
          range,
          raw: binding.text.slice(range.start, range.end),
          content: node.attributes.content,
          marker: typeof node.attributes.marker === 'string' ? node.attributes.marker : '$',
          displayMode: displayParagraph && displayMarker(node)
        })
        if (widget !== undefined) spans.push({ range, ...widget, atomic: true })
      }
      return
    }
    if (node.kind === 'footnote-reference') {
      const range = nativeRange(node.range)
      if (range !== undefined) {
        spans.push({
          range,
          open: `<sup id="noteref-${escapeHtml(String(node.attributes.label))}" class="mu-inline-footnote-identifier mu-inline-rule">`,
          close: '</sup>',
          atomic: true
        })
        const marker = `<span class="${markerClass(node)} mu-remove">`
        add({ start: node.range.start, end: node.range.start + 2 }, marker, '</span>')
        add(
          { start: node.range.start + 2, end: node.range.end - 1 },
          '<a spellcheck="false">',
          '</a>'
        )
        add({ start: node.range.end - 1, end: node.range.end }, marker, '</span>')
      }
      return
    }
    if (isMuyaImageSyntax(node)) {
      const range = nativeRange(
        node.kind !== 'image'
          ? { start: Number(node.attributes.tagStart), end: Number(node.attributes.tagEnd) }
          : node.range
      )
      if (range !== undefined) {
        const widget = context?.renderImage({
          range,
          raw: binding.text.slice(range.start, range.end),
          src: String(node.attributes.semanticDestination ?? ''),
          alt: imageAltText(node),
          title: String(node.attributes.semanticTitle ?? ''),
          ...(node.attributes.semanticWidth
            ? { width: String(node.attributes.semanticWidth) }
            : {}),
          ...(node.attributes.semanticHeight
            ? { height: String(node.attributes.semanticHeight) }
            : {}),
          ...(node.attributes.semanticAlign ? { align: String(node.attributes.semanticAlign) } : {})
        })
        if (widget !== undefined) {
          spans.push({ range, open: widget.open, close: widget.close, atomic: true })
        }
      }
      return
    }
    if (node.kind === 'inline-html' && typeof node.attributes.tagName === 'string') {
      const range = nativeRange(node.range)
      if (range !== undefined) {
        const attributes: Record<string, string> = {}
        for (const [name, value] of Object.entries(node.attributes)) {
          if (name.startsWith('htmlAttribute:') && typeof value === 'string') {
            attributes[name.slice('htmlAttribute:'.length)] = value
          }
        }
        const widget = context?.renderHtmlTag?.({
          range,
          raw: binding.text.slice(range.start, range.end),
          tag: node.attributes.tagName,
          closing: node.attributes.closingTag === true,
          selfClosing: node.attributes.selfClosing === true,
          attributes
        })
        if (widget !== undefined) spans.push({ range, ...widget })
      }
      return
    }
    if (node.kind === 'text') {
      for (const spelling of node.semanticTextSegments ?? []) {
        const range = nativeRange(spelling.range)
        const raw = range === undefined ? '' : binding.text.slice(range.start, range.end)
        if (range !== undefined && raw === `\\${spelling.value}`) {
          // Upstream marks only a backslash escape's backslash as syntax.
          const backslash = { start: range.start, end: range.start + 1 }
          addNative(backslash, `<span class="${revealed(backslash) ? 'mu-gray' : 'mu-hide'} mu-remove">`)
          continue
        }
        // Upstream draws only the named entities it knows as their character;
        // any other reference, such as `&#35;`, shows as its source text. It
        // knows names in any case but draws only the listed spelling's
        // character, so another case shows as nothing while hidden.
        if (range === undefined || !knownHtmlEscapes.has(raw.toLowerCase())) continue
        const character = htmlEscapeCharacters[raw] as string | undefined
        const shown = revealed(range) ? 'mu-gray' : 'mu-hide'
        add(
          spelling.range,
          `<span class="${shown} mu-html-escape"${character === undefined ? '' : ` data-character="${escapeHtml(character)}"`}><span class="mu-html-escape-marker">`,
          '</span></span>'
        )
      }
      const emoji = node.attributes.emojiValue
      const emojiRange = nativeRange({ start: node.range.start + 1, end: node.range.end - 1 })
      if (
        typeof emoji === 'string' &&
        node.attributes.emojiClosed === true &&
        emojiRange !== undefined
      ) {
        const shown = markerClass(node)
        const marker = `<span class="${shown} mu-emoji-marker">`
        add({ start: node.range.start, end: node.range.start + 1 }, marker, '</span>')
        spans.push({
          range: emojiRange,
          open: `<span class="${shown === 'mu-hide' ? 'mu-hide ' : ''}mu-inline-rule mu-emoji-marked-text" data-emoji="${escapeHtml(emoji)}">`,
          close: '</span>',
          atomic: true
        })
        add({ start: node.range.end - 1, end: node.range.end }, marker, '</span>')
      } else if (
        typeof node.attributes.emojiAlias === 'string' &&
        node.attributes.emojiClosed === true &&
        emojiRange !== undefined
      ) {
        // Upstream warns of an unknown emoji name wherever the caret is.
        const marker = '<span class="mu-warn mu-emoji-marker">'
        add({ start: node.range.start, end: node.range.start + 1 }, marker, '</span>')
        addNative(emojiRange, '<span class="mu-warn mu-inline-rule mu-emoji-marked-text">')
        add({ start: node.range.end - 1, end: node.range.end }, marker, '</span>')
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
    const reference = node.kind === 'link' && typeof node.attributes.referenceLabel === 'string'
    // Muya presents an inline `[text](url)` link as `span.mu-link`, keeping
    // its destination as data rather than a native editable anchor.
    const inlineLink =
      node.kind === 'link' && !reference && node.attributes.extendedAutolink !== true
    const tag = inlineLink ? 'span' : tags[node.kind]
    if (inlineLink && node.children.length === 0) {
      // Upstream always shows a link without text as its gray brackets
      // around a native anchor holding the destination.
      const range = nativeRange(node.range)
      const opening = binding.text.slice(range?.start ?? 0, (range?.start ?? 0) + 3)
      if (range !== undefined && opening === '[](') {
        const destination = escapeHtml(String(node.attributes.semanticDestination ?? ''))
        const title = typeof node.attributes.semanticTitle === 'string'
          ? ` title="${escapeHtml(node.attributes.semanticTitle)}"`
          : ''
        addNative({ start: range.start, end: range.start + 3 }, '<span class="mu-gray mu-remove">')
        spans.push({
          range: { start: range.start + 3, end: range.end - 1 },
          open: `<a class="mu-no-text-link mu-inline-rule" href="${destination}" target="_blank"${title}>`,
          close: '</a>'
        })
        addNative({ start: range.end - 1, end: range.end }, '<span class="mu-gray mu-remove">')
      }
    }
    const content =
      node.kind === 'inline-code'
        ? { start: Number(node.attributes.contentStart), end: Number(node.attributes.contentEnd) }
        : node.kind === 'autolink'
          ? { start: node.range.start + 1, end: node.range.end - 1 }
          : node.children.length > 0
            ? {
              start: node.children[0].range.start,
              end: node.children[node.children.length - 1].range.end
            }
            : undefined
    if (
      tag !== undefined &&
      content !== undefined &&
      Number.isSafeInteger(content.start) &&
      Number.isSafeInteger(content.end)
    ) {
      const shown = markerClass(node)
      // Upstream gives an autolink's and a reference link's markers no
      // removal class; the others' markers are removed from copied HTML.
      const marker = `<span class="${shown}${node.kind === 'autolink' || reference ? '' : ' mu-remove'}">`
      add({ start: node.range.start, end: content.start }, marker, '</span>')
      const destination =
        (node.kind === 'link' || node.kind === 'autolink') &&
        typeof node.attributes.semanticDestination === 'string'
          ? ` href="${escapeHtml(node.attributes.semanticDestination)}"`
          : ''
      const linkRange =
        node.kind === 'link' || node.kind === 'autolink' ? nativeRange(node.range) : undefined
      const linkClass =
        node.kind === 'autolink'
          ? ' mu-auto-link'
          : node.attributes.extendedAutolink === true
            ? ' mu-auto-link-extension'
            : reference
              ? ' mu-reference-link'
              : ' mu-link'
      const linkData =
        linkRange === undefined
          ? ''
          : ` data-start="${linkRange.start}" data-end="${linkRange.end}" data-raw="${escapeHtml(binding.text.slice(linkRange.start, linkRange.end))}"`
      add(
        content,
        `<${tag} class="mu-inline-rule${linkRange === undefined ? '' : linkClass}"${destination}${linkData}>`,
        `</${tag}>`
      )
      const after = nativeRange({ start: content.end, end: node.range.end })
      const rest = after === undefined ? '' : binding.text.slice(after.start, after.end)
      // Upstream splits the rest of a shown link into `](`, its destination
      // (with any title) and `)`, and the rest of a shown full reference link
      // into `][`, its label and `]`. Hidden, those parts read alike, so they
      // stay one element: a long document holds thousands of links.
      if (shown === 'mu-gray' && inlineLink && rest.startsWith('](') && rest.endsWith(')')) {
        add({ start: content.end, end: content.end + 2 }, marker, '</span>')
        add(
          { start: content.end + 2, end: node.range.end - 1 },
          '<span class="mu-link-in-bracket mu-remove" spellcheck="false">',
          '</span>'
        )
        add({ start: node.range.end - 1, end: node.range.end }, marker, '</span>')
      } else if (
        shown === 'mu-gray' &&
        reference &&
        node.attributes.referenceKind === 'full' &&
        rest.startsWith('][')
      ) {
        add({ start: content.end, end: content.end + 2 }, marker, '</span>')
        add({ start: content.end + 2, end: node.range.end - 1 }, '<span class="mu-reference-label">', '</span>')
        add({ start: node.range.end - 1, end: node.range.end }, marker, '</span>')
      } else {
        add({ start: content.end, end: node.range.end }, marker, '</span>')
      }
    }
    if (node.kind === 'hard-break') {
      // Core already recognized the break. Only locate its authored newline,
      // which may occupy two UTF-16 positions in CRLF documents.
      const last = binding.segments.find(
        (segment) => segment.syntax.start < node.range.end && segment.syntax.end >= node.range.end
      )
      const end =
        last === undefined ? undefined : last.text.start + node.range.end - last.syntax.start
      const newlineLength = end !== undefined && binding.text.slice(end - 2, end) === '\r\n' ? 2 : 1
      const newline = { start: node.range.end - newlineLength, end: node.range.end }
      add(
        { start: node.range.start, end: newline.start },
        '<span class="mu-hard-line-break-space">',
        '</span>'
      )
      add(newline, '<span class="mu-line-end">', '</span>')
    }
    for (const child of node.children) visit(child)
  }
  visit(binding.syntax)
  return spans
}

/** Keeps every raw editing character in the DOM; wrappers only present it. */
const renderSpans = (
  text: string,
  spans: readonly PresentationSpan[],
  markers: readonly PresentationMarker[]
): string => {
  const markersAt = new Map<number, string[]>()
  for (const marker of markers) {
    const group = markersAt.get(marker.offset)
    if (group === undefined) markersAt.set(marker.offset, [marker.html])
    else group.push(marker.html)
  }
  const boundaries = [
    ...new Set([
      0,
      text.length,
      ...markersAt.keys(),
      ...spans.flatMap((span) => [span.range.start, span.range.end])
    ])
  ]
    .filter((offset) => offset >= 0 && offset <= text.length)
    .sort((a, b) => a - b)
  const output: string[] = []
  let active: readonly PresentationSpan[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    let next = spans.filter((span) => span.range.start <= start && span.range.end >= end)
    const widget = next.find((span) => span.atomic)
    if (widget !== undefined) {
      // A partial decoration must nest inside an indivisible native widget.
      // Closing/reopening that widget at decoration edges duplicates its UI.
      // Enclosing links and whole-widget marks retain their outer position.
      const containsWidget = (span: PresentationSpan) =>
        span !== widget &&
        span.range.start <= widget.range.start &&
        span.range.end >= widget.range.end
      next = [
        ...next.filter(containsWidget),
        widget,
        ...next.filter((span) => span !== widget && !containsWidget(span))
      ]
    }
    let common = 0
    while (common < active.length && active[common] === next[common]) common += 1
    for (let close = active.length - 1; close >= common; close -= 1) {
      output.push(active[close].close)
    }
    output.push(...(markersAt.get(start) ?? []))
    for (let open = common; open < next.length; open += 1) output.push(next[open].open)
    // HTML parsing, including the sanitizer's, folds CRLF into LF.
    output.push(escapeHtml(text.slice(start, end)).replaceAll('\r', '&#13;'))
    active = next
  }
  for (let close = active.length - 1; close >= 0; close -= 1) output.push(active[close].close)
  output.push(...(markersAt.get(text.length) ?? []))
  return output.join('')
}

const COMMENT_NAME_LIMIT = 200

/**
 * A comment marker has no visible text, so its accessible name carries the
 * comment itself; long comments are shortened for announcement.
 */
export function commentMarkerName(label: string, text: string | undefined): string {
  const words = text?.replace(/\s+/gu, ' ').trim() ?? ''
  if (words === '') return label
  const characters = Array.from(words)
  const spoken =
    characters.length > COMMENT_NAME_LIMIT
      ? `${characters.slice(0, COMMENT_NAME_LIMIT).join('')}…`
      : words
  return `${label}: ${spoken}`
}

/** Presents Core-owned syntax and marks without recognizing flattened Markdown. */
export function renderMuyaMarkupBinding(
  binding: MuyaMarkupBinding,
  decorations: readonly MuyaMarkupDecoration[],
  currentText: string,
  context?: IInlinePresentationContext,
  comments: readonly MuyaMarkupComment[] = [],
  commentLabel = 'Comment',
  /**
   * Receives the text range of each syntax whose markers the caret can show,
   * so a cached rendering is reused only while the caret shows the same ones.
   */
  revealRanges?: SourceRange[]
): string {
  const spans: PresentationSpan[] = []
  for (const highlight of context?.highlights ?? []) {
    if (
      !Number.isSafeInteger(highlight.start) ||
      !Number.isSafeInteger(highlight.end) ||
      highlight.start < 0 ||
      highlight.end > currentText.length ||
      highlight.end <= highlight.start
    ) {
      continue
    }
    spans.push({
      range: highlight,
      open: `<span class="${highlight.active ? 'mu-highlight' : 'mu-selection'}">`,
      close: '</span>'
    })
  }
  const trailingLine =
    binding.trailingLinePosition !== undefined && currentText === `${binding.text}\n`
      ? { start: binding.text.length, end: currentText.length }
      : undefined
  // Enter on an earlier line of a paragraph shows the new paragraph's empty
  // first line before its text, as upstream does.
  const leadingLine =
    binding.leadingLinePosition !== undefined && currentText === `\n${binding.text}`
  // Upstream keeps a space typed after a cell's text in the cell.
  const cellPadding =
    binding.tableCellPadding !== undefined &&
    currentText.length > binding.text.length &&
    currentText.length - binding.text.length <= binding.tableCellPadding &&
    currentText.startsWith(binding.text) &&
    /^ +$/u.test(currentText.slice(binding.text.length))
  const acknowledged = currentText === binding.text || trailingLine !== undefined || cellPadding
  // Only Core's view locates marks. Other native text is a draft awaiting its
  // acknowledgement and stays literal: comparing strings cannot tell which of
  // two equal characters an edit changed.
  const rebase = (range: SourceRange): SourceRange | undefined =>
    acknowledged
      ? range
      : leadingLine
        ? { start: range.start + 1, end: range.end + 1 }
        : undefined
  const markers: PresentationMarker[] = []
  for (const comment of comments) {
    if (
      comment.path.length !== binding.path.length ||
      comment.path.some((part, index) => part !== binding.path[index])
    ) {
      continue
    }
    const location = rebase({ start: comment.offset, end: comment.offset })
    if (location === undefined || location.start < 0 || location.start > currentText.length) {
      continue
    }
    // An empty native affordance adds neither hidden payload nor a caret
    // character to Muya's editable text. Core remains the annotation owner.
    markers.push({
      offset: location.start,
      html: `<span class="mu-critic-comment-marker mu-remove" contenteditable="false" role="button" tabindex="0" aria-label="${escapeHtml(commentMarkerName(commentLabel, comment.text))}" data-critic-kind="comment" data-critic-start="${comment.annotationRange.start - binding.sourceRange.start}" data-critic-end="${comment.annotationRange.end - binding.sourceRange.start}"></span>`
    })
  }
  for (const decoration of decorations) {
    if (
      decoration.path.length !== binding.path.length ||
      decoration.path.some((part, index) => part !== binding.path[index])
    ) {
      continue
    }
    const range = rebase(decoration.range)
    if (range === undefined) continue
    const { mark } = decoration
    if (range.start === range.end && decoration.sourcePosition !== undefined) {
      const arm = mark.kind === 'substitution' ? ` data-critic-arm="${escapeHtml(mark.arm)}"` : ''
      markers.push({
        offset: range.start,
        html: `<span data-critic-kind="${escapeHtml(mark.kind)}" data-critic-start="${mark.annotationRange.start - binding.sourceRange.start}" data-critic-end="${mark.annotationRange.end - binding.sourceRange.start}" data-critic-position="${decoration.sourcePosition - binding.sourceRange.start}"${arm}></span>`
      })
      continue
    }
    if (range.end <= range.start) continue
    // Leaf-relative locations survive cached sibling rendering when an earlier
    // edit uniformly shifts the Core source coordinates.
    const arm = mark.kind === 'substitution' ? ` data-critic-arm="${escapeHtml(mark.arm)}"` : ''
    const role = criticRole(mark)
    spans.push({
      range,
      open: `<span data-critic-kind="${escapeHtml(mark.kind)}" data-critic-start="${mark.annotationRange.start - binding.sourceRange.start}" data-critic-end="${mark.annotationRange.end - binding.sourceRange.start}"${arm}${role === undefined ? '' : ` role="${role}"`}>`,
      close: '</span>'
    })
  }
  const revealed = (shift: number) => (range: SourceRange): boolean => {
    const shown = { start: range.start + shift, end: range.end + shift }
    revealRanges?.push(shown)
    return caretReveals(shown, context?.cursor)
  }
  if (acknowledged) {
    spans.push(...syntaxSpans(binding, context, revealed(0)))
  } else if (leadingLine) {
    spans.push(
      ...syntaxSpans(binding, context, revealed(1)).map((span) => ({
        ...span,
        range: { start: span.range.start + 1, end: span.range.end + 1 }
      }))
    )
  }
  // Upstream's line-end soft break is a block, so the empty last line holds the caret.
  if (trailingLine !== undefined) {
    spans.push({
      range: trailingLine,
      open: '<span class="mu-soft-line-break mu-line-end">',
      close: '</span>'
    })
  }
  const html = sanitize(renderSpans(currentText, spans, markers), {
    ...PREVIEW_DOMPURIFY_CONFIG,
    // Styles and contenteditable are generated only by the trusted native
    // widget renderer. All authored text and scalar values are escaped.
    FORBID_ATTR: [],
    ALLOWED_URI_REGEXP: EXPORT_DOMPURIFY_CONFIG.ALLOWED_URI_REGEXP,
    ADD_ATTR: [
      'contenteditable',
      'data-critic-kind',
      'data-critic-arm',
      'data-critic-start',
      'data-critic-position',
      'data-critic-end',
      'data-character',
      'data-emoji',
      'data-raw',
      'data-start',
      'data-end',
      'data-core-image',
      'data-title'
    ]
  })
  // HTML parsing folds CRLF into LF. A character reference keeps each CR in
  // the DOM, so native offsets stay those of the Core text.
  return html.replaceAll('\r', '&#13;')
}
