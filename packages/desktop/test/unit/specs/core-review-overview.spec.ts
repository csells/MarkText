import { expect, it } from 'vitest'
import { createEditorCoreBinding } from '../../../src/renderer/src/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '../../../src/renderer/src/documentAuthority/coreDocumentSessionManager'
import { createCoreActor } from '../../../src/renderer/src/documentAuthority/coreActor'
import type { CoreReviewItemReply } from '../../../src/renderer/src/documentAuthority/coreProtocol'

it('exposes visible review comments from their owning Core scope without promoting nested comment drafts', () => {
  const source = '{==Passage==}{>>First **note**.<<}\n\nTail.{>>Outer {>>nested<<}.<<}\n'
  const actor = createCoreActor()
  try {
    const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
    expect(opened.type).toBe('opened')
    const reply = actor.handle({
      type: 'review-item-at-barrier',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0,
      includeOverview: true
    }) as CoreReviewItemReply
    expect(reply.overview?.map(entry => entry.item.kind)).toEqual(['commented-span', 'comment'])
    expect(reply.overview?.map(entry => entry.commentText)).toEqual(['First **note**.', 'Outer {>>nested<<}.'])
    expect(reply.overview?.every(entry => entry.commentProjection !== undefined)).toBe(true)
    expect(actor.handle({
      type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: opened.revision
    })).toMatchObject({ source, revision: opened.revision })
  } finally { actor.dispose() }
})

it('carries the overview through the document view lease without bypassing its ownership', async() => {
  const sessions = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: async request => structuredClone(actor.handle(request)),
        dispose: () => actor.dispose()
      })
    }
  })
  const source = '{==Passage==}{>>Margin comment.<<}\n'
  await sessions.open({ documentId: 'margin', source, lineEnding: '\n' })
  const lease = sessions.lease('margin')
  try {
    const reply = await lease.binding.reviewItemAtBarrier('next', 0, true)
    expect(reply.type).toBe('review-item')
    if (reply.type !== 'review-item') throw new Error('Review read was rejected')
    expect(reply.overview?.map(entry => entry.commentText)).toEqual(['Margin comment.'])
    expect((await sessions.saveBarrier('margin')).source).toBe(source)
  } finally {
    await sessions.handoff(lease)
    await sessions.close('margin')
  }
})

it('provides source-owned excerpts for every suggestion and standalone highlight in the sidebar', () => {
  const actor = createCoreActor()
  const source = '{++New++} {--Old--} {~~Before~>After~~} {==Important==}\n'
  try {
    const opened = actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const reply = actor.handle({
      type: 'review-item-at-barrier',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0,
      includeOverview: true
    }) as CoreReviewItemReply
    expect(reply.overview?.map(entry => ({
      kind: entry.item.kind, text: entry.text, replacementText: entry.replacementText
    }))).toEqual([
      { kind: 'addition', text: 'New', replacementText: undefined },
      { kind: 'deletion', text: 'Old', replacementText: undefined },
      { kind: 'substitution', text: 'Before', replacementText: 'After' },
      { kind: 'highlight', text: 'Important', replacementText: undefined }
    ])
    expect(actor.handle({
      type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: opened.revision
    })).toMatchObject({ source, revision: opened.revision })
  } finally { actor.dispose() }
})
