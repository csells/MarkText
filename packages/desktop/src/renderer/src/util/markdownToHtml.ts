import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml,
  type ParseConfiguration
} from '@marktext/document-core'

const PREVIEW_CONFIGURATION: ParseConfiguration = Object.freeze({
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

const languageEngine = createLanguageEngine()

/** Render the inert Preferences theme sample through the production grammar. */
const markdownToHtml = async(markdown: string): Promise<string> => {
  const revision = languageEngine.open(
    createSourceSnapshot(markdown),
    PREVIEW_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(
      `Theme preview is unavailable: ${revision.fatalDiagnostic.code}`
    )
  }
  const html = renderMarkdownHtml(
    revision.projection('revised').markdown,
    { rawHtml: 'escape', unsafeUrls: 'drop' }
  )
  return `<article class="markdown-body">${html}</article>`
}

export default markdownToHtml
