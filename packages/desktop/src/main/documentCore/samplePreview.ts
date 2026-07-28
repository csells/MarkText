import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml
} from '@marktext/document-core'
import type { ParseConfiguration } from '@marktext/document-core'

const MAXIMUM_SAMPLE_UNITS = 64 * 1024

const previewEngine = createLanguageEngine()

/**
 * Renders inert sample text — the Preferences theme sample — through the
 * production grammar under the caller's shipping configuration. This owns no
 * document: it holds no session, publishes no revision, and its result is
 * display HTML with raw HTML escaped and unsafe URLs dropped.
 */
export function renderSamplePreviewHtml(
  markdown: string,
  configuration: ParseConfiguration
): string {
  if (typeof markdown !== 'string') {
    throw new TypeError('Sample preview requires exact source text')
  }
  if (markdown.length > MAXIMUM_SAMPLE_UNITS) {
    throw new RangeError('Sample preview source exceeds its bound')
  }
  const revision = previewEngine.open(
    createSourceSnapshot(markdown),
    configuration
  )
  if (revision.kind !== 'complete') {
    throw new Error(
      `Sample preview is unavailable: ${revision.fatalDiagnostic.code}`
    )
  }
  const html = renderMarkdownHtml(revision.projection('revised').markdown, {
    rawHtml: 'escape',
    unsafeUrls: 'drop'
  })
  return `<article class="markdown-body">${html}</article>`
}
