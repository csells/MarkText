import { describe, expect, it } from 'vitest'

import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

const createSessions = () => createCoreDocumentSessionManager({
  createBinding: () => {
    const actor = createCoreActor()
    return createEditorCoreBinding({
      request: async request => structuredClone(actor.handle(request)),
      dispose: () => {}
    })
  }
})

describe('Core read-only display projections', () => {
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
    const payload = '## Local\n\n**bold** [outer][ref] {~~old~>new~~}\n\n[local]: https://local.test\n'
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
    const pending = new Promise<void>(resolve => { release = resolve })
    lease.settleView(() => pending)
    let completed = false
    const reading = lease.displayProjectionAtBarrier('revised').then(projection => {
      completed = true
      return projection
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    await lease.binding.submit({ edits: [{ start: 5, end: 5, insert: ' second' }], projections: [] }).acknowledged
    release?.()
    expect(renderMarkdownProjectionToSafeHtml(await reading)).toBe('<p>first second</p>\n')
    await sessions.handoff(lease)
    await expect(lease.displayProjectionAtBarrier('original')).rejects.toThrow('released')
    await sessions.close('pending')
  })

  it('refuses a delayed display projection after its acknowledged revision changes', async() => {
    let release: (() => void) | undefined
    let requested: (() => void) | undefined
    const observedRequest = new Promise<void>(resolve => { requested = resolve })
    const sessions = createCoreDocumentSessionManager({
      createBinding: () => {
        const actor = createCoreActor()
        return createEditorCoreBinding({
          request: async request => {
            const reply = structuredClone(actor.handle(request))
            if (request.type === 'display-projection-at-barrier') {
              requested?.()
              await new Promise<void>(resolve => { release = resolve })
            }
            return reply
          },
          dispose: () => {}
        })
      }
    })
    await sessions.open({ documentId: 'race', source: 'old', lineEnding: '\n' })
    const lease = sessions.lease('race')
    const reading = lease.displayProjectionAtBarrier('original')
    const rejected = expect(reading).rejects.toThrow('stale')
    await observedRequest
    await lease.binding.submit({ edits: [{ start: 0, end: 3, insert: 'new' }], projections: [] }).acknowledged
    release?.()
    await rejected
    expect((await sessions.saveBarrier('race')).source).toBe('new')
    await sessions.handoff(lease)
    await sessions.close('race')
  })
})
