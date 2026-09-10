import { describe, expect, it } from 'vitest'

import {
  createCoreActor,
  createCoreDocumentSessionManager,
  createEditorCoreBinding,
  type CoreModelOwner,
  type CoreReply,
  type CoreRequest
} from '@/documentAuthority'

describe('Core actor Markup WYSIWYG barrier', () => {
  it('edits a visible selection across hidden annotation syntax atomically', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => structuredClone(actor.handle(request)),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'markup.md', source: 'a{++bc++}d\n' })
    const outcome = await binding.submit({
      kind: 'markup-edits',
      edits: [{ start: 5, end: 10, insert: '' }],
      projections: []
    }).acknowledged
    expect(outcome.type).toBe('applied')
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'a{++b++}\n' })
    await binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'a{++bc++}d\n' })
  })
  it('exposes the view through the production binding barrier', async() => {
    const actor = createCoreActor()
    const port: CoreModelOwner = {
      request(request: CoreRequest): CoreReply {
        return structuredClone(actor.handle(structuredClone(request)))
      },
      dispose(): void {
        actor.dispose()
      }
    }
    const binding = createEditorCoreBinding(port)
    await binding.open({
      documentId: 'plain.md',
      source: 'head\n\nmiddle\n\ntail\n'
    })

    await expect(binding.plainTextViewAtBarrier()).toMatchObject({
      type: 'plain-text-view',
      revision: 1,
      view: {
        kind: 'view',
        bindings: [
          {},
          { path: [1, 'text'], sourceRange: { start: 6, end: 12 }, text: 'middle' },
          {}
        ]
      }
    })
  })

  it('returns one detached actor-owned view map without renderer parsing', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 11,
      sequence: 1,
      source: 'head\n\nmiddle\n\ntail\n'
    })

    const reply = actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 11,
      sequence: 2,
      baseRevision: 1
    })

    expect(reply).toMatchObject({
      type: 'plain-text-view',
      session: 11,
      sequence: 2,
      revision: 1,
      accepted: true,
      sourceLength: 19,
      source: 'head\n\nmiddle\n\ntail\n',
      view: {
        kind: 'view',
        markdown: 'head\n\nmiddle\n\ntail\n',
        state: [
          { name: 'paragraph', text: 'head' },
          { name: 'paragraph', text: 'middle' },
          { name: 'paragraph', text: 'tail' }
        ],
        decorations: [],
        comments: [],
        bindings: [
          { path: [0, 'text'], sourceRange: { start: 0, end: 4 }, text: 'head' },
          {
            path: [1, 'text'],
            sourceRange: { start: 6, end: 12 },
            text: 'middle',
            segments: [
              {
                text: { start: 0, end: 6 },
                source: { start: 6, end: 12 },
                syntax: { start: 6, end: 12 }
              }
            ],
            syntax: { kind: 'paragraph', range: { start: 6, end: 12 } }
          },
          { path: [2, 'text'], sourceRange: { start: 14, end: 18 }, text: 'tail' }
        ]
      }
    })
    expect(structuredClone(reply)).toEqual(reply)
  })

  it('drains the live view before the manager requests its projection', async() => {
    const actor = createCoreActor()
    const manager = createCoreDocumentSessionManager({
      createBinding: () =>
        createEditorCoreBinding({
          request(request: CoreRequest): CoreReply {
            return structuredClone(actor.handle(structuredClone(request)))
          },
          dispose(): void {
            actor.dispose()
          }
        })
    })
    await manager.open({
      documentId: 'managed.md',
      source: 'head\n\nmiddle\n\ntail\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('managed.md')
    const order: string[] = []
    lease.settleView(async() => {
      order.push('settled')
    })

    const result = await manager.plainTextViewBarrier('managed.md')

    order.push('projected')
    expect(order).toEqual(['settled', 'projected'])
    expect(result).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view' }
    })
  })

  it('projects an acknowledged history revision without re-entering its view barrier', async() => {
    const actor = createCoreActor()
    const manager = createCoreDocumentSessionManager({
      createBinding: () =>
        createEditorCoreBinding({
          request(request: CoreRequest): CoreReply {
            return structuredClone(actor.handle(structuredClone(request)))
          },
          dispose(): void {
            actor.dispose()
          }
        })
    })
    await manager.open({
      documentId: 'history.md',
      source: 'seed\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('history.md')
    lease.settleView(() =>
      Promise.reject(new Error('history projection must not re-enter its own settlement'))
    )
    const edited = await lease.binding.submit({
      edits: [{ start: 4, end: 4, insert: '!' }],
      projections: []
    }).acknowledged
    expect(edited).toMatchObject({ type: 'applied', revision: 2 })
    const undone = await lease.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged
    expect(undone).toMatchObject({ type: 'applied', revision: 3 })

    await expect(lease.projectAcknowledgedPlainTextView(3)).toMatchObject({
      type: 'plain-text-view',
      revision: 3,
      source: 'seed\n',
      view: { kind: 'view', markdown: 'seed\n' }
    })
  })

  it('returns a source-mapped heading for structural Markdown editing', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 12,
      sequence: 1,
      source: '# heading\n'
    })

    const reply = actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 12,
      sequence: 2,
      baseRevision: 1
    })

    expect(reply).toMatchObject({
      type: 'plain-text-view',
      revision: 1,
      accepted: true,
      source: '# heading\n',
      view: {
        kind: 'view',
        markdown: '# heading\n',
        state: [{ name: 'atx-heading', text: '# heading', meta: { level: 1 } }],
        bindings: [
          {
            path: [0, 'text'],
            text: '# heading',
            sourceRange: { start: 0, end: 9 },
            segments: [
              {
                text: { start: 0, end: 9 },
                source: { start: 0, end: 9 },
                syntax: { start: 0, end: 9 }
              }
            ],
            syntax: {
              kind: 'heading',
              range: { start: 0, end: 9 },
              attributes: { level: 1 },
              children: [
                {
                  kind: 'text',
                  range: { start: 2, end: 9 },
                  attributes: { semanticText: 'heading' }
                }
              ]
            }
          }
        ]
      }
    })
    if (reply.type !== 'plain-text-view' || reply.view.kind !== 'view') {
      throw new Error('Expected a mapped heading view')
    }
    expect(reply.view.bindings[0]?.editable).not.toBe(false)
    expect(
      actor.handle({
        type: 'source-at-barrier',
        session: 12,
        sequence: 3,
        baseRevision: 1
      })
    ).toMatchObject({
      type: 'source',
      revision: 1,
      source: '# heading\n'
    })
  })
})
