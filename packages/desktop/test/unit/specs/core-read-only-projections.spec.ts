import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

const createSessions = () =>
  createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: (request) => structuredClone(actor.handle(request)),
        dispose: () => {}
      })
    }
  })

describe('Core read-only display projections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('honors disabled HTML presentation without changing ordinary Markdown semantics', async() => {
    const sessions = createSessions()
    await sessions.open({ documentId: 'html', source: '**Bold** <b>raw</b>\n', lineEnding: '\n' })
    const lease = sessions.lease('html')
    const projection = await lease.displayProjectionAtBarrier('revised')
    const host = document.createElement('div')
    host.innerHTML = renderMarkdownProjectionToSafeHtml(projection, { htmlEnabled: false })
    expect(host.querySelector('strong')?.textContent).toBe('Bold')
    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toContain('<b>raw</b>')
    await sessions.handoff(lease)
    await sessions.close('html')
  })

  it('uses MarkText code highlighting without interpreting code contents as Markdown or HTML', async() => {
    const sessions = createSessions()
    const source = '```js\nconst answer = "<script>{++literal++}</script>"\n```\n'
    await sessions.open({ documentId: 'code', source, lineEnding: '\n' })
    const lease = sessions.lease('code')
    const host = document.createElement('div')
    host.innerHTML = renderMarkdownProjectionToSafeHtml(
      await lease.displayProjectionAtBarrier('revised')
    )
    expect(host.querySelector('code .token.keyword')?.textContent).toBe('const')
    expect(host.querySelector('code')?.textContent).toBe(
      'const answer = "<script>{++literal++}</script>"\n'
    )
    expect(host.querySelector('script')).toBeNull()
    await sessions.handoff(lease)
    await sessions.close('code')
  })

  it('renders existing math and local images from Core semantics in both reader views', async() => {
    vi.stubGlobal('DIRNAME', '/documents/review')
    vi.stubGlobal('path', { join: (...parts: string[]) => parts.join('/') })
    const sessions = createSessions()
    const source = '![Local](assets/figure.png)\n\n$x^2$ and {~~old~>new~~}.\n'
    await sessions.open({ documentId: 'media', source, lineEnding: '\n' })
    const lease = sessions.lease('media')
    for (const mode of ['original', 'revised'] as const) {
      const html = renderMarkdownProjectionToSafeHtml(await lease.displayProjectionAtBarrier(mode))
      const host = document.createElement('div')
      host.innerHTML = html
      expect(host.querySelector('img')?.getAttribute('src')).toBe(
        'file:///documents/review/assets/figure.png'
      )
      expect(host.querySelector('.katex .mord')).not.toBeNull()
      expect(host.querySelector('.katex .msupsub')).not.toBeNull()
      expect(host.textContent).toContain(mode === 'original' ? 'old' : 'new')
    }
    expect((await sessions.saveBarrier('media')).source).toBe(source)
    await sessions.handoff(lease)
    await sessions.close('media')
  })

  it('resolves raw HTML and Markdown image destinations through the same document resource policy', async() => {
    vi.stubGlobal('DIRNAME', '/documents/review')
    vi.stubGlobal('path', { join: (...parts: string[]) => parts.join('/') })
    const sessions = createSessions()
    const source = '<img src="assets/raw.png" alt="raw">\n\n![Markdown](assets/markdown.png)\n'
    await sessions.open({ documentId: 'raw-media', source, lineEnding: '\n' })
    const lease = sessions.lease('raw-media')
    for (const mode of ['original', 'revised'] as const) {
      const host = document.createElement('div')
      host.innerHTML = renderMarkdownProjectionToSafeHtml(
        await lease.displayProjectionAtBarrier(mode)
      )
      expect([...host.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
        'file:///documents/review/assets/raw.png',
        'file:///documents/review/assets/markdown.png'
      ])
    }
    expect((await sessions.saveBarrier('raw-media')).source).toBe(source)
    await sessions.handoff(lease)
    await sessions.close('raw-media')
  })

  it('reads Original and Revised from acknowledged source without changing save or consumer authority', async() => {
    const sessions = createSessions()
    const source = 'A {++new++} {--old--} {~~before~>after~~} {>>private<<}'
    await sessions.open({ documentId: 'review', source, lineEnding: '\n' })
    const lease = sessions.lease('review')
    const original = await lease.displayProjectionAtBarrier('original')
    const revised = await lease.displayProjectionAtBarrier('revised')

    expect(original.name).toBe('original')
    expect(renderMarkdownProjectionToSafeHtml(original)).toBe('<p>A  old before</p>\n')
    expect(renderMarkdownProjectionToSafeHtml(revised)).toBe('<p>A new  after</p>\n')
    expect((await lease.consumerProjectionAtBarrier()).name).toBe('revised')
    expect((await sessions.saveBarrier('review')).source).toBe(source)
    expect(lease.identity.revision).toBe(1)
    await sessions.handoff(lease)
    await sessions.close('review')
  })

  it('publishes isolated Markdown Comment presentation while retaining its exact editable payload', async() => {
    const sessions = createSessions()
    const payload =
      '## Local\n\n**bold** [outer][ref] {~~old~>new~~}\n\n[local]: https://local.test\n'
    const source = `[ref]: https://outer.test\n\n{>>${payload}<<}`
    await sessions.open({
      documentId: 'comment',
      source,
      lineEnding: '\n'
    })
    const lease = sessions.lease('comment')
    const review = await lease.binding.reviewItemAtBarrier('next', source.indexOf('[local]'))
    expect(review.type).toBe('review-item')
    if (review.type !== 'review-item') throw new Error('Comment review was rejected')
    expect(review.commentText).toBe(payload)
    expect(review.commentProjection).toBeDefined()
    if (review.commentProjection === undefined) throw new Error('Comment presentation is absent')
    const html = renderMarkdownProjectionToSafeHtml(review.commentProjection)
    expect(html).toContain('<h2 id="local">Local</h2>')
    expect(html).toContain('<strong>bold</strong> [outer][ref] new')
    expect(html).not.toContain('https://outer.test')
    expect(html).not.toContain(' old')
    await sessions.handoff(lease)
    await sessions.close('comment')
  })

  it('waits for pending native input before publishing a read-only projection', async() => {
    const sessions = createSessions()
    await sessions.open({ documentId: 'pending', source: 'first', lineEnding: '\n' })
    const lease = sessions.lease('pending')
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    lease.settleView(() => pending)
    let completed = false
    const reading = lease.displayProjectionAtBarrier('revised').then((projection) => {
      completed = true
      return projection
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    await lease.binding.submit({
      edits: [{ start: 5, end: 5, insert: ' second' }],
      projections: []
    }).acknowledged
    release?.()
    expect(renderMarkdownProjectionToSafeHtml(await reading)).toBe('<p>first second</p>\n')
    await sessions.handoff(lease)
    await expect(lease.displayProjectionAtBarrier('original')).rejects.toThrow('released')
    await sessions.close('pending')
  })

  it('refuses a stale owner display projection after its acknowledged revision changes', async() => {
    const actor = createCoreActor()
    let previous: ReturnType<typeof actor.handle> | undefined
    const sessions = createCoreDocumentSessionManager({
      createBinding: () =>
        createEditorCoreBinding({
          request(request) {
            const reply = structuredClone(actor.handle(request))
            if (request.type !== 'display-projection-at-barrier') return reply
            const result = previous ?? reply
            previous ??= reply
            return result
          },
          dispose: () => actor.dispose()
        })
    })
    sessions.open({ documentId: 'race', source: 'old', lineEnding: '\n' })
    const lease = sessions.lease('race')
    await lease.displayProjectionAtBarrier('original')
    lease.binding.submit({ edits: [{ start: 0, end: 3, insert: 'new' }], projections: [] })
    await expect(lease.displayProjectionAtBarrier('original')).rejects.toThrow('stale')
    expect((await sessions.saveBarrier('race')).source).toBe('new')
    await sessions.handoff(lease)
    await sessions.close('race')
  })
})
