import { describe, expect, it } from 'vitest'

import {
  createCoreActor,
  createCoreConsumerProjectionRegistry,
  createCoreDocumentSessionManager,
  createEditorCoreBinding,
  type CoreActorPort,
  type CoreReply,
  type CoreRequest
} from '@/documentAuthority'
import {
  createProjectedSearchReplacementPlan,
  searchProjectedDocument
} from '@/documentConsumers/documentProjectionConsumers'

const inMemoryPort = (): CoreActorPort => {
  const actor = createCoreActor()
  return {
    async request(request: CoreRequest): Promise<CoreReply> {
      return structuredClone(actor.handle(structuredClone(request)))
    },
    dispose(): void { actor.dispose() }
  }
}

describe('Core consumer projection authority', () => {
  it('transports one detached Revised AST without canonical source', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 41,
      sequence: 1,
      source: 'Keep {~~legacy~>current~~} {--gone--} {++fresh++}. {>>note<<}\n'
    })

    const reply = actor.handle({
      type: 'consumer-projection-at-barrier',
      session: 41,
      sequence: 2,
      baseRevision: 1
    })

    expect(reply).toMatchObject({
      type: 'consumer-projection',
      session: 41,
      revision: 1,
      projection: {
        kind: 'markdown-consumer-projection',
        name: 'revised',
        markdown: 'Keep current  fresh. \n',
        ast: { root: { kind: 'document' } }
      }
    })
    expect(reply).not.toHaveProperty('source')
    expect(structuredClone(reply)).toEqual(reply)
  })

  it('transports one selection-scoped Revised projection from canonical coordinates', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 42,
      sequence: 1,
      source: 'before {~~old~>**new**~~} {--gone--} after\n'
    })

    const reply = actor.handle({
      type: 'selection-projection-at-barrier',
      session: 42,
      sequence: 2,
      baseRevision: 1,
      range: { start: 7, end: 25 }
    })

    expect(reply).toMatchObject({
      type: 'selection-projection',
      session: 42,
      revision: 1,
      projection: {
        kind: 'markdown-consumer-projection',
        name: 'revised',
        markdown: '**new**',
        ast: {
          root: {
            kind: 'document',
            range: { start: 0, end: 7 },
            children: [{
              kind: 'paragraph',
              children: [{ kind: 'strong' }]
            }]
          }
        }
      }
    })
    expect(reply).not.toHaveProperty('source')
    expect(structuredClone(reply)).toEqual(reply)
    actor.dispose()
  })

  it('does not re-recognize a selected fragment outside its document context', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 43,
      sequence: 1,
      source: 'lead # copied\n'
    })

    const reply = actor.handle({
      type: 'selection-projection-at-barrier',
      session: 43,
      sequence: 2,
      baseRevision: 1,
      range: { start: 5, end: 13 }
    })

    expect(reply).toMatchObject({
      type: 'selection-projection',
      projection: {
        markdown: '# copied',
        ast: {
          root: {
            children: [{
              kind: 'paragraph',
              children: [{
                kind: 'text',
                attributes: { semanticText: '# copied' }
              }]
            }]
          }
        }
      }
    })
    actor.dispose()
  })

  it('transports one selection projection through the acknowledged editor binding', async() => {
    const binding = createEditorCoreBinding(inMemoryPort())
    await expect(binding.open({
      documentId: 'selection.md',
      source: 'before {++**new**++} after\n'
    })).resolves.toMatchObject({ type: 'opened', revision: 1 })

    await expect(binding.selectionProjectionAtBarrier({
      start: 7,
      end: 20
    })).resolves.toMatchObject({
      type: 'selection-projection',
      revision: 1,
      projection: {
        markdown: '**new**',
        ast: { root: { kind: 'document' } }
      }
    })
    binding.dispose()
  })

  it('replaces one exact semantic search match through the actor authority', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 44,
      sequence: 1,
      source: 'first cat and cat\n'
    })

    const outcome = actor.handle({
      type: 'replace-consumer-search',
      session: 44,
      sequence: 2,
      baseRevision: 1,
      replacements: [{
        match: { path: [0], start: 6, end: 9, match: 'cat' },
        insert: 'dog'
      }],
      projections: []
    })

    expect(outcome).toMatchObject({
      type: 'applied',
      revision: 2,
      sourceLength: 18
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 44,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ source: 'first dog and cat\n' })
    actor.dispose()
  })

  it('submits an exact consumer search replacement through the editor binding', async() => {
    const binding = createEditorCoreBinding(inMemoryPort())
    await binding.open({ documentId: 'replace.md', source: 'cat cat\n' })

    await expect(binding.submit({
      kind: 'replace-consumer-search',
      authoredRevision: 1,
      replacements: [{
        match: { path: [0], start: 0, end: 3, match: 'cat' },
        insert: 'dog'
      }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      source: 'dog cat\n'
    })
    binding.dispose()
  })

  it('publishes only identity-matched snapshots and retires them explicitly', () => {
    const actor = createCoreActor()
    actor.handle({ type: 'open', session: 7, sequence: 1, source: 'alpha\n' })
    const reply = actor.handle({
      type: 'consumer-projection-at-barrier',
      session: 7,
      sequence: 2,
      baseRevision: 1
    })
    if (reply.type !== 'consumer-projection') throw new Error('Expected projection')
    const registry = createCoreConsumerProjectionRegistry()

    registry.publish('doc.md', { generation: 7, revision: 1 }, reply.projection)

    expect(registry.read('doc.md', { generation: 7, revision: 1 }))
      .toBe(reply.projection)
    expect(registry.read('doc.md', { generation: 7, revision: 2 })).toBeUndefined()
    expect(registry.read('doc.md', { generation: 8, revision: 1 })).toBeUndefined()
    registry.retire('doc.md')
    expect(registry.read('doc.md', { generation: 7, revision: 1 })).toBeUndefined()
  })

  it('invalidates the synchronous lease view on edit until a fresh barrier publishes', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({ documentId: 'doc.md', source: 'alpha\n', lineEnding: '\n' })
    const lease = manager.lease('doc.md')

    expect(lease.consumerProjection()).toBeUndefined()
    await expect(lease.consumerProjectionAtBarrier()).resolves.toMatchObject({
      markdown: 'alpha\n'
    })
    expect(lease.consumerProjection()?.markdown).toBe('alpha\n')

    const applied = await lease.binding.submit({
      edits: [{ start: 0, end: 5, insert: 'beta' }],
      projections: []
    }).acknowledged
    expect(applied).toMatchObject({ type: 'applied', revision: 2 })
    expect(lease.consumerProjection()).toBeUndefined()

    await expect(lease.consumerProjectionAtBarrier()).resolves.toMatchObject({
      markdown: 'beta\n'
    })
    expect(lease.consumerProjection()?.markdown).toBe('beta\n')
  })

  it('leases a selection projection without replacing the document projection cache', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({
      documentId: 'selection-lease.md',
      source: 'before {++**new**++} after\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('selection-lease.md')
    await expect(lease.consumerProjectionAtBarrier()).resolves.toMatchObject({
      markdown: 'before **new** after\n'
    })

    await expect(lease.selectionProjectionAtBarrier({
      start: 7,
      end: 20
    })).resolves.toMatchObject({
      markdown: '**new**',
      ast: { root: { kind: 'document' } }
    })
    expect(lease.consumerProjection()?.markdown).toBe('before **new** after\n')

    await manager.handoff(lease)
    await manager.close('selection-lease.md')
  })

  it('replaces a match only for the exact settled lease projection identity', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({
      documentId: 'replace-lease.md',
      source: 'cat cat\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('replace-lease.md')
    await lease.consumerProjectionAtBarrier()
    const searchedIdentity = { ...lease.identity }

    await expect(lease.replaceConsumerSearchAtBarrier(searchedIdentity, [{
      match: { path: [0], start: 0, end: 3, match: 'cat' },
      insert: 'dog'
    }])).resolves.toMatchObject({ type: 'applied', revision: 2 })
    expect(lease.consumerProjection()).toBeUndefined()
    await expect(manager.saveBarrier('replace-lease.md')).resolves.toMatchObject({
      source: 'dog cat\n',
      identity: { revision: 2 }
    })

    await expect(lease.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(manager.saveBarrier('replace-lease.md')).resolves.toMatchObject({
      source: 'cat cat\n'
    })
    await manager.handoff(lease)
    await manager.close('replace-lease.md')
  })

  it('atomically replaces all exact matches planned from one barrier projection', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({
      documentId: 'replace-all.md',
      source: 'cat-12 cat-34\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('replace-all.md')
    const projection = await lease.consumerProjectionAtBarrier()
    const identity = { ...lease.identity }
    const result = searchProjectedDocument(projection, '(cat)-(\\d+)', {
      isRegexp: true
    })
    const replacements = createProjectedSearchReplacementPlan(
      result,
      '$2:$1',
      { isSingle: false, isRegexp: true }
    )
    if (replacements === undefined) throw new Error('Expected replacement plan')

    await expect(lease.replaceConsumerSearchAtBarrier(identity, replacements))
      .resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(manager.saveBarrier('replace-all.md')).resolves.toMatchObject({
      source: '12:cat 34:cat\n'
    })
    await manager.handoff(lease)
    await manager.close('replace-all.md')
  })

  it('maps raw-equivalent formatted and Revised-arm text without replacing syntax', () => {
    const actor = createCoreActor()
    actor.handle({
      type: 'open',
      session: 45,
      sequence: 1,
      source: '**cat** and {~~old~>cat~~}\n'
    })
    const projectionReply = actor.handle({
      type: 'consumer-projection-at-barrier',
      session: 45,
      sequence: 2,
      baseRevision: 1
    })
    if (projectionReply.type !== 'consumer-projection') {
      throw new Error('Expected consumer projection')
    }
    const result = searchProjectedDocument(projectionReply.projection, 'cat')
    const replacements = createProjectedSearchReplacementPlan(
      result,
      'dog',
      { isSingle: false, isRegexp: false }
    )
    if (replacements === undefined) throw new Error('Expected replacement plan')

    expect(actor.handle({
      type: 'replace-consumer-search',
      session: 45,
      sequence: 3,
      baseRevision: 1,
      replacements,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 2 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 45,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({ source: '**dog** and {~~old~>dog~~}\n' })
    actor.dispose()
  })

  it('rejects stale and structurally unsupported match identities nonterminally', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({
      documentId: 'replace-reject.md',
      source: '**cat** dog\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('replace-reject.md')
    const projection = await lease.consumerProjectionAtBarrier()
    const identity = { ...lease.identity }
    const crossing = searchProjectedDocument(projection, 'cat dog')
    const unsupported = createProjectedSearchReplacementPlan(
      crossing,
      'pet',
      { isSingle: true, isRegexp: false }
    )
    if (unsupported === undefined) throw new Error('Expected unsupported plan')
    await expect(lease.replaceConsumerSearchAtBarrier(identity, unsupported))
      .resolves.toMatchObject({
        type: 'rejected',
        reason: 'consumer-search-match-invalid',
        revision: 1
      })
    await expect(manager.saveBarrier('replace-reject.md')).resolves.toMatchObject({
      source: '**cat** dog\n',
      identity: { revision: 1 }
    })

    await expect(lease.binding.submit({
      edits: [{ start: 11, end: 11, insert: '!' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(lease.replaceConsumerSearchAtBarrier(identity, [{
      match: { path: [0], start: 0, end: 3, match: 'cat' },
      insert: 'fox'
    }])).resolves.toMatchObject({
      type: 'rejected',
      reason: 'stale-base',
      revision: 2
    })
    await expect(manager.saveBarrier('replace-reject.md')).resolves.toMatchObject({
      source: '**cat** dog!\n',
      identity: { revision: 2 }
    })
    await manager.handoff(lease)
    await manager.close('replace-reject.md')
  })

  it('replays an acknowledged search replacement with undo after recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(inMemoryPort())
    })
    await manager.open({
      documentId: 'replace-recover.md',
      source: 'cat\n',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('replace-recover.md')
    await oldLease.consumerProjectionAtBarrier()
    await expect(oldLease.replaceConsumerSearchAtBarrier(
      { ...oldLease.identity },
      [{
        match: { path: [0], start: 0, end: 3, match: 'cat' },
        insert: 'dog'
      }]
    )).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('replace presentation requires recovery'))
    const replacement = await manager.recover(oldLease)
    await expect(manager.saveBarrier('replace-recover.md')).resolves.toMatchObject({
      source: 'dog\n',
      identity: { revision: 2 }
    })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(manager.saveBarrier('replace-recover.md')).resolves.toMatchObject({
      source: 'cat\n'
    })
    await manager.handoff(replacement)
    await manager.close('replace-recover.md')
  })
})
