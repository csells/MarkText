import type {
  MarkdownDocument,
  MarkdownNode,
  NodeId,
  ViewRange
} from '../revision.js'
import {
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionTracker
} from '../parseExecutionControl.js'

export interface MarkdownStaticHeadingAnchor {
  readonly node: MarkdownNode
  readonly level: number
  readonly slug: string
}

export interface MarkdownStaticStructurePlan {
  readonly anchors: readonly MarkdownStaticHeadingAnchor[]
  readonly anchorsByNodeId: ReadonlyMap<NodeId, MarkdownStaticHeadingAnchor>
  readonly tableOfContents: Readonly<{
    readonly title: string
    readonly includeTopHeading: boolean
  }>
}

export interface MarkdownHtmlRenderOptions {
  readonly rawHtml?: 'passthrough' | 'escape'
  readonly unsafeUrls?: 'passthrough' | 'drop'
  readonly frontMatter?: 'omit' | 'render'
  readonly staticStructure?: MarkdownStaticStructurePlan
  readonly range?: ViewRange
}

export type MarkdownReviewElement = 'ins' | 'del' | 'mark'

export interface MarkdownReviewRun {
  readonly start: number
  readonly end: number
  /** Ordered outermost to innermost. */
  readonly elements: readonly MarkdownReviewElement[]
}

export interface MarkdownReviewAnnotation {
  readonly position: number
  readonly reference: string
  readonly noteId: string
}

export interface MarkdownReviewRenderPlan {
  readonly runs: readonly MarkdownReviewRun[]
  readonly annotations: readonly MarkdownReviewAnnotation[]
  readonly frontMatter?: 'omit' | 'render'
  readonly staticStructure?: MarkdownStaticStructurePlan
  readonly range?: ViewRange
}

interface MarkdownReviewRenderState extends MarkdownReviewRenderPlan {
  readonly emittedAnnotations: Set<MarkdownReviewAnnotation>
  readonly annotationsByPosition: ReadonlyMap<
    number,
    readonly MarkdownReviewAnnotation[]
  >
}

interface MarkdownHtmlRenderPolicy {
  readonly rawHtml: 'passthrough' | 'escape'
  readonly unsafeUrls: 'passthrough' | 'drop'
  readonly frontMatter: 'omit' | 'render'
  readonly footnotes: FootnoteRenderState
  readonly review?: MarkdownReviewRenderState
  readonly staticStructure?: MarkdownStaticStructurePlan
  readonly range?: ViewRange
}

interface FootnoteRenderState {
  readonly definitions: ReadonlyMap<string, MarkdownNode>
  readonly ordinals: ReadonlyMap<string, number>
  readonly referenceTotals: ReadonlyMap<string, number>
  readonly emittedReferences: Map<string, number>
}

/**
 * The HTML materializer: a pure consumer of a revision's block/inline
 * structure (ADR-0009). It walks parser-created nodes and emits CommonMark's
 * reference HTML. It performs no recognition — the only source reads are
 * slices of ranges the graph already owns, transformed by the specification's
 * text semantics (backslash escapes, character references, code-span
 * normalization), never re-tokenized.
 */
export function renderMarkdownHtml(
  document: MarkdownDocument,
  options: MarkdownHtmlRenderOptions = {}
): string {
  validateRenderRange(document, options.range)
  validateFrontMatterPolicy(options.frontMatter)
  const policy: MarkdownHtmlRenderPolicy = Object.freeze({
    rawHtml: options.rawHtml ?? 'passthrough',
    unsafeUrls: options.unsafeUrls ?? 'passthrough',
    frontMatter: options.frontMatter ?? 'omit',
    footnotes: createFootnoteRenderState(document, options.range),
    ...(options.staticStructure === undefined
      ? {}
      : { staticStructure: options.staticStructure }),
    ...(options.range === undefined ? {} : { range: options.range })
  })
  return renderChildren(document, document.root, 'block', policy) +
    renderFootnoteSection(document, policy)
}

/**
 * Render parser-produced editing Markdown with parser-produced Review ranges.
 *
 * This is deliberately a closed decoration plan rather than a callback: only
 * the three inert semantic elements can enter the output. Source HTML and URLs
 * are always sanitized at this boundary.
 */
export function renderMarkdownReviewHtml(
  document: MarkdownDocument,
  plan: MarkdownReviewRenderPlan
): string {
  validateReviewPlan(document, plan)
  validateRenderRange(document, plan.range)
  validateFrontMatterPolicy(plan.frontMatter)
  const annotationsByPosition =
    new Map<number, MarkdownReviewAnnotation[]>()
  for (const annotation of plan.annotations) {
    const annotations = annotationsByPosition.get(annotation.position) ?? []
    annotations.push(annotation)
    annotationsByPosition.set(annotation.position, annotations)
  }
  const review: MarkdownReviewRenderState = {
    runs: plan.runs,
    annotations: plan.annotations,
    ...(plan.range === undefined ? {} : { range: plan.range }),
    emittedAnnotations: new Set(),
    annotationsByPosition
  }
  const policy: MarkdownHtmlRenderPolicy = {
    rawHtml: 'escape',
    unsafeUrls: 'drop',
    frontMatter: plan.frontMatter ?? 'omit',
    footnotes: createFootnoteRenderState(document, plan.range),
    review,
    ...(plan.staticStructure === undefined
      ? {}
      : { staticStructure: plan.staticStructure }),
    ...(plan.range === undefined ? {} : { range: plan.range })
  }
  let rendered = renderChildren(document, document.root, 'block', policy)
  rendered += renderFootnoteSection(document, policy)
  for (const annotation of plan.annotations) {
    if (!review.emittedAnnotations.has(annotation)) {
      rendered += reviewReference(annotation)
      review.emittedAnnotations.add(annotation)
    }
  }
  return rendered
}

type InlineContext = 'block' | 'inline'

function renderChildren(
  document: MarkdownDocument,
  node: MarkdownNode,
  context: InlineContext,
  policy: MarkdownHtmlRenderPolicy
): string {
  const parts: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    parts.push(renderNode(document, node.childAt(ordinal), context, policy))
  }
  return parts.join('')
}

// Paragraph-family content: the block phase leaves continuation-line
// indentation and surrounding whitespace in the raw slices; the
// specification's paragraph semantics strip whitespace at line starts and
// ends. Applied per TEXT NODE around break nodes, never to code spans.
function renderInlineContent(
  document: MarkdownDocument,
  node: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy,
  tableCell = false
): string {
  const parts: string[] = []
  let atLineStart = true
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const child = node.childAt(ordinal)
    const isBreak = child.kind === 'soft-break' || child.kind === 'hard-break'
    let rendered: string
    if (child.kind === 'text') {
      const selected = selectedNodeRange(child, policy.range)
      let raw = document.source.slice(selected.start, selected.end)
      let start = selected.start
      if (atLineStart) {
        const trimmed = /^[\t ]+/.exec(raw)?.[0].length ?? 0
        raw = raw.slice(trimmed)
        start += trimmed
      }
      const next = ordinal + 1 < node.childCount
        ? node.childAt(ordinal + 1)
        : undefined
      if (next === undefined || next.kind === 'soft-break') {
        raw = raw.replace(/[\t ]+$/, '')
      }
      rendered = renderMarkdownText(raw, start, policy)
    } else if (tableCell && child.kind === 'inline-code') {
      rendered = decorateReviewAtomic(
        renderInlineCode(child, true),
        child,
        policy
      )
    } else {
      rendered = renderNode(document, child, 'inline', policy)
    }
    parts.push(rendered)
    atLineStart = isBreak
  }
  return parts.join('')
}

function tableOfContentsPolicy(
  policy: MarkdownHtmlRenderPolicy
): MarkdownHtmlRenderPolicy {
  const review = policy.review
  if (review === undefined) return policy
  return {
    ...policy,
    review: {
      runs: review.runs,
      annotations: Object.freeze([]),
      emittedAnnotations: new Set(),
      annotationsByPosition: new Map(),
      ...(review.range === undefined ? {} : { range: review.range })
    }
  }
}

function renderTableOfContents(
  document: MarkdownDocument,
  policy: MarkdownHtmlRenderPolicy
): string {
  const structure = policy.staticStructure
  if (structure === undefined) {
    throw new TypeError('Static TOC marker has no parser-owned outline')
  }
  const included =
    !structure.tableOfContents.includeTopHeading &&
    structure.anchors[0]?.level === 1
      ? structure.anchors.slice(1)
      : structure.anchors
  if (included.length === 0) return ''
  const title = structure.tableOfContents.title.length === 0
    ? 'Table of Contents'
    : structure.tableOfContents.title
  const inlinePolicy = tableOfContentsPolicy(policy)
  return '<nav class="toc-container" aria-label="Table of Contents">' +
    `<p class="toc-title">${escapeHtml(title)}</p>` +
    '<ol class="toc-list">' +
    included.map((anchor) =>
      `<li class="toc-level-${String(anchor.level)}">` +
      `<a href="#${escapeHtml(anchor.slug)}">${
        renderInlineContent(document, anchor.node, inlinePolicy)
      }</a></li>`
    ).join('') +
    '</ol></nav>'
}

function renderNode(
  document: MarkdownDocument,
  node: MarkdownNode,
  context: InlineContext,
  policy: MarkdownHtmlRenderPolicy
): string {
  if (!nodeIntersectsRange(node, policy.range)) {
    return ''
  }
  const source = document.source
  switch (node.kind) {
    case 'document':
      return renderChildren(document, node, context, policy)
    case 'paragraph':
      if (
        node.attributes['tableOfContents'] === true &&
        policy.staticStructure !== undefined &&
        !hasVisibleReviewElements(node, policy)
      ) {
        return renderTableOfContents(document, policy)
      }
      return `<p>${renderInlineContent(document, node, policy)}</p>\n`
    case 'heading': {
      const level = Number(node.attributes['level'] ?? 1)
      const anchor = policy.staticStructure?.anchorsByNodeId.get(node.nodeId)
      const id = anchor === undefined
        ? ''
        : ` id="${escapeHtml(anchor.slug)}"`
      return `<h${level}${id}>${
        renderInlineContent(document, node, policy)
      }</h${level}>\n`
    }
    case 'thematic-break':
      return decorateReviewAtomic('<hr />\n', node, policy)
    case 'list': {
      const ordered = node.attributes['ordered'] === true
      const start = Number(node.attributes['start'] ?? 1)
      const tight = node.attributes['tight'] !== false
      const items: string[] = []
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
        items.push(renderListItem(document, node.childAt(ordinal), tight, policy))
      }
      const openTag = ordered
        ? start === 1
          ? '<ol>'
          : `<ol start="${start}">`
        : '<ul>'
      const closeTag = ordered ? '</ol>' : '</ul>'
      return `${openTag}\n${items.join('')}${closeTag}\n`
    }
    case 'list-item':
      return renderListItem(document, node, false, policy)
    case 'table':
      return renderTable(document, node, policy)
    case 'table-row':
      return renderTableRow(document, node, policy)
    case 'table-cell':
      return renderInlineContent(document, node, policy, true)
    case 'blockquote':
      return `<blockquote>\n${renderChildren(document, node, 'block', policy)}</blockquote>\n`
    case 'code-block': {
      const content = String(node.attributes['content'] ?? '')
      const info = node.attributes['info']
      const language = info === undefined
        ? ''
        : ` class="language-${escapeHtml(markdownTextValue(firstWord(String(info))))}"`
      return decorateReviewAtomic(
        `<pre><code${language}>${escapeHtml(content)}</code></pre>\n`,
        node,
        policy
      )
    }
    case 'html-block':
      return decorateReviewAtomic(
        ensureTrailingNewline(
          policy.rawHtml === 'escape'
            ? escapeHtml(parserOwnedContent(node))
            : gfmTagFilteredHtml(node)
        ),
        node,
        policy
      )
    case 'front-matter':
      return policy.frontMatter === 'omit'
        ? ''
        : decorateReviewAtomic(
          '<pre class="front-matter"><code>' +
          escapeHtml(document.source.slice(
            Number(node.range.start),
            Number(node.range.end)
          )) +
          '</code></pre>\n',
          node,
          policy
        )
    case 'definition':
    case 'footnote-definition':
      return ''
    case 'text': {
      const selected = selectedNodeRange(node, policy.range)
      return renderMarkdownText(
        source.slice(selected.start, selected.end),
        selected.start,
        policy
      )
    }
    case 'soft-break':
      return decorateReviewAtomic('\n', node, policy)
    case 'hard-break':
      return decorateReviewAtomic('<br />\n', node, policy)
    case 'emphasis':
      return `<em>${renderChildren(document, node, 'inline', policy)}</em>`
    case 'strong':
      return `<strong>${renderChildren(document, node, 'inline', policy)}</strong>`
    case 'strikethrough':
      return `<del>${renderChildren(document, node, 'inline', policy)}</del>`
    case 'subscript':
      return `<sub>${renderChildren(document, node, 'inline', policy)}</sub>`
    case 'superscript':
      return `<sup>${renderChildren(document, node, 'inline', policy)}</sup>`
    case 'inline-code':
      return decorateReviewAtomic(renderInlineCode(node), node, policy)
    case 'inline-math':
      return decorateReviewAtomic(
        `<span class="math-inline">${escapeHtml(
          String(node.attributes['content'] ?? '')
        )}</span>`,
        node,
        policy
      )
    case 'math-block':
      return decorateReviewAtomic(
        `<pre class="math-block"><code>${escapeHtml(
          String(node.attributes['content'] ?? '')
        )}</code></pre>\n`,
        node,
        policy
      )
    case 'diagram':
      return decorateReviewAtomic(
        `<pre class="diagram" data-language="${escapeHtml(
          String(node.attributes['language'] ?? '')
        )}"><code>${escapeHtml(
          String(node.attributes['content'] ?? '')
        )}</code></pre>\n`,
        node,
        policy
      )
    case 'inline-html':
      return decorateReviewAtomic(
        policy.rawHtml === 'escape'
          ? escapeHtml(parserOwnedContent(node))
          : gfmTagFilteredHtml(node),
        node,
        policy
      )
    case 'link':
    case 'image': {
      const target = resolveLinkTarget(document, node)
      if (target === undefined) {
        return escapeHtml(markdownTextValue(sliceRange(source, node)))
      }
      const decodedDestination = markdownTextValue(target.destination)
      const href = escapeHrefAttribute(
        encodeHref(
          policy.unsafeUrls === 'drop' && hasUnsafeScheme(decodedDestination)
            ? ''
            : decodedDestination
        )
      )
      const title = target.title === undefined
        ? ''
        : ` title="${escapeHtml(markdownTextValue(target.title))}"`
      return node.kind === 'image'
        ? decorateReviewAtomic(
          `<img src="${href}" alt="${escapeHtml(plainText(document, node))}"${title} />`,
          node,
          policy
        )
        : `<a href="${href}"${title}>${renderChildren(document, node, 'inline', policy)}</a>`
    }
    case 'autolink': {
      // Autolink content is taken verbatim: the specification applies no
      // backslash-escape or reference decoding inside <…>.
      const content = sliceRange(source, node).slice(1, -1)
      const candidate = AUTOLINK_EMAIL.test(content) ? `mailto:${content}` : content
      const href = policy.unsafeUrls === 'drop' && hasUnsafeScheme(candidate)
        ? ''
        : candidate
      return decorateReviewAtomic(
        `<a href="${escapeHrefAttribute(encodeHref(href))}">${escapeHtml(content)}</a>`,
        node,
        policy
      )
    }
    case 'footnote-reference':
      return renderFootnoteReference(document, node, policy)
  }
  const unhandled: never = node.kind
  throw new TypeError(`Unhandled Markdown HTML node: ${String(unhandled)}`)
}

function hasVisibleReviewElements(
  node: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy
): boolean {
  const runs = policy.review?.runs
  if (runs === undefined) {
    return false
  }
  for (
    let index = firstReviewRunEndingAfter(runs, node.range.start);
    index < runs.length;
    index += 1
  ) {
    const run = runs[index]
    if (run === undefined || run.start >= node.range.end) {
      break
    }
    if (
      run.elements.length > 0 &&
      run.start < node.range.end &&
      run.end > node.range.start
    ) {
      return true
    }
  }
  return false
}

function createFootnoteRenderState(
  document: MarkdownDocument,
  range: ViewRange | undefined
): FootnoteRenderState {
  const definitions = new Map<string, MarkdownNode>()
  for (
    let ordinal = 0;
    ordinal < document.references.footnoteDefinitionCount;
    ordinal += 1
  ) {
    const definition = document.references.footnoteDefinitionAt(ordinal)
    definitions.set(definition.label, definition.node)
  }

  const ordinals = new Map<string, number>()
  const referenceTotals = new Map<string, number>()
  for (
    let ordinal = 0;
    ordinal < document.references.footnoteReferenceCount;
    ordinal += 1
  ) {
    const reference = document.references.footnoteReferenceAt(ordinal)
    if (
      reference.definition === undefined ||
      !nodeIntersectsRange(reference.node, range)
    ) {
      continue
    }
    const label = reference.label
    if (!ordinals.has(label)) {
      ordinals.set(label, ordinals.size + 1)
    }
    referenceTotals.set(label, (referenceTotals.get(label) ?? 0) + 1)
  }
  return {
    definitions,
    ordinals,
    referenceTotals,
    emittedReferences: new Map()
  }
}

function footnoteAddress(label: string): string {
  return encodeURIComponent(label)
}

function footnoteReferenceId(label: string, occurrence: number): string {
  const suffix = occurrence === 1 ? '' : `-${String(occurrence)}`
  return `fnref-${footnoteAddress(label)}${suffix}`
}

function renderFootnoteReference(
  document: MarkdownDocument,
  node: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy
): string {
  const label = node.attributes['label']
  if (typeof label !== 'string') {
    return ''
  }
  const ordinal = policy.footnotes.ordinals.get(label)
  if (ordinal === undefined) {
    return renderMarkdownText(
      sliceRange(document.source, node),
      node.range.start,
      policy
    )
  }
  const occurrence =
    (policy.footnotes.emittedReferences.get(label) ?? 0) + 1
  policy.footnotes.emittedReferences.set(label, occurrence)
  const address = footnoteAddress(label)
  const referenceId = footnoteReferenceId(label, occurrence)
  return `<sup class="footnote-ref"><a href="#fn-${escapeHtml(address)}" ` +
    `id="${escapeHtml(referenceId)}">${String(ordinal)}</a></sup>`
}

function renderFootnoteSection(
  document: MarkdownDocument,
  policy: MarkdownHtmlRenderPolicy
): string {
  if (policy.footnotes.ordinals.size === 0) {
    return ''
  }
  const entries = [...policy.footnotes.ordinals.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([label, ordinal]) => {
      const definition = policy.footnotes.definitions.get(label)
      if (definition === undefined) {
        return ''
      }
      const backlinks: string[] = []
      const total = policy.footnotes.referenceTotals.get(label) ?? 0
      for (let occurrence = 1; occurrence <= total; occurrence += 1) {
        const referenceId = footnoteReferenceId(label, occurrence)
        const suffix = occurrence === 1
          ? ''
          : `<span class="footnote-backref-index">${String(occurrence)}</span>`
        backlinks.push(
          `<a href="#${escapeHtml(referenceId)}" ` +
          'class="footnote-backref" aria-label="Back to reference ' +
          `${String(ordinal)}${occurrence === 1 ? '' : `-${String(occurrence)}`}">` +
          `↩${suffix}</a>`
        )
      }
      const definitionPolicy: MarkdownHtmlRenderPolicy = {
        rawHtml: policy.rawHtml,
        unsafeUrls: policy.unsafeUrls,
        frontMatter: policy.frontMatter,
        footnotes: policy.footnotes,
        ...(policy.review === undefined ? {} : { review: policy.review })
      }
      const rendered = renderChildren(
        document,
        definition,
        'block',
        definitionPolicy
      )
      const backReferences = backlinks.join(' ')
      const body = rendered.endsWith('</p>\n')
        ? `${rendered.slice(0, -5)} ${backReferences}</p>\n`
        : `${rendered}${backReferences}\n`
      return `<li id="fn-${escapeHtml(footnoteAddress(label))}">\n` +
        `${body}</li>\n`
    })
    .join('')
  return `<section class="footnotes">\n<ol>\n${entries}</ol>\n</section>\n`
}

function renderTable(
  document: MarkdownDocument,
  table: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy
): string {
  const headerRows: string[] = []
  const bodyRows: string[] = []
  for (let ordinal = 0; ordinal < table.childCount; ordinal += 1) {
    const row = table.childAt(ordinal)
    const rendered = renderTableRow(document, row, policy)
    if (row.attributes['header'] === true) {
      headerRows.push(rendered)
    } else {
      bodyRows.push(rendered)
    }
  }
  const parts = ['<table>\n']
  if (headerRows.length > 0) {
    parts.push('<thead>\n', ...headerRows, '</thead>\n')
  }
  if (bodyRows.length > 0) {
    parts.push('<tbody>\n', ...bodyRows, '</tbody>\n')
  }
  parts.push('</table>\n')
  return parts.join('')
}

function renderTableRow(
  document: MarkdownDocument,
  row: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy
): string {
  const header = row.attributes['header'] === true
  const tag = header ? 'th' : 'td'
  const parts = ['<tr>\n']
  for (let ordinal = 0; ordinal < row.childCount; ordinal += 1) {
    const cell = row.childAt(ordinal)
    const alignment = cell.attributes['alignment']
    const align = alignment === 'left' ||
      alignment === 'center' ||
      alignment === 'right'
      ? ` align="${alignment}"`
      : ''
    parts.push(
      `<${tag}${align}>`,
      renderInlineContent(document, cell, policy, true),
      `</${tag}>\n`
    )
  }
  parts.push('</tr>\n')
  return parts.join('')
}

// Tight lists render their items' paragraphs as bare inline content; loose
// lists keep the <p>. Block-level children always sit on their own lines
// inside the <li>.
function renderListItem(
  document: MarkdownDocument,
  item: MarkdownNode,
  tight: boolean,
  policy: MarkdownHtmlRenderPolicy
): string {
  const parts: string[] = []
  const task = item.attributes['task'] === true
  if (task) {
    const checked = item.attributes['checked'] === true ? ' checked=""' : ''
    parts.push(`<input${checked} disabled="" type="checkbox"> `)
  }
  let previousWasTightParagraph = false
  for (let ordinal = 0; ordinal < item.childCount; ordinal += 1) {
    const child = item.childAt(ordinal)
    if (tight && child.kind === 'paragraph') {
      if (previousWasTightParagraph) {
        parts.push('\n')
      }
      parts.push(renderInlineContent(document, child, policy))
      previousWasTightParagraph = true
      continue
    }
    if (previousWasTightParagraph) {
      parts.push('\n')
      previousWasTightParagraph = false
    }
    parts.push(renderNode(document, child, 'block', policy))
  }
  if (parts.length === 0) {
    return '<li></li>\n'
  }
  const first = item.childAt(0)
  const startsInline = tight && first.kind === 'paragraph'
  const body = parts.join('')
  const opening = '<li>'
  return startsInline
    ? previousWasTightParagraph && !body.endsWith('\n')
      ? `${opening}${body}</li>\n`
      : `${opening}${body}</li>\n`
    : `${opening}\n${body}</li>\n`
}

function sliceRange(source: string, node: MarkdownNode): string {
  return source.slice(node.range.start, node.range.end)
}

function validateRenderRange(
  document: MarkdownDocument,
  range: ViewRange | undefined
): void {
  if (
    range !== undefined &&
    (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > document.source.length
    )
  ) {
    throw new RangeError(
      `HTML render range must be inside [0, ${String(document.source.length)}]`
    )
  }
}

function nodeIntersectsRange(
  node: MarkdownNode,
  range: ViewRange | undefined
): boolean {
  return range === undefined ||
    (node.range.start < range.end && node.range.end > range.start)
}

function selectedNodeRange(
  node: MarkdownNode,
  range: ViewRange | undefined
): ViewRange {
  return range === undefined
    ? node.range
    : {
      start: Math.max(node.range.start, range.start),
      end: Math.min(node.range.end, range.end)
    }
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
  const target = document.references.linkForNode(node.nodeId)
  return target === undefined
    ? undefined
    : {
      destination: target.destination,
      ...(target.title === undefined ? {} : { title: target.title })
    }
}

// Image alt text is the plain-text projection of the label's inline content.
function plainText(document: MarkdownDocument, node: MarkdownNode): string {
  const parts: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const child = node.childAt(ordinal)
    switch (child.kind) {
      case 'text':
        parts.push(markdownTextValue(sliceRange(document.source, child)))
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

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto'])

function hasUnsafeScheme(url: string): boolean {
  // Browsers ignore ASCII whitespace/control characters around and within
  // scheme spelling. Normalize only for the scheme decision; emitted text
  // still goes through the ordinary href encoder.
  let normalized = ''
  for (const character of url) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint > 0x20 && codePoint !== 0x7f) {
      normalized += character.toLowerCase()
    }
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1]
  return scheme !== undefined && !SAFE_URL_SCHEMES.has(scheme)
}

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

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function renderInlineCode(node: MarkdownNode, tableCell = false): string {
  const content = node.attributes['content']
  if (typeof content !== 'string') {
    throw new TypeError('inline-code node has no parser-owned content')
  }
  return `<code>${escapeHtml(tableCell ? content.replace(/\\\|/g, '|') : content)}</code>`
}

function parserOwnedContent(node: MarkdownNode): string {
  const content = node.attributes['content']
  if (typeof content !== 'string') {
    throw new TypeError(`${node.kind} node has no parser-owned content`)
  }
  return content
}

const GFM_TAG_FILTER =
  /<\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\t\n\f />])/gi

function gfmTagFilteredHtml(node: MarkdownNode): string {
  const content = parserOwnedContent(node)
  return node.attributes['gfmTagFilter'] === true
    ? content.replace(GFM_TAG_FILTER, match => `&lt;${match.slice(1)}`)
    : content
}

function validateReviewPlan(
  document: MarkdownDocument,
  plan: MarkdownReviewRenderPlan
): void {
  let previousEnd = 0
  for (const run of plan.runs) {
    if (
      !Number.isInteger(run.start) ||
      !Number.isInteger(run.end) ||
      run.start < previousEnd ||
      run.end < run.start ||
      run.end > document.source.length
    ) {
      throw new RangeError('Review render runs must be ordered non-overlapping ranges')
    }
    if (
      run.elements.some((element) =>
        element !== 'ins' && element !== 'del' && element !== 'mark'
      )
    ) {
      throw new RangeError('Review render run contains an unknown semantic element')
    }
    previousEnd = run.end
  }
  let previousPosition = 0
  for (const annotation of plan.annotations) {
    if (
      !Number.isInteger(annotation.position) ||
      annotation.position < previousPosition ||
      annotation.position > document.source.length
    ) {
      throw new RangeError('Review annotations must be ordered document positions')
    }
    if (!/^review-note-[1-9][0-9]*$/.test(annotation.noteId)) {
      throw new TypeError('Review annotation note id is not sink-generated')
    }
    previousPosition = annotation.position
  }
}

function validateFrontMatterPolicy(value: unknown): void {
  if (
    value !== undefined &&
    value !== 'omit' &&
    value !== 'render'
  ) {
    throw new TypeError('Unknown front matter render policy')
  }
}

function renderMarkdownText(
  raw: string,
  sourceStart: number,
  policy: MarkdownHtmlRenderPolicy
): string {
  const review = policy.review
  if (review === undefined) {
    return escapeHtml(markdownTextValue(raw))
  }
  const sourceEnd = sourceStart + raw.length
  const boundaries = new Set<number>([sourceStart, sourceEnd])
  for (
    let index = firstReviewRunEndingAfter(review.runs, sourceStart);
    index < review.runs.length;
    index += 1
  ) {
    const run = review.runs[index]
    if (run === undefined || run.start >= sourceEnd) {
      break
    }
    if (run.start > sourceStart && run.start < sourceEnd) {
      boundaries.add(run.start)
    }
    if (run.end > sourceStart && run.end < sourceEnd) {
      boundaries.add(run.end)
    }
  }
  for (
    let index = firstReviewAnnotationAtOrAfter(
      review.annotations,
      sourceStart
    );
    index < review.annotations.length;
    index += 1
  ) {
    const annotation = review.annotations[index]
    if (annotation === undefined || annotation.position > sourceEnd) {
      break
    }
    if (
      annotation.position >= sourceStart &&
      annotation.position <= sourceEnd
    ) {
      boundaries.add(annotation.position)
    }
  }
  const positions = [...boundaries].sort((left, right) => left - right)
  const parts: string[] = []
  let activeElements: readonly MarkdownReviewElement[] = []
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index]
    if (position === undefined) {
      continue
    }
    const annotations = review.annotationsByPosition.get(position) ?? []
    if (annotations.length > 0) {
      appendReviewElementTransition(parts, activeElements, [])
      activeElements = []
    }
    for (const annotation of annotations) {
      if (!review.emittedAnnotations.has(annotation)) {
        parts.push(reviewReference(annotation))
        review.emittedAnnotations.add(annotation)
      }
    }
    const next = positions[index + 1]
    if (next === undefined || next === position) {
      continue
    }
    const value = escapeHtml(markdownTextValue(
      raw.slice(position - sourceStart, next - sourceStart)
    ))
    const nextElements = reviewElementsAt(review.runs, position)
    appendReviewElementTransition(parts, activeElements, nextElements)
    activeElements = nextElements
    parts.push(value)
  }
  appendReviewElementTransition(parts, activeElements, [])
  return parts.join('')
}

function reviewElementsAt(
  runs: readonly MarkdownReviewRun[],
  position: number
): readonly MarkdownReviewElement[] {
  const run = runs[firstReviewRunEndingAfter(runs, position)]
  return run !== undefined &&
    position >= run.start &&
    position < run.end
    ? run.elements
    : []
}

function firstReviewRunEndingAfter(
  runs: readonly MarkdownReviewRun[],
  position: number
): number {
  let low = 0
  let high = runs.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const run = runs[middle]
    if (run !== undefined && run.end <= position) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function firstReviewAnnotationAtOrAfter(
  annotations: readonly MarkdownReviewAnnotation[],
  position: number
): number {
  let low = 0
  let high = annotations.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    const annotation = annotations[middle]
    if (annotation !== undefined && annotation.position < position) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function wrapReviewElements(
  html: string,
  elements: readonly MarkdownReviewElement[]
): string {
  if (elements.length === 0) {
    return html
  }
  const parts = new Array<string>(elements.length * 2 + 1)
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    if (element !== undefined) {
      parts[index] = `<${element}>`
      parts[parts.length - index - 1] = `</${element}>`
    }
  }
  parts[elements.length] = html
  return parts.join('')
}

function appendReviewElementTransition(
  parts: string[],
  from: readonly MarkdownReviewElement[],
  to: readonly MarkdownReviewElement[]
): void {
  let shared = 0
  while (
    shared < from.length &&
    shared < to.length &&
    from[shared] === to[shared]
  ) {
    shared += 1
  }
  for (let index = from.length - 1; index >= shared; index -= 1) {
    const element = from[index]
    if (element !== undefined) {
      parts.push(`</${element}>`)
    }
  }
  for (let index = shared; index < to.length; index += 1) {
    const element = to[index]
    if (element !== undefined) {
      parts.push(`<${element}>`)
    }
  }
}

function decorateReviewAtomic(
  html: string,
  node: MarkdownNode,
  policy: MarkdownHtmlRenderPolicy
): string {
  const review = policy.review
  if (review === undefined || html === '') {
    return html
  }
  const selected = selectedNodeRange(node, policy.range)
  let cursor = selected.start
  let elements: readonly MarkdownReviewElement[] | undefined
  for (
    let index = firstReviewRunEndingAfter(review.runs, cursor);
    index < review.runs.length;
    index += 1
  ) {
    const run = review.runs[index]
    if (run === undefined) {
      break
    }
    if (run.end <= cursor) {
      continue
    }
    if (run.start >= selected.end) {
      break
    }
    if (run.start > cursor) {
      return html
    }
    if (elements === undefined) {
      elements = run.elements
    } else if (!sameReviewElements(elements, run.elements)) {
      return html
    }
    cursor = Math.min(selected.end, run.end)
    if (cursor === selected.end) {
      break
    }
  }
  return cursor === selected.end && elements !== undefined
    ? wrapReviewElements(html, elements)
    : html
}

function sameReviewElements(
  left: readonly MarkdownReviewElement[],
  right: readonly MarkdownReviewElement[]
): boolean {
  return left.length === right.length &&
    left.every((element, index) => element === right[index])
}

function reviewReference(annotation: MarkdownReviewAnnotation): string {
  return '<sup role="doc-noteref">' +
    `<a href="#${annotation.noteId}" data-review-annotation="${annotation.noteId}">` +
    `${escapeHtml(annotation.reference)}</a></sup>`
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
export interface MarkdownTextValueSegment {
  readonly text: string
  /**
   * Compact parser-issued boundary semantics. Identity text maps an interior
   * rendered boundary linearly from `inputRange.start`; a collapsed escape or
   * entity maps every nonterminal rendered boundary to the start and its final
   * boundary to the end.
   */
  readonly boundaryMapping: 'identity' | 'collapsed'
  readonly inputRange: Readonly<{
    readonly start: number
    readonly end: number
  }>
}

/**
 * Decode parser-owned text while retaining the exact input boundary map.
 *
 * `inputStart` names `text[0]` in the caller's coordinate space. The helper
 * interprets text nodes only; it does not recognize Markdown structure.
 */
export function markdownTextValueSegments(
  text: string,
  inputStart = 0,
  execution?: ParseExecutionTracker
): readonly MarkdownTextValueSegment[] {
  const segments: MarkdownTextValueSegment[] = []
  let identityStart = 0
  let cursor = 0
  let reported = 0
  const report = (): void => {
    if (cursor - reported >= PARSE_SOURCE_CHECKPOINT_INTERVAL) {
      execution?.examineSource(cursor - reported)
      reported = cursor
    }
  }
  const appendIdentity = (from: number, to: number): void => {
    if (to <= from) return
    segments.push(Object.freeze({
      text: text.slice(from, to),
      boundaryMapping: 'identity' as const,
      inputRange: Object.freeze({
        start: inputStart + from,
        end: inputStart + to
      })
    }))
  }

  while (cursor < text.length) {
    const start = cursor
    let end = cursor
    let value: string | undefined
    if (
      text.charCodeAt(cursor) === 92 &&
      cursor + 1 < text.length &&
      isEscapableMarkdownPunctuation(text.charCodeAt(cursor + 1))
    ) {
      end = cursor + 2
      value = text[cursor + 1]
    } else if (text.charCodeAt(cursor) === 38) {
      let tokenCursor = cursor + 1
      if (text.charCodeAt(tokenCursor) === 35) {
        tokenCursor += 1
        const hexadecimal =
          text.charCodeAt(tokenCursor) === 88 ||
          text.charCodeAt(tokenCursor) === 120
        if (hexadecimal) tokenCursor += 1
        const digitsStart = tokenCursor
        const maximumDigits = hexadecimal ? 6 : 7
        while (tokenCursor < text.length &&
          tokenCursor - digitsStart < maximumDigits) {
          const code = text.charCodeAt(tokenCursor)
          const digit = hexadecimal
            ? (code >= 48 && code <= 57) ||
              (code >= 65 && code <= 70) ||
              (code >= 97 && code <= 102)
            : code >= 48 && code <= 57
          if (!digit) break
          tokenCursor += 1
        }
        if (
          tokenCursor > digitsStart &&
          text.charCodeAt(tokenCursor) === 59
        ) {
          end = tokenCursor + 1
          value = codePointToString(Number.parseInt(
            text.slice(digitsStart, tokenCursor),
            hexadecimal ? 16 : 10
          ))
        }
      } else {
        const nameStart = tokenCursor
        const first = text.charCodeAt(tokenCursor)
        if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
          tokenCursor += 1
          while (tokenCursor < text.length && tokenCursor - nameStart < 32) {
            const code = text.charCodeAt(tokenCursor)
            if (!(
              (code >= 48 && code <= 57) ||
              (code >= 65 && code <= 90) ||
              (code >= 97 && code <= 122)
            )) break
            tokenCursor += 1
          }
          if (
            tokenCursor - nameStart >= 2 &&
            text.charCodeAt(tokenCursor) === 59
          ) {
            end = tokenCursor + 1
            const raw = text.slice(start, end)
            value = NAMED_ENTITIES[
              text.slice(nameStart, tokenCursor)
            ] ?? raw
          }
        }
      }
    }

    if (value === undefined) {
      cursor += 1
      report()
      continue
    }
    const raw = text.slice(start, end)
    if (value === raw) {
      cursor = end
      report()
      continue
    }
    appendIdentity(identityStart, start)
    segments.push(Object.freeze({
      text: value,
      boundaryMapping: 'collapsed' as const,
      inputRange: Object.freeze({
        start: inputStart + start,
        end: inputStart + end
      })
    }))
    cursor = end
    identityStart = end
    report()
  }
  appendIdentity(identityStart, text.length)
  execution?.examineSource(cursor - reported)
  return Object.freeze(segments)
}

function isEscapableMarkdownPunctuation(codeUnit: number): boolean {
  return (
    (codeUnit >= 33 && codeUnit <= 47) ||
    (codeUnit >= 58 && codeUnit <= 64) ||
    (codeUnit >= 91 && codeUnit <= 96) ||
    (codeUnit >= 123 && codeUnit <= 126)
  )
}

export function markdownTextValue(
  text: string,
  execution?: ParseExecutionTracker
): string {
  const segments = markdownTextValueSegments(text, 0, execution)
  if (execution !== undefined) {
    let outputUnits = 0
    for (const segment of segments) {
      outputUnits += segment.text.length
      execution.examineParserWork(1)
    }
    execution.examineParserWork(outputUnits)
  }
  return segments.map((segment) => segment.text).join('')
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
