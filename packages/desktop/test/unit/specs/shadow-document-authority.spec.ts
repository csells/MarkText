import { describe, expect, it } from 'vitest'
import {
  createDocumentCore,
  type DocumentRevision
} from '@marktext/document-core'

import {
  createEditorShadowBinding,
  createInMemoryShadowPort,
  createShadowDocumentAuthority,
  createWorkerShadowPort,
  type ShadowActorPort,
  type ShadowRequest,
  type ShadowWorkerRequestEnvelope,
  type ShadowWorkerResponseEnvelope
} from '@/documentAuthority'
import { createShadowActor } from '@/documentAuthority/shadowActor'

const markdownOptions = (overrides: Partial<{
  gfm: boolean
  gfmTagFilter: boolean
  frontMatter: boolean
  math: boolean
  gitLabMath: boolean
  footnotes: boolean
  subscriptAndSuperscript: boolean
}> = {}) => Object.freeze({
  gfm: true,
  gfmTagFilter: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: false,
  ...overrides
})

class ActorBackedWorker {
  readonly actorPort = createInMemoryShadowPort()
  readonly messages: ShadowWorkerRequestEnvelope[] = []
  terminated = false
  private readonly messageListeners = new Set<(
    event: MessageEvent<ShadowWorkerResponseEnvelope>
  ) => void>()

  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()

  postMessage(message: ShadowWorkerRequestEnvelope): void {
    this.messages.push(message)
    this.actorPort.request(message.request, message.queue).then(reply => {
      const event = { data: { type: 'shadow-result', reply } } as
        MessageEvent<ShadowWorkerResponseEnvelope>
      for (const listener of this.messageListeners) listener(event)
    })
  }

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<ShadowWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (
        event: MessageEvent<ShadowWorkerResponseEnvelope>
      ) => void)
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<ShadowWorkerResponseEnvelope>) => void) |
      ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (
        event: MessageEvent<ShadowWorkerResponseEnvelope>
      ) => void)
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
    this.actorPort.dispose()
  }

  emitError(message: string): void {
    const event = { message } as ErrorEvent
    for (const listener of this.errorListeners) listener(event)
  }
}

class ControlledObservePort implements ShadowActorPort {
  readonly actorPort = createInMemoryShadowPort()
  readonly requests: ShadowRequest[] = []
  private readonly held: Array<{
    request: ShadowRequest
    resolve: (value: Awaited<ReturnType<ShadowActorPort['request']>>) => void
    reject: (reason?: unknown) => void
  }> = []

  request(request: ShadowRequest): ReturnType<ShadowActorPort['request']> {
    this.requests.push(request)
    if (request.type !== 'observe') return this.actorPort.request(request)
    return new Promise((resolve, reject) => {
      this.held.push({ request, resolve, reject })
    })
  }

  releaseNext(): void {
    const held = this.held.shift()
    if (held === undefined) throw new Error('No held Shadow observation')
    this.actorPort.request(held.request).then(held.resolve, held.reject)
  }

  dispose(): void {
    this.actorPort.dispose()
  }
}

class HoldFirstRequestPort implements ShadowActorPort {
  readonly actorPort = createInMemoryShadowPort()
  readonly requests: ShadowRequest[] = []
  private held: {
    request: ShadowRequest
    resolve: (value: Awaited<ReturnType<ShadowActorPort['request']>>) => void
    reject: (reason?: unknown) => void
  } | undefined

  request(request: ShadowRequest): ReturnType<ShadowActorPort['request']> {
    this.requests.push(request)
    if (this.held === undefined && this.requests.length === 1) {
      return new Promise((resolve, reject) => {
        this.held = { request, resolve, reject }
      })
    }
    return this.actorPort.request(request)
  }

  release(): void {
    const held = this.held
    if (held === undefined) throw new Error('No held Shadow request')
    this.held = undefined
    this.actorPort.request(held.request).then(held.resolve, held.reject)
  }

  dispose(): void {
    this.actorPort.dispose()
  }
}

describe('Shadow document authority', () => {
  it('recognizes a revision without materializing its canonical source', () => {
    let sourceReads = 0
    const revision: DocumentRevision = Object.freeze({
      get source(): string {
        sourceReads += 1
        throw new Error('recognition must not materialize canonical source')
      },
      sourceLength: 5,
      annotations: Object.freeze([]),
      diagnostics: Object.freeze([])
    })
    const backingCore = createDocumentCore()
    const actor = createShadowActor(() => Object.freeze({
      ...backingCore,
      open: () => revision
    }))

    expect(actor.handle({
      type: 'open',
      session: 1,
      generation: 1,
      sequence: 1,
      source: 'alpha'
    })).toMatchObject({
      accepted: true,
      recognition: { sourceLength: 5 }
    })
    expect(sourceReads).toBe(0)

    actor.dispose()
  })

  it('owns one fresh core per open barrier and drops retired generations', () => {
    let coreCount = 0
    const actor = createShadowActor(() => {
      coreCount += 1
      return createDocumentCore()
    })

    expect(actor.handle({
      type: 'open',
      session: 1,
      generation: 1,
      sequence: 1,
      source: 'first'
    })).toMatchObject({ accepted: true, revision: 1 })
    expect(actor.handle({
      type: 'open',
      session: 1,
      generation: 2,
      sequence: 2,
      source: '++}'.repeat(1_025)
    })).toMatchObject({ accepted: false, status: 'resource', revision: 0 })
    expect(actor.handle({
      type: 'open',
      session: 1,
      generation: 3,
      sequence: 3,
      source: 'third'
    })).toMatchObject({ accepted: true, revision: 1 })
    expect(actor.handle({
      type: 'close',
      session: 1,
      generation: 3,
      sequence: 4
    })).toMatchObject({ accepted: true })
    expect(coreCount).toBe(3)

    actor.dispose()
  })

  it('opens barriers for document and language changes and observes only content changes', async() => {
    const requests: ShadowRequest[] = []
    const inMemory = createInMemoryShadowPort()
    const authority = createShadowDocumentAuthority({
      port: {
        request(request, queue) {
          requests.push(request)
          return inMemory.request(request, queue)
        },
        dispose() {
          inMemory.dispose()
        }
      }
    })
    const binding = createEditorShadowBinding(authority)

    binding.update({
      documentId: 'tab-a',
      source: 'alpha',
      options: markdownOptions()
    })
    await binding.settled()
    expect(requests.at(-1)).toMatchObject({
      type: 'open',
      generation: 1,
      source: 'alpha'
    })

    expect(binding.update({
      documentId: 'tab-a',
      source: 'alpha',
      options: markdownOptions()
    })).toMatchObject({ state: 'unchanged' })
    binding.update({
      documentId: 'tab-a',
      source: 'alpha {++new++}',
      options: markdownOptions()
    })
    await binding.settled()
    expect(requests.at(-1)).toMatchObject({
      type: 'observe',
      generation: 1,
      edits: [{ start: 5, end: 5, insert: ' {++new++}' }]
    })

    binding.update({
      documentId: 'tab-a',
      source: 'alpha {++new++}',
      options: markdownOptions({ footnotes: true })
    })
    await binding.settled()
    expect(requests.at(-1)).toMatchObject({
      type: 'open',
      generation: 2,
      options: { footnotes: true }
    })

    binding.update({
      documentId: 'tab-b',
      source: 'beta',
      options: markdownOptions({ footnotes: true })
    })
    await binding.settled()
    expect(requests.at(-1)).toMatchObject({
      type: 'open',
      generation: 3,
      source: 'beta'
    })

    binding.update(null)
    await binding.settled()
    expect(requests.at(-1)).toMatchObject({
      type: 'close',
      generation: 3
    })
    expect(binding.update(null)).toBeUndefined()
    expect(binding.diagnosticOnly).toBe(true)

    binding.dispose()
  })

  it('opens one diagnostic-only session without publishing source or projections', async() => {
    const authority = createShadowDocumentAuthority({
      port: createInMemoryShadowPort()
    })

    const ticket = authority.open({
      documentId: '/notes/review.md',
      source: '# title\n\n{++new++}\n'
    })

    expect(authority.mode).toBe('shadow')
    expect(authority.diagnosticOnly).toBe(true)
    expect(ticket).toEqual({ sequence: 1, state: 'queued' })
    expect(authority.reports()).toEqual([])

    await authority.settled()
    const [report] = authority.reports()
    expect(report).toMatchObject({
      documentId: '/notes/review.md',
      sequence: 1,
      revision: 1,
      accepted: true,
      status: 'accepted',
      diagnostics: [],
      recognition: {
        sourceLength: 19,
        annotationCounts: {
          addition: 1,
          deletion: 0,
          substitution: 0,
          highlight: 0,
          comment: 0
        }
      }
    })
    expect(report?.metrics.parseMs).toBeGreaterThanOrEqual(0)
    expect(report?.metrics.queueMs).toBeGreaterThanOrEqual(0)
    expect(report?.metrics.queueDepth).toBe(0)
    expect(report).not.toHaveProperty('source')
    expect(report).not.toHaveProperty('projection')

    authority.dispose()
  })

  it('coalesces snapshot bursts into one exact edit on the acknowledged revision', async() => {
    const requests: ShadowRequest[] = []
    const inMemory = createInMemoryShadowPort()
    const recordingPort: ShadowActorPort = {
      request(request) {
        requests.push(request)
        return inMemory.request(request)
      },
      dispose() {
        inMemory.dispose()
      }
    }
    const authority = createShadowDocumentAuthority({ port: recordingPort })
    authority.open({ source: 'alpha {++beta++}\n' })
    await authority.settled()

    expect(authority.observe('alpha {++BETA++}\n')).toEqual({
      sequence: 2,
      state: 'queued'
    })
    expect(authority.observe('ALPHA {++BETA++}\n!')).toEqual({
      sequence: 3,
      state: 'queued'
    })
    expect(authority.observe('ALPHA {++BETA++}\n!!')).toMatchObject({
      state: 'queued'
    })
    expect(authority.observe('ALPHA {++BETA++}\n!!!')).toMatchObject({
      state: 'queued'
    })
    expect(authority.observe('ALPHA {++BETA++}\n!!!!')).toMatchObject({
      state: 'queued'
    })
    // A synchronous Vue watch only enqueues snapshots; diffing and transport
    // begin after the watch callback returns.
    expect(requests).toHaveLength(1)
    await authority.settled()

    const session = requests[0]?.session
    expect(requests).toEqual([
      expect.objectContaining({
        type: 'open',
        session,
        generation: 1,
        sequence: 1,
        source: 'alpha {++beta++}\n'
      }),
      {
        type: 'observe',
        session,
        generation: 1,
        sequence: 6,
        baseRevision: 1,
        edits: [
          { start: 0, end: 17, insert: 'ALPHA {++BETA++}\n!!!!' }
        ]
      }
    ])
    expect(requests[1]).not.toHaveProperty('source')
    expect(authority.reports().map(report => ({
      sequence: report.sequence,
      revision: report.revision
    }))).toEqual([
      { sequence: 1, revision: 1 },
      { sequence: 6, revision: 2 }
    ])

    authority.dispose()
  })

  it('reconstructs exact UTF-16, BOM, line-ending, and trailing-newline edits', async() => {
    const cases = [
      ['A😀B', 'A😺B'],
      ['\uFEFFalpha', 'alpha'],
      ['a\r\nb', 'a\nb'],
      ['a\rb', 'a\rB'],
      ['tail\n', 'tail']
    ] as const

    for (const [previous, next] of cases) {
      const requests: ShadowRequest[] = []
      const inMemory = createInMemoryShadowPort()
      const authority = createShadowDocumentAuthority({
        port: {
          request(request, queue) {
            requests.push(request)
            return inMemory.request(request, queue)
          },
          dispose() {
            inMemory.dispose()
          }
        }
      })
      authority.open({ source: previous })
      await authority.settled()
      authority.observe(next)
      await authority.settled()

      const observed = requests.at(-1)
      expect(observed?.type).toBe('observe')
      if (observed?.type !== 'observe') throw new Error('Expected observe request')
      let reconstructed = previous
      for (let index = observed.edits.length - 1; index >= 0; index -= 1) {
        const edit = observed.edits[index]
        if (edit === undefined) continue
        reconstructed = reconstructed.slice(0, edit.start) +
          edit.insert + reconstructed.slice(edit.end)
      }
      expect(reconstructed).toBe(next)
      expect(authority.reports().at(-1)).toMatchObject({
        accepted: true,
        recognition: { sourceLength: next.length }
      })
      authority.dispose()
    }
  })

  it('rejects stale and invalid actor requests atomically', async() => {
    const port = createInMemoryShadowPort()
    const opened = await port.request({
      type: 'open',
      session: 1,
      generation: 1,
      sequence: 1,
      source: 'alpha'
    })

    await expect(port.request({
      type: 'observe',
      session: 1,
      generation: 1,
      sequence: 2,
      baseRevision: opened.revision - 1,
      edits: [{ start: 0, end: 5, insert: 'wrong' }]
    })).resolves.toMatchObject({
      accepted: false,
      status: 'rejected',
      rejectionReason: 'stale-base',
      revision: 1
    })
    await expect(port.request({
      type: 'observe',
      session: 1,
      generation: 1,
      sequence: 3,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 6, insert: 'wrong' }]
    })).resolves.toMatchObject({
      accepted: false,
      status: 'rejected',
      rejectionReason: 'invalid-edit',
      revision: 1
    })
    await expect(port.request({
      type: 'observe',
      session: 1,
      generation: 1,
      sequence: 4,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 0, insert: 42 }] as never
    })).resolves.toMatchObject({
      accepted: false,
      status: 'rejected',
      rejectionReason: 'invalid-edit',
      revision: 1
    })

    await expect(port.request({
      type: 'observe',
      session: 1,
      generation: 1,
      sequence: 5,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 5, insert: '{++right++}' }]
    })).resolves.toMatchObject({
      accepted: true,
      status: 'accepted',
      revision: 2
    })

    port.dispose()
  })

  it('runs the same actor protocol through the production Worker port', async() => {
    const worker = new ActorBackedWorker()
    const port = createWorkerShadowPort(worker)

    const opened = await port.request({
      type: 'open',
      session: 7,
      generation: 1,
      sequence: 41,
      source: 'before'
    }, { queuedAt: Date.now(), queueDepth: 2 })
    const observed = await port.request({
      type: 'observe',
      session: 7,
      generation: 1,
      sequence: 42,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 6, insert: 'after' }]
    })

    expect(observed).toMatchObject({
      session: 7,
      generation: 1,
      sequence: 42,
      revision: 2,
      accepted: true,
      status: 'accepted'
    })
    expect(worker.messages[0]).toMatchObject({
      type: 'shadow-request',
      request: { type: 'open', source: 'before' },
      queue: { queueDepth: 2 }
    })
    expect(worker.messages[1]?.request).not.toHaveProperty('source')

    port.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('latches a Worker failure so later requests reject instead of hanging', async() => {
    const worker = new ActorBackedWorker()
    const port = createWorkerShadowPort(worker)
    await expect(port.request({
      type: 'open',
      session: 7,
      generation: 1,
      sequence: 1,
      source: 'before failure'
    })).resolves.toMatchObject({ accepted: true })

    worker.emitError('worker crashed')
    await expect(port.request({
      type: 'open',
      session: 7,
      generation: 2,
      sequence: 2,
      source: 'after failure'
    })).rejects.toThrow('worker crashed')
    expect(worker.messages).toHaveLength(1)
    expect(worker.terminated).toBe(true)

    port.dispose()
  })

  it('disables diagnostically on finite-queue overflow until an explicit open barrier', async() => {
    const port = new ControlledObservePort()
    const authority = createShadowDocumentAuthority({ port, maxPending: 1 })
    authority.open({ documentId: 'a', source: 'a' })
    await authority.settled()

    expect(authority.observe('ab')).toMatchObject({ state: 'queued' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(authority.observe('abc')).toEqual({
      sequence: 3,
      state: 'disabled',
      reason: 'queue-full'
    })
    expect(authority.observe('abcd')).toMatchObject({
      state: 'disabled',
      reason: 'queue-full'
    })
    expect(port.requests.filter(request => request.type === 'observe'))
      .toHaveLength(1)

    port.releaseNext()
    await authority.settled()
    expect(authority.reports()).toContainEqual(expect.objectContaining({
      sequence: 3,
      accepted: false,
      terminal: true,
      rejectionReason: 'queue-full',
      metrics: expect.objectContaining({ queueDepth: 1 })
    }))
    expect(authority.reports().at(-1)).toMatchObject({
      sequence: 3,
      accepted: false,
      terminal: true,
      rejectionReason: 'queue-full'
    })

    expect(authority.open({ documentId: 'b', source: 'fresh' })).toMatchObject({
      state: 'queued'
    })
    await authority.settled()
    expect(authority.observe('fresher')).toMatchObject({ state: 'queued' })
    await new Promise(resolve => setTimeout(resolve, 0))
    port.releaseNext()
    await authority.settled()
    expect(port.requests.at(-1)).toMatchObject({
      type: 'observe',
      session: port.requests[0]?.session,
      generation: 2,
      baseRevision: 1,
      edits: [{ start: 5, end: 5, insert: 'er' }]
    })

    authority.dispose()
  })

  it('bounds renderer snapshot diffing and retention by UTF-16 source units', async() => {
    const requests: ShadowRequest[] = []
    const actorPort = createInMemoryShadowPort()
    const authority = createShadowDocumentAuthority({
      maxDiffSourceUnits: 8,
      port: {
        request(request, queue) {
          requests.push(request)
          return actorPort.request(request, queue)
        },
        dispose() {
          actorPort.dispose()
        }
      }
    })
    authority.open({ documentId: 'large', source: '123456789' })
    await authority.settled()

    expect(authority.observe('12345678!')).toEqual({
      sequence: 2,
      state: 'disabled',
      reason: 'snapshot-too-large'
    })
    await authority.settled()
    expect(requests).toHaveLength(1)
    expect(authority.reports().at(-1)).toMatchObject({
      sequence: 2,
      accepted: false,
      terminal: true,
      rejectionReason: 'snapshot-too-large'
    })
    expect(authority.reports().at(-1)).not.toHaveProperty('source')

    authority.dispose()
  })

  it('uses session identity so a late reply cannot advance a replacement document', async() => {
    const port = new HoldFirstRequestPort()
    const authority = createShadowDocumentAuthority({ port })
    authority.open({ documentId: 'A', source: 'alpha' })
    await Promise.resolve()
    authority.open({ documentId: 'B', source: 'bravo' })

    port.release()
    await authority.settled()
    authority.observe('bravo!')
    await authority.settled()

    expect(port.requests).toEqual([
      expect.objectContaining({
        type: 'open',
        generation: 1,
        source: 'alpha'
      }),
      expect.objectContaining({
        type: 'open',
        generation: 2,
        source: 'bravo'
      }),
      {
        type: 'observe',
        session: port.requests[0]?.session,
        generation: 2,
        sequence: 3,
        baseRevision: 1,
        edits: [{ start: 5, end: 5, insert: '!' }]
      }
    ])
    expect(authority.reports().map(report => ({
      documentId: report.documentId,
      generation: report.generation,
      revision: report.revision
    }))).toEqual([
      { documentId: 'A', generation: 1, revision: 1 },
      { documentId: 'B', generation: 2, revision: 1 },
      { documentId: 'B', generation: 2, revision: 2 }
    ])

    authority.dispose()
  })

  it('keeps options on open barriers and closes without exposing a durable result', async() => {
    const requests: ShadowRequest[] = []
    const actorPort = createInMemoryShadowPort()
    const port: ShadowActorPort = {
      request(request, queue) {
        requests.push(request)
        return actorPort.request(request, queue)
      },
      dispose() {
        actorPort.dispose()
      }
    }
    const authority = createShadowDocumentAuthority({ port })
    authority.open({ source: '[^a]: note\n', options: { footnotes: false } })
    await authority.settled()

    expect(authority.close()).toMatchObject({ state: 'queued' })
    await authority.settled()
    expect(authority.observe('must not send')).toMatchObject({
      state: 'disabled',
      reason: 'closed'
    })

    authority.open({ source: '[^a]: note\n', options: { footnotes: true } })
    await authority.settled()
    expect(requests).toEqual([
      expect.objectContaining({
        type: 'open',
        generation: 1,
        options: { footnotes: false }
      }),
      expect.objectContaining({ type: 'close', generation: 1 }),
      expect.objectContaining({
        type: 'open',
        generation: 2,
        options: { footnotes: true }
      })
    ])
    for (const report of authority.reports()) {
      expect(report).not.toHaveProperty('source')
      expect(report).not.toHaveProperty('projection')
    }

    authority.dispose()
  })

  it('rejects out-of-order sequences without consuming the valid base', async() => {
    const port = createInMemoryShadowPort()
    const opened = await port.request({
      type: 'open',
      session: 3,
      generation: 1,
      sequence: 10,
      source: 'old'
    })

    await expect(port.request({
      type: 'observe',
      session: 3,
      generation: 1,
      sequence: 9,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 3, insert: 'bad' }]
    })).resolves.toMatchObject({
      accepted: false,
      rejectionReason: 'out-of-order',
      revision: 1
    })
    await expect(port.request({
      type: 'observe',
      session: 3,
      generation: 1,
      sequence: 11,
      baseRevision: opened.revision,
      edits: [{ start: 0, end: 3, insert: 'new' }]
    })).resolves.toMatchObject({ accepted: true, revision: 2 })

    port.dispose()
  })

  it('reports syntax diagnostics and full resource failure facts only', async() => {
    const port = createInMemoryShadowPort()
    const diagnostic = await port.request({
      type: 'open',
      session: 1,
      generation: 1,
      sequence: 1,
      source: '{++'
    })
    expect(diagnostic).toMatchObject({
      accepted: true,
      status: 'diagnostic',
      diagnosticCount: 1,
      diagnostics: [{ code: 'CM_UNTERMINATED_OPENER' }]
    })

    const diagnosticStorm = await port.request({
      type: 'open',
      session: 1,
      generation: 2,
      sequence: 2,
      source: '++}'.repeat(20)
    })
    expect(diagnosticStorm).toMatchObject({
      accepted: true,
      status: 'diagnostic',
      diagnosticCount: 20
    })
    expect(diagnosticStorm.diagnostics).toHaveLength(16)

    const nestedSource = '{++a{--b--}{~~x~>y~~}{==h==}{>>c<<}++}'
    const recognized = await port.request({
      type: 'open',
      session: 2,
      generation: 1,
      sequence: 3,
      source: nestedSource
    })
    expect(recognized.recognition).toEqual({
      sourceLength: nestedSource.length,
      annotationCounts: {
        addition: 1,
        deletion: 1,
        substitution: 1,
        highlight: 1,
        comment: 1
      }
    })

    const depth = 16_385
    const overLimit = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    const resource = await port.request({
      type: 'open',
      session: 3,
      generation: 1,
      sequence: 4,
      source: overLimit
    })
    expect(resource).toMatchObject({
      accepted: false,
      status: 'resource',
      revision: 0,
      resource: {
        code: 'CM_RESOURCE_CM_DEPTH_EXCEEDED',
        range: { start: expect.any(Number), end: expect.any(Number) },
        metadata: expect.any(Object)
      }
    })
    expect(Object.keys(resource.resource?.metadata ?? {})).not.toHaveLength(0)
    expect(resource).not.toHaveProperty('source')
    expect(resource).not.toHaveProperty('projection')
    expect(resource).not.toHaveProperty('recognition')

    const diagnosticResource = await port.request({
      type: 'open',
      session: 4,
      generation: 1,
      sequence: 5,
      source: '++}'.repeat(1_025)
    })
    expect(diagnosticResource).toMatchObject({
      accepted: false,
      status: 'resource',
      diagnosticCount: 0,
      diagnostics: [],
      resource: {
        code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
        metadata: { limit: '1024', observed: '1025' }
      }
    })

    const recovered = await port.request({
      type: 'open',
      session: 5,
      generation: 1,
      sequence: 6,
      source: 'fresh after rejected open'
    })
    expect(recovered).toMatchObject({
      accepted: true,
      status: 'accepted',
      revision: 1,
      recognition: { sourceLength: 25 }
    })

    port.dispose()
  })

  it('classifies unexpected port failures as terminal transport errors', async() => {
    const port: ShadowActorPort = {
      request() {
        return Promise.reject(new Error('actor invariant failed'))
      },
      dispose() {}
    }
    const authority = createShadowDocumentAuthority({ port })

    authority.open({ source: 'source remains upstream-owned' })
    await authority.settled()

    expect(authority.reports()).toEqual([
      expect.objectContaining({
        accepted: false,
        terminal: true,
        rejectionReason: 'transport-error'
      })
    ])
    expect(authority.observe('upstream can keep editing')).toMatchObject({
      state: 'disabled',
      reason: 'transport-error'
    })
    expect(authority.reports()[0]).not.toHaveProperty('source')

    authority.dispose()
  })

  it('bounds retained diagnostic reports independently of the work queue', async() => {
    const authority = createShadowDocumentAuthority({
      port: createInMemoryShadowPort(),
      maxReports: 2
    })
    authority.open({ source: 'a' })
    await authority.settled()
    authority.observe('ab')
    await authority.settled()
    authority.observe('abc')
    await authority.settled()

    expect(authority.reports().map(report => report.sequence)).toEqual([2, 3])
    for (const report of authority.reports()) {
      expect(report).not.toHaveProperty('source')
      expect(report).not.toHaveProperty('edits')
    }

    authority.dispose()
  })

  it('does not reopen or report an unchanged observed snapshot', async() => {
    const requests: ShadowRequest[] = []
    const actorPort = createInMemoryShadowPort()
    const authority = createShadowDocumentAuthority({
      port: {
        request(request, queue) {
          requests.push(request)
          return actorPort.request(request, queue)
        },
        dispose() {
          actorPort.dispose()
        }
      }
    })
    authority.open({ source: 'unchanged' })
    await authority.settled()

    expect(authority.observe('unchanged')).toEqual({
      sequence: 2,
      state: 'unchanged'
    })
    await authority.settled()
    expect(requests).toHaveLength(1)
    expect(authority.reports()).toHaveLength(1)

    authority.dispose()
  })
})
