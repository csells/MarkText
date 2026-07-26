import type { MarkdownDocument, MarkdownNode } from '../revision.js'

/**
 * The HTML materializer: a pure consumer of a revision's block/inline
 * structure (ADR-0009). It walks parser-created nodes and emits CommonMark's
 * reference HTML. It performs no recognition — the only source reads are
 * slices of ranges the graph already owns, transformed by the specification's
 * text semantics (backslash escapes, character references, code-span
 * normalization), never re-tokenized.
 */
export function renderMarkdownHtml(document: MarkdownDocument): string {
  return renderChildren(document, document.root, 'block')
}

type InlineContext = 'block' | 'inline'

function renderChildren(
  document: MarkdownDocument,
  node: MarkdownNode,
  context: InlineContext
): string {
  const parts: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    parts.push(renderNode(document, node.childAt(ordinal), context))
  }
  return parts.join('')
}

// Paragraph-family content: the block phase leaves continuation-line
// indentation and surrounding whitespace in the raw slices; the
// specification's paragraph semantics strip whitespace at line starts and
// ends. Applied per TEXT NODE around break nodes, never to code spans.
function renderInlineContent(
  document: MarkdownDocument,
  node: MarkdownNode
): string {
  const parts: string[] = []
  let atLineStart = true
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const child = node.childAt(ordinal)
    const isBreak = child.kind === 'soft-break' || child.kind === 'hard-break'
    let rendered: string
    if (child.kind === 'text') {
      let raw = sliceRange(document.source, child)
      if (atLineStart) {
        raw = raw.replace(/^[\t ]+/, '')
      }
      const next = ordinal + 1 < node.childCount
        ? node.childAt(ordinal + 1)
        : undefined
      if (next === undefined || next.kind === 'soft-break') {
        raw = raw.replace(/[\t ]+$/, '')
      }
      rendered = escapeHtml(decodeMarkdownText(raw))
    } else {
      rendered = renderNode(document, child, 'inline')
    }
    parts.push(rendered)
    atLineStart = isBreak
  }
  return parts.join('')
}

function renderNode(
  document: MarkdownDocument,
  node: MarkdownNode,
  context: InlineContext
): string {
  const source = document.source
  switch (node.kind) {
    case 'paragraph':
      return `<p>${renderInlineContent(document, node)}</p>\n`
    case 'heading': {
      const level = Number(node.attributes['level'] ?? 1)
      return `<h${level}>${renderInlineContent(document, node)}</h${level}>\n`
    }
    case 'thematic-break':
      return '<hr />\n'
    case 'list': {
      const ordered = node.attributes['ordered'] === true
      const start = Number(node.attributes['start'] ?? 1)
      const tight = node.attributes['tight'] !== false
      const items: string[] = []
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
        items.push(renderListItem(document, node.childAt(ordinal), tight))
      }
      const openTag = ordered
        ? start === 1 ? '<ol>' : `<ol start="${start}">`
        : '<ul>'
      const closeTag = ordered ? '</ol>' : '</ul>'
      return `${openTag}\n${items.join('')}${closeTag}\n`
    }
    case 'blockquote':
      return `<blockquote>\n${renderChildren(document, node, 'block')}</blockquote>\n`
    case 'code-block': {
      const content = String(node.attributes['content'] ?? '')
      const info = node.attributes['info']
      const language = info === undefined
        ? ''
        : ` class="language-${escapeHtml(decodeMarkdownText(firstWord(String(info))))}"`
      return `<pre><code${language}>${escapeHtml(content)}</code></pre>\n`
    }
    case 'html-block':
      return ensureTrailingNewline(sliceRange(source, node))
    case 'front-matter':
    case 'definition':
    case 'footnote-definition':
      return ''
    case 'text':
      return escapeHtml(decodeMarkdownText(sliceRange(source, node)))
    case 'soft-break':
      return '\n'
    case 'hard-break':
      return '<br />\n'
    case 'emphasis':
      return `<em>${renderChildren(document, node, 'inline')}</em>`
    case 'strong':
      return `<strong>${renderChildren(document, node, 'inline')}</strong>`
    case 'strikethrough':
      return `<del>${renderChildren(document, node, 'inline')}</del>`
    case 'inline-code':
      return renderInlineCode(source, node)
    case 'inline-html':
      return sliceRange(source, node)
    case 'link':
    case 'image': {
      const target = resolveLinkTarget(document, node)
      if (target === undefined) {
        return renderChildren(document, node, 'inline')
      }
      const href = escapeHrefAttribute(
        encodeHref(decodeMarkdownText(target.destination))
      )
      const title = target.title === undefined
        ? ''
        : ` title="${escapeHtml(decodeMarkdownText(target.title))}"`
      return node.kind === 'image'
        ? `<img src="${href}" alt="${escapeHtml(plainText(document, node))}"${title} />`
        : `<a href="${href}"${title}>${renderChildren(document, node, 'inline')}</a>`
    }
    case 'autolink': {
      // Autolink content is taken verbatim: the specification applies no
      // backslash-escape or reference decoding inside <…>.
      const content = sliceRange(source, node).slice(1, -1)
      const href = AUTOLINK_EMAIL.test(content) ? `mailto:${content}` : content
      return `<a href="${escapeHrefAttribute(encodeHref(href))}">${escapeHtml(content)}</a>`
    }
    default:
      // Sections not yet taken green render their children transparently so
      // enabled sections never depend on pending ones' final shape.
      return renderChildren(document, node, context)
  }
}

// Tight lists render their items' paragraphs as bare inline content; loose
// lists keep the <p>. Block-level children always sit on their own lines
// inside the <li>.
function renderListItem(
  document: MarkdownDocument,
  item: MarkdownNode,
  tight: boolean
): string {
  const parts: string[] = []
  let previousWasTightParagraph = false
  for (let ordinal = 0; ordinal < item.childCount; ordinal += 1) {
    const child = item.childAt(ordinal)
    if (tight && child.kind === 'paragraph') {
      if (previousWasTightParagraph) {
        parts.push('\n')
      }
      parts.push(renderInlineContent(document, child))
      previousWasTightParagraph = true
      continue
    }
    if (previousWasTightParagraph) {
      parts.push('\n')
      previousWasTightParagraph = false
    }
    parts.push(renderNode(document, child, 'block'))
  }
  if (parts.length === 0) {
    return '<li></li>\n'
  }
  const first = item.childAt(0)
  const startsInline = tight && first.kind === 'paragraph'
  const body = parts.join('')
  return startsInline
    ? previousWasTightParagraph && !body.endsWith('\n')
      ? `<li>${body}</li>\n`
      : `<li>${body}</li>\n`
    : `<li>\n${body}</li>\n`
}

function sliceRange(source: string, node: MarkdownNode): string {
  return source.slice(node.range.start, node.range.end)
}

interface LinkTarget {
  readonly destination: string
  readonly title?: string
}

// Links carry their own destination/title content ranges (inline form) or a
// referenceLabel resolved against the document's definition nodes — both
// attached by the parser, so no link syntax is re-read here.
function resolveLinkTarget(
  document: MarkdownDocument,
  node: MarkdownNode
): LinkTarget | undefined {
  const owner = node.attributes['destinationStart'] !== undefined
    ? node
    : definitionsFor(document).get(String(node.attributes['referenceLabel']))
  if (owner === undefined) {
    return undefined
  }
  const destination = document.source.slice(
    Number(owner.attributes['destinationStart']),
    Number(owner.attributes['destinationEnd'])
  )
  const titleStart = owner.attributes['titleStart']
  if (titleStart === undefined) {
    return { destination }
  }
  const title = document.source.slice(
    Number(titleStart),
    Number(owner.attributes['titleEnd'])
  )
  return { destination, title }
}

const DEFINITIONS_CACHE = new WeakMap<
  MarkdownDocument,
  Map<string, MarkdownNode>
>()

function definitionsFor(document: MarkdownDocument): Map<string, MarkdownNode> {
  const cached = DEFINITIONS_CACHE.get(document)
  if (cached !== undefined) {
    return cached
  }
  const definitions = new Map<string, MarkdownNode>()
  const collect = (node: MarkdownNode): void => {
    if (node.kind === 'definition') {
      const label = node.attributes['label']
      if (typeof label === 'string' && !definitions.has(label)) {
        definitions.set(label, node)
      }
      return
    }
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      collect(node.childAt(ordinal))
    }
  }
  collect(document.root)
  DEFINITIONS_CACHE.set(document, definitions)
  return definitions
}

// Image alt text is the plain-text projection of the label's inline content.
function plainText(document: MarkdownDocument, node: MarkdownNode): string {
  const parts: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const child = node.childAt(ordinal)
    switch (child.kind) {
      case 'text':
        parts.push(decodeMarkdownText(sliceRange(document.source, child)))
        break
      case 'inline-code':
        parts.push(sliceRange(document.source, child))
        break
      case 'soft-break':
      case 'hard-break':
        parts.push(' ')
        break
      default:
        parts.push(plainText(document, child))
    }
  }
  return parts.join('')
}

const AUTOLINK_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

// cmark's href policy: its safe set stays literal (existing % sequences
// included); every other char percent-encodes as UTF-8 bytes.
const HREF_SAFE = new Set(
  "!#$%&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~"
)

function encodeHref(url: string): string {
  let encoded = ''
  for (const char of url) {
    encoded += HREF_SAFE.has(char) ? char : encodeURIComponent(char)
  }
  return encoded
}

function escapeHrefAttribute(href: string): string {
  return escapeHtml(href).replace(/'/g, '&#x27;')
}

function firstWord(text: string): string {
  const match = /^\S+/.exec(text)
  return match === null ? '' : match[0]
}

function stripIndentColumns(line: string, columns: number): string {
  let stripped = 0
  let offset = 0
  while (offset < line.length && stripped < columns) {
    const code = line.charCodeAt(offset)
    if (code === 32) {
      stripped += 1
      offset += 1
    } else if (code === 9) {
      stripped += 4 - (stripped % 4)
      offset += 1
    } else {
      break
    }
  }
  return line.slice(offset)
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function renderInlineCode(source: string, node: MarkdownNode): string {
  const raw = sliceRange(source, node)
  const markerLength = Number(node.attributes['markerLength'] ?? 1)
  let content = raw.slice(markerLength, raw.length - markerLength)
  content = content.replace(/\r\n|\r|\n/g, ' ')
  if (
    content.length >= 2 &&
    content.startsWith(' ') &&
    content.endsWith(' ') &&
    content.trim() !== ''
  ) {
    content = content.slice(1, -1)
  }
  return `<code>${escapeHtml(content)}</code>`
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  frac34: '¾',
  HilbertSpace: 'ℋ',
  DifferentialD: 'ⅆ',
  ClockwiseContourIntegral: '∲',
  ngE: '≧̸',
  AElig: 'Æ',
  Dcaron: 'Ď'
})

/**
 * The specification's text semantics for raw source text: backslash escapes
 * of ASCII punctuation collapse to the character, and character references
 * decode. This is defined text interpretation, not syntax recognition — the
 * graph already decided these bytes are text.
 */
function decodeMarkdownText(text: string): string {
  return text.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&#[Xx]([0-9a-fA-F]{1,6});|&#([0-9]{1,7});|&([A-Za-z][A-Za-z0-9]{1,31});/g,
    (whole, escaped: string | undefined, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (escaped !== undefined) {
        return escaped
      }
      if (hex !== undefined) {
        return codePointToString(Number.parseInt(hex, 16))
      }
      if (dec !== undefined) {
        return codePointToString(Number.parseInt(dec, 10))
      }
      if (named !== undefined) {
        const value = NAMED_ENTITIES[named]
        return value ?? whole
      }
      return whole
    }
  )
}

function codePointToString(codePoint: number): string {
  if (codePoint === 0 || codePoint > 0x10ffff || Number.isNaN(codePoint)) {
    return '�'
  }
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return '�'
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
