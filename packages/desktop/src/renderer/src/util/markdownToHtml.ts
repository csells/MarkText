import { createDocumentCore } from '@marktext/document-core'
import { renderProjectedDocumentHtml } from '@/documentConsumers/documentProjectionConsumers'

/**
 * HTML for a fixed Markdown sample, such as the theme previews', read by the
 * document core as any document is and rendered as its exports are.
 */
const markdownToHtml = async(markdown: string): Promise<string> => {
  const core = createDocumentCore()
  const projection = core.project(core.open(markdown), 'revised')
  return `<article class="markdown-body">${renderProjectedDocumentHtml(projection)}</article>`
}

export default markdownToHtml
