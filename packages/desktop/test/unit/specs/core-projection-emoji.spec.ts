import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'
import { exportStyledHTMLFromProjection } from '@/util/exportHtml'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('presents parser-owned emoji consistently in reader views, comments and exported HTML', async() => {
  const source =
    'Plain :smile: {++:smile:++} `:smile:` \\:smile: word:smile: :unknown:.\n\n{>>Note :smile: {++:smile:++} `:smile:`.<<}\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const original = core.project(revision, 'original')
  const revised = core.project(revision, 'revised')
  const host = document.createElement('div')
  host.innerHTML = renderMarkdownProjectionToSafeHtml(original)
  expect(host.textContent).toBe('Plain 😄  :smile: :smile: word:smile: :unknown:.\n')
  host.innerHTML = renderMarkdownProjectionToSafeHtml(revised)
  expect(host.textContent).toBe('Plain 😄 😄 :smile: :smile: word:smile: :unknown:.\n')
  expect(host.querySelector('code')?.textContent).toBe(':smile:')
  const comment = revision.annotations.find((annotation) => annotation.kind === 'comment')!
  host.innerHTML = renderMarkdownProjectionToSafeHtml(core.projectComment(revision, comment))
  expect(host.textContent).toBe('Note 😄 😄 :smile:.\n')
  const app = bootBoundMuya(source)
  try {
    const exported = new DOMParser().parseFromString(
      await exportStyledHTMLFromProjection(app.muya, revised),
      'text/html'
    )
    expect(exported.querySelector('article')?.textContent?.trim()).toBe(
      'Plain 😄 😄 :smile: :smile: word:smile: :unknown:.'
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
  expect(revision.source).toBe(source)
})
