import { describe, expect, it, vi } from 'vitest'
import type CodeMirror from 'codemirror'
import {
  createDocumentCore,
  DOCUMENT_RESOURCE_POLICY_V1,
  type DocumentSourceEdit
} from '@marktext/document-core'
import { inspectDocumentCore } from '../../../../document-core/src/internal/documentCoreInspection'

import {
  createCoreActor,
  createCodeMirrorCoreAdapter,
  createEditorCoreBinding,
  createWorkerCorePort,
  createCoreDocumentSessionManager,
  type CoreWorkerRequestEnvelope,
  type CoreWorkerResponseEnvelope,
  type CoreWorkerLike,
  type CoreWorkerTestControl,
  type CoreActorPort,
  type CoreRequest,
  type CoreActor,
  type EditorCoreBinding,
  type CoreDocumentViewLease,
  type CoreAuthorityPerformanceEvent
} from '@/documentAuthority'
import codeMirror from '@/codeMirror'
import { inspectCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import type { CoreHistorySnapshot } from '@/documentAuthority/coreProtocol'
import { createCanonicalEolIndex } from '@/documentAuthority/canonicalEolIndex'
import { sourceCodeCoreAdapterOptions } from '@/documentAuthority/sourceCodeCoreAdapterOptions'
import { teardownCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionTeardown'
import { retireClosedCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionRetirement'
import { handoffCoreDocumentView } from '@/documentAuthority/coreDocumentViewHandoff'

const submitMarkup = (
  binding: EditorCoreBinding,
  edits: readonly DocumentSourceEdit[]
) => binding.submit({ edits, projections: ['markup'] }).acknowledged

const testBinding = (
  apply: (edits: readonly DocumentSourceEdit[]) =>
  ReturnType<EditorCoreBinding['submit']>['acknowledged']
): EditorCoreBinding => Object.freeze({
  mode: 'core',
  durableSourceAuthority: 'core',
  open: vi.fn(),
  submit: (input: Parameters<EditorCoreBinding['submit']>[0]) => Object.freeze({
    identity: Object.freeze({
      documentId: 'test',
      generation: 1,
      transactionId: 1
    }),
    acknowledged: 'edits' in input
      ? apply(input.edits)
      : Promise.reject(new Error('unexpected history command'))
  }),
  sourceAtBarrier: () => Promise.reject(new Error('unexpected source barrier')),
  plainTextViewAtBarrier: () => Promise.reject(
    new Error('unexpected plain-text view barrier')
  ),
  selectionProjectionAtBarrier: () => Promise.reject(
    new Error('unexpected selection projection barrier')
  ),
  reviewItemAtBarrier: () => Promise.reject(
    new Error('unexpected Review item barrier')
  ),
  observe: () => () => {},
  dispose: vi.fn()
})

class ActorBackedCoreWorker implements CoreWorkerLike {
  readonly actor: CoreActor
  readonly requests: CoreWorkerRequestEnvelope[] = []
  private readonly listeners = new Set<(
    event: MessageEvent<CoreWorkerResponseEnvelope>
  ) => void>()

  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  private readonly messageErrorListeners = new Set<(event: MessageEvent) => void>()
  private readonly heldResponses: CoreWorkerResponseEnvelope[] = []

  holdApplyReplies = false
  holdHistoryReplies = false
  holdSourceReplies = false
  disposeViewAfterHistoryRequest: (() => void) | undefined
  terminations = 0

  constructor(actor: CoreActor = createCoreActor()) {
    this.actor = actor
  }

  postMessage(message: CoreWorkerRequestEnvelope): void {
    this.requests.push(structuredClone(message))
    const response: CoreWorkerResponseEnvelope = Object.freeze({
      type: 'core-result',
      reply: this.actor.handle(message.request)
    })
    const cloned = structuredClone(response)
    if (this.holdApplyReplies && message.request.type === 'apply') {
      this.heldResponses.push(cloned)
      return
    }
    if (
      this.holdHistoryReplies &&
      (message.request.type === 'undo' || message.request.type === 'redo')
    ) {
      this.heldResponses.push(cloned)
      return
    }
    if (this.holdSourceReplies && message.request.type === 'source-at-barrier') {
      this.heldResponses.push(cloned)
      return
    }
    this.deliver(cloned)
    if (
      this.disposeViewAfterHistoryRequest !== undefined &&
      (message.request.type === 'undo' || message.request.type === 'redo')
    ) {
      setTimeout(this.disposeViewAfterHistoryRequest, 0)
    }
  }

  releaseNextApply(): void {
    const response = this.heldResponses.shift()
    if (response === undefined) throw new Error('No held Core apply reply')
    this.deliver(response)
  }

  releaseNextHistory(): void {
    const response = this.heldResponses.shift()
    if (response === undefined) throw new Error('No held Core history reply')
    this.deliver(response)
  }

  releaseNextSource(): void {
    const response = this.heldResponses.shift()
    if (response === undefined) throw new Error('No held Core source reply')
    this.deliver(response)
  }

  private deliver(response: CoreWorkerResponseEnvelope): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) {
        listener({ data: response } as MessageEvent<CoreWorkerResponseEnvelope>)
      }
    })
  }

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'message') {
      this.listeners.add(listener as (
        event: MessageEvent<CoreWorkerResponseEnvelope>
      ) => void)
    } else if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    } else {
      this.messageErrorListeners.add(listener as (event: MessageEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'message') {
      this.listeners.delete(listener as (
        event: MessageEvent<CoreWorkerResponseEnvelope>
      ) => void)
    } else if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    } else {
      this.messageErrorListeners.delete(listener as (event: MessageEvent) => void)
    }
  }

  terminate(): void {
    this.terminations += 1
    this.actor.dispose()
  }

  fail(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message } as ErrorEvent)
    }
  }
}

class FailingCoreWorker implements CoreWorkerLike {
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()
  private readonly messageErrorListeners = new Set<(event: MessageEvent) => void>()

  postMessage(): void {}

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    } else if (type === 'messageerror') {
      this.messageErrorListeners.add(listener as (event: MessageEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    } else if (type === 'messageerror') {
      this.messageErrorListeners.delete(listener as (event: MessageEvent) => void)
    }
  }

  terminate(): void {}

  fail(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message } as ErrorEvent)
    }
  }
}

class CoreFailureReportingWorker implements CoreWorkerLike {
  private readonly messageListeners = new Set<(
    event: MessageEvent<CoreWorkerResponseEnvelope>
  ) => void>()

  posts = 0

  terminations = 0

  postMessage(message: CoreWorkerRequestEnvelope): void {
    this.posts += 1
    queueMicrotask(() => {
      const response: CoreWorkerResponseEnvelope = Object.freeze({
        type: 'core-failure',
        session: message.request.session,
        sequence: message.request.sequence,
        message: 'actor terminated unexpectedly'
      })
      for (const listener of this.messageListeners) {
        listener({ data: response } as MessageEvent<CoreWorkerResponseEnvelope>)
      }
    })
  }

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (
        event: MessageEvent<CoreWorkerResponseEnvelope>
      ) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<CoreWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void) | ((event: MessageEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (
        event: MessageEvent<CoreWorkerResponseEnvelope>
      ) => void)
    }
  }

  terminate(): void {
    this.terminations += 1
  }
}

describe('Core actor protocol', () => {
  it('can delay actual Worker acknowledgements for the pending-save tracer', async() => {
    vi.useFakeTimers()
    const worker = new ActorBackedCoreWorker()
    const port = createWorkerCorePort(worker, { responseDelayMs: 25 })
    const opening = port.request({
      type: 'open',
      session: 1,
      sequence: 1,
      source: 'alpha'
    })
    let settled = false
    opening.then(() => { settled = true }).catch(() => {})

    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(24)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(opening).resolves.toMatchObject({ type: 'opened' })
    port.dispose()
    vi.useRealTimers()
  })

  it('opens once then applies an exact UTF-16 edit through Worker transport', async() => {
    const core = createDocumentCore()
    const worker = new ActorBackedCoreWorker(createCoreActor(() => core))
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    const source = 'head 😀\n\nordinary text paragraph\n\ntail\n'

    const opened = await binding.open({
      documentId: 'review.md',
      source
    })
    const beforeApply = inspectDocumentCore(core)
    const editStart = source.indexOf('text')
    const applied = await submitMarkup(binding, [{
      start: editStart,
      end: editStart + 4,
      insert: 'TEXT'
    }])
    if (applied.type !== 'applied') throw new Error('expected applied outcome')

    expect(binding).toMatchObject({
      mode: 'core',
      durableSourceAuthority: 'core'
    })
    expect(opened).toMatchObject({ accepted: true, revision: 1 })
    expect(applied).toMatchObject({
      accepted: true,
      revision: 2,
      sourceLength: source.length,
      diagnosticCount: 0,
      diagnostics: [],
      change: {
        appliedEdits: [{
          start: editStart,
          end: editStart + 4,
          insert: 'TEXT'
        }],
        projections: [{ name: 'markup', scope: 'regions' }]
      }
    })
    expect(() => structuredClone(applied.change)).not.toThrow()
    expect(worker.requests).toEqual([
      expect.objectContaining({
        type: 'core-request',
        request: expect.objectContaining({
          type: 'open',
          source
        })
      }),
      expect.objectContaining({
        type: 'core-request',
        request: expect.objectContaining({
          type: 'apply',
          baseRevision: 1,
          edits: [{
            start: editStart,
            end: editStart + 4,
            insert: 'TEXT'
          }]
        })
      })
    ])
    expect(worker.requests[1]?.request).not.toHaveProperty('source')
    expect(binding).not.toHaveProperty('source')
    const afterApply = inspectDocumentCore(core)
    expect(afterApply.documentParses).toBe(beforeApply.documentParses)
    expect(afterApply.sourceMaterializations).toBe(beforeApply.sourceMaterializations)
    expect(afterApply.regionalFastApplies).toBe(beforeApply.regionalFastApplies + 1)

    binding.dispose()
  })

  it('owns exact undo and redo history inside the document actor', async() => {
    const core = createDocumentCore()
    const worker = new ActorBackedCoreWorker(createCoreActor(() => core))
    const port = createWorkerCorePort(worker)
    const source = 'head\n\nordinary text paragraph\n\ntail\n'
    const start = source.indexOf('text')
    const opened = await port.request({
      type: 'open',
      session: 71,
      sequence: 1,
      source
    })
    const before = inspectDocumentCore(core)
    const applied = await port.request({
      type: 'apply',
      session: 71,
      sequence: 2,
      baseRevision: opened.revision,
      edits: [{ start, end: start + 4, insert: 'WORDS' }],
      projections: []
    })
    const undone = await port.request({
      type: 'undo',
      session: 71,
      sequence: 3,
      baseRevision: applied.revision,
      projections: []
    })
    const redone = await port.request({
      type: 'redo',
      session: 71,
      sequence: 4,
      baseRevision: undone.revision,
      projections: []
    })
    const saved = await port.request({
      type: 'source-at-barrier',
      session: 71,
      sequence: 5,
      baseRevision: redone.revision
    })

    expect(applied).toMatchObject({ type: 'applied', revision: 2 })
    expect(undone).toMatchObject({
      type: 'applied',
      revision: 3,
      change: { appliedEdits: [{ start, end: start + 5, insert: 'text' }] }
    })
    expect(redone).toMatchObject({
      type: 'applied',
      revision: 4,
      change: { appliedEdits: [{ start, end: start + 4, insert: 'WORDS' }] }
    })
    expect(saved).toMatchObject({
      type: 'source',
      source: source.replace('text', 'WORDS')
    })
    const after = inspectDocumentCore(core)
    expect(after.sourceMaterializations).toBe(before.sourceMaterializations + 1)
    port.dispose()
  })

  it('accepts one current CriticMarkup annotation through actor-owned history', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 72,
      sequence: 1,
      source: 'a {++add++} b\n'
    })
    const accepted = await port.request({
      type: 'resolve',
      session: 72,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: { kind: 'addition', range: { start: 2, end: 11 } },
      decision: 'accept',
      projections: []
    })
    const saved = await port.request({
      type: 'source-at-barrier',
      session: 72,
      sequence: 3,
      baseRevision: accepted.revision
    })
    const undone = await port.request({
      type: 'undo',
      session: 72,
      sequence: 4,
      baseRevision: accepted.revision,
      projections: []
    })
    const restored = await port.request({
      type: 'source-at-barrier',
      session: 72,
      sequence: 5,
      baseRevision: undone.revision
    })

    expect(accepted).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 2, end: 11, insert: 'add' }]
      }
    })
    expect(saved).toMatchObject({ type: 'source', source: 'a add b\n' })
    expect(undone).toMatchObject({ type: 'applied', revision: 3 })
    expect(restored).toMatchObject({
      type: 'source',
      source: 'a {++add++} b\n'
    })
    port.dispose()
  })

  it('rejects an unknown CriticMarkup locator without changing actor source', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 73,
      sequence: 1,
      source: 'a {++add++} b\n'
    })
    const rejected = await port.request({
      type: 'resolve',
      session: 73,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: { kind: 'addition', range: { start: 2, end: 10 } },
      decision: 'accept',
      projections: []
    })
    const saved = await port.request({
      type: 'source-at-barrier',
      session: 73,
      sequence: 3,
      baseRevision: opened.revision
    })

    expect(rejected).toMatchObject({
      type: 'rejected',
      revision: 1,
      reason: 'annotation-not-found'
    })
    expect(saved).toMatchObject({
      type: 'source',
      revision: 1,
      source: 'a {++add++} b\n'
    })
    port.dispose()
  })

  it('rejects a Review decision that is invalid for the located annotation', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const source = 'a {++add++} b\n'
    const opened = await port.request({
      type: 'open',
      session: 731,
      sequence: 1,
      source
    })
    const rejected = await port.request({
      type: 'resolve',
      session: 731,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: { kind: 'addition', range: { start: 2, end: 11 } },
      decision: 'remove',
      projections: []
    })
    const saved = await port.request({
      type: 'source-at-barrier',
      session: 731,
      sequence: 3,
      baseRevision: opened.revision
    })

    expect(rejected).toMatchObject({
      type: 'rejected',
      revision: 1,
      reason: 'resolution-invalid'
    })
    expect(saved).toMatchObject({
      type: 'source',
      revision: 1,
      source
    })
    port.dispose()
  })

  it('returns one bounded next Review item from the acknowledged revision', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 74,
      sequence: 1,
      source: 'before {++new++} and {--old--} after\n'
    })
    const item = await port.request({
      type: 'review-item-at-barrier',
      session: 74,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })

    expect(item).toMatchObject({
      type: 'review-item',
      revision: 1,
      item: {
        kind: 'addition',
        range: { start: 7, end: 16 }
      }
    })
    expect(item).not.toHaveProperty('source')
    port.dispose()
  })

  it('rejects malformed Review navigation coordinates nonterminally', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 805,
      sequence: 1,
      source: '{++x++}\n'
    })
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 805,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: Number.NaN
    })).resolves.toMatchObject({
      type: 'rejected',
      reason: 'invalid-edit',
      revision: 1,
      sourceLength: 8
    })
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 805,
      sequence: 3,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })).resolves.toMatchObject({
      type: 'review-item',
      revision: 1,
      item: { kind: 'addition', range: { start: 0, end: 7 } }
    })
    port.dispose()
  })

  it('does not alias a Review item across a same-range revision', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    const source = '{--old--}\n'
    await binding.open({ documentId: 'stale-review-identity.md', source })
    const reviewed = await binding.reviewItemAtBarrier('next', 0)
    if (reviewed.type !== 'review-item' || reviewed.item === null) {
      throw new Error('Expected a Review item')
    }

    await expect(binding.submit({
      edits: [{ start: 3, end: 6, insert: 'new' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    const staleTarget = {
      kind: 'resolve' as const,
      authoredRevision: reviewed.revision,
      annotation: reviewed.item,
      decision: 'reject' as const,
      projections: [] as const
    }
    await expect(binding.submit(staleTarget).acknowledged).resolves.toMatchObject({
      type: 'rejected',
      reason: 'stale-base',
      revision: 2
    })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 2,
      source: '{--new--}\n'
    })
    await expect(binding.submit({
      edits: [{ start: 9, end: 9, insert: '!' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    binding.dispose()
  })

  it('derives and removes one gapless Commented span without promoting nested items', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const source = 'before {==text==}{>>outer {++nested++}<<} after\n'
    const opened = await port.request({
      type: 'open',
      session: 75,
      sequence: 1,
      source
    })
    const item = await port.request({
      type: 'review-item-at-barrier',
      session: 75,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })

    expect(item).toMatchObject({
      type: 'review-item',
      commentText: 'outer {++nested++}',
      item: {
        kind: 'commented-span',
        range: { start: 7, end: 41 },
        highlightRange: { start: 7, end: 17 },
        commentRange: { start: 17, end: 41 }
      }
    })
    if (item.type !== 'review-item' || item.item === null) {
      throw new Error('Expected one Commented span Review item')
    }
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 75,
      sequence: 3,
      baseRevision: item.revision,
      direction: 'next',
      from: item.item.range.end
    })).resolves.toMatchObject({ item: null })
    await expect(port.request({
      type: 'resolve',
      session: 75,
      sequence: 4,
      baseRevision: item.revision,
      annotation: item.item,
      decision: 'remove',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      change: {
        appliedEdits: [{ start: 7, end: 41, insert: 'text' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 75,
      sequence: 5,
      baseRevision: 2
    })).resolves.toMatchObject({ source: 'before text after\n' })
    port.dispose()
  })

  it('authors a Commented span and tracked Substitution inside actor history', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 76,
      sequence: 1,
      source: 'alpha selected omega\n'
    })
    const commented = await port.request({
      type: 'author',
      session: 76,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'comment',
      range: { start: 6, end: 14 },
      text: 'note',
      projections: []
    })
    expect(commented).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 6,
          end: 14,
          insert: '{==selected==}{>>note<<}'
        }]
      }
    })
    const substitution = await port.request({
      type: 'author',
      session: 76,
      sequence: 3,
      baseRevision: 2,
      form: 'substitution',
      range: { start: 31, end: 36 },
      text: 'replacement',
      projections: []
    })
    expect(substitution).toMatchObject({
      type: 'applied',
      revision: 3,
      change: {
        appliedEdits: [{
          start: 31,
          end: 36,
          insert: '{~~omega~>replacement~~}'
        }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 76,
      sequence: 4,
      baseRevision: 3
    })).resolves.toMatchObject({
      source: 'alpha {==selected==}{>>note<<} {~~omega~>replacement~~}\n'
    })
    await expect(port.request({
      type: 'undo',
      session: 76,
      sequence: 5,
      baseRevision: 3,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 4 })
    port.dispose()
  })

  it('edits an anchored Comment as one actor-owned history entry', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before {==text==}{>>old note<<} after\n'
    const edited = 'before {==text==}{>>new note<<} after\n'
    const opened = await port.request({
      type: 'open',
      session: 813,
      sequence: 1,
      source: original
    })

    await expect(port.request({
      type: 'edit-comment',
      session: 813,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: {
        kind: 'commented-span',
        range: { start: 7, end: 31 },
        highlightRange: { start: 7, end: 17 },
        commentRange: { start: 17, end: 31 }
      },
      text: 'new note',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 17, end: 31, insert: '{>>new note<<}' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 813,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: edited })
    await expect(port.request({
      type: 'undo',
      session: 813,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 813,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    await expect(port.request({
      type: 'redo',
      session: 813,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 813,
      sequence: 7,
      baseRevision: 4
    })).resolves.toMatchObject({ type: 'source', source: edited })
    port.dispose()
  })

  it('preserves nested Comment ownership while protecting a hostile edited closer', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before {==text==}{>>old<<} after\n'
    const payload = 'outer {>>inner<<} plus <<} literal'
    const protectedPayload = 'outer {>>inner<<} plus \\<<} literal'
    const opened = await port.request({
      type: 'open',
      session: 816,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'edit-comment',
      session: 816,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: {
        kind: 'commented-span',
        range: { start: 7, end: 26 },
        highlightRange: { start: 7, end: 17 },
        commentRange: { start: 17, end: 26 }
      },
      text: payload,
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 17,
          end: 26,
          insert: `{>>${protectedPayload}<<}`
        }]
      }
    })
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 816,
      sequence: 3,
      baseRevision: 2,
      direction: 'next',
      from: 0
    })).resolves.toMatchObject({
      type: 'review-item',
      commentText: protectedPayload
    })
    await expect(port.request({
      type: 'undo',
      session: 816,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 816,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    port.dispose()
  })

  it('edits a Comment payload to empty without deleting the Comment', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before {==text==}{>>note<<} after\n'
    const emptied = 'before {==text==}{>><<} after\n'
    const opened = await port.request({
      type: 'open',
      session: 821,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'edit-comment',
      session: 821,
      sequence: 2,
      baseRevision: opened.revision,
      annotation: {
        kind: 'commented-span',
        range: { start: 7, end: 27 },
        highlightRange: { start: 7, end: 17 },
        commentRange: { start: 17, end: 27 }
      },
      text: '',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 17, end: 27, insert: '{>><<}' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 821,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: emptied })
    await expect(port.request({
      type: 'undo',
      session: 821,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 821,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    port.dispose()
  })

  it('edits an imported standalone Comment without synthesizing an Anchor', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before {>>old<<} after\n'
    const edited = 'before {>>new<<} after\n'
    const opened = await port.request({
      type: 'open',
      session: 823,
      sequence: 1,
      source: original
    })
    const reviewed = await port.request({
      type: 'review-item-at-barrier',
      session: 823,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })
    expect(reviewed).toMatchObject({
      type: 'review-item',
      commentText: 'old',
      item: { kind: 'comment', range: { start: 7, end: 16 } }
    })
    if (reviewed.type !== 'review-item' || reviewed.item === null) {
      throw new Error('Expected standalone Comment')
    }
    await expect(port.request({
      type: 'edit-comment',
      session: 823,
      sequence: 3,
      baseRevision: reviewed.revision,
      annotation: reviewed.item,
      text: 'new',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 7, end: 16, insert: '{>>new<<}' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 823,
      sequence: 4,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: edited })
    port.dispose()
  })

  it('authors a standalone Highlight as one actor-owned history entry', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before selected after\n'
    const highlighted = 'before {==selected==} after\n'
    const opened = await port.request({
      type: 'open',
      session: 814,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'author',
      session: 814,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'highlight',
      range: { start: 7, end: 15 },
      text: '',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 7, end: 15, insert: '{==selected==}' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 814,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: highlighted })
    await expect(port.request({
      type: 'undo',
      session: 814,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 814,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    port.dispose()
  })

  it('authors an anchored Comment whose payload is empty', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'before selected after\n'
    const commented = 'before {==selected==}{>><<} after\n'
    const opened = await port.request({
      type: 'open',
      session: 818,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'author',
      session: 818,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'comment',
      range: { start: 7, end: 15 },
      text: '',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 7,
          end: 15,
          insert: '{==selected==}{>><<}'
        }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 818,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: commented })
    await expect(port.request({
      type: 'undo',
      session: 818,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 818,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    port.dispose()
  })

  it('accepts or rejects every Review suggestion atomically', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'A {++new++} B {--old--} C {~~left~>right~~}\n'
    const accepted = 'A new B  C right\n'
    const opened = await port.request({
      type: 'open',
      session: 815,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'resolve-all',
      session: 815,
      sequence: 2,
      baseRevision: opened.revision,
      decision: 'accept',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [
          { start: 2, end: 11, insert: 'new' },
          { start: 14, end: 23, insert: '' },
          { start: 26, end: 43, insert: 'right' }
        ]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 815,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: accepted })
    await expect(port.request({
      type: 'undo',
      session: 815,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 815,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    await expect(port.request({
      type: 'resolve-all',
      session: 815,
      sequence: 6,
      baseRevision: 3,
      decision: 'reject',
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 815,
      sequence: 7,
      baseRevision: 4
    })).resolves.toMatchObject({ type: 'source', source: 'A  B old C left\n' })
    port.dispose()
  })

  it('bulk-resolves a nested visible suggestion without removing its Highlight', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const original = 'A {==outer {++inner++}==} Z\n'
    const accepted = 'A {==outer inner==} Z\n'
    const opened = await port.request({
      type: 'open',
      session: 817,
      sequence: 1,
      source: original
    })
    await expect(port.request({
      type: 'resolve-all',
      session: 817,
      sequence: 2,
      baseRevision: opened.revision,
      decision: 'accept',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 11, end: 22, insert: 'inner' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 817,
      sequence: 3,
      baseRevision: 2
    })).resolves.toMatchObject({ type: 'source', source: accepted })
    await expect(port.request({
      type: 'undo',
      session: 817,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 817,
      sequence: 5,
      baseRevision: 3
    })).resolves.toMatchObject({ type: 'source', source: original })
    port.dispose()
  })

  it('rejects an oversized bulk Review decision without partial publication', () => {
    const actor = createCoreActor(undefined, { maximumHistoryEditsPerEntry: 2 })
    const source = '{++a++} {++b++} {++c++}\n'
    expect(actor.handle({
      type: 'open',
      session: 822,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'resolve-all',
      session: 822,
      sequence: 2,
      baseRevision: 1,
      decision: 'accept',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-resource',
      revision: 1
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 822,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source, revision: 1 })
    expect(actor.handle({
      type: 'undo',
      session: 822,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({ type: 'rejected', reason: 'history-empty' })
    actor.dispose()
  })

  it('navigates the deepest visible nested Review item before its parent', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 819,
      sequence: 1,
      source: 'A {==outer {++inner++}==} Z\n'
    })
    const nested = await port.request({
      type: 'review-item-at-barrier',
      session: 819,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })
    expect(nested).toMatchObject({
      type: 'review-item',
      item: { kind: 'addition', range: { start: 11, end: 22 } }
    })
    if (nested.type !== 'review-item' || nested.item === null) {
      throw new Error('Expected nested Review item')
    }
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 819,
      sequence: 3,
      baseRevision: opened.revision,
      direction: 'next',
      from: nested.item.range.end
    })).resolves.toMatchObject({
      type: 'review-item',
      item: { kind: 'highlight', range: { start: 2, end: 25 } }
    })
    await expect(port.request({
      type: 'review-item-at-barrier',
      session: 819,
      sequence: 4,
      baseRevision: opened.revision,
      direction: 'previous',
      from: nested.item.range.start
    })).resolves.toMatchObject({
      type: 'review-item',
      item: { kind: 'highlight', range: { start: 2, end: 25 } }
    })
    port.dispose()
  })

  it('derives a nested visible Highlight and Comment as one Commented span', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const opened = await port.request({
      type: 'open',
      session: 820,
      sequence: 1,
      source: 'A {==outer {==text==}{>>note<<}==} Z\n'
    })
    const reviewed = await port.request({
      type: 'review-item-at-barrier',
      session: 820,
      sequence: 2,
      baseRevision: opened.revision,
      direction: 'next',
      from: 0
    })
    expect(reviewed).toMatchObject({
      type: 'review-item',
      commentText: 'note',
      item: {
        kind: 'commented-span',
        range: { start: 11, end: 31 },
        highlightRange: { start: 11, end: 21 },
        commentRange: { start: 21, end: 31 }
      }
    })
    if (reviewed.type !== 'review-item' || reviewed.item === null) {
      throw new Error('Expected nested Commented span')
    }
    await expect(port.request({
      type: 'resolve',
      session: 820,
      sequence: 3,
      baseRevision: reviewed.revision,
      annotation: reviewed.item,
      decision: 'remove',
      projections: []
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 11, end: 31, insert: 'text' }]
      }
    })
    await expect(port.request({
      type: 'source-at-barrier',
      session: 820,
      sequence: 4,
      baseRevision: 2
    })).resolves.toMatchObject({ source: 'A {==outer text==} Z\n' })
    port.dispose()
  })

  it('rejects authoring that partially overlaps actor-owned markup', () => {
    const actor = createCoreActor()
    const source = 'a{++x++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 778,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'author',
      session: 778,
      sequence: 2,
      baseRevision: 1,
      form: 'substitution',
      range: { start: 6, end: 7 },
      text: 'Q',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      revision: 1,
      accepted: false,
      reason: 'author-invalid',
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 778,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 778,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
  })

  it('expands a visible reference label to its complete link before authoring', () => {
    const actor = createCoreActor()
    const source =
      'See [important][ref].[^n]\n\n[ref]: https://example.com\n[^n]: Note.'
    const authored =
      'See {==[important][ref]==}.[^n]\n\n[ref]: https://example.com\n[^n]: Note.'
    expect(actor.handle({
      type: 'open',
      session: 7781,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })

    expect(actor.handle({
      type: 'author',
      session: 7781,
      sequence: 2,
      baseRevision: 1,
      form: 'highlight',
      range: { start: 5, end: 14 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 4,
          end: 20,
          insert: '{==[important][ref]==}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 7781,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: authored })
  })

  it('keeps Critic-looking replacement text visible when authoring', () => {
    const actor = createCoreActor()
    const source = 'alpha selected omega\n'
    const authored = 'alpha {~~selected~>\\{--X\\--}~~} omega\n'
    expect(actor.handle({
      type: 'open',
      session: 779,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'author',
      session: 779,
      sequence: 2,
      baseRevision: 1,
      form: 'substitution',
      range: { start: 6, end: 14 },
      text: '{--X--}',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      diagnosticCount: 0,
      change: {
        appliedEdits: [{
          start: 6,
          end: 14,
          insert: '{~~selected~>\\{--X\\--}~~}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 779,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: authored })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 779,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'alpha \\{--X\\--} omega\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 779,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 779,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 779,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 779,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: authored })
  })

  it('keeps Critic-looking Comment text literal when authoring', () => {
    const actor = createCoreActor()
    const source = 'alpha selected omega\n'
    const authored = 'alpha {==selected==}{>>\\{--X\\--}<<} omega\n'
    expect(actor.handle({
      type: 'open',
      session: 780,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'author',
      session: 780,
      sequence: 2,
      baseRevision: 1,
      form: 'comment',
      range: { start: 6, end: 14 },
      text: '{--X--}',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      diagnosticCount: 0,
      change: {
        appliedEdits: [{
          start: 6,
          end: 14,
          insert: '{==selected==}{>>\\{--X\\--}<<}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 780,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: authored })
    expect(actor.handle({
      type: 'undo',
      session: 780,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 780,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 780,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 780,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: authored })
  })

  it('protects an incomplete Critic token in authored replacement text', () => {
    const actor = createCoreActor()
    const source = 'alpha selected omega\n'
    const authored = 'alpha {~~selected~>\\{--~~} omega\n'
    expect(actor.handle({
      type: 'open',
      session: 783,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'author',
      session: 783,
      sequence: 2,
      baseRevision: 1,
      form: 'substitution',
      range: { start: 6, end: 14 },
      text: '{--',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      diagnosticCount: 0,
      change: {
        appliedEdits: [{
          start: 6,
          end: 14,
          insert: '{~~selected~>\\{--~~}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 783,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: authored })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 783,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'alpha \\{-- omega\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 783,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 783,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 783,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 783,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: authored })
  })

  it('authors tracked insertion and deletion carriers inside actor history', () => {
    const actor = createCoreActor()
    const opened = actor.handle({
      type: 'open',
      session: 765,
      sequence: 1,
      source: 'ab\n'
    })
    expect(opened).toMatchObject({ type: 'opened', revision: 1 })

    const insertion = actor.handle({
      type: 'track',
      session: 765,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 1 },
      text: 'X',
      projections: []
    })
    expect(insertion).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 1, end: 1, insert: '{++X++}' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 765,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{++X++}b\n' })
    expect(actor.handle({
      type: 'undo',
      session: 765,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 765,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab\n' })
    expect(actor.handle({
      type: 'redo',
      session: 765,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 765,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'a{++X++}b\n' })

    const actor2 = createCoreActor()
    const opened2 = actor2.handle({
      type: 'open',
      session: 766,
      sequence: 1,
      source: 'ab\n'
    })
    expect(opened2).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor2.handle({
      type: 'track',
      session: 766,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 2 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 1, end: 2, insert: '{--b--}' }]
      }
    })
    expect(actor2.handle({
      type: 'source-at-barrier',
      session: 766,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{--b--}\n' })
    expect(actor2.handle({
      type: 'undo',
      session: 766,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor2.handle({
      type: 'source-at-barrier',
      session: 766,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab\n' })
    expect(actor2.handle({
      type: 'redo',
      session: 766,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor2.handle({
      type: 'source-at-barrier',
      session: 766,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'a{--b--}\n' })

    const actor3 = createCoreActor()
    expect(actor3.handle({
      type: 'open',
      session: 767,
      sequence: 1,
      source: 'ab\n'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor3.handle({
      type: 'track',
      session: 767,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 2 },
      text: 'X',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 1, end: 2, insert: '{~~b~>X~~}' }]
      }
    })
    expect(actor3.handle({
      type: 'source-at-barrier',
      session: 767,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{~~b~>X~~}\n' })
    expect(actor3.handle({
      type: 'undo',
      session: 767,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor3.handle({
      type: 'source-at-barrier',
      session: 767,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab\n' })
    expect(actor3.handle({
      type: 'redo',
      session: 767,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor3.handle({
      type: 'source-at-barrier',
      session: 767,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'a{~~b~>X~~}\n' })
  })

  it('authors one cross-paragraph tracked replacement as a block-spanning Substitution', () => {
    const actor = createCoreActor()
    const source = 'alpha\n\nbeta\n\ngamma\n'
    expect(actor.handle({
      type: 'open',
      session: 774,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 774,
      sequence: 2,
      baseRevision: 1,
      range: { start: 2, end: 15 },
      text: 'X',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 2,
          end: 15,
          insert: '{~~pha\n\nbeta\n\nga~>X~~}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 774,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({
      type: 'source',
      source: 'al{~~pha\n\nbeta\n\nga~>X~~}mma\n'
    })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 774,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'alXmma\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 774,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 774,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
  })

  it('protects a literal substitution divider inside actor-authored old text', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())
    const source = 'before old~>literal after\n'
    const opened = await port.request({
      type: 'open',
      session: 761,
      sequence: 1,
      source
    })
    const authored = await port.request({
      type: 'author',
      session: 761,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'substitution',
      range: { start: 7, end: 19 },
      text: 'new',
      projections: []
    })
    const view = await port.request({
      type: 'plain-text-view-at-barrier',
      session: 761,
      sequence: 3,
      baseRevision: authored.revision
    })
    const undone = await port.request({
      type: 'undo',
      session: 761,
      sequence: 4,
      baseRevision: authored.revision,
      projections: []
    })
    const restored = await port.request({
      type: 'source-at-barrier',
      session: 761,
      sequence: 5,
      baseRevision: undone.revision
    })

    expect(authored).toMatchObject({
      type: 'applied',
      change: {
        appliedEdits: [{
          start: 7,
          end: 19,
          insert: '{~~old\\~>literal~>new~~}'
        }]
      }
    })
    expect(view).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'before new after\n' }
    })
    expect(restored).toMatchObject({ type: 'source', source })
    port.dispose()
  })

  it('protects only the conflicting outer substitution divider', () => {
    const actor = createCoreActor()
    const source = 'before old {++nested++} ~> tail after\n'
    const opened = actor.handle({
      type: 'open',
      session: 764,
      sequence: 1,
      source
    })
    expect(opened).toMatchObject({ type: 'opened', revision: 1 })

    const authored = actor.handle({
      type: 'author',
      session: 764,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'substitution',
      range: { start: 7, end: 31 },
      text: 'new',
      projections: []
    })
    expect(authored).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 7,
          end: 31,
          insert: '{~~old {++nested++} \\~> tail~>new~~}'
        }]
      }
    })

    expect(actor.handle({
      type: 'source-at-barrier',
      session: 764,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({
      type: 'source',
      source: 'before {~~old {++nested++} \\~> tail~>new~~} after\n'
    })
    expect(actor.handle({
      type: 'undo',
      session: 764,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 764,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
  })

  it('protects a conflicting closer inside actor-tracked visible text', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 768,
      sequence: 1,
      source: 'ab\n'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 768,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 1 },
      text: 'x++}y',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 1,
          end: 1,
          insert: '{++x\\++}y++}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 768,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{++x\\++}y++}b\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 768,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'ax\\++}yb\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 768,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 768,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab\n' })
    expect(actor.handle({
      type: 'redo',
      session: 768,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 768,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'a{++x\\++}y++}b\n' })
  })

  it('keeps Critic-looking native text visible inside a tracked insertion', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 771,
      sequence: 1,
      source: 'ab\n'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 771,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 1 },
      text: '{--X--}',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 1,
          end: 1,
          insert: '{++\\{--X\\--}++}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 771,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({
      type: 'source',
      source: 'a{++\\{--X\\--}++}b\n'
    })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 771,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'a\\{--X\\--}b\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 771,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 771,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab\n' })
    expect(actor.handle({
      type: 'redo',
      session: 771,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 771,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({
      type: 'source',
      source: 'a{++\\{--X\\--}++}b\n'
    })
  })

  it('protects an incomplete Critic token inside tracked native text', () => {
    const actor = createCoreActor()
    const source = 'ab\n'
    const tracked = 'a{++\\{--++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 782,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 782,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 1 },
      text: '{--',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      diagnosticCount: 0,
      change: {
        appliedEdits: [{ start: 1, end: 1, insert: '{++\\{--++}' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 782,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: tracked })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 782,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'a\\{--b\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 782,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 782,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 782,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 782,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: tracked })
  })

  it('does not double-protect native text that is already literal', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 773,
      sequence: 1,
      source: 'ab\n'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 773,
      sequence: 2,
      baseRevision: 1,
      range: { start: 1, end: 1 },
      text: '\\{--X\\--}',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 1,
          end: 1,
          insert: '{++\\{--X\\--}++}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 773,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{++\\{--X\\--}++}b\n' })
  })

  it('preserves nested CriticMarkup while protecting an outer tracked deletion', () => {
    const actor = createCoreActor()
    const source = 'before old {--nested--} --} tail after\n'
    expect(actor.handle({
      type: 'open',
      session: 770,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 770,
      sequence: 2,
      baseRevision: 1,
      range: { start: 7, end: 32 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{
          start: 7,
          end: 32,
          insert: '{--old {--nested--} \\--} tail--}'
        }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 770,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({
      type: 'source',
      source: 'before {--old {--nested--} \\--} tail--} after\n'
    })
    expect(actor.handle({
      type: 'undo',
      session: 770,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 770,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
  })

  it('extends an acknowledged Addition instead of fragmenting a typing run', () => {
    const actor = createCoreActor()
    const source = 'seed{++!++}\n'
    expect(actor.handle({
      type: 'open',
      session: 769,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 769,
      sequence: 2,
      baseRevision: 1,
      range: { start: 8, end: 8 },
      text: '?',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 8, end: 8, insert: '?' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 769,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'seed{++!?++}\n' })
    expect(actor.handle({
      type: 'undo',
      session: 769,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 769,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
  })

  it('replaces selected text inside an acknowledged Addition', () => {
    const actor = createCoreActor()
    const source = '{++seed++}\n'
    expect(actor.handle({
      type: 'open',
      session: 792,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 792,
      sequence: 2,
      baseRevision: 1,
      range: { start: 4, end: 6 },
      text: 'X',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 4, end: 6, insert: 'X' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 792,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{++sXd++}\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 792,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'sXd\n' }
    })
    expect(actor.handle({
      type: 'review-item-at-barrier',
      session: 792,
      sequence: 5,
      baseRevision: 2,
      direction: 'next',
      from: 0
    })).toMatchObject({
      type: 'review-item',
      item: { kind: 'addition', range: { start: 0, end: 9 } }
    })
    expect(actor.handle({
      type: 'undo',
      session: 792,
      sequence: 6,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 792,
      sequence: 7,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 792,
      sequence: 8,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 792,
      sequence: 9,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{++sXd++}\n' })
  })

  it('does not record an identical replacement inside an Addition', () => {
    const actor = createCoreActor()
    const source = '{++abc++}\n'
    expect(actor.handle({
      type: 'open',
      session: 800,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 800,
      sequence: 2,
      baseRevision: 1,
      range: { start: 3, end: 6 },
      text: 'abc',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'no-change',
      revision: 1,
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 800,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 800,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
    actor.dispose()
  })

  it('extends the revised arm of an acknowledged Substitution', () => {
    const actor = createCoreActor()
    const source = '{~~old~>new~~}\n'
    expect(actor.handle({
      type: 'open',
      session: 787,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 787,
      sequence: 2,
      baseRevision: 1,
      range: { start: 11, end: 11 },
      text: '!',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 11, end: 11, insert: '!' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 787,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{~~old~>new!~~}\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 787,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'new!\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 787,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 787,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 787,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 787,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{~~old~>new!~~}\n' })
  })

  it('cancels a Substitution when its revised arm returns to the original', () => {
    const actor = createCoreActor()
    const source = '{~~old~>new~~}\n'
    expect(actor.handle({
      type: 'open',
      session: 798,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 798,
      sequence: 2,
      baseRevision: 1,
      range: { start: 8, end: 11 },
      text: 'old',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: { appliedEdits: [{ start: 0, end: 14, insert: 'old' }] }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 798,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'old\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 798,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'old\n' }
    })
    expect(actor.handle({
      type: 'review-item-at-barrier',
      session: 798,
      sequence: 5,
      baseRevision: 2,
      direction: 'next',
      from: 0
    })).toMatchObject({ type: 'review-item', item: null })
    expect(actor.handle({
      type: 'undo',
      session: 798,
      sequence: 6,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 798,
      sequence: 7,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 798,
      sequence: 8,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 798,
      sequence: 9,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'old\n' })
  })

  it('shrinks the revised arm of an acknowledged Substitution', () => {
    const actor = createCoreActor()
    const source = '{~~old~>new~~}\n'
    expect(actor.handle({
      type: 'open',
      session: 788,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 788,
      sequence: 2,
      baseRevision: 1,
      range: { start: 10, end: 11 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 10, end: 11, insert: '' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 788,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{~~old~>ne~~}\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 788,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'ne\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 788,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 788,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 788,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 788,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{~~old~>ne~~}\n' })
  })

  it('turns a Substitution into a Deletion when its revised arm becomes empty', () => {
    const actor = createCoreActor()
    const source = '{~~old~>x~~}\n'
    expect(actor.handle({
      type: 'open',
      session: 790,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 790,
      sequence: 2,
      baseRevision: 1,
      range: { start: 8, end: 9 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 0, end: 12, insert: '{--old--}' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 790,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{--old--}\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 790,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: '\n' }
    })
    expect(actor.handle({
      type: 'review-item-at-barrier',
      session: 790,
      sequence: 5,
      baseRevision: 2,
      direction: 'next',
      from: 0
    })).toMatchObject({
      type: 'review-item',
      item: { kind: 'deletion', range: { start: 0, end: 9 } }
    })
    expect(actor.handle({
      type: 'undo',
      session: 790,
      sequence: 6,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 790,
      sequence: 7,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 790,
      sequence: 8,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 790,
      sequence: 9,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{--old--}\n' })
  })

  it('rejects tracked insertion into a nested hidden Substitution arm', () => {
    const actor = createCoreActor()
    const source = '{++{~~old~>new~~}++}\n'
    expect(actor.handle({
      type: 'open',
      session: 789,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 789,
      sequence: 2,
      baseRevision: 1,
      range: { start: 6, end: 6 },
      text: '!',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'invalid-edit',
      revision: 1
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 789,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 789,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
  })

  it('protects an incomplete Critic token when extending an Addition', () => {
    const actor = createCoreActor()
    const source = 'a{++x++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 785,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 785,
      sequence: 2,
      baseRevision: 1,
      range: { start: 4, end: 4 },
      text: '{--',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      diagnosticCount: 0,
      change: {
        appliedEdits: [{ start: 4, end: 4, insert: '\\{--' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 785,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a{++\\{--x++}b\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 785,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'a\\{--xb\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 785,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 785,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 785,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 785,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: 'a{++\\{--x++}b\n' })
  })

  it('cancels added text when Track Changes backspaces inside an Addition', () => {
    const actor = createCoreActor()
    const source = '{++seed++}\n'
    expect(actor.handle({
      type: 'open',
      session: 777,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 777,
      sequence: 2,
      baseRevision: 1,
      range: { start: 6, end: 7 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 6, end: 7, insert: '' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 777,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{++see++}\n' })
    expect(actor.handle({
      type: 'plain-text-view-at-barrier',
      session: 777,
      sequence: 4,
      baseRevision: 2
    })).toMatchObject({
      type: 'plain-text-view',
      view: { kind: 'view', markdown: 'see\n' }
    })
    expect(actor.handle({
      type: 'undo',
      session: 777,
      sequence: 5,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 777,
      sequence: 6,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 777,
      sequence: 7,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 777,
      sequence: 8,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{++see++}\n' })
  })

  it('rejects deletion of a protective byte inside an Addition atomically', () => {
    const actor = createCoreActor()
    const source = 'a{++\\{--x++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 786,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1, diagnosticCount: 0 })
    expect(actor.handle({
      type: 'track',
      session: 786,
      sequence: 2,
      baseRevision: 1,
      range: { start: 4, end: 5 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'invalid-edit',
      revision: 1
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 786,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 786,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
  })

  it('removes an Addition when Track Changes deletes its final character', () => {
    const actor = createCoreActor()
    const source = '{++x++}\n'
    expect(actor.handle({
      type: 'open',
      session: 781,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 781,
      sequence: 2,
      baseRevision: 1,
      range: { start: 3, end: 4 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 0, end: 7, insert: '' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 781,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '\n' })
    expect(actor.handle({
      type: 'undo',
      session: 781,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 781,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 781,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 781,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '\n' })
  })

  it('rejects tracked insertion into actor-owned marker bytes atomically', () => {
    const actor = createCoreActor()
    const source = 'a{++x++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 775,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 775,
      sequence: 2,
      baseRevision: 1,
      range: { start: 6, end: 6 },
      text: '!',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      revision: 1,
      accepted: false,
      reason: 'invalid-edit',
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 775,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 775,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
  })

  it('rejects a tracked edit that partially overlaps actor-owned markup', () => {
    const actor = createCoreActor()
    const source = 'a{++x++}b\n'
    expect(actor.handle({
      type: 'open',
      session: 776,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 776,
      sequence: 2,
      baseRevision: 1,
      range: { start: 6, end: 7 },
      text: '',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      revision: 1,
      accepted: false,
      reason: 'invalid-edit',
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 776,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 776,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({ type: 'rejected', reason: 'history-empty', revision: 1 })
  })

  it('protects native text while extending an acknowledged Addition', () => {
    const actor = createCoreActor()
    const source = '{++seed++}\n'
    expect(actor.handle({
      type: 'open',
      session: 772,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'track',
      session: 772,
      sequence: 2,
      baseRevision: 1,
      range: { start: 7, end: 7 },
      text: 'x++}y',
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start: 7, end: 7, insert: 'x\\++}y' }]
      }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 772,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: '{++seedx\\++}y++}\n' })
    expect(actor.handle({
      type: 'undo',
      session: 772,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 772,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'redo',
      session: 772,
      sequence: 6,
      baseRevision: 3,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 772,
      sequence: 7,
      baseRevision: 4
    })).toMatchObject({ type: 'source', source: '{++seedx\\++}y++}\n' })
  })

  it('rejects malformed author transport without poisoning the actor session', async() => {
    const actor = createCoreActor()
    const opened = actor.handle({
      type: 'open',
      session: 762,
      sequence: 1,
      source: 'alpha selected omega\n'
    })
    const malformed = actor.handle({
      type: 'author',
      session: 762,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'comment',
      range: null,
      text: 42,
      projections: []
    } as unknown as CoreRequest)
    const authored = actor.handle({
      type: 'author',
      session: 762,
      sequence: 3,
      baseRevision: opened.revision,
      form: 'comment',
      range: { start: 6, end: 14 },
      text: 'note',
      projections: []
    })

    expect(malformed).toMatchObject({
      type: 'rejected',
      revision: 1,
      reason: 'author-invalid'
    })
    expect(authored).toMatchObject({ type: 'applied', revision: 2 })
    actor.dispose()
  })

  it('validates actor authoring under the active Markdown options', () => {
    const actor = createCoreActor()
    const opened = actor.handle({
      type: 'open',
      session: 763,
      sequence: 1,
      source: '$x$\n',
      options: { math: false }
    })
    const authored = actor.handle({
      type: 'author',
      session: 763,
      sequence: 2,
      baseRevision: opened.revision,
      form: 'substitution',
      range: { start: 1, end: 2 },
      text: 'y',
      projections: []
    })

    expect(authored).toMatchObject({
      type: 'applied',
      change: {
        appliedEdits: [{ start: 1, end: 2, insert: '{~~x~>y~~}' }]
      }
    })
    actor.dispose()
  })

  it('snapshots caller-owned recovery history before asynchronous open transport', async() => {
    const actor = createCoreActor()
    const port: CoreActorPort = Object.freeze({
      async request(request: CoreRequest) {
        await Promise.resolve()
        return actor.handle(request)
      },
      dispose: () => actor.dispose()
    })
    const binding = createEditorCoreBinding(port)
    const recoveryHistory = {
      undo: [{
        undo: [{ start: 1, end: 2, insert: '' }],
        redo: [{ start: 1, end: 1, insert: 'X' }]
      }],
      redo: []
    }

    const opening = binding.open({
      documentId: 'recovered.md',
      source: 'aXbc',
      recoveryHistory
    })
    recoveryHistory.undo[0]!.undo[0]!.start = 99
    await expect(opening).resolves.toMatchObject({ type: 'opened', revision: 1 })

    await expect(binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 2,
      source: 'abc'
    })

    binding.dispose()
  })

  it('bounds actor-owned history by the engine entry and retained-unit policy', () => {
    const actor = createCoreActor(createDocumentCore, {
      maximumHistoryEntries: 3,
      maximumHistoryInsertUnits: 100,
      maximumHistoryEditRecords: 4
    })
    expect(actor.handle({
      type: 'open',
      session: 91,
      sequence: 1,
      source: 'abcd'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'apply',
      session: 91,
      sequence: 2,
      baseRevision: 1,
      edits: [{ start: 0, end: 1, insert: 'X' }],
      projections: []
    })).toMatchObject({ type: 'applied', revision: 2 })
    expect(actor.handle({
      type: 'apply',
      session: 91,
      sequence: 3,
      baseRevision: 2,
      edits: [{ start: 1, end: 2, insert: 'YYY' }],
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'apply',
      session: 91,
      sequence: 4,
      baseRevision: 3,
      edits: [{ start: 4, end: 5, insert: 'Z' }],
      projections: []
    })).toMatchObject({ type: 'applied', revision: 4 })

    const firstUndo = actor.handle({
      type: 'undo',
      session: 91,
      sequence: 5,
      baseRevision: 4,
      projections: []
    })
    expect(firstUndo).toMatchObject({ type: 'applied', revision: 5 })
    const secondUndo = actor.handle({
      type: 'undo',
      session: 91,
      sequence: 6,
      baseRevision: 5,
      projections: []
    })
    expect(secondUndo).toMatchObject({ type: 'applied', revision: 6 })
    const thirdUndo = actor.handle({
      type: 'undo',
      session: 91,
      sequence: 7,
      baseRevision: 6,
      projections: []
    })
    expect(thirdUndo).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 6
    })
    actor.dispose()

    expect(() => createCoreActor(createDocumentCore, {
      maximumHistoryEntries: 257,
      maximumHistoryEditRecords: 8_193
    })).toThrow('cannot exceed the engine resource policy')
  })

  it('rejects one Review resolution that cannot remain undoable', () => {
    const actor = createCoreActor(createDocumentCore, {
      maximumHistoryEntries: 3,
      maximumHistoryInsertUnits: 5,
      maximumHistoryEditRecords: 20
    })
    const source = '{++abcdef++}'
    expect(actor.handle({
      type: 'open',
      session: 94,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'resolve',
      session: 94,
      sequence: 2,
      baseRevision: 1,
      annotation: { kind: 'addition', range: { start: 0, end: 12 } },
      decision: 'accept',
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-resource',
      revision: 1,
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 94,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 94,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
    actor.dispose()
  })

  it('rejects an edit set that cannot be reconciled within the interactive history policy', () => {
    const actor = createCoreActor()
    const source = 'ab'.repeat(257)
    expect(actor.handle({
      type: 'open',
      session: 93,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    const edits = Array.from({ length: 257 }, (_, index) => ({
      start: index * 2,
      end: index * 2 + 1,
      insert: 'X'
    }))

    expect(actor.handle({
      type: 'apply',
      session: 93,
      sequence: 2,
      baseRevision: 1,
      edits,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-resource',
      revision: 1,
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 93,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', revision: 1, source })

    actor.dispose()
  })

  it('charges history policy only for retained effective source edits', () => {
    const actor = createCoreActor(createDocumentCore, {
      maximumHistoryEditsPerEntry: 1
    })
    expect(actor.handle({
      type: 'open',
      session: 807,
      sequence: 1,
      source: 'ab'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'apply',
      session: 807,
      sequence: 2,
      baseRevision: 1,
      edits: [
        { start: 0, end: 1, insert: 'a' },
        { start: 1, end: 2, insert: 'B' }
      ],
      projections: []
    })).toMatchObject({
      type: 'applied',
      revision: 2,
      change: { appliedEdits: [{ start: 1, end: 2, insert: 'B' }] }
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 807,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'aB' })
    expect(actor.handle({
      type: 'undo',
      session: 807,
      sequence: 4,
      baseRevision: 2,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 3 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 807,
      sequence: 5,
      baseRevision: 3
    })).toMatchObject({ type: 'source', source: 'ab' })
    actor.dispose()
  })

  it('rejects a recovery snapshot whose combined undo and redo depth exceeds policy', () => {
    const actor = createCoreActor(createDocumentCore, {
      maximumHistoryEntries: 3,
      maximumHistoryInsertUnits: 100,
      maximumHistoryEditRecords: 20
    })
    const entry = Object.freeze({
      undo: Object.freeze([{ start: 0, end: 1, insert: 'a' }]),
      redo: Object.freeze([{ start: 0, end: 1, insert: 'b' }])
    })

    expect(actor.handle({
      type: 'open',
      session: 92,
      sequence: 1,
      source: 'a',
      recoveryHistory: Object.freeze({
        undo: Object.freeze([entry, entry]),
        redo: Object.freeze([entry, entry])
      })
    })).toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'history-resource',
      revision: 0,
      sourceLength: 0
    })

    actor.dispose()
  })

  it('rejects malformed recovery history without terminalizing the actor', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 797,
      sequence: 1,
      source: 'safe',
      recoveryHistory: null as unknown as CoreHistorySnapshot
    })).toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })
    expect(actor.handle({
      type: 'open',
      session: 797,
      sequence: 2,
      source: 'safe'
    })).toMatchObject({ type: 'opened', revision: 1 })
    actor.dispose()
  })

  it('rejects a malformed open source without publishing an actor session', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 806,
      sequence: 1,
      source: null as unknown as string
    })).toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'invalid-edit',
      revision: 0,
      sourceLength: 0
    })
    expect(actor.handle({
      type: 'open',
      session: 806,
      sequence: 2,
      source: 'safe'
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 806,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source: 'safe' })
    actor.dispose()
  })

  it('rejects recovery history that is not exactly reversible before opening', () => {
    const actor = createCoreActor()
    const source = 'safe'
    expect(actor.handle({
      type: 'open',
      session: 795,
      sequence: 1,
      source,
      recoveryHistory: Object.freeze({
        undo: Object.freeze([Object.freeze({
          undo: Object.freeze([{ start: 0, end: 4, insert: '' }]),
          redo: Object.freeze([{ start: 0, end: 0, insert: 'unsafe' }])
        })]),
        redo: Object.freeze([])
      })
    })).toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })

    expect(actor.handle({
      type: 'open',
      session: 795,
      sequence: 2,
      source
    })).toMatchObject({ type: 'opened', revision: 1, sourceLength: 4 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 795,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    actor.dispose()
  })

  it('rejects reversible recovery history whose reachable source exceeds policy', () => {
    const actor = createCoreActor()
    const source = 'safe'
    const unreachable = '++}'.repeat(1_025)
    expect(actor.handle({
      type: 'open',
      session: 796,
      sequence: 1,
      source,
      recoveryHistory: Object.freeze({
        undo: Object.freeze([Object.freeze({
          undo: Object.freeze([{
            start: 0,
            end: source.length,
            insert: unreachable
          }]),
          redo: Object.freeze([{
            start: 0,
            end: unreachable.length,
            insert: source
          }])
        })]),
        redo: Object.freeze([])
      })
    })).toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })
    expect(actor.handle({
      type: 'open',
      session: 796,
      sequence: 2,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    actor.dispose()
  })

  it('rejects no-op recovery history without publishing an actor session', () => {
    const actor = createCoreActor()
    const source = 'seed\n'
    const identity = Object.freeze({
      undo: Object.freeze([{ start: 0, end: 4, insert: 'seed' }]),
      redo: Object.freeze([{ start: 0, end: 4, insert: 'seed' }])
    })
    expect(actor.handle({
      type: 'open',
      session: 803,
      sequence: 1,
      source,
      recoveryHistory: Object.freeze({
        undo: Object.freeze([identity]),
        redo: Object.freeze([])
      })
    })).toMatchObject({
      type: 'rejected',
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })
    expect(actor.handle({
      type: 'open',
      session: 803,
      sequence: 2,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'undo',
      session: 803,
      sequence: 3,
      baseRevision: 1,
      projections: []
    })).toMatchObject({ type: 'rejected', reason: 'history-empty', revision: 1 })
    actor.dispose()
  })

  it('rejects an empty recovery entry without publishing an actor session', () => {
    const actor = createCoreActor()
    expect(actor.handle({
      type: 'open',
      session: 804,
      sequence: 1,
      source: 'safe',
      recoveryHistory: Object.freeze({
        undo: Object.freeze([Object.freeze({
          undo: Object.freeze([]),
          redo: Object.freeze([])
        })]),
        redo: Object.freeze([])
      })
    })).toMatchObject({
      type: 'rejected',
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })
    expect(actor.handle({
      type: 'open',
      session: 804,
      sequence: 2,
      source: 'safe'
    })).toMatchObject({ type: 'opened', revision: 1 })
    actor.dispose()
  })

  it('restores mixed undo and redo stacks in actor execution order', () => {
    const actor = createCoreActor()
    const entry = (undoInsert: string, redoInsert: string) => Object.freeze({
      undo: Object.freeze([{ start: 0, end: 1, insert: undoInsert }]),
      redo: Object.freeze([{ start: 0, end: 1, insert: redoInsert }])
    })
    expect(actor.handle({
      type: 'open',
      session: 799,
      sequence: 1,
      source: 'c',
      recoveryHistory: Object.freeze({
        undo: Object.freeze([entry('a', 'b'), entry('b', 'c')]),
        redo: Object.freeze([entry('d', 'e'), entry('c', 'd')])
      })
    })).toMatchObject({ type: 'opened', revision: 1 })

    expect(actor.handle({
      type: 'undo',
      session: 799,
      sequence: 2,
      baseRevision: 1,
      projections: []
    })).toMatchObject({ type: 'applied', revision: 2 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 799,
      sequence: 3,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'b' })
    for (const [sequence, baseRevision, expected] of [
      [4, 2, 'c'],
      [6, 3, 'd'],
      [8, 4, 'e']
    ] as const) {
      expect(actor.handle({
        type: 'redo',
        session: 799,
        sequence,
        baseRevision,
        projections: []
      })).toMatchObject({ type: 'applied', revision: baseRevision + 1 })
      expect(actor.handle({
        type: 'source-at-barrier',
        session: 799,
        sequence: sequence + 1,
        baseRevision: baseRevision + 1
      })).toMatchObject({ type: 'source', source: expected })
    }
    actor.dispose()
  })

  it('submits undo through the one production transaction interface', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history.md', source: 'alpha' })
    await binding.submit({
      edits: [{ start: 5, end: 5, insert: '!' }],
      projections: []
    }).acknowledged

    const undone = await binding.submit({ kind: 'undo', projections: [] }).acknowledged
    const source = await binding.sourceAtBarrier()

    expect(undone).toMatchObject({
      type: 'applied',
      revision: 3,
      change: { appliedEdits: [{ start: 5, end: 6, insert: '' }] }
    })
    expect(source).toMatchObject({ type: 'source', source: 'alpha' })
    binding.dispose()
  })

  it('rejects a stale edit without changing the authoritative revision', async() => {
    const worker = new ActorBackedCoreWorker()
    const port = createWorkerCorePort(worker)
    const opened = await port.request({
      type: 'open',
      session: 9,
      sequence: 1,
      source: 'alpha'
    })

    await expect(port.request({
      type: 'apply',
      session: 9,
      sequence: 2,
      baseRevision: opened.revision - 1,
      edits: [{ start: 0, end: 5, insert: 'wrong' }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'stale-base',
      revision: 1,
      sourceLength: 5
    })
    await expect(port.request({
      type: 'apply',
      session: 9,
      sequence: 3,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 5, insert: 'right' }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'applied',
      accepted: true,
      revision: 2,
      sourceLength: 5
    })

    port.dispose()
  })

  it('does not record an exact identity source edit', () => {
    const actor = createCoreActor()
    const source = 'seed\n'
    expect(actor.handle({
      type: 'open',
      session: 801,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'apply',
      session: 801,
      sequence: 2,
      baseRevision: 1,
      edits: [{ start: 0, end: 4, insert: 'seed' }],
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'no-change',
      revision: 1,
      sourceLength: source.length
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 801,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 801,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })
    actor.dispose()
  })

  it('does not record a net-zero source edit transaction', () => {
    const actor = createCoreActor()
    const source = 'a'
    expect(actor.handle({
      type: 'open',
      session: 802,
      sequence: 1,
      source
    })).toMatchObject({ type: 'opened', revision: 1 })
    expect(actor.handle({
      type: 'apply',
      session: 802,
      sequence: 2,
      baseRevision: 1,
      edits: [
        { start: 0, end: 0, insert: 'a' },
        { start: 0, end: 1, insert: '' }
      ],
      projections: []
    })).toMatchObject({
      type: 'rejected',
      reason: 'no-change',
      revision: 1,
      sourceLength: 1
    })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 802,
      sequence: 3,
      baseRevision: 1
    })).toMatchObject({ type: 'source', source })
    expect(actor.handle({
      type: 'undo',
      session: 802,
      sequence: 4,
      baseRevision: 1,
      projections: []
    })).toMatchObject({ type: 'rejected', reason: 'history-empty', revision: 1 })
    expect(actor.handle({
      type: 'apply',
      session: 802,
      sequence: 5,
      baseRevision: 1,
      edits: [{ start: 1, end: 1, insert: '!' }],
      projections: []
    })).toMatchObject({ type: 'applied', revision: 2 })
    expect(actor.handle({
      type: 'source-at-barrier',
      session: 802,
      sequence: 6,
      baseRevision: 2
    })).toMatchObject({ type: 'source', source: 'a!' })
    actor.dispose()
  })

  it('rejects a stale source barrier without materializing source', async() => {
    const worker = new ActorBackedCoreWorker()
    const port = createWorkerCorePort(worker)
    await port.request({ type: 'open', session: 19, sequence: 1, source: 'alpha' })

    await expect(port.request({
      type: 'source-at-barrier',
      session: 19,
      sequence: 2,
      baseRevision: 0
    })).resolves.toEqual({
      type: 'rejected',
      session: 19,
      sequence: 2,
      revision: 1,
      accepted: false,
      reason: 'stale-base',
      sourceLength: 5
    })
    expect(worker.requests.at(-1)?.request).not.toHaveProperty('source')
    port.dispose()
  })

  it('rejects an invalid exact edit without changing the authoritative revision', async() => {
    const worker = new ActorBackedCoreWorker()
    const port = createWorkerCorePort(worker)
    const opened = await port.request({
      type: 'open',
      session: 10,
      sequence: 1,
      source: 'alpha'
    })

    await expect(port.request({
      type: 'apply',
      session: 10,
      sequence: 2,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 6, insert: 'wrong' }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'invalid-edit',
      revision: 1,
      sourceLength: 5
    })
    await expect(port.request({
      type: 'apply',
      session: 10,
      sequence: 3,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 5, insert: 'right' }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      sourceLength: 5
    })

    port.dispose()
  })

  it('reports a resource rejection without changing the authoritative revision', async() => {
    const worker = new ActorBackedCoreWorker()
    const port = createWorkerCorePort(worker)
    const opened = await port.request({
      type: 'open',
      session: 11,
      sequence: 1,
      source: 'alpha'
    })

    await expect(port.request({
      type: 'apply',
      session: 11,
      sequence: 2,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 0, insert: '++}'.repeat(1_025) }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'resource',
      accepted: false,
      revision: 1,
      sourceLength: 5,
      resource: {
        code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
        range: expect.any(Object),
        metadata: { limit: '1024', observed: '1025' }
      }
    })
    await expect(port.request({
      type: 'apply',
      session: 11,
      sequence: 3,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 5, insert: 'right' }],
      projections: ['markup']
    })).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      sourceLength: 5
    })

    port.dispose()
  })

  it('allows only one Core edit transaction in flight', async() => {
    const binding = createEditorCoreBinding(
      createWorkerCorePort(new ActorBackedCoreWorker())
    )
    await binding.open({ documentId: 'one.md', source: 'alpha' })

    const first = submitMarkup(binding, [{ start: 5, end: 5, insert: '!' }])
    expect(() => submitMarkup(binding, [{ start: 5, end: 5, insert: '?' }]))
      .toThrow('Core edit transaction is already in flight')
    await expect(first).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      sourceLength: 6
    })

    binding.dispose()
  })

  it('allows a valid open after a resource-rejected open', async() => {
    const port = createWorkerCorePort(new ActorBackedCoreWorker())

    await expect(port.request({
      type: 'open',
      session: 12,
      sequence: 1,
      source: '++}'.repeat(1_025)
    })).resolves.toMatchObject({
      type: 'resource',
      accepted: false,
      revision: 0,
      sourceLength: 0,
      resource: { code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED' }
    })
    await expect(port.request({
      type: 'open',
      session: 12,
      sequence: 2,
      source: 'fresh'
    })).resolves.toMatchObject({
      type: 'opened',
      accepted: true,
      revision: 1,
      sourceLength: 5
    })

    port.dispose()
  })

  it('returns a typed rejected-open outcome and retries on the same binding', async() => {
    const binding = createEditorCoreBinding(
      createWorkerCorePort(new ActorBackedCoreWorker())
    )

    await expect(binding.open({
      documentId: 'retry.md',
      source: '++}'.repeat(1_025)
    })).resolves.toMatchObject({
      type: 'resource',
      accepted: false,
      revision: 0,
      sourceLength: 0
    })
    await expect(binding.open({
      documentId: 'retry.md',
      source: 'fresh'
    })).resolves.toMatchObject({
      type: 'opened',
      accepted: true,
      revision: 1,
      sourceLength: 5
    })

    binding.dispose()
  })

  it('rejects malformed recovery history through the binding and retries', async() => {
    const binding = createEditorCoreBinding(
      createWorkerCorePort(new ActorBackedCoreWorker())
    )

    await expect(binding.open({
      documentId: 'malformed-recovery.md',
      source: 'safe',
      recoveryHistory: null as unknown as CoreHistorySnapshot
    })).resolves.toMatchObject({
      type: 'rejected',
      accepted: false,
      reason: 'recovery-history-invalid',
      revision: 0,
      sourceLength: 0
    })
    await expect(binding.open({
      documentId: 'malformed-recovery.md',
      source: 'safe'
    })).resolves.toMatchObject({
      type: 'opened',
      accepted: true,
      revision: 1,
      sourceLength: 4
    })
    binding.dispose()
  })

  it('submits caller projections with stable identity and observes typed outcomes', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    const source = 'head\n\nbefore {>>note<<} after\n\ntail\n'
    const opened = await binding.open({ documentId: 'identity.md', source })
    expect(opened.type).toBe('opened')
    const range = { start: source.indexOf('{>>'), end: source.indexOf('<<}') + 3 }
    const observed: unknown[] = []
    binding.observe(() => { throw new Error('isolated observer') })
    const unsubscribe = binding.observe(event => observed.push(event))
    const editAt = source.indexOf('note')
    const submission = binding.submit({
      edits: [{ start: editAt, end: editAt + 4, insert: 'NOTE' }],
      projections: ['markup', { name: 'comment', annotationRange: range }]
    })

    expect(submission.identity).toMatchObject({
      documentId: 'identity.md',
      generation: expect.any(Number),
      transactionId: expect.any(Number)
    })
    await expect(submission.acknowledged).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        projections: [
          { name: 'markup' },
          { name: 'comment' }
        ]
      }
    })
    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        projections: ['markup', { name: 'comment', annotationRange: range }]
      }
    })
    expect(observed).toEqual([expect.objectContaining({
      identity: submission.identity,
      outcome: expect.objectContaining({ type: 'applied' })
    })])
    unsubscribe()

    binding.dispose()
  })

  it('bounds diagnostic transport while retaining the exact diagnostic count', async() => {
    const binding = createEditorCoreBinding(
      createWorkerCorePort(new ActorBackedCoreWorker())
    )
    const source = '{++'.repeat(20)

    const opened = await binding.open({ documentId: 'diagnostics.md', source })

    expect(opened).toMatchObject({
      type: 'opened',
      diagnosticCount: 20
    })
    expect(opened.type === 'opened' && opened.diagnostics).toHaveLength(16)
    expect(() => structuredClone(opened)).not.toThrow()
    binding.dispose()
  })

  it('rejects pending and future requests after a Worker failure', async() => {
    const worker = new FailingCoreWorker()
    const port = createWorkerCorePort(worker)
    const pending = port.request({
      type: 'open',
      session: 13,
      sequence: 1,
      source: 'alpha'
    })
    worker.fail('Core Worker crashed')

    const outcome = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 20))
    ])
    expect(outcome).toBe('rejected')
    await expect(port.request({
      type: 'open',
      session: 13,
      sequence: 2,
      source: 'later'
    })).rejects.toThrow('Core Worker crashed')

    port.dispose()
  })

  it('terminates the actual port Worker through the opt-in test control', async() => {
    const worker = new ActorBackedCoreWorker()
    let control: CoreWorkerTestControl | undefined
    const port = createWorkerCorePort(worker, {
      registerTestControl: value => { control = value }
    })
    const opened = await port.request({
      type: 'open',
      session: 14,
      sequence: 1,
      source: 'alpha'
    })
    worker.holdApplyReplies = true
    const pending = port.request({
      type: 'apply',
      session: 14,
      sequence: 2,
      baseRevision: opened.revision,
      edits: [{ start: 5, end: 5, insert: '!' }],
      projections: []
    })

    expect(control).toBeDefined()
    control?.crash()

    await expect(pending).rejects.toThrow(
      'Core Worker was terminated by the test harness'
    )
    await expect(port.request({
      type: 'source-at-barrier',
      session: 14,
      sequence: 3,
      baseRevision: 1
    })).rejects.toThrow('Core Worker was terminated by the test harness')
    expect(worker.terminations).toBe(1)
    port.dispose()
  })

  it('obtains a typed stale reply from the actor through the opt-in test control', async() => {
    const worker = new ActorBackedCoreWorker()
    let control: CoreWorkerTestControl | undefined
    const port = createWorkerCorePort(worker, {
      registerTestControl: value => { control = value }
    })
    const opened = await port.request({
      type: 'open',
      session: 15,
      sequence: 1,
      source: 'alpha'
    })

    expect(control).toBeDefined()
    control?.staleNextTransaction()
    const outcome = await port.request({
      type: 'apply',
      session: 15,
      sequence: 2,
      baseRevision: opened.revision,
      edits: [{ start: 5, end: 5, insert: '!' }],
      projections: []
    })
    const source = await port.request({
      type: 'source-at-barrier',
      session: 15,
      sequence: 3,
      baseRevision: opened.revision
    })

    expect(outcome).toMatchObject({
      type: 'rejected',
      reason: 'stale-base',
      revision: 1
    })
    expect(worker.requests[1]).toMatchObject({
      request: { type: 'apply', baseRevision: 0 }
    })
    expect(source).toMatchObject({ type: 'source', source: 'alpha' })
    port.dispose()
  })

  it('latches an actor failure envelope as a terminal Worker fault', async() => {
    const worker = new CoreFailureReportingWorker()
    const port = createWorkerCorePort(worker)
    const request = {
      type: 'open' as const,
      session: 301,
      sequence: 1,
      source: 'alpha'
    }

    await expect(port.request(request)).rejects.toThrow('actor terminated unexpectedly')
    await expect(port.request({ ...request, sequence: 2 })).rejects.toThrow(
      'actor terminated unexpectedly'
    )
    expect(worker.posts).toBe(1)
    expect(worker.terminations).toBe(1)

    port.dispose()
  })
})

describe('Core document session manager', () => {
  it('does not expose WYSIWYG until the Core source is reconciled and handed off', async() => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const states: string[] = []
    const reconcile = vi.fn()
    const lease = { documentId: 'a.md' } as CoreDocumentViewLease
    const manager = {
      async saveBarrier() {
        await held
        return { source: 'acknowledged source' }
      },
      handoff: vi.fn(async() => {})
    }

    const transition = handoffCoreDocumentView({
      manager,
      lease,
      reconcile,
      setState: state => states.push(state)
    })
    expect(states).toEqual(['reconciling'])
    expect(reconcile).not.toHaveBeenCalled()
    expect(manager.handoff).not.toHaveBeenCalled()

    release()
    await transition
    expect(reconcile).toHaveBeenCalledWith('a.md', 'acknowledged source')
    expect(manager.handoff).toHaveBeenCalledWith(lease)
    expect(states).toEqual(['reconciling', 'wysiwyg'])
  })

  it('keeps the Source view active when its authority barrier rejects', async() => {
    const states: string[] = []
    const lease = { documentId: 'a.md' } as CoreDocumentViewLease
    await expect(handoffCoreDocumentView({
      manager: {
        saveBarrier: () => Promise.reject(new Error('stale authority')),
        handoff: vi.fn()
      },
      lease,
      reconcile: vi.fn(),
      setState: state => states.push(state)
    })).rejects.toThrow('stale authority')
    expect(states).toEqual(['reconciling', 'source'])
  })

  it('retires a closed tab session without disturbing live document authority', async() => {
    const close = vi.fn(async() => {})
    const abort = vi.fn()
    const unregisterA = vi.fn()
    const unregisterB = vi.fn()
    const openedDocumentIds = new Set(['a.md', 'b.md'])
    const registrations = new Map([
      ['a.md', unregisterA],
      ['b.md', unregisterB]
    ])

    await retireClosedCoreDocumentSessions({
      manager: { close, abort },
      openedDocumentIds,
      liveDocumentIds: new Set(['b.md']),
      registrations
    })

    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith('a.md')
    expect(abort).not.toHaveBeenCalled()
    expect(unregisterA).toHaveBeenCalledTimes(1)
    expect(unregisterB).not.toHaveBeenCalled()
    expect([...openedDocumentIds]).toEqual(['b.md'])
    expect([...registrations.keys()]).toEqual(['b.md'])
  })

  it('aborts every opened session when final view handoff fails', async() => {
    const workers = new Map<string, ActorBackedCoreWorker>()
    const manager = createCoreDocumentSessionManager({
      createBinding(documentId) {
        const worker = new ActorBackedCoreWorker()
        workers.set(documentId, worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({ documentId: 'a.md', source: 'alpha', lineEnding: '\n' })
    await manager.open({ documentId: 'b.md', source: 'beta', lineEnding: '\n' })
    const lease = manager.lease('a.md')
    lease.onHandoff(() => { throw new Error('final view cleanup failed') })

    await expect(teardownCoreDocumentSessions({
      manager,
      transition: Promise.resolve(),
      finalLease: () => lease,
      clearFinalLease: () => {},
      documentIds: ['a.md', 'b.md']
    })).rejects.toThrow('final view cleanup failed')

    expect(workers.get('a.md')?.terminations).toBe(1)
    expect(workers.get('b.md')?.terminations).toBe(1)
    expect(() => manager.lease('a.md')).toThrow('not open')
    expect(() => manager.lease('b.md')).toThrow('not open')
  })

  it('releases the lease and disposes the binding when abort cleanup throws', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({ documentId: 'abort-cleanup.md', source: 'alpha', lineEnding: '\n' })
    const lease = manager.lease('abort-cleanup.md')
    lease.onHandoff(() => { throw new Error('abort cleanup failed') })

    expect(() => manager.abort('abort-cleanup.md')).toThrow('abort cleanup failed')
    expect(worker.terminations).toBe(1)
    expect(() => lease.binding.submit({ edits: [], projections: [] })).toThrow(
      'lease is released'
    )
    expect(() => manager.lease('abort-cleanup.md')).toThrow('not open')
  })

  it('releases a handed-off lease even when terminal view cleanup throws', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    await manager.open({ documentId: 'cleanup.md', source: 'alpha', lineEnding: '\n' })
    const first = manager.lease('cleanup.md')
    let cleanupCalls = 0
    first.onHandoff(() => {
      cleanupCalls += 1
      throw new Error('view cleanup failed')
    })

    await expect(manager.handoff(first)).rejects.toThrow('view cleanup failed')
    const replacement = manager.lease('cleanup.md')
    await manager.handoff(replacement)
    expect(cleanupCalls).toBe(1)
    await manager.close('cleanup.md')
  })

  it('does not expose source after rejection and can explicitly abort the session', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({ documentId: 'abort.md', source: 'alpha', lineEnding: '\n' })
    const lease = manager.lease('abort.md')
    const rejected = lease.binding.submit({
      edits: [{ start: 0, end: 0, insert: '++}'.repeat(1_025) }],
      projections: ['markup']
    })

    await expect(rejected.acknowledged).resolves.toMatchObject({
      type: 'resource',
      revision: 1,
      sourceLength: 5
    })
    await expect(manager.saveBarrier('abort.md')).rejects.toThrow(
      'requires reconciliation'
    )
    expect(worker.requests.map(item => item.request.type)).toEqual(['open', 'apply'])

    manager.abort('abort.md')
    expect(() => manager.lease('abort.md')).toThrow('not open')
    expect(() => lease.binding.submit({ edits: [], projections: [] })).toThrow(
      'lease is released'
    )
  })

  it('keeps a managed session saveable after an atomic history-resource refusal', async() => {
    const worker = new ActorBackedCoreWorker(createCoreActor(createDocumentCore, {
      maximumHistoryInsertUnits: 5
    }))
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    const source = '{++abcdef++}'
    await manager.open({
      documentId: 'history-resource.md',
      source,
      lineEnding: '\n'
    })
    const lease = manager.lease('history-resource.md')

    await expect(lease.binding.submit({
      kind: 'resolve',
      authoredRevision: 1,
      annotation: {
        kind: 'addition',
        range: { start: 0, end: source.length }
      },
      decision: 'accept',
      projections: []
    }).acknowledged).resolves.toMatchObject({
      type: 'rejected',
      reason: 'history-resource',
      revision: 1
    })
    await expect(manager.saveBarrier('history-resource.md')).resolves.toEqual(
      expect.objectContaining({ revision: 1, source })
    )
    await expect(lease.binding.submit({
      edits: [{ start: source.length, end: source.length, insert: '!' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(manager.saveBarrier('history-resource.md')).resolves.toEqual(
      expect.objectContaining({ revision: 2, source: `${source}!` })
    )

    await manager.handoff(lease)
    await manager.close('history-resource.md')
  })

  it('returns exact acknowledged bytes only after the save barrier drains', async() => {
    const worker = new ActorBackedCoreWorker()
    worker.holdApplyReplies = true
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    const source = 'head\r\n\r\nordinary text\r\n\r\ntail\r\n'
    await manager.open({ documentId: 'save.md', source, lineEnding: '\r\n' })
    const lease = manager.lease('save.md')
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, lease.binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n',
      projections: () => ['markup']
    })
    let detached = false
    lease.settleView(() => adapter.settled())
    lease.onHandoff(() => {
      detached = true
      adapter.dispose()
    })

    editor.replaceRange('TEXT', { line: 2, ch: 9 }, { line: 2, ch: 13 }, '+input')
    const barrier = manager.saveBarrier('save.md')
    while (worker.requests.length < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(await Promise.race([
      barrier.then(() => 'settled'),
      Promise.resolve('pending')
    ])).toBe('pending')

    worker.releaseNextApply()
    await expect(barrier).resolves.toEqual({
      documentId: 'save.md',
      revision: 2,
      identity: {
        generation: expect.any(Number),
        revision: 2
      },
      source: source.replace('text', 'TEXT'),
      lineEnding: '\r\n'
    })
    expect(detached).toBe(false)
    expect(worker.requests.at(-1)?.request).toMatchObject({
      type: 'source-at-barrier',
      baseRevision: 2
    })

    editor.replaceRange('TAIL', { line: 4, ch: 0 }, { line: 4, ch: 4 }, '+input')
    const secondBarrier = manager.saveBarrier('save.md')
    while (worker.requests.filter(item => item.request.type === 'apply').length < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    worker.releaseNextApply()
    await expect(secondBarrier).resolves.toEqual({
      documentId: 'save.md',
      revision: 3,
      identity: {
        generation: expect.any(Number),
        revision: 3
      },
      source: source.replace('text', 'TEXT').replace('tail', 'TAIL'),
      lineEnding: '\r\n'
    })

    await manager.handoff(lease)
    expect(detached).toBe(true)
    await manager.close('save.md')
  })

  it('coalesces concurrent source barriers inside one document session', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({ documentId: 'coalesced.md', source: 'alpha', lineEnding: '\n' })

    const first = manager.saveBarrier('coalesced.md')
    const second = manager.saveBarrier('coalesced.md')
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ documentId: 'coalesced.md', revision: 1, source: 'alpha' }),
      expect.objectContaining({ documentId: 'coalesced.md', revision: 1, source: 'alpha' })
    ])
    expect(worker.requests.filter(item => item.request.type === 'source-at-barrier')).toHaveLength(1)

    await manager.close('coalesced.md')
  })

  it('does not reuse a source snapshot after a newer edit is submitted', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({ documentId: 'fresh.md', source: 'alpha', lineEnding: '\n' })
    const first = await manager.saveBarrier('fresh.md')
    const lease = manager.lease('fresh.md')
    await lease.binding.submit({
      edits: [{ start: 0, end: 1, insert: 'A' }],
      projections: []
    }).acknowledged

    await expect(manager.saveBarrier('fresh.md')).resolves.toEqual(
      expect.objectContaining({ revision: 2, source: 'Alpha' })
    )
    expect(first).toEqual(expect.objectContaining({ revision: 1, source: 'alpha' }))
    expect(worker.requests.filter(item => item.request.type === 'source-at-barrier')).toHaveLength(2)

    await manager.handoff(lease)
    await manager.close('fresh.md')
  })

  it('invalidates a held source snapshot when a newer edit is submitted', async() => {
    const worker = new ActorBackedCoreWorker()
    worker.holdSourceReplies = true
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({ documentId: 'held.md', source: 'alpha', lineEnding: '\n' })
    const first = manager.saveBarrier('held.md')
    while (worker.requests.filter(item => item.request.type === 'source-at-barrier').length < 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const lease = manager.lease('held.md')
    await lease.binding.submit({
      edits: [{ start: 0, end: 1, insert: 'A' }],
      projections: []
    }).acknowledged
    const second = manager.saveBarrier('held.md')
    while (worker.requests.filter(item => item.request.type === 'source-at-barrier').length < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    worker.releaseNextSource()
    await expect(first).resolves.toEqual(expect.objectContaining({ revision: 1, source: 'alpha' }))
    worker.releaseNextSource()
    await expect(second).resolves.toEqual(expect.objectContaining({ revision: 2, source: 'Alpha' }))

    await manager.handoff(lease)
    await manager.close('held.md')
  })

  it('reopens exact disk bytes in a new generation before accepting later edits', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'reload.md',
      source: 'stale local source',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('reload.md')
    const oldEdit = oldLease.binding.submit({
      edits: [{ start: 0, end: 5, insert: 'STALE' }],
      projections: []
    })
    await expect(oldEdit.acknowledged).resolves.toMatchObject({ type: 'applied' })
    let crossedViewBarrier = false
    oldLease.settleView(async() => { crossedViewBarrier = true })

    const replacement = await manager.replace(oldLease, {
      documentId: 'reload.md',
      source: 'disk source\r\nnext',
      lineEnding: '\r\n'
    })
    expect(replacement.identity).toEqual({
      generation: expect.any(Number),
      revision: 3
    })
    expect(crossedViewBarrier).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[0]?.terminations).toBe(1)
    expect(workers[1]?.requests.map(item => item.request.type)).toEqual([
      'open',
      'apply',
      'source-at-barrier',
      'apply',
      'source-at-barrier'
    ])
    expect(workers[1]?.requests[0]?.request).toMatchObject({
      type: 'open',
      source: 'stale local source'
    })
    expect(workers[1]?.requests[3]?.request).toMatchObject({
      type: 'apply',
      edits: [{ start: 0, end: 18, insert: 'disk source\r\nnext' }]
    })
    expect(() => oldLease.binding.submit({ edits: [], projections: [] })).toThrow(
      'lease is released'
    )

    const nextEdit = replacement.binding.submit({
      edits: [{ start: 0, end: 4, insert: 'DISK' }],
      projections: []
    })
    expect(nextEdit.identity.generation).not.toBe(oldEdit.identity.generation)
    await expect(nextEdit.acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('reload.md')).resolves.toEqual({
      documentId: 'reload.md',
      revision: 4,
      identity: {
        generation: nextEdit.identity.generation,
        revision: 4
      },
      source: 'DISK source\r\nnext',
      lineEnding: '\r\n'
    })

    await manager.handoff(replacement)
    await manager.close('reload.md')
  })

  it('records external reload as one actor-owned undo and redo boundary', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const before = 'before {++local++}\n'
    const after = 'after {--disk--}\n\nnext\n'
    await manager.open({ documentId: 'reload-history.md', source: before, lineEnding: '\n' })
    const oldLease = manager.lease('reload-history.md')

    const replacement = await manager.replace(oldLease, {
      documentId: 'reload-history.md',
      source: after,
      lineEnding: '\n'
    })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('reload-history.md')).resolves.toMatchObject({
      source: before
    })

    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('reload-history.md')).resolves.toMatchObject({
      source: after
    })

    await manager.handoff(replacement)
    await manager.close('reload-history.md')
  })

  it('replaces a generation for byte-identical disk content without fake history', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    const source = 'same\n'
    await manager.open({ documentId: 'same.md', source, lineEnding: '\n' })
    const oldLease = manager.lease('same.md')

    const replacement = await manager.replace(oldLease, {
      documentId: 'same.md',
      source,
      lineEnding: '\n'
    })
    expect(replacement.identity.generation).not.toBe(oldLease.identity.generation)
    expect(workers[1]?.requests.map(item => item.request.type)).toEqual([
      'open',
      'source-at-barrier'
    ])
    await expect(manager.saveBarrier('same.md')).resolves.toMatchObject({
      source,
      revision: 1
    })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({
      type: 'rejected',
      reason: 'history-empty',
      revision: 1
    })

    await manager.handoff(replacement)
    await manager.close('same.md')
  })

  it('keeps the acknowledged session usable when a replacement generation cannot open', async() => {
    const oldWorker = new ActorBackedCoreWorker()
    let bindingIndex = 0
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        bindingIndex += 1
        if (bindingIndex === 1) {
          return createEditorCoreBinding(createWorkerCorePort(oldWorker))
        }
        return Object.freeze({
          ...testBinding(async() => { throw new Error('unexpected replacement submit') }),
          open: () => Promise.reject(new Error('replacement open failed'))
        })
      }
    })
    await manager.open({
      documentId: 'reload-failure.md',
      source: 'old acknowledged source',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('reload-failure.md')

    await expect(manager.replace(oldLease, {
      documentId: 'reload-failure.md',
      source: 'rejected disk source',
      lineEnding: '\n'
    })).rejects.toThrow('replacement open failed')

    await expect(oldLease.binding.submit({
      edits: [{ start: 3, end: 3, insert: ' still' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('reload-failure.md')).resolves.toMatchObject({
      source: 'old still acknowledged source'
    })

    await manager.handoff(oldLease)
    await manager.close('reload-failure.md')
  })

  it('ignores an old-generation acknowledgement delivered after replacement', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'late.md',
      source: 'old source',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('late.md')
    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('old Core generation was not created')
    const observed: string[] = []
    oldLease.binding.observe(event => { observed.push(event.outcome.type) })
    oldWorker.holdApplyReplies = true
    const oldEdit = oldLease.binding.submit({
      edits: [{ start: 0, end: 3, insert: 'OLD' }],
      projections: []
    })
    const oldSettlement = oldEdit.acknowledged.then(
      () => 'published',
      () => 'retired'
    )

    const replacement = await manager.replace(oldLease, {
      documentId: 'late.md',
      source: 'disk bytes',
      lineEnding: '\n'
    })
    await expect(oldSettlement).resolves.toBe('retired')
    oldWorker.releaseNextApply()
    await Promise.resolve()
    expect(observed).toEqual([])

    const nextEdit = replacement.binding.submit({
      edits: [{ start: 10, end: 10, insert: '!' }],
      projections: []
    })
    expect(nextEdit.identity.generation).not.toBe(oldEdit.identity.generation)
    await expect(nextEdit.acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('late.md')).resolves.toEqual(
      expect.objectContaining({ revision: 3, source: 'disk bytes!' })
    )

    await manager.handoff(replacement)
    await manager.close('late.md')
  })

  it('keeps an acknowledgement that arrives while a replacement candidate is opening', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        if (workers.length > 0) worker.holdSourceReplies = true
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'reload-race.md',
      source: 'old source',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('reload-race.md')
    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('old reload Worker was not created')
    oldWorker.holdApplyReplies = true
    const pending = oldLease.binding.submit({
      edits: [{ start: 0, end: 3, insert: 'OLD' }],
      projections: []
    })

    const replacing = manager.replace(oldLease, {
      documentId: 'reload-race.md',
      source: 'disk source',
      lineEnding: '\n'
    })
    while ((workers[1]?.requests.length ?? 0) < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    oldWorker.releaseNextApply()
    await expect(pending.acknowledged).resolves.toMatchObject({ type: 'applied' })

    const candidate = workers[1]
    if (candidate === undefined) throw new Error('replacement candidate was not created')
    candidate.releaseNextSource()
    while (candidate.requests.filter(item =>
      item.request.type === 'source-at-barrier'
    ).length < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    candidate.releaseNextSource()

    await expect(replacing).rejects.toThrow('source changed during candidate open')
    await expect(manager.saveBarrier('reload-race.md')).resolves.toMatchObject({
      source: 'OLD source'
    })

    await manager.handoff(oldLease)
    await manager.close('reload-race.md')
  })

  it('recovers a faulted Worker from its checkpoint and acknowledged command journal', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        if (workers.length > 0) worker.holdApplyReplies = true
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'recover.md',
      source: 'alpha',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover.md')
    const accepted = oldLease.binding.submit({
      edits: [{ start: 0, end: 1, insert: 'A' }],
      projections: []
    })
    await expect(accepted.acknowledged).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })

    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('old Core generation was not created')
    const observedAfterFault: string[] = []
    oldLease.binding.observe(event => { observedAfterFault.push(event.outcome.type) })
    oldWorker.holdApplyReplies = true
    const unacknowledged = oldLease.binding.submit({
      edits: [{ start: 4, end: 5, insert: 'Z' }],
      projections: []
    })
    oldWorker.fail('Core Worker crashed')
    await expect(unacknowledged.acknowledged).rejects.toThrow('Core Worker crashed')

    const recovering = manager.recover(oldLease)
    const saving = manager.saveBarrier('recover.md')
    while ((workers[1]?.requests.length ?? 0) < 2) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const recoveryWorker = workers[1]
    if (recoveryWorker === undefined) {
      throw new Error('replacement Core generation was not created')
    }
    expect(await Promise.race([
      saving.then(() => 'saved'),
      Promise.resolve('recovering')
    ])).toBe('recovering')
    expect(recoveryWorker.requests.map(envelope => envelope.request)).toEqual([
      expect.objectContaining({ type: 'open', source: 'alpha' }),
      expect.objectContaining({
        type: 'apply',
        edits: [{ start: 0, end: 1, insert: 'A' }]
      })
    ])

    recoveryWorker.releaseNextApply()
    const replacement = await recovering
    expect(replacement.binding).not.toBe(oldLease.binding)
    await expect(saving).resolves.toEqual({
      documentId: 'recover.md',
      revision: 2,
      identity: {
        generation: expect.any(Number),
        revision: 2
      },
      source: 'Alpha',
      lineEnding: '\n'
    })

    oldWorker.releaseNextApply()
    await Promise.resolve()
    expect(observedAfterFault).toEqual([])
    recoveryWorker.holdApplyReplies = false
    const next = replacement.binding.submit({
      edits: [{ start: 5, end: 5, insert: '!' }],
      projections: []
    })
    expect(next.identity.generation).not.toBe(accepted.identity.generation)
    await expect(next.acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(manager.saveBarrier('recover.md')).resolves.toMatchObject({
      source: 'Alpha!'
    })

    await manager.handoff(replacement)
    await manager.close('recover.md')
  })

  it('recovers a faulted speculative view from acknowledged actor history', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'recover-view.md',
      source: 'alpha',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-view.md')
    await expect(oldLease.binding.submit({
      edits: [{ start: 0, end: 1, insert: 'A' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('unsupported speculative view operation'))
    await expect(manager.saveBarrier('recover-view.md')).rejects.toThrow(
      'unsupported speculative view operation'
    )

    const replacement = await manager.recover(oldLease)
    expect(replacement.identity).toMatchObject({ revision: 2 })
    expect(replacement.identity.generation).not.toBe(oldLease.identity.generation)
    await expect(manager.saveBarrier('recover-view.md')).resolves.toMatchObject({
      source: 'Alpha',
      revision: 2
    })
    expect(workers[0]?.terminations).toBe(1)

    await manager.handoff(replacement)
    await manager.close('recover-view.md')
  })

  it('replays actor-authored Track Changes without renderer marker bytes', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'recover-track.md',
      source: 'seed\n',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-track.md')
    await expect(oldLease.binding.submit({
      kind: 'track',
      range: { start: 4, end: 4 },
      text: '!',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    expect(workers[0]?.requests.at(-1)?.request).toMatchObject({
      type: 'track',
      range: { start: 4, end: 4 },
      text: '!'
    })
    expect(workers[0]?.requests.at(-1)?.request).not.toHaveProperty('edit')

    oldLease.faultView(new Error('tracked paragraph requires projection rebind'))
    const replacement = await manager.recover(oldLease)
    expect(workers[1]?.requests.map(envelope => envelope.request)).toEqual([
      expect.objectContaining({ type: 'open', source: 'seed\n' }),
      expect.objectContaining({
        type: 'track',
        range: { start: 4, end: 4 },
        text: '!'
      })
    ])
    await expect(manager.saveBarrier('recover-track.md')).resolves.toMatchObject({
      source: 'seed{++!++}\n',
      revision: 2
    })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(manager.saveBarrier('recover-track.md')).resolves.toMatchObject({
      source: 'seed\n'
    })
    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(manager.saveBarrier('recover-track.md')).resolves.toMatchObject({
      source: 'seed{++!++}\n'
    })

    await manager.handoff(replacement)
    await manager.close('recover-track.md')
  })

  it('restores checkpointed Track Changes history after Worker recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'seed\n'
    const tracked = 'seed{++!++}\n'
    await manager.open({
      documentId: 'recover-checkpointed-track.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-checkpointed-track.md')
    await expect(oldLease.binding.submit({
      kind: 'track',
      range: { start: 4, end: 4 },
      text: '!',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(
      manager.saveBarrier('recover-checkpointed-track.md')
    ).resolves.toMatchObject({ source: tracked, revision: 2 })

    oldLease.faultView(new Error('restart after tracked checkpoint'))
    const replacement = await manager.recover(oldLease)
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(
      manager.saveBarrier('recover-checkpointed-track.md')
    ).resolves.toMatchObject({ source })
    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(
      manager.saveBarrier('recover-checkpointed-track.md')
    ).resolves.toMatchObject({ source: tracked })

    await manager.handoff(replacement)
    await manager.close('recover-checkpointed-track.md')
  })

  it('replays an acknowledged Review resolution with its undo history on recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'before {++new++} after\n'
    await manager.open({
      documentId: 'recover-review.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-review.md')
    await expect(oldLease.binding.submit({
      kind: 'resolve',
      authoredRevision: 1,
      annotation: { kind: 'addition', range: { start: 7, end: 16 } },
      decision: 'accept',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('Review presentation requires recovery'))
    const replacement = await manager.recover(oldLease)
    await expect(manager.saveBarrier('recover-review.md')).resolves.toMatchObject({
      source: 'before new after\n',
      revision: 2
    })

    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(manager.saveBarrier('recover-review.md')).resolves.toMatchObject({
      source,
      revision: 3
    })

    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(manager.saveBarrier('recover-review.md')).resolves.toMatchObject({
      source: 'before new after\n',
      revision: 4
    })

    await manager.handoff(replacement)
    await manager.close('recover-review.md')
  })

  it('rebases a post-checkpoint Review resolution onto its recovery generation', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'before {++new++} after\n'
    const checkpointed = `${source}!`
    const resolved = 'before new after\n!'
    await manager.open({
      documentId: 'recover-checkpointed-review.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-checkpointed-review.md')
    await expect(oldLease.binding.submit({
      edits: [{ start: source.length, end: source.length, insert: '!' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(
      manager.saveBarrier('recover-checkpointed-review.md')
    ).resolves.toMatchObject({ source: checkpointed, revision: 2 })
    await expect(oldLease.binding.submit({
      kind: 'resolve',
      authoredRevision: 2,
      annotation: { kind: 'addition', range: { start: 7, end: 16 } },
      decision: 'accept',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })

    oldLease.faultView(new Error('Review replay crosses an actor generation'))
    const replacement = await manager.recover(oldLease)
    await expect(
      manager.saveBarrier('recover-checkpointed-review.md')
    ).resolves.toMatchObject({ source: resolved, revision: 2 })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(
      manager.saveBarrier('recover-checkpointed-review.md')
    ).resolves.toMatchObject({ source: checkpointed })
    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(
      manager.saveBarrier('recover-checkpointed-review.md')
    ).resolves.toMatchObject({ source: resolved })

    await manager.handoff(replacement)
    await manager.close('recover-checkpointed-review.md')
  })

  it('replays acknowledged authoring with its undo and redo history on recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'alpha selected omega\n'
    const authoredSource = 'alpha {==selected==}{>>note<<} omega\n'
    await manager.open({
      documentId: 'recover-author.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-author.md')
    await expect(oldLease.binding.submit({
      kind: 'author',
      form: 'comment',
      range: { start: 6, end: 14 },
      text: 'note',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('Author presentation requires recovery'))
    const replacement = await manager.recover(oldLease)
    await expect(manager.saveBarrier('recover-author.md')).resolves.toMatchObject({
      source: authoredSource,
      revision: 2
    })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(manager.saveBarrier('recover-author.md')).resolves.toMatchObject({
      source,
      revision: 3
    })
    await expect(replacement.binding.submit({
      kind: 'redo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(manager.saveBarrier('recover-author.md')).resolves.toMatchObject({
      source: authoredSource,
      revision: 4
    })

    await manager.handoff(replacement)
    await manager.close('recover-author.md')
  })

  it('replays acknowledged Comment editing with its undo history on recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'before {==text==}{>>old note<<} after\n'
    const edited = 'before {==text==}{>>new note<<} after\n'
    await manager.open({
      documentId: 'recover-edit-comment.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-edit-comment.md')
    await expect(oldLease.binding.submit({
      kind: 'edit-comment',
      authoredRevision: 1,
      annotation: {
        kind: 'commented-span',
        range: { start: 7, end: 31 },
        highlightRange: { start: 7, end: 17 },
        commentRange: { start: 17, end: 31 }
      },
      text: 'new note',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('Comment presentation requires recovery'))
    const replacement = await manager.recover(oldLease)
    await expect(
      manager.saveBarrier('recover-edit-comment.md')
    ).resolves.toMatchObject({ source: edited, revision: 2 })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(
      manager.saveBarrier('recover-edit-comment.md')
    ).resolves.toMatchObject({ source, revision: 3 })

    await manager.handoff(replacement)
    await manager.close('recover-edit-comment.md')
  })

  it('replays atomic bulk Review resolution with its undo history on recovery', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    const source = 'A {++new++} B {--old--} C {~~left~>right~~}\n'
    const accepted = 'A new B  C right\n'
    await manager.open({
      documentId: 'recover-resolve-all.md',
      source,
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-resolve-all.md')
    await expect(oldLease.binding.submit({
      kind: 'resolve-all',
      decision: 'accept',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })

    oldLease.faultView(new Error('Bulk Review presentation requires recovery'))
    const replacement = await manager.recover(oldLease)
    await expect(
      manager.saveBarrier('recover-resolve-all.md')
    ).resolves.toMatchObject({ source: accepted, revision: 2 })
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(
      manager.saveBarrier('recover-resolve-all.md')
    ).resolves.toMatchObject({ source, revision: 3 })

    await manager.handoff(replacement)
    await manager.close('recover-resolve-all.md')
  })

  it('keeps a faulted session retryable when recovery handoff cleanup fails', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'recover-cleanup.md',
      source: 'alpha',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('recover-cleanup.md')
    await expect(oldLease.binding.submit({
      edits: [{ start: 0, end: 1, insert: 'A' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied' })

    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('old recovery Worker was not created')
    oldWorker.holdApplyReplies = true
    const unacknowledged = oldLease.binding.submit({
      edits: [{ start: 4, end: 5, insert: 'Z' }],
      projections: []
    })
    oldWorker.fail('Core Worker crashed')
    await expect(unacknowledged.acknowledged).rejects.toThrow('Core Worker crashed')
    oldLease.onHandoff(() => { throw new Error('recovery cleanup failed') })

    await expect(manager.recover(oldLease)).rejects.toThrow('recovery cleanup failed')
    expect(workers[1]?.terminations).toBe(1)

    oldLease.onHandoff(() => {})
    const replacement = await manager.recover(oldLease)
    await expect(manager.saveBarrier('recover-cleanup.md')).resolves.toMatchObject({
      source: 'Alpha'
    })

    await manager.handoff(replacement)
    await manager.close('recover-cleanup.md')
  })

  it('preserves actor undo history across a checkpointed Worker recovery', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({ documentId: 'recover-history.md', source: 'abc', lineEnding: '\n' })
    const oldLease = manager.lease('recover-history.md')
    await expect(oldLease.binding.submit({
      edits: [{ start: 3, end: 3, insert: 'd' }],
      projections: []
    }).acknowledged).resolves.toMatchObject({ type: 'applied', revision: 2 })
    await expect(manager.saveBarrier('recover-history.md')).resolves.toMatchObject({
      source: 'abcd'
    })

    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('old recovery Worker was not created')
    oldWorker.holdApplyReplies = true
    const faulted = oldLease.binding.submit({
      edits: [{ start: 0, end: 0, insert: '!' }],
      projections: []
    })
    oldWorker.fail('Core Worker crashed after checkpoint')
    await expect(faulted.acknowledged).rejects.toThrow('crashed after checkpoint')

    const replacement = await manager.recover(oldLease)
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({
      type: 'applied',
      change: { appliedEdits: [{ start: 3, end: 4, insert: '' }] }
    })
    await expect(manager.saveBarrier('recover-history.md')).resolves.toMatchObject({
      source: 'abc'
    })

    await manager.handoff(replacement)
    await manager.close('recover-history.md')
  })

  it('checkpoints the accepted recovery journal internally before it exceeds policy', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({ documentId: 'bounded.md', source: '', lineEnding: '\n' })
    const oldLease = manager.lease('bounded.md')
    const journalLimit = Math.min(
      DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress,
      DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
    )
    const suffixLength = 3
    const finalSource = 'x'.repeat(journalLimit + suffixLength)
    for (let index = 0; index < finalSource.length; index += 1) {
      await expect(oldLease.binding.submit({
        edits: [{ start: index, end: index, insert: 'x' }],
        projections: []
      }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    }

    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('Expected original Core Worker')
    expect(oldWorker.requests.filter(
      envelope => envelope.request.type === 'source-at-barrier'
    )).toHaveLength(1)
    oldWorker.holdApplyReplies = true
    const faulted = oldLease.binding.submit({
      edits: [{
        start: finalSource.length,
        end: finalSource.length,
        insert: '!'
      }],
      projections: []
    })
    oldWorker.fail('Core Worker crashed after internal checkpoint')
    await expect(faulted.acknowledged).rejects.toThrow(
      'crashed after internal checkpoint'
    )

    const replacement = await manager.recover(oldLease)
    const recoveryWorker = workers[1]
    if (recoveryWorker === undefined) throw new Error('Expected recovery Core Worker')
    expect(recoveryWorker.requests.map(envelope => envelope.request)).toEqual([
      expect.objectContaining({
        type: 'open',
        source: 'x'.repeat(journalLimit),
        recoveryHistory: expect.objectContaining({
          undo: expect.arrayContaining([expect.any(Object)])
        })
      }),
      ...Array.from({ length: suffixLength }, (_, index) =>
        expect.objectContaining({
          type: 'apply',
          edits: [{
            start: journalLimit + index,
            end: journalLimit + index,
            insert: 'x'
          }]
        }))
    ])
    await expect(manager.saveBarrier('bounded.md')).resolves.toMatchObject({
      source: finalSource
    })

    for (
      let index = 0;
      index < DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries;
      index += 1
    ) {
      await expect(replacement.binding.submit({
        kind: 'undo',
        projections: []
      }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    }
    await expect(replacement.binding.submit({
      kind: 'undo',
      projections: []
    }).acknowledged).resolves.toMatchObject({
      type: 'rejected',
      reason: 'history-empty'
    })
    await expect(manager.saveBarrier('bounded.md')).resolves.toMatchObject({
      source: 'x'.repeat(
        finalSource.length - DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries
      )
    })

    await manager.handoff(replacement)
    await manager.close('bounded.md')
  })

  it('fails maintenance closed without clearing its checkpoint or journal', async() => {
    const workers: ActorBackedCoreWorker[] = []
    const manager = createCoreDocumentSessionManager({
      createBinding() {
        const worker = new ActorBackedCoreWorker()
        workers.push(worker)
        return createEditorCoreBinding(createWorkerCorePort(worker))
      }
    })
    await manager.open({
      documentId: 'maintenance-failure.md',
      source: '',
      lineEnding: '\n'
    })
    const oldLease = manager.lease('maintenance-failure.md')
    const journalLimit = Math.min(
      DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress,
      DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
    )
    for (let index = 0; index < journalLimit - 1; index += 1) {
      await expect(oldLease.binding.submit({
        edits: [{ start: index, end: index, insert: 'x' }],
        projections: []
      }).acknowledged).resolves.toMatchObject({ type: 'applied' })
    }

    const oldWorker = workers[0]
    if (oldWorker === undefined) throw new Error('Expected original Core Worker')
    oldWorker.holdSourceReplies = true
    const triggering = oldLease.binding.submit({
      edits: [{
        start: journalLimit - 1,
        end: journalLimit - 1,
        insert: 'x'
      }],
      projections: []
    })
    while (!oldWorker.requests.some(
      envelope => envelope.request.type === 'source-at-barrier'
    )) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const suffix = oldLease.binding.submit({
      edits: [{ start: journalLimit, end: journalLimit, insert: '!' }],
      projections: []
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    oldWorker.fail('automatic recovery maintenance failed')
    await expect(triggering.acknowledged).resolves.toMatchObject({ type: 'applied' })
    await expect(suffix.acknowledged).resolves.toMatchObject({ type: 'applied' })
    expect(() => oldLease.binding.submit({
      edits: [{
        start: journalLimit + 1,
        end: journalLimit + 1,
        insert: '?'
      }],
      projections: []
    })).toThrow('Worker recovery is required')

    const replacement = await manager.recover(oldLease)
    const recoveryWorker = workers[1]
    if (recoveryWorker === undefined) throw new Error('Expected recovery Core Worker')
    const recoveryRequests = recoveryWorker.requests.map(
      envelope => envelope.request
    )
    expect(recoveryRequests[0]).toMatchObject({
      type: 'open',
      source: '',
      recoveryHistory: { undo: [], redo: [] }
    })
    expect(recoveryRequests.filter(request => request.type === 'apply'))
      .toHaveLength(journalLimit + 1)
    expect(recoveryRequests.at(-1)).toMatchObject({
      type: 'apply',
      edits: [{ start: journalLimit, end: journalLimit, insert: '!' }]
    })
    await expect(
      manager.saveBarrier('maintenance-failure.md')
    ).resolves.toMatchObject({
      source: `${'x'.repeat(journalLimit)}!`
    })

    await manager.handoff(replacement)
    await manager.close('maintenance-failure.md')
  })

  it('requires the current generation one live view lease for replacement', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    await manager.open({ documentId: 'lease.md', source: 'original', lineEnding: '\n' })
    const releasedLease = manager.lease('lease.md')
    await manager.handoff(releasedLease)

    await expect(manager.replace(releasedLease, {
      documentId: 'lease.md',
      source: 'disk replacement',
      lineEnding: '\n'
    })).rejects.toThrow('one live view lease')
    await expect(manager.saveBarrier('lease.md')).resolves.toEqual(
      expect.objectContaining({ revision: 1, source: 'original' })
    )

    await manager.close('lease.md')
  })

  it('reserves each document and permits only one live view lease', async() => {
    let releaseOpen!: () => void
    const openBarrier = new Promise<void>(resolve => { releaseOpen = resolve })
    const binding: EditorCoreBinding = Object.freeze({
      mode: 'core',
      durableSourceAuthority: 'core',
      async open() {
        await openBarrier
        return Object.freeze({
          type: 'opened',
          session: 1,
          sequence: 1,
          revision: 1,
          accepted: true,
          sourceLength: 5,
          diagnosticCount: 0,
          diagnostics: Object.freeze([])
        })
      },
      submit: testBinding(async() => { throw new Error('unexpected submit') }).submit,
      sourceAtBarrier: () => Promise.reject(new Error('unexpected source barrier')),
      plainTextViewAtBarrier: () => Promise.reject(
        new Error('unexpected plain-text view barrier')
      ),
      selectionProjectionAtBarrier: () => Promise.reject(
        new Error('unexpected selection projection barrier')
      ),
      reviewItemAtBarrier: () => Promise.reject(
        new Error('unexpected Review item barrier')
      ),
      observe: () => () => {},
      dispose: vi.fn()
    })
    const manager = createCoreDocumentSessionManager({ createBinding: () => binding })
    const firstOpen = manager.open({
      documentId: 'one.md',
      source: 'alpha',
      lineEnding: '\n'
    })

    const competingOpen = manager.open({
      documentId: 'one.md',
      source: 'other',
      lineEnding: '\n'
    })
    releaseOpen()
    await firstOpen
    await expect(competingOpen).rejects.toThrow('already open')

    const lease = manager.lease('one.md')
    expect(() => manager.lease('one.md')).toThrow('already has a live view')
    await expect(manager.close('one.md')).rejects.toThrow('live view')
    await manager.handoff(lease)
    await manager.close('one.md')
  })

  it('keeps held document sessions isolated across view activation and handoff', async() => {
    const workers = new Map<string, ActorBackedCoreWorker>()
    const bindings = new Map<string, EditorCoreBinding>()
    const manager = createCoreDocumentSessionManager({
      createBinding(documentId) {
        const worker = new ActorBackedCoreWorker()
        workers.set(documentId, worker)
        const binding = createEditorCoreBinding(createWorkerCorePort(worker))
        bindings.set(documentId, binding)
        return binding
      }
    })
    await manager.open({
      documentId: 'a.md',
      source: 'head\n\nalpha text\n\ntail\n',
      lineEnding: '\n'
    })
    await manager.open({
      documentId: 'b.md',
      source: 'head\n\nbeta text\n\ntail\n',
      lineEnding: '\n'
    })
    const a = manager.lease('a.md')
    const b = manager.lease('b.md')
    expect(a.binding).not.toBe(bindings.get('a.md'))
    expect(b.binding).not.toBe(bindings.get('b.md'))
    workers.get('a.md')!.holdApplyReplies = true
    const held = a.binding.submit({
      edits: [{ start: 12, end: 16, insert: 'TEXT' }],
      projections: ['markup']
    })

    await manager.activate('b.md')
    const handoff = manager.handoff(a)
    await Promise.resolve()
    expect(await Promise.race([
      handoff.then(() => 'settled'),
      Promise.resolve('pending')
    ])).toBe('pending')
    expect(workers.get('a.md')!.requests).toHaveLength(2)
    expect(workers.get('b.md')!.requests).toHaveLength(1)

    workers.get('a.md')!.releaseNextApply()
    await expect(held.acknowledged).resolves.toMatchObject({
      type: 'applied', revision: 2
    })
    await handoff
    await manager.close('a.md')
    expect(() => a.binding.submit({
      edits: [{ start: 0, end: 0, insert: 'late' }],
      projections: ['markup']
    })).toThrow('lease is released')
    expect(() => manager.lease('a.md')).toThrow('Core document is not open')
    expect(b.binding).not.toBe(bindings.get('a.md'))

    await manager.handoff(b)
    await manager.close('b.md')
  })

  it('refuses handoff and close after a typed submission rejection', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(
        createWorkerCorePort(new ActorBackedCoreWorker())
      )
    })
    await manager.open({
      documentId: 'rejected.md',
      source: 'alpha',
      lineEnding: '\n'
    })
    const lease = manager.lease('rejected.md')
    const rejected = lease.binding.submit({
      edits: [{ start: 0, end: 0, insert: '++}'.repeat(1_025) }],
      projections: ['markup']
    })

    await expect(rejected.acknowledged).resolves.toMatchObject({ type: 'resource' })
    await expect(manager.handoff(lease)).rejects.toThrow('requires reconciliation')
    await expect(manager.close('rejected.md')).rejects.toThrow(
      'live view'
    )
    expect(lease.binding).toBeDefined()
  })

  it('crosses the view delivery barrier before handing off a lease', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    const source = 'head\n\nordinary text\n\ntail\n'
    await manager.open({ documentId: 'view.md', source, lineEnding: '\n' })
    const lease = manager.lease('view.md')
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, lease.binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })
    lease.settleView(() => adapter.settled())
    lease.onHandoff(() => adapter.dispose())

    editor.replaceRange('TEXT', { line: 2, ch: 9 }, { line: 2, ch: 13 }, '+input')
    const handoff = manager.handoff(lease)
    await handoff

    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        edits: [{ start: 15, end: 19, insert: 'TEXT' }]
      }
    })
    adapter.dispose()
    await manager.close('view.md')
  })
})

const createAttachedCodeMirror = (source: string): Readonly<{
  editor: CodeMirror.Editor
  dispose: () => void
}> => {
  const rangePrototype = Range.prototype
  const rangeRect = Object.getOwnPropertyDescriptor(
    rangePrototype,
    'getBoundingClientRect'
  )
  const rangeRects = Object.getOwnPropertyDescriptor(
    rangePrototype,
    'getClientRects'
  )
  Object.defineProperties(rangePrototype, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect()
    },
    getClientRects: {
      configurable: true,
      value: () => []
    }
  })
  const host = document.body.appendChild(document.createElement('div'))
  let disposed = false
  const restore = (
    name: 'getBoundingClientRect' | 'getClientRects',
    descriptor: PropertyDescriptor | undefined
  ): void => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(rangePrototype, name)
    } else {
      Object.defineProperty(rangePrototype, name, descriptor)
    }
  }
  try {
    const editor: CodeMirror.Editor = codeMirror(host, { value: source })
    return Object.freeze({
      editor,
      dispose: () => {
        if (disposed) return
        disposed = true
        host.remove()
        restore('getBoundingClientRect', rangeRect)
        restore('getClientRects', rangeRects)
      }
    })
  } catch (error) {
    host.remove()
    restore('getBoundingClientRect', rangeRect)
    restore('getClientRects', rangeRects)
    throw error
  }
}

describe('CodeMirror Core adapter', () => {
  it('records one Source dispatch, acknowledgement, and reconciliation', async() => {
    const source = 'abc'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'source-performance.md', source })
    const editor = new codeMirror.Doc(source)
    const recorded: CoreAuthorityPerformanceEvent[] = []
    const clock = [10, 14, 18]
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      ...sourceCodeCoreAdapterOptions(source, '\n'),
      performanceTrace: {
        documentId: 'source-performance.md',
        clock: () => clock.shift() ?? Number.NaN,
        record: event => recorded.push(event)
      }
    })

    editor.replaceRange('!', { line: 0, ch: 3 }, { line: 0, ch: 3 }, '+input')
    await adapter.settled()

    expect(recorded).toEqual([
      {
        phase: 'dispatch',
        documentId: 'source-performance.md',
        transaction: 2,
        pendingDepth: 1,
        at: 10
      },
      {
        phase: 'ack',
        documentId: 'source-performance.md',
        transaction: 2,
        at: 14
      },
      {
        phase: 'reconcile',
        documentId: 'source-performance.md',
        transaction: 2,
        corrected: false,
        at: 18
      }
    ])
    adapter.dispose()
    binding.dispose()
  })

  it('uses the normalized LF renderer domain under a CRLF host save policy', () => {
    const options = sourceCodeCoreAdapterOptions('a\nb', '\r\n')

    expect(options).toMatchObject({
      canonicalSource: 'a\nb',
      insertedLineEnding: '\n'
    })
    expect(options.projections?.()).toEqual([])
  })

  it('faults when a native change arrives without a pre-change capture', () => {
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      testBinding(async() => { throw new Error('unexpected submit') }),
      { canonicalSource: 'abc', insertedLineEnding: '\n' }
    )

    ;(codeMirror as typeof codeMirror & {
      signal(target: unknown, event: string, ...args: unknown[]): void
    }).signal(editor, 'change', editor, {
      from: { line: 0, ch: 1 },
      to: { line: 0, ch: 2 },
      text: ['X'],
      removed: ['b'],
      origin: '+input'
    })

    expect(adapter.state()).toEqual({
      status: 'faulted',
      lastAcceptedRevision: 1,
      message: 'CodeMirror Core change lacked a pre-change capture'
    })
    adapter.dispose()
  })

  it('sends a native change as one exact edit without reading a source snapshot', async() => {
    const source = 'head 😀\n\nordinary text paragraph\n\ntail\n'
    const core = createDocumentCore()
    const worker = new ActorBackedCoreWorker(createCoreActor(() => core))
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'source.md', source })
    const beforeApply = inspectDocumentCore(core)
    const editor = new codeMirror.Doc(source)
    const getValue = vi.spyOn(editor, 'getValue').mockImplementation(() => {
      throw new Error('Core adapter must not read a whole source snapshot')
    })
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    const start = source.indexOf('text')

    editor.replaceRange(
      'TEXT',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 4),
      '+input'
    )
    const acknowledged = await adapter.settled()

    expect(acknowledged).toMatchObject({
      type: 'applied',
      revision: 2,
      sourceLength: source.length,
      change: {
        appliedEdits: [{ start, end: start + 4, insert: 'TEXT' }],
        projections: []
      }
    })
    expect(getValue).not.toHaveBeenCalled()
    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        edits: [{ start, end: start + 4, insert: 'TEXT' }]
      }
    })
    expect(worker.requests[1]?.request).not.toHaveProperty('source')
    const afterApply = inspectDocumentCore(core)
    expect(afterApply.regionalFastApplies).toBe(beforeApply.regionalFastApplies + 1)
    expect(afterApply.documentParses).toBe(beforeApply.documentParses)
    expect(afterApply.sourceMaterializations).toBe(beforeApply.sourceMaterializations)

    adapter.dispose()
    binding.dispose()
  })

  it('keeps Source ready after a native identity replacement', async() => {
    const source = 'abc'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'source-no-change.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    editor.replaceRange('b', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 1 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 1,
      source
    })

    editor.replaceRange('!', { line: 0, ch: 3 }, { line: 0, ch: 3 }, '+input')
    await expect(adapter.settled()).resolves.toMatchObject({ revision: 2 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 2,
      source: 'abc!'
    })
    adapter.dispose()
    binding.dispose()
  })

  it('applies actor-owned CriticMarkup resolution through the authoritative lane', async() => {
    const source = 'a {++add++} b\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'review.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    const accepted = adapter.resolve(
      { kind: 'addition', range: { start: 2, end: 11 } },
      1,
      'accept'
    )
    const barrier = adapter.settled()
    await expect(accepted).resolves.toMatchObject({
      type: 'applied',
      revision: 2,
      change: { appliedEdits: [{ start: 2, end: 11, insert: 'add' }] }
    })
    await expect(barrier).resolves.toMatchObject({ revision: 2 })
    expect(editor.getValue()).toBe('a add b\n')
    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'resolve',
        annotation: { kind: 'addition', range: { start: 2, end: 11 } },
        decision: 'accept'
      }
    })

    await expect(adapter.history('undo')).resolves.toMatchObject({ revision: 3 })
    expect(editor.getValue()).toBe(source)
    adapter.dispose()
    binding.dispose()
  })

  it('keeps Source authority saveable after a stale Review locator is rejected', async() => {
    const source = 'a {++add++} b\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'stale-review.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    await expect(adapter.resolve(
      { kind: 'addition', range: { start: 2, end: 10 } },
      1,
      'accept'
    )).rejects.toThrow('Core resolution target is no longer current')
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 1 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 1,
      source
    })

    editor.replaceRange('!', { line: 0, ch: 0 }, { line: 0, ch: 0 }, '+input')
    await expect(adapter.settled()).resolves.toMatchObject({ revision: 2 })
    adapter.dispose()
    binding.dispose()
  })

  it('keeps Source authority saveable after an atomic Review history refusal', async() => {
    const source = '{++abcdef++}\n'
    const worker = new ActorBackedCoreWorker(createCoreActor(
      createDocumentCore,
      { maximumHistoryInsertUnits: 5 }
    ))
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'source-history-resource.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    await expect(adapter.resolve(
      { kind: 'addition', range: { start: 0, end: 12 } },
      1,
      'accept'
    )).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 1 })
    expect(editor.getValue()).toBe(source)
    expect(await Promise.race([
      adapter.settled().then(() => 'settled'),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 25))
    ])).toBe('settled')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 1,
      source
    })

    editor.replaceRange('!', { line: 0, ch: 12 }, { line: 0, ch: 12 }, '+input')
    await expect(adapter.settled()).resolves.toMatchObject({ revision: 2 })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 2,
      source: '{++abcdef++}!\n'
    })
    adapter.dispose()
    binding.dispose()
  })

  it('snapshots a Review locator before its asynchronous command boundary', async() => {
    const source = 'a {++add++} b\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'snapshot-review.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    const locator = {
      kind: 'addition' as const,
      range: { start: 2, end: 11 }
    }

    const accepting = adapter.resolve(locator, 1, 'accept')
    locator.range.start = 0
    locator.range.end = 0

    await expect(accepting).resolves.toMatchObject({ revision: 2 })
    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'resolve',
        annotation: { kind: 'addition', range: { start: 2, end: 11 } }
      }
    })
    expect(editor.getValue()).toBe('a add b\n')
    adapter.dispose()
    binding.dispose()
  })

  it('keeps a Review locator on the same annotation across earlier queued input', async() => {
    const source = 'x {++a++}\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'rebased-review.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    editor.replaceRange('!', { line: 0, ch: 0 }, { line: 0, ch: 0 }, '+input')
    await expect(adapter.resolve(
      { kind: 'addition', range: { start: 2, end: 9 } },
      1,
      'accept'
    )).resolves.toMatchObject({ revision: 3 })

    expect(worker.requests.slice(1)).toMatchObject([
      { request: { type: 'apply', edits: [{ start: 0, end: 0, insert: '!' }] } },
      {
        request: {
          type: 'resolve',
          annotation: { kind: 'addition', range: { start: 3, end: 10 } }
        }
      }
    ])
    expect(editor.getValue()).toBe('!x a\n')
    adapter.dispose()
    binding.dispose()
  })

  it('reads the next Review item after earlier native input is acknowledged', async() => {
    const source = 'x\n\n{++add++}\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'review-navigation.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )

    editor.replaceRange('!', { line: 0, ch: 0 }, { line: 0, ch: 0 }, '+input')
    const item = await adapter.reviewItem('next', 0)

    expect(item).toMatchObject({
      type: 'review-item',
      revision: 2,
      item: { kind: 'addition', range: { start: 4, end: 13 } }
    })
    expect(worker.requests.slice(1).map(envelope => envelope.request.type)).toEqual([
      'apply',
      'review-item-at-barrier'
    ])
    adapter.dispose()
    binding.dispose()
  })

  it('routes immediate undo and redo to actor-owned history without CodeMirror history', async() => {
    const source = 'head\n\nordinary text paragraph\n\ntail\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-source.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    const start = source.indexOf('text')
    editor.replaceRange(
      'WORDS',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 4),
      '+input'
    )

    const undone = await adapter.history('undo')
    expect(editor.getValue()).toBe(source)
    const redone = await adapter.history('redo')
    expect(editor.getValue()).toBe(source.replace('text', 'WORDS'))
    if (undone === undefined || redone === undefined) {
      throw new Error('Expected nonempty actor history')
    }
    expect(undone.change.appliedEdits).toEqual([{
      start,
      end: start + 5,
      insert: 'text'
    }])
    expect(redone.change.appliedEdits).toEqual([{
      start,
      end: start + 4,
      insert: 'WORDS'
    }])
    expect(worker.requests.slice(-2).map(item => item.request.type)).toEqual([
      'undo',
      'redo'
    ])
    adapter.dispose()
    binding.dispose()
  })

  it('maps held actor history across canonical CRLF and Unicode coordinates', async() => {
    const source = 'head 😀\r\n\r\nordinary text\r\n'
    const normalized = source.replaceAll('\r\n', '\n')
    const worker = new ActorBackedCoreWorker()
    worker.holdApplyReplies = true
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-crlf.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })
    const viewStart = normalized.indexOf('text')
    editor.replaceRange(
      'WORDS',
      editor.posFromIndex(viewStart),
      editor.posFromIndex(viewStart + 4),
      '+input'
    )
    const undoing = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'apply')).toHaveLength(1)
    })
    worker.releaseNextApply()
    await undoing

    expect(editor.getValue()).toBe(normalized)
    expect(worker.requests.map(item => item.request.type)).toEqual([
      'open',
      'apply',
      'undo'
    ])
    adapter.dispose()
    binding.dispose()
  })

  it('treats empty actor history as a no-op and keeps later typing admissible', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'empty-history.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })

    await expect(adapter.history('undo')).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 1 })
    editor.replaceRange('X', { line: 0, ch: 3 }, undefined, '+input')
    await expect(adapter.settled()).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      source: 'abcX'
    })
    adapter.dispose()
    binding.dispose()
  })

  it('keeps a managed session saveable after an empty history command', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    await manager.open({
      documentId: 'managed-empty-history.md',
      source: 'abc',
      lineEnding: '\n'
    })
    const lease = manager.lease('managed-empty-history.md')
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, lease.binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    lease.settleView(() => adapter.settled())
    lease.onHandoff(() => adapter.dispose())

    await expect(adapter.history('undo')).resolves.toBeUndefined()
    editor.replaceRange('X', { line: 0, ch: 3 }, undefined, '+input')
    await expect(manager.saveBarrier('managed-empty-history.md')).resolves.toEqual({
      documentId: 'managed-empty-history.md',
      revision: 2,
      identity: {
        generation: expect.any(Number),
        revision: 2
      },
      source: 'abcX',
      lineEnding: '\n'
    })

    await manager.handoff(lease)
    await manager.close('managed-empty-history.md')
  })

  it('serializes rapid actor history commands and includes them in settlement', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'rapid-history.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('d', { line: 0, ch: 3 }, undefined, '+input')
    await adapter.settled()
    worker.holdHistoryReplies = true

    const first = adapter.history('undo')
    const second = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(1)
    })
    let settled = false
    const barrier = adapter.settled().then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    worker.releaseNextHistory()
    await expect(first).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(2)
    })
    expect(settled).toBe(false)
    worker.releaseNextHistory()
    await expect(second).resolves.toBeUndefined()
    await barrier
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 3 })
    expect(editor.getValue()).toBe('abc')

    adapter.dispose()
    binding.dispose()
  })

  it('rebases native input authored while actor history is in flight', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-input.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('d', { line: 0, ch: 3 }, undefined, '+input')
    await adapter.settled()
    worker.holdHistoryReplies = true

    const undoing = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(1)
    })
    editor.replaceRange('E', { line: 0, ch: 4 }, undefined, '+input')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'apply')).toHaveLength(2)
    })
    expect(worker.requests.at(-1)?.request).toMatchObject({
      type: 'apply',
      baseRevision: 3,
      edits: [{ start: 3, end: 3, insert: 'E' }]
    })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 4 })
    expect(editor.getValue()).toBe('abcE')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 4,
      source: 'abcE'
    })
    expect(worker.requests.map(item => item.request.type)).toEqual([
      'open',
      'apply',
      'undo',
      'apply',
      'source-at-barrier'
    ])

    adapter.dispose()
    binding.dispose()
  })

  it('orders same-point pending input after an earlier actor history insertion', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-tie.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('X', { line: 0, ch: 1 }, undefined, '+input')
    await adapter.settled()
    await adapter.history('undo')
    worker.holdHistoryReplies = true

    const redoing = adapter.history('redo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'redo')).toHaveLength(1)
    })
    editor.replaceRange('Y', { line: 0, ch: 1 }, undefined, '+input')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(redoing).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 5 })
    expect(editor.getValue()).toBe('aXYbc')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 5,
      source: 'aXYbc'
    })
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 5 })

    adapter.dispose()
    binding.dispose()
  })

  it('keeps crossed pending insertion provenance aligned after actor history', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-crossed-provenance.md', source: 'ab' })
    await binding.submit({
      edits: [
        { start: 0, end: 0, insert: 'JK' },
        { start: 1, end: 2, insert: 'JK' }
      ],
      projections: []
    }).acknowledged
    await binding.submit({ kind: 'undo', projections: [] }).acknowledged
    const editor = new codeMirror.Doc('ab')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'ab',
      insertedLineEnding: '\n'
    })
    worker.holdHistoryReplies = true

    const redoing = adapter.history('redo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'redo')).toHaveLength(1)
    })
    editor.replaceRange('YZ', { line: 0, ch: 2 }, undefined, '+input')
    editor.replaceRange('P', { line: 0, ch: 1 }, undefined, '+input')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(redoing).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 6 })
    expect(editor.getValue()).toBe('JKaJKYZP')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 6,
      source: 'JKaJKYZP'
    })
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 6 })

    adapter.dispose()
    binding.dispose()
  })

  it('orders sequential pending input after an earlier history replacement at its start', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-replacement-tie.md', source: 'abcd' })
    const editor = new codeMirror.Doc('abcd')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abcd',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await adapter.settled()
    editor.replaceRange('YYY', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await adapter.settled()
    worker.holdHistoryReplies = true

    const undoing = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(1)
    })
    editor.replaceRange('P', { line: 0, ch: 1 }, undefined, '+input')
    editor.replaceRange('Q', { line: 0, ch: 2 }, undefined, '+input')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 6 })
    expect(editor.getValue()).toBe('aXPQcd')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 6,
      source: 'aXPQcd'
    })

    adapter.dispose()
    binding.dispose()
  })

  it('preserves deletion of pending text across an earlier history replacement', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-pending-delete.md', source: 'abcd' })
    const editor = new codeMirror.Doc('abcd')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abcd',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await adapter.settled()
    editor.replaceRange('YYY', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await adapter.settled()
    worker.holdHistoryReplies = true

    const undoing = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(1)
    })
    editor.replaceRange('P', { line: 0, ch: 1 }, undefined, '+input')
    editor.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+delete')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 6 })
    expect(editor.getValue()).toBe('aXcd')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 6,
      source: 'aXcd'
    })
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 6 })

    adapter.dispose()
    binding.dispose()
  })

  it('maps later optimistic EOF input after a queued deletion during history', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-delete-eof.md', source: 'abcde' })
    const editor = new codeMirror.Doc('abcde')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abcde',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('H', { line: 0, ch: 0 }, undefined, '+input')
    await adapter.settled()
    await adapter.history('undo')
    worker.holdHistoryReplies = true

    const redoing = adapter.history('redo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'redo')).toHaveLength(1)
    })
    editor.replaceRange('', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+delete')
    editor.replaceRange('X', { line: 0, ch: 4 }, undefined, '+input')
    const barrier = adapter.settled()
    worker.releaseNextHistory()

    await expect(redoing).resolves.toMatchObject({ type: 'applied', revision: 4 })
    await expect(barrier).resolves.toMatchObject({ type: 'applied', revision: 6 })
    expect(editor.getValue()).toBe('HacdeX')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      type: 'source',
      revision: 6,
      source: 'HacdeX'
    })

    adapter.dispose()
    binding.dispose()
  })

  it('fences a late actor history reply after adapter disposal', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-dispose.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('d', { line: 0, ch: 3 }, undefined, '+input')
    await adapter.settled()
    worker.holdHistoryReplies = true
    const undoing = adapter.history('undo')
    await vi.waitFor(() => {
      expect(worker.requests.filter(item => item.request.type === 'undo')).toHaveLength(1)
    })

    adapter.dispose()
    await expect(undoing).rejects.toThrow('adapter is disposed')
    worker.releaseNextHistory()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(editor.getValue()).toBe('abcd')

    binding.dispose()
  })

  it('fences history publication when disposal races its deferred view update', async() => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'history-dispose-race.md', source: 'abc' })
    const editor = new codeMirror.Doc('abc')
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: 'abc',
      insertedLineEnding: '\n'
    })
    editor.replaceRange('d', { line: 0, ch: 3 }, undefined, '+input')
    await adapter.settled()
    worker.disposeViewAfterHistoryRequest = () => adapter.dispose()

    await expect(adapter.history('undo')).rejects.toThrow('adapter is disposed')
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(editor.getValue()).toBe('abcd')
    expect(adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 2 })

    binding.dispose()
  })

  it('holds composition updates locally and commits one actor transaction at composition end', async() => {
    const source = 'head\n\nordinary text paragraph\n\ntail\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'ime.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    const start = source.indexOf('text')

    adapter.compositionStart()
    editor.replaceRange(
      'に',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 4),
      '+input'
    )
    editor.replaceRange(
      '日本',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 1),
      '+input'
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(worker.requests.filter(item => item.request.type === 'apply')).toEqual([])

    const acknowledged = await adapter.compositionEnd()
    expect(acknowledged).toMatchObject({
      type: 'applied',
      revision: 2,
      change: {
        appliedEdits: [{ start, end: start + 4, insert: '日本' }]
      }
    })
    expect(worker.requests.filter(item => item.request.type === 'apply')).toHaveLength(1)
    adapter.dispose()
    binding.dispose()
  })

  it('keeps save behind composition and persists only its final text', async() => {
    const worker = new ActorBackedCoreWorker()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createWorkerCorePort(worker))
    })
    const source = 'head\n\nordinary text paragraph\n\ntail\n'
    await manager.open({ documentId: 'ime-save.md', source, lineEnding: '\n' })
    const lease = manager.lease('ime-save.md')
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(
      editor,
      lease.binding,
      sourceCodeCoreAdapterOptions(source, '\n')
    )
    lease.settleView(() => adapter.settled())
    lease.onHandoff(() => adapter.dispose())
    const start = source.indexOf('text')

    adapter.compositionStart()
    editor.replaceRange(
      'に',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 4),
      '+input'
    )
    const saving = manager.saveBarrier('ime-save.md')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(worker.requests.map(item => item.request.type)).toEqual(['open'])

    editor.replaceRange(
      '日本',
      editor.posFromIndex(start),
      editor.posFromIndex(start + 1),
      '+input'
    )
    await adapter.compositionEnd()
    await expect(saving).resolves.toEqual({
      documentId: 'ime-save.md',
      revision: 2,
      identity: {
        generation: expect.any(Number),
        revision: 2
      },
      source: source.replace('text', '日本'),
      lineEnding: '\n'
    })
    expect(worker.requests.map(item => item.request.type)).toEqual([
      'open',
      'apply',
      'source-at-barrier'
    ])

    await manager.handoff(lease)
    await manager.close('ime-save.md')
  })

  it('keeps distinct ordinary editor operations in distinct undo entries', async() => {
    const source = 'head 😀\n\nordinary text paragraph\n\ntail\n'
    const worker = new ActorBackedCoreWorker()
    worker.holdApplyReplies = true
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'burst.md', source })
    const fixture = createAttachedCodeMirror(source)
    const editor = fixture.editor
    const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })
    const textStart = source.indexOf('text')
    const paragraphStart = source.indexOf('paragraph')

    editor.replaceRange(
      'TEXT',
      editor.posFromIndex(textStart),
      editor.posFromIndex(textStart + 4),
      '+input'
    )
    editor.replaceRange(
      'PARAGRAPH',
      editor.posFromIndex(paragraphStart),
      editor.posFromIndex(paragraphStart + 9),
      '+input'
    )
    const burstSettled = adapter.settled()
    await vi.waitFor(() => {
      expect(worker.requests.filter(({ request }) => request.type === 'apply'))
        .toHaveLength(1)
    })
    worker.releaseNextApply()
    await vi.waitFor(() => {
      expect(worker.requests.filter(({ request }) => request.type === 'apply'))
        .toHaveLength(2)
    })
    expect(worker.requests.slice(1).map(({ request }) => request)).toEqual([
      expect.objectContaining({
        type: 'apply',
        baseRevision: 1,
        edits: [{ start: textStart, end: textStart + 4, insert: 'TEXT' }]
      }),
      expect.objectContaining({
        type: 'apply',
        baseRevision: 2,
        edits: [{
          start: paragraphStart,
          end: paragraphStart + 9,
          insert: 'PARAGRAPH'
        }]
      })
    ])
    worker.releaseNextApply()
    await expect(burstSettled).resolves.toMatchObject({
      type: 'applied',
      revision: 3,
      sourceLength: source.length
    })
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      source: source.replace('text paragraph', 'TEXT PARAGRAPH'),
      recoveryHistory: {
        undo: [expect.any(Object), expect.any(Object)],
        redo: []
      }
    })

    await expect(adapter.history('undo')).resolves.toMatchObject({
      type: 'applied'
    })
    expect(editor.getValue()).toBe(source.replace('text', 'TEXT'))
    await expect(adapter.history('undo')).resolves.toMatchObject({
      type: 'applied'
    })
    expect(editor.getValue()).toBe(source)
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      source,
      recoveryHistory: {
        undo: [],
        redo: [expect.any(Object), expect.any(Object)]
      }
    })

    adapter.dispose()
    binding.dispose()
    fixture.dispose()
  })

  it('commits one multi-selection operation as one actor undo entry', async() => {
    const source = 'aa\r\nbb\r\ncc'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'multi.md', source })
    const fixture = createAttachedCodeMirror(source)
    const editor = fixture.editor
    const doc = editor.getDoc()
    const adapter = createCodeMirrorCoreAdapter(doc, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })
    doc.setSelections([
      { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 1 } },
      { anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 1 } }
    ])

    editor.replaceSelections(['A\nX\nY', 'C'], 'around', '+input')
    const expectedSelections = doc.listSelections().map(selection => ({
      anchor: { ...selection.anchor },
      head: { ...selection.head }
    }))
    await adapter.settled()

    expect(worker.requests.slice(1)).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          type: 'apply',
          baseRevision: 1,
          edits: [
            { start: 0, end: 1, insert: 'A\r\nX\r\nY' },
            { start: 8, end: 9, insert: 'C' }
          ]
        })
      })
    ])
    expect(editor.getValue()).toBe('A\nX\nYa\nbb\nCc')
    expect(doc.listSelections()).toEqual(expectedSelections)
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      source: 'A\r\nX\r\nYa\r\nbb\r\nCc',
      recoveryHistory: {
        undo: [expect.any(Object)],
        redo: []
      }
    })

    await expect(adapter.history('undo')).resolves.toMatchObject({
      type: 'applied'
    })
    expect(editor.getValue()).toBe('aa\nbb\ncc')
    await expect(binding.sourceAtBarrier()).resolves.toMatchObject({
      source,
      recoveryHistory: {
        undo: [],
        redo: [expect.any(Object)]
      }
    })

    adapter.dispose()
    binding.dispose()
    fixture.dispose()
  })

  it('maps a native LF view edit onto the exact canonical CRLF range', async() => {
    const source = 'a\r\nb\r\nc\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'crlf.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })

    editor.replaceRange('B', { line: 1, ch: 0 }, { line: 1, ch: 1 }, '+input')
    const acknowledged = await adapter.settled()

    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        edits: [{ start: 3, end: 4, insert: 'B' }]
      }
    })
    expect(acknowledged).toMatchObject({
      type: 'applied',
      sourceLength: source.length,
      change: {
        appliedEdits: [{ start: 3, end: 4, insert: 'B' }]
      }
    })

    adapter.dispose()
    binding.dispose()
  })

  it('preserves canonical CRLF bytes across multiline removal and insertion', async() => {
    const source = 'a\r\nb\r\nc\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'crlf-lines.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })

    editor.replaceRange('B\nD', { line: 1, ch: 0 }, { line: 2, ch: 1 }, '+input')
    const acknowledged = await adapter.settled()

    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        edits: [{ start: 3, end: 7, insert: 'B\r\nD' }]
      }
    })
    expect(acknowledged).toMatchObject({
      type: 'applied',
      sourceLength: source.length,
      change: {
        appliedEdits: [{ start: 3, end: 7, insert: 'B\r\nD' }]
      }
    })

    adapter.dispose()
    binding.dispose()
  })

  it('maps mixed endings with an explicit insertion policy across later edits', async() => {
    const source = 'a\r\nb\nc\rd'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'mixed.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })

    editor.replaceRange('C\nD', { line: 2, ch: 0 }, { line: 2, ch: 1 }, '+input')
    await adapter.settled()
    editor.replaceRange('Z', { line: 4, ch: 0 }, { line: 4, ch: 1 }, '+input')
    await adapter.settled()

    expect(worker.requests.slice(1).map(({ request }) => request)).toEqual([
      expect.objectContaining({
        type: 'apply',
        edits: [{ start: 5, end: 6, insert: 'C\r\nD' }]
      }),
      expect.objectContaining({
        type: 'apply',
        edits: [{ start: 10, end: 11, insert: 'Z' }]
      })
    ])

    adapter.dispose()
    binding.dispose()
  })

  it.each([
    {
      name: 'suffix LF after inserted CR',
      source: 'ab\n',
      policy: '\r' as const,
      from: { line: 0, ch: 1 },
      to: { line: 0, ch: 2 },
      text: 'A\n\n',
      edit: { start: 1, end: 3, insert: 'A\r\r\r' }
    },
    {
      name: 'prefix CR before inserted LF',
      source: 'a\r',
      policy: '\n' as const,
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 0 },
      text: '\n',
      edit: { start: 1, end: 2, insert: '\n\n' }
    }
  ])('prevents line-ending fusion at the $name boundary', async fixture => {
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'fusion.md', source: fixture.source })
    const editor = new codeMirror.Doc(fixture.source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: fixture.source,
      insertedLineEnding: fixture.policy
    })

    editor.replaceRange(fixture.text, fixture.from, fixture.to, '+input')
    await adapter.settled()

    expect(worker.requests[1]).toMatchObject({
      request: { type: 'apply', edits: [fixture.edit] }
    })
    adapter.dispose()
    binding.dispose()
  })

  it('prevents retained CR and LF fusion across an empty deletion', async() => {
    const source = 'a\rb\n'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'empty-fusion.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })

    editor.replaceRange('', { line: 1, ch: 0 }, { line: 1, ch: 1 }, '+delete')
    await adapter.settled()
    editor.replaceRange('Z', { line: 2, ch: 0 }, { line: 2, ch: 0 }, '+input')
    await adapter.settled()

    expect(worker.requests.slice(1).map(({ request }) => request)).toEqual([
      expect.objectContaining({
        type: 'apply',
        edits: [{ start: 1, end: 4, insert: '\n\r' }]
      }),
      expect.objectContaining({
        type: 'apply',
        edits: [{ start: 3, end: 3, insert: 'Z' }]
      })
    ])
    adapter.dispose()
    binding.dispose()
  })

  it('keeps far-tail canonical mapping bounded and independent of CodeMirror indexing', async() => {
    const lineCount = 100_000
    const source = 'x\r\n'.repeat(lineCount - 1) + 'tail'
    const edits: unknown[] = []
    const binding = testBinding(async submitted => {
      edits.push(submitted)
      return Object.freeze({
        type: 'applied',
        session: 1,
        sequence: edits.length,
        revision: edits.length + 1,
        accepted: true,
        sourceLength: source.length,
        diagnosticCount: 0,
        diagnostics: Object.freeze([]),
        change: Object.freeze({
          appliedEdits: submitted,
          projections: Object.freeze([])
        })
      })
    }
    )
    const editor = new codeMirror.Doc(source)
    vi.spyOn(editor, 'indexFromPos').mockImplementation(() => {
      throw new Error('adapter must use its canonical line index')
    })
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n'
    })
    const before = inspectCodeMirrorCoreAdapter(adapter)

    editor.replaceRange(
      'T',
      { line: lineCount - 1, ch: 0 },
      { line: lineCount - 1, ch: 1 },
      '+input'
    )
    await adapter.settled()
    const after = inspectCodeMirrorCoreAdapter(adapter)

    expect(edits).toEqual([[
      { start: source.length - 4, end: source.length - 3, insert: 'T' }
    ]])
    expect(before.currentLines).toBe(lineCount)
    expect(before.currentPages).toBeLessThan(lineCount / 100)
    expect(after.nodeVisits - before.nodeVisits).toBeLessThan(80)
    expect(after.nodeAllocations - before.nodeAllocations).toBeLessThan(100)
    expect(after.currentHeight).toBeLessThan(20)

    adapter.dispose()
  })

  it('accounts for page records traversed by both canonical lookup directions', () => {
    const source = 'x\r\n'.repeat(599) + 'tail'
    const index = createCanonicalEolIndex(source)
    const before = index.inspection()
    const offset = index.offset({ line: 500, ch: 1 })
    const afterOffset = index.inspection()

    expect(offset).toBe('x\r\n'.repeat(500).length + 1)
    expect(afterOffset.pageRecordsScanned).toBeGreaterThan(
      before.pageRecordsScanned
    )
    expect(afterOffset.pageRecordsScanned - before.pageRecordsScanned).toBeLessThanOrEqual(256)

    expect(index.position(offset)).toEqual({ line: 500, ch: 1 })
    const afterPosition = index.inspection()
    expect(afterPosition.pageRecordsScanned).toBeGreaterThan(
      afterOffset.pageRecordsScanned
    )
    expect(afterPosition.pageRecordsScanned - afterOffset.pageRecordsScanned)
      .toBeLessThanOrEqual(256)
  })

  it('keeps packed line pages bounded across distributed stable-line edits', async() => {
    const lineCount = 10_000
    const source = 'x\r\n'.repeat(lineCount - 1) + 'x'
    const binding = testBinding(async submitted => Object.freeze({
      type: 'applied',
      session: 1,
      sequence: 1,
      revision: 2,
      accepted: true,
      sourceLength: source.length,
      diagnosticCount: 0,
      diagnostics: Object.freeze([]),
      change: Object.freeze({ appliedEdits: submitted, projections: Object.freeze([]) })
    }))
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\r\n',
      maxPending: 2_000
    })
    const before = inspectCodeMirrorCoreAdapter(adapter)

    for (let line = 0; line < 1_000; line += 1) {
      editor.replaceRange('y', { line: line * 10, ch: 0 }, { line: line * 10, ch: 1 })
      await adapter.settled()
    }
    const after = inspectCodeMirrorCoreAdapter(adapter)

    expect(after.currentPages).toBe(before.currentPages)
    expect(after.nodeAllocations - before.nodeAllocations).toBeLessThan(20_000)
    expect(after.currentHeight).toBe(before.currentHeight)

    adapter.dispose()
  })

  it('coalesces packed line pages across repeated newline insertions', async() => {
    const source = 'x'
    const binding = testBinding(async submitted => Object.freeze({
      type: 'applied',
      session: 1,
      sequence: 1,
      revision: 2,
      accepted: true,
      sourceLength: 1,
      diagnosticCount: 0,
      diagnostics: Object.freeze([]),
      change: Object.freeze({
        appliedEdits: submitted,
        projections: Object.freeze([])
      })
    }))
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n',
      maxPending: 20_000
    })
    const before = inspectCodeMirrorCoreAdapter(adapter)

    for (let index = 0; index < 10_000; index += 1) {
      editor.replaceRange('\n', { line: 0, ch: 0 }, undefined, '+input')
      await adapter.settled()
    }
    const after = inspectCodeMirrorCoreAdapter(adapter)

    expect(after.currentLines).toBe(10_001)
    expect(after.currentPages).toBeLessThan(100)
    expect(after.currentHeight).toBeLessThan(12)
    expect(after.nodeAllocations - before.nodeAllocations).toBeLessThan(200_000)

    adapter.dispose()
  }, 20_000)

  it('does not advance Core for a later-listener canceled change', async() => {
    const source = 'abc'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'cancel.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })
    editor.on('beforeChange', (
      _doc: CodeMirror.Doc,
      change: CodeMirror.EditorChangeCancellable
    ) => change.cancel())

    editor.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(worker.requests).toHaveLength(1)
    adapter.dispose()
    binding.dispose()
  })

  it('uses a later-listener update as the one final exact transaction', async() => {
    const source = 'abc'
    const worker = new ActorBackedCoreWorker()
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'update.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })
    editor.on('beforeChange', (
      _doc: CodeMirror.Doc,
      change: CodeMirror.EditorChangeCancellable
    ) => {
      change.update?.({ line: 0, ch: 0 }, { line: 0, ch: 2 }, ['AB'])
    })

    editor.replaceRange('X', { line: 0, ch: 1 }, { line: 0, ch: 2 }, '+input')
    await adapter.settled()

    expect(worker.requests[1]).toMatchObject({
      request: {
        type: 'apply',
        edits: [{ start: 0, end: 2, insert: 'AB' }]
      }
    })
    adapter.dispose()
    binding.dispose()
  })

  it('requires reconciliation after a typed Core resource outcome', async() => {
    const source = 'alpha'
    const binding = createEditorCoreBinding(
      createWorkerCorePort(new ActorBackedCoreWorker())
    )
    await binding.open({ documentId: 'resource-adapter.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })

    editor.replaceRange('++}'.repeat(1_025), { line: 0, ch: 0 }, undefined, '+input')
    await expect(adapter.settled()).rejects.toThrow('reconciliation required')
    expect(adapter.state()).toEqual({
      status: 'reconciliation-required',
      lastAcceptedRevision: 1,
      reason: 'resource'
    })

    adapter.dispose()
    binding.dispose()
  })

  it('requires reconciliation before unbounded pending inserted bytes accumulate', async() => {
    const source = 'alpha'
    const worker = new ActorBackedCoreWorker()
    worker.holdApplyReplies = true
    const binding = createEditorCoreBinding(createWorkerCorePort(worker))
    await binding.open({ documentId: 'bounded-adapter.md', source })
    const editor = new codeMirror.Doc(source)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: source,
      insertedLineEnding: '\n',
      maxPendingInsertUnits: 3
    })

    editor.replaceRange('abcd', { line: 0, ch: 0 }, undefined, '+input')
    await expect(adapter.settled()).rejects.toThrow('reconciliation required')
    expect(worker.requests).toHaveLength(1)
    expect(adapter.state()).toEqual({
      status: 'reconciliation-required',
      lastAcceptedRevision: 1,
      reason: 'pending-limit'
    })

    adapter.dispose()
    binding.dispose()
  })

  it('keeps mixed canonical endings equivalent under deterministic edit fuzz', async() => {
    let canonical = 'a\rb\r\nc\nd'
    let revision = 1
    let transaction = 0
    const binding = testBinding(async edits => {
      const edit = edits[0]
      if (edit === undefined) throw new Error('missing fuzz edit')
      canonical = canonical.slice(0, edit.start) + edit.insert +
          canonical.slice(edit.end)
      revision += 1
      transaction += 1
      return Object.freeze({
        type: 'applied',
        session: 1,
        sequence: transaction,
        revision,
        accepted: true,
        sourceLength: canonical.length,
        diagnosticCount: 0,
        diagnostics: Object.freeze([]),
        change: Object.freeze({ appliedEdits: edits, projections: Object.freeze([]) })
      })
    }
    )
    const editor = new codeMirror.Doc(canonical)
    const adapter = createCodeMirrorCoreAdapter(editor, binding, {
      canonicalSource: canonical,
      insertedLineEnding: '\r'
    })
    let seed = 0xADDA
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed
    }
    const inserts = ['', 'x', '\n', 'y\n', '\n\n']

    for (let index = 0; index < 200; index += 1) {
      const line = random() % editor.lineCount()
      const lineLength = editor.getLine(line).length
      const startCh = random() % (lineLength + 1)
      const endCh = startCh + (random() % (lineLength - startCh + 1))
      const insert = inserts[random() % inserts.length] ?? ''
      editor.replaceRange(
        insert,
        { line, ch: startCh },
        { line, ch: endCh },
        '+input'
      )
      await adapter.settled()
      expect(canonical.replace(/\r\n?|\n/g, '\n')).toBe(editor.getValue())
    }

    adapter.dispose()
  })
})
