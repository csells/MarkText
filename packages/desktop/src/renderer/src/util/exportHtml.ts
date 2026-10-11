// Desktop-side styled-HTML export wrapper for the @muyajs/core engine.
//
// The new engine (`@muyajs/core`) exposes `MarkdownToHtml(md, muya).generate()`
// which produces a full standalone HTML document (markdown rendered, diagrams
// rasterised, github-markdown-css + katex + prism linked, plus the engine
// export stylesheet). It has NO equivalent of the legacy muyajs
// `exportStyledHTML`, which additionally injected a table-of-contents at the
// `[TOC]` marker and wrapped the article in a header/footer page table for PDF
// / print. This helper reproduces that desktop-specific behaviour on top of the
// engine output so the export result stays equivalent to the legacy engine.

import type { MarkdownAstNode } from '@marktext/document-core'
import type { Muya } from '@muyajs/core'
import { MarkdownToHtml } from '@muyajs/core'
import {
  renderProjectedDocumentHtml,
  type DocumentConsumerProjection
} from '@/documentConsumers/documentProjectionConsumers'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from './dompurify'
import { rewriteImageSrcs } from './rewriteImageSrcs'
import { resolveLocalLinkHref } from './resolveLinkHref'

export interface HeaderFooterPart {
  type?: number
  left?: string
  center?: string
  right?: string
}

export interface ExportStyledHtmlOptions {
  title?: string
  printOptimization?: boolean
  extraCss?: string
  /** Pre-rendered TOC HTML (from `getHtmlToc`). Injected at `[TOC]`. */
  toc?: string
  header?: HeaderFooterPart | null
  footer?: HeaderFooterPart | null
  headerFooterStyled?: boolean
  /** Editor text direction ('ltr' | 'rtl' | 'auto'); set on the exported <html>. */
  dir?: string
}

// Ported verbatim from legacy muyajs `headerFooterStyle.css` so the page
// header/footer table lays out the same in the exported document.
const HEADER_FOOTER_CSS = `
:root { --footerHeaderBorderColor: #1c1c1c; }
table.page-container { width: 100%; border-collapse: collapse; }
table.page-container > tbody,
table.page-container > tbody > tr,
table.page-container > tbody > tr > td { display: block; width: 100vw; }
table.page-container > tbody > tr > td { overflow-wrap: anywhere; }
table.page-container > thead,
table.page-container > tfoot { display: table-header-group; }
.page-header .hf-container,
.page-footer-fake .hf-container,
.page-footer .hf-container { display: flex; justify-content: space-between; font-size: 0.75em; font-weight: 400; }
.hf-container { font-family: "Noto Music", "Noto Sans Math", "Open Sans", sans-serif; }
.page-header { display: table-header-group; }
.page-header .hf-container { margin-bottom: 16px; }
.page-header.styled .hf-container { padding-bottom: 1px; border-bottom: 1px solid var(--footerHeaderBorderColor); }
.page-header .hf-container > div { flex: 1; max-height: 100px; overflow: hidden; }
.page-header .header-content-left { text-align: left; margin-right: 4px; }
.page-header .header-content { text-align: center; }
.page-header .header-content-right { text-align: right; margin-left: 4px; }
.page-header.single .header-content-left,
.page-header.single .header-content-right { display: none; }
.page-footer-fake { display: table-footer-group; }
.page-footer-fake .hf-container { margin-top: 16px; visibility: hidden; }
.page-footer { position: fixed; bottom: 0; left: 0; right: 0; }
.page-footer.styled .hf-container { padding-top: 1px; border-top: 1px solid var(--footerHeaderBorderColor); }
.page-footer .hf-container > div { flex: 1; white-space: nowrap; overflow: hidden; }
.page-footer .footer-content-left { text-align: left; margin-right: 14px; }
.page-footer .footer-content { text-align: center; }
.page-footer .footer-content-right { text-align: right; margin-left: 14px; }
.page-footer.single .footer-content-left,
.page-footer.single .footer-content-right { display: none; }
`

const HF_TABLE_START = '<table class="page-container">'
const HF_TABLE_END = '</table>'
const HF_TABLE_FOOTER = `<tfoot class="page-footer-fake"><tr><td>
  <div class="hf-container">&nbsp;</div>
</td></tr></tfoot>`

const styledClass = (value: boolean | undefined): string => {
  if (value === undefined) return ''
  return value ? ' styled' : ' simple'
}

// Header/footer left/center/right are user-supplied, so sanitize them here.
// The article body is NOT sanitized again (it was already sanitized by the
// engine during render); re-sanitizing it strips diagram <foreignObject>
// labels and drops mermaid content from the export (#3359).
const hf = (value: string): string => sanitize(value, EXPORT_DOMPURIFY_CONFIG) as string

const createTableHeader = (header: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = header
  const headerClass =
    `page-header ${(type === 1 ? 'single' : '') + styledClass(headerFooterStyled)}`
      .replace(/\s+/g, ' ')
      .trim()
  return `<thead class="${headerClass}"><tr><th>
  <div class="hf-container">
    <div class="header-content-left">${hf(left)}</div>
    <div class="header-content">${hf(center)}</div>
    <div class="header-content-right">${hf(right)}</div>
  </div>
</th></tr></thead>`
}

const createRealFooter = (footer: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = footer
  const footerClass =
    `page-footer ${(type === 1 ? 'single' : '') + styledClass(headerFooterStyled)}`
      .replace(/\s+/g, ' ')
      .trim()
  return `<div class="${footerClass}">
  <div class="hf-container">
    <div class="footer-content-left">${hf(left)}</div>
    <div class="footer-content">${hf(center)}</div>
    <div class="footer-content-right">${hf(right)}</div>
  </div>
</div>`
}

const createTableBody = (article: string): string =>
  `<tbody><tr><td>
  <div class="main-container">
    ${article}
  </div>
</td></tr></tbody>`

/**
 * The projection with each paragraph Core reads as the text `[TOC]` alone,
 * the table-of-contents marker, holding `placeholder` instead, so the TOC
 * goes where the document holds the marker and never where `[TOC]` is code.
 */
const withTocPlaceholders = (
  projection: DocumentConsumerProjection,
  placeholder: string
): DocumentConsumerProjection => {
  const mark = (node: MarkdownAstNode): MarkdownAstNode => {
    const only = node.children.length === 1 ? node.children[0] : undefined
    if (node.kind === 'paragraph' && only?.kind === 'text' && only.attributes.semanticText === '[TOC]') {
      return { ...node, children: [{ ...only, attributes: { ...only.attributes, semanticText: placeholder } }] }
    }
    return node.children.length === 0 ? node : { ...node, children: node.children.map(mark) }
  }
  return { ...projection, ast: { ...projection.ast, root: mark(projection.ast.root) } }
}

/** A word no projection holds, standing for its TOC marker paragraphs. */
const tocPlaceholderFor = (projection: DocumentConsumerProjection): string => {
  for (;;) {
    const placeholder = `marktexttoc${Math.random().toString(36).slice(2)}`
    if (!projection.markdown.includes(placeholder)) return placeholder
  }
}

// Match the `href="…"` of an <a> tag in the (already sanitized, double-quoted)
// engine output, so relative local links are rewritten to absolute `file://`
// URLs the same way images are.
const ANCHOR_HREF_REG = /(<a\b[^>]*?\shref=")([^"]*)(")/gi

/**
 * Rewrite relative / absolute-local `<a href>` to absolute `file://` URLs so a
 * link to a local file still resolves after the saved document is moved out of
 * the source folder (#1688). Remote URLs, `mailto:`/`data:` schemes and in-page
 * fragment anchors are left untouched.
 */
const rewriteAnchorHrefs = (html: string): string =>
  html.replace(ANCHOR_HREF_REG, (match, pre: string, href: string, post: string) => {
    const resolved = resolveLocalLinkHref(href)
    return resolved === href ? match : `${pre}${resolved}${post}`
  })

const optionsWithHeaderFooterCss = (options: ExportStyledHtmlOptions): ExportStyledHtmlOptions => {
  const { header, footer } = options
  let { extraCss = '' } = options
  if (header || footer) {
    extraCss = extraCss ? HEADER_FOOTER_CSS + extraCss : HEADER_FOOTER_CSS
  }
  return { ...options, extraCss }
}

/**
 * A styled, standalone HTML document equivalent to legacy muyajs
 * `exportStyledHTML`: the TOC at the `[TOC]` marker and, when a header or
 * footer is supplied, the article in the page-container table for paged
 * PDF / print export.
 */
const finalizeStyledHtml = (
  fullDoc: string,
  projectedArticle: string,
  options: ExportStyledHtmlOptions,
  tocPlaceholder: string
): string => {
  const { toc = '', header, footer, headerFooterStyled } = options
  const appendHeaderFooter = !!header || !!footer
  let article = projectedArticle
  // Resolve relative image paths to absolute file:// URLs so the saved document
  // still shows its images when opened from a different folder (issue 230).
  article = rewriteImageSrcs(article)
  // Same for relative local links so they still resolve after the document is
  // moved out of the source folder (#1688).
  article = rewriteAnchorHrefs(article)

  // Inject the TOC at the first `[TOC]` marker paragraph (legacy behaviour:
  // only appears when the document explicitly contains `[TOC]`). A marker
  // that renders without its own paragraph, as in a tight list item, and any
  // later one keep their text.
  const placeholderParagraph = `<p>${tocPlaceholder}</p>`
  if (toc && article.includes(placeholderParagraph)) {
    article = article.replace(placeholderParagraph, () => toc)
  }
  article = article.split(tocPlaceholder).join('[TOC]')

  let bodyHtml: string
  if (!appendHeaderFooter) {
    bodyHtml = `<article class="markdown-body">${article}</article>`
  } else {
    let output = HF_TABLE_START
    if (header) output += createTableHeader(header, headerFooterStyled)
    if (footer) {
      output += HF_TABLE_FOOTER
      output = createRealFooter(footer, headerFooterStyled) + output
    }
    output += createTableBody(`<article class="markdown-body">${article}</article>`)
    output += HF_TABLE_END
    bodyHtml = output
  }

  // Re-emit the engine document shell with the (possibly augmented) body.
  return fullDoc.replace(/<body>[\s\S]*<\/body>/, () => `<body>\n  ${bodyHtml}\n</body>`)
}

/**
 * Core authority path. The document body comes only from the parser-owned AST;
 * Muya processes the interpreted HTML through its shared media/export pipeline
 * without receiving or reinterpreting document Markdown.
 */
export const exportStyledHTMLFromProjection = async(
  muya: Muya,
  projection: DocumentConsumerProjection,
  options: ExportStyledHtmlOptions = {}
): Promise<string> => {
  const prepared = optionsWithHeaderFooterCss(options)
  const { title = '', extraCss = '', dir } = prepared
  const tocPlaceholder = tocPlaceholderFor(projection)
  const shell = await MarkdownToHtml.fromHtml(
    renderProjectedDocumentHtml(withTocPlaceholders(projection, tocPlaceholder)),
    muya
  ).generate({
    title,
    extraCSS: extraCss,
    dir
  })
  return finalizeStyledHtml(
    shell,
    /<article class="markdown-body">([\s\S]*)<\/article>/.exec(shell)?.[1] ?? shell,
    prepared,
    tocPlaceholder
  )
}
