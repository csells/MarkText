import type {
  DocumentCoreExportHeaderFooter,
  DocumentCoreExportOptions,
  DocumentCoreExportPageSize,
  DocumentCoreExportTheme
} from '../../shared/types/documentCore'

export type DocumentCoreExportConsumer =
  | 'styled-html'
  | 'pdf'
  | 'print'

export interface DocumentCorePdfPageOptions {
  readonly landscape: boolean
  readonly pageSize:
    | Extract<
      DocumentCoreExportPageSize,
      { readonly kind: 'named' }
    >['name']
    | Readonly<{
      readonly width: number
      readonly height: number
    }>
}

export interface DocumentCoreDecoratedExport {
  readonly html: string
  readonly pdfPageOptions?: DocumentCorePdfPageOptions
}

export interface DocumentCoreExportThemeSource {
  readonly cssFor: (theme: DocumentCoreExportTheme) => Promise<string>
}

export interface DocumentCoreExportDecorator {
  readonly decorate: (
    html: string,
    consumer: DocumentCoreExportConsumer,
    options: DocumentCoreExportOptions
  ) => Promise<DocumentCoreDecoratedExport>
}

const HEADER_FOOTER_CSS = [
  '.page-header,.page-footer{font-weight:400;}',
  '.page-header{margin-bottom:16px;}',
  '.page-footer{margin-top:16px;}',
  '.hf-container{display:flex;justify-content:space-between;}',
  '.hf-container>span{flex:1;overflow-wrap:anywhere;}',
  '.hf-left{text-align:left}.hf-center{text-align:center}',
  '.hf-right{text-align:right}',
  '.single .hf-left,.single .hf-right{visibility:hidden;}',
  '.page-header.rules .hf-container{padding-bottom:2px;',
  'border-bottom:1px solid currentColor;}',
  '.page-footer.rules .hf-container{padding-top:2px;',
  'border-top:1px solid currentColor;}'
].join('')

const AUTO_NUMBER_CSS = [
  '.markdown-body{counter-reset:h2;}',
  '.markdown-body h2{counter-reset:h3;}',
  '.markdown-body h3{counter-reset:h4;}',
  '.markdown-body h4{counter-reset:h5;}',
  '.markdown-body h5{counter-reset:h6;}',
  '.markdown-body h2:before{counter-increment:h2;',
  'content:counter(h2) ". ";}',
  '.markdown-body h3:before{counter-increment:h3;',
  'content:counter(h2) "." counter(h3) ". ";}',
  '.markdown-body h4:before{counter-increment:h4;',
  'content:counter(h2) "." counter(h3) "." counter(h4) ". ";}',
  '.markdown-body h5:before{counter-increment:h5;',
  'content:counter(h2) "." counter(h3) "." counter(h4) "." ',
  'counter(h5) ". ";}',
  '.markdown-body h6:before{counter-increment:h6;',
  'content:counter(h2) "." counter(h3) "." counter(h4) "." ',
  'counter(h5) "." counter(h6) ". ";}'
].join('')

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function headerFooterHtml(
  kind: 'header' | 'footer',
  value: DocumentCoreExportHeaderFooter,
  drawRules: boolean
): string {
  const element = kind === 'header' ? 'header' : 'footer'
  const layoutClass = value.layout === 'single'
    ? 'single'
    : 'three-columns'
  const rulesClass = drawRules ? ' rules' : ''
  return `<${element} class="page-${kind} ${layoutClass}${rulesClass}">` +
    '<div class="hf-container">' +
    `<span class="hf-left">${escapeHtml(value.left)}</span>` +
    `<span class="hf-center">${escapeHtml(value.center)}</span>` +
    `<span class="hf-right">${escapeHtml(value.right)}</span>` +
    `</div></${element}>`
}

function safeThemeCss(css: string): string {
  if (
    /<\/style/i.test(css) ||
    /@import\b/i.test(css) ||
    /\bexpression\s*\(/i.test(css) ||
    /url\s*\(\s*(['"]?)\s*javascript:/i.test(css)
  ) {
    throw new TypeError('Export theme CSS contains an unsafe style escape')
  }
  return css
}

function cssString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\3c ')
}

function optionCss(
  consumer: DocumentCoreExportConsumer,
  options: DocumentCoreExportOptions,
  themeCss: string
): string {
  const rules: string[] = []
  if (consumer !== 'styled-html') {
    const { top, right, bottom, left } = options.page.marginsMm
    const size = options.page.size.kind === 'named'
      ? options.page.size.name
      : `${String(options.page.size.widthMm)}mm ` +
        `${String(options.page.size.heightMm)}mm`
    const orientation = options.page.landscape ? ' landscape' : ''
    rules.push(
      `@media print{@page{size:${size}${orientation};` +
      `margin:${String(top)}mm ` +
      `${String(right)}mm ${String(bottom)}mm ${String(left)}mm;}` +
      'h1,h2,h3,h4,h5,h6{break-after:avoid;break-inside:avoid;}}'
    )
  }
  if (!options.showFrontMatter) {
    rules.push('pre.front-matter{display:none!important;}')
  }
  if (options.autoNumberHeadings) rules.push(AUTO_NUMBER_CSS)
  rules.push(HEADER_FOOTER_CSS)
  rules.push(safeThemeCss(themeCss))
  if (options.typography !== null) {
    const fontFamily = options.typography.fontFamily === null
      ? ''
      : `font-family:${cssString(options.typography.fontFamily)},` +
        'system-ui,sans-serif;'
    rules.push(
      '.markdown-body,.hf-container{' +
      fontFamily +
      `font-size:${String(options.typography.fontSizePx)}px;` +
      `line-height:${String(options.typography.lineHeight)};}`
    )
  }
  if (options.headerFooterAppearance !== null) {
    rules.push(
      `.hf-container{font-size:${
        String(options.headerFooterAppearance.fontSizePx)
      }px;}`
    )
  }
  return rules.join('')
}

function pdfPageOptions(
  options: DocumentCoreExportOptions
): DocumentCorePdfPageOptions {
  const size = options.page.size
  return Object.freeze({
    landscape: options.page.landscape,
    pageSize: size.kind === 'named'
      ? size.name
      : Object.freeze({
        width: size.widthMm * 1_000,
        height: size.heightMm * 1_000
      })
  })
}

function decorateBody(
  html: string,
  options: DocumentCoreExportOptions
): string {
  const bodyOpen = '<body>'
  const bodyClose = '</body>'
  const bodyStart = html.indexOf(bodyOpen)
  const bodyEnd = html.lastIndexOf(bodyClose)
  if (bodyStart < 0 || bodyEnd < bodyStart + bodyOpen.length) {
    throw new TypeError('Authenticated export HTML has no body')
  }
  const article = html.slice(bodyStart + bodyOpen.length, bodyEnd)
  const drawRules =
    options.headerFooterAppearance?.drawRules ?? false
  const header = options.header === null
    ? ''
    : headerFooterHtml('header', options.header, drawRules)
  const footer = options.footer === null
    ? ''
    : headerFooterHtml('footer', options.footer, drawRules)
  const body = `${header}<article class="markdown-body">${
    article
  }</article>${footer}`
  return html.slice(0, bodyStart) +
    `<body>${body}</body>` +
    html.slice(bodyEnd + bodyClose.length)
}

export function createDocumentCoreExportDecorator(
  themes: DocumentCoreExportThemeSource
): DocumentCoreExportDecorator {
  return Object.freeze({
    decorate: async(
      html: string,
      consumer: DocumentCoreExportConsumer,
      options: DocumentCoreExportOptions
    ): Promise<DocumentCoreDecoratedExport> => {
      const themeCss = await themes.cssFor(options.theme)
      let decorated = decorateBody(html, options)
      const head = `<title>${escapeHtml(options.title)}</title>` +
        `<style data-marktext-export-options>${
          optionCss(consumer, options, themeCss)
        }</style>`
      const headEnd = decorated.indexOf('</head>')
      if (headEnd < 0) {
        throw new TypeError('Authenticated export HTML has no head')
      }
      decorated = decorated.slice(0, headEnd) +
        `${head}</head>` +
        decorated.slice(headEnd + '</head>'.length)
      return Object.freeze({
        html: decorated,
        ...(consumer !== 'styled-html'
          ? { pdfPageOptions: pdfPageOptions(options) }
          : {})
      })
    }
  })
}
