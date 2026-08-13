import type { DocumentSourceEdit } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextSourceBinding
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type {
  EditorCoreApplyOutcome,
  EditorCoreBinding,
  EditorCoreSubmitInput,
  EditorCoreSubmission
} from '@/documentAuthority/editorCoreBinding'
import type { CoreAuthorityPerformanceEvent } from '@/documentAuthority/coreAuthorityPerformanceTrace'

const applied = (
  revision: number,
  edit: DocumentSourceEdit
): Extract<EditorCoreApplyOutcome, { readonly type: 'applied' }> => Object.freeze({
  type: 'applied',
  session: 1,
  sequence: revision,
  revision,
  accepted: true,
  sourceLength: 20,
  diagnosticCount: 0,
  diagnostics: Object.freeze([]),
  change: Object.freeze({
    appliedEdits: Object.freeze([Object.freeze({ ...edit })]),
    projections: Object.freeze([])
  })
})

describe('Muya plain-text Core command lane', () => {
  it('adopts an externally authorized applied revision only through reconciliation', async() => {
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 3 }),
      text: 'cat'
    }]), {} as Pick<EditorCoreBinding, 'submit'>)

    await expect(adapter.reconcileApplied(
      applied(2, { start: 0, end: 3, insert: 'dog' }),
      () => Promise.resolve(Object.freeze([{
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 3 }),
        text: 'dog'
      }]))
    )).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 0 },
      focus: { path: [0, 'text'], offset: 3 }
    })).toEqual({ start: 0, end: 3 })
    adapter.dispose()
  })

  it('maps a live bound selection to canonical source coordinates without widening scope', () => {
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 11, end: 15 }),
      text: 'seed'
    }, {
      path: Object.freeze([1, 'text'] as const),
      sourceRange: Object.freeze({ start: 17, end: 21 }),
      text: 'next'
    }]), {} as Pick<EditorCoreBinding, 'submit'>)

    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 4 },
      focus: { path: [0, 'text'], offset: 1 }
    })).toEqual({ start: 12, end: 15 })
    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 1 },
      focus: { path: [1, 'text'], offset: 2 }
    })).toEqual({ start: 12, end: 19 })
    expect(adapter.selectionSourceRange({
      anchor: { path: [1, 'text'], offset: 2 },
      focus: { path: [0, 'text'], offset: 1 }
    })).toEqual({ start: 12, end: 19 })
    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 1 },
      focus: { path: [0, 'text'], offset: 1 }
    })).toBeUndefined()
    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 1 },
      focus: { path: [2, 'text'], offset: 1 }
    })).toBeUndefined()
    expect(adapter.selectionSourceRange({
      anchor: { path: [0, 'text'], offset: 1 },
      focus: { path: [1, 'text'], offset: 5 }
    })).toBeUndefined()

    adapter.dispose()
  })

  it('submits an empty Comment payload and distinguishes it from cancellation', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'empty-comment.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 0,
            end: 4,
            insert: '{==seed==}{>><<}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)

    await expect(adapter.author('comment', {
      anchor: { path: [0, 'text'], offset: 0 },
      focus: { path: [0, 'text'], offset: 4 }
    }, '', () => Promise.resolve(Object.freeze([])))).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    expect(submissions).toEqual([{
      kind: 'author',
      form: 'comment',
      range: { start: 0, end: 4 },
      text: '',
      projections: []
    }])
  })

  it('reports bounded dispatch, acknowledgement, and reconciliation phases', async() => {
    const events: CoreAuthorityPerformanceEvent[] = []
    let now = 10
    const binding = {
      submit(): EditorCoreSubmission {
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'latency.md',
            generation: 1,
            transactionId: 7
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 4,
            end: 4,
            insert: '!'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding, {
      documentId: 'latency.md',
      record(event) {
        events.push(Object.freeze({ ...event }))
      },
      clock: () => now
    })

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    })).toBe('accepted')
    now = 13
    await Promise.resolve()
    now = 15
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(events).toEqual([
      {
        phase: 'dispatch',
        documentId: 'latency.md',
        transaction: 7,
        pendingDepth: 1,
        at: 10
      },
      {
        phase: 'ack',
        documentId: 'latency.md',
        transaction: 7,
        at: 13
      },
      {
        phase: 'reconcile',
        documentId: 'latency.md',
        transaction: 7,
        corrected: false,
        at: 13
      }
    ])
  })

  it('routes one native insertion through actor-owned Track Changes and rebinds before settlement', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    let release: ((outcome: EditorCoreApplyOutcome) => void) | undefined
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-one.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            release = resolve
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)
    let finishReconciliation: (() => void) | undefined

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    }, () => new Promise(resolve => {
      finishReconciliation = () => resolve(Object.freeze([]))
    }))).toBe('accepted')
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 4, end: 4 },
      text: '!',
      projections: []
    }])
    expect(submissions[0]).not.toHaveProperty('edits')

    const barrier = adapter.settled()
    release?.(applied(2, { start: 4, end: 4, insert: '{++!++}' }))
    await Promise.resolve()
    let settled = false
    barrier.then(() => { settled = true }).catch(() => {})
    await Promise.resolve()
    expect(settled).toBe(false)

    finishReconciliation?.()
    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('routes one native replacement through actor-owned Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-replacement.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 1,
            end: 2,
            insert: '{~~b~>X~~}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 2 }),
      text: 'ab'
    }]), binding)

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'ab' }],
      doc: [{ name: 'paragraph', text: 'aX' }],
      op: [0, 'text', { es: [1, { d: 'b' }, 'X'] }]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 1, end: 2 },
      text: 'X',
      projections: []
    }])
  })

  it('retains a second tracked keystroke while the first acknowledgement is pending', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const releases: Array<(outcome: EditorCoreApplyOutcome) => void> = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-fast-typing.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            releases.push(resolve)
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const initialBindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }])
    const afterFirst = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 3, end: 8 }),
      text: 'seed!'
    }])
    const afterSecond = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 3, end: 9 }),
      text: 'seed!?'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(initialBindings, binding)
    let reconciliation = 0
    const reconcile = () => Promise.resolve(
      reconciliation++ === 0 ? afterFirst : afterSecond
    )

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    }, reconcile)).toBe('accepted')
    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed!' }],
      doc: [{ name: 'paragraph', text: 'seed!?' }],
      op: [0, 'text', { es: [5, '?'] }]
    }, reconcile)).toBe('accepted')

    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 4, end: 4 },
      text: '!',
      projections: []
    }])
    releases[0]?.(applied(2, { start: 4, end: 4, insert: '{++!++}' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(submissions).toEqual([
      {
        kind: 'track',
        range: { start: 4, end: 4 },
        text: '!',
        projections: []
      },
      {
        kind: 'track',
        range: { start: 8, end: 8 },
        text: '?',
        projections: []
      }
    ])
    releases[1]?.(applied(3, { start: 8, end: 8, insert: '?' }))
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })
  })

  it('commits one native composition as one actor-owned tracked change', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    let release: ((outcome: EditorCoreApplyOutcome) => void) | undefined
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-composition.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            release = resolve
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)

    adapter.compositionStart()
    const saveBarrier = adapter.settled()
    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed日' }],
      op: [0, 'text', { es: [4, '日'] }]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed日' }],
      doc: [{ name: 'paragraph', text: 'seed日本' }],
      op: [0, 'text', { es: [5, '本'] }]
    })).toBe('accepted')
    expect(submissions).toEqual([])

    const ending = adapter.compositionEnd()
    await Promise.resolve()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 4, end: 4 },
      text: '日本',
      projections: []
    }])
    release?.(applied(2, { start: 4, end: 4, insert: '{++日本++}' }))

    await expect(ending).resolves.toBeUndefined()
    await expect(saveBarrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('resolves one Review item through the actor lane and settles after view reconciliation', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'review.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 7,
            end: 16,
            insert: 'old'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([]), binding)
    let finishReconciliation: (() => void) | undefined

    const resolving = adapter.resolve(
      { kind: 'deletion', range: { start: 7, end: 16 } },
      1,
      'reject',
      () => new Promise(resolve => {
        finishReconciliation = () => resolve(Object.freeze([]))
      })
    )
    const barrier = adapter.settled()
    await Promise.resolve()

    expect(submissions).toEqual([{
      kind: 'resolve',
      authoredRevision: 1,
      annotation: { kind: 'deletion', range: { start: 7, end: 16 } },
      decision: 'reject',
      projections: []
    }])
    let resolved = false
    resolving.then(() => { resolved = true }).catch(() => {})
    await Promise.resolve()
    expect(resolved).toBe(false)

    finishReconciliation?.()
    await expect(resolving).resolves.toMatchObject({ revision: 2 })
    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('resolves all Review suggestions through one atomic actor command', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'resolve-all.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 2,
            end: 11,
            insert: 'new'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 3 }),
      text: 'new'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(adapter.resolveAll(
      'accept',
      () => Promise.resolve(bindings)
    )).resolves.toMatchObject({ type: 'applied', revision: 2 })
    expect(submissions).toEqual([{
      kind: 'resolve-all',
      decision: 'accept',
      projections: []
    }])
  })

  it('edits one Review Comment through the actor lane before settlement', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'edit-comment.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 17,
            end: 31,
            insert: '{>>new note<<}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 10, end: 14 }),
      text: 'text'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)
    let reconciled = false

    await expect(adapter.editComment({
      kind: 'commented-span',
      range: { start: 7, end: 31 },
      highlightRange: { start: 7, end: 17 },
      commentRange: { start: 17, end: 31 }
    }, 1, 'new note', () => {
      reconciled = true
      return Promise.resolve(bindings)
    })).resolves.toMatchObject({ type: 'applied', revision: 2 })

    expect(submissions).toEqual([{
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
    }])
    expect(reconciled).toBe(true)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('keeps Comment editing ready after a no-change or stale target refusal', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const reasons = ['no-change', 'annotation-not-found'] as const
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const reason = reasons[submissions.length - 1]
        if (reason === undefined) throw new Error('Unexpected Comment edit')
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'edit-comment-refusal.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: Promise.resolve(Object.freeze({
            type: 'rejected' as const,
            session: 1,
            sequence: submissions.length,
            revision: 1,
            accepted: false as const,
            reason,
            sourceLength: 31
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([]), binding)
    const locator = Object.freeze({
      kind: 'comment' as const,
      range: Object.freeze({ start: 17, end: 31 })
    })
    let reconciliations = 0
    const reconcile = () => {
      reconciliations += 1
      return Promise.resolve(Object.freeze([]))
    }

    await expect(adapter.editComment(locator, 1, 'same', reconcile))
      .resolves.toBeUndefined()
    await expect(adapter.editComment(locator, 1, 'stale', reconcile))
      .resolves.toBeUndefined()
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(reconciliations).toBe(0)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })
    expect(submissions).toHaveLength(2)
  })

  it('keeps WYSIWYG authority ready after a stale Review locator is rejected', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const outcome: EditorCoreApplyOutcome = input.kind === 'resolve'
          ? Object.freeze({
            type: 'rejected',
            session: 1,
            sequence: 1,
            revision: 1,
            accepted: false,
            reason: 'annotation-not-found',
            sourceLength: 4
          })
          : applied(2, { start: 4, end: 4, insert: '!' })
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'stale-review.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: Promise.resolve(outcome)
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)
    let reconciled = false

    await expect(adapter.resolve(
      { kind: 'deletion', range: { start: 7, end: 16 } },
      1,
      'reject',
      () => {
        reconciled = true
        return Promise.resolve(Object.freeze([]))
      }
    )).resolves.toBeUndefined()
    expect(reconciled).toBe(false)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
    expect(submissions).toHaveLength(2)
  })

  it('keeps WYSIWYG authority ready after a history-resource Review refusal', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const outcome: EditorCoreApplyOutcome = input.kind === 'resolve'
          ? Object.freeze({
            type: 'rejected',
            session: 1,
            sequence: 1,
            revision: 1,
            accepted: false,
            reason: 'history-resource',
            sourceLength: 12
          })
          : applied(2, { start: 4, end: 4, insert: '!' })
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'history-resource-review.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: Promise.resolve(outcome)
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)
    let reconciled = false

    await expect(adapter.resolve(
      { kind: 'addition', range: { start: 0, end: 12 } },
      1,
      'accept',
      () => {
        reconciled = true
        return Promise.resolve(bindings)
      }
    )).resolves.toBeUndefined()
    expect(reconciled).toBe(false)
    expect(adapter.state()).toEqual({ status: 'ready', revision: 1 })

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('maps a selected plain-text binding into one actor-owned author command', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'author.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 6,
            end: 14,
            insert: '{==selected==}{>>note<<}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 20 }),
      text: 'alpha selected omega'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(adapter.author('comment', {
      anchor: { path: [0, 'text'], offset: 6 },
      focus: { path: [0, 'text'], offset: 14 }
    }, 'note', () => Promise.resolve(bindings))).resolves.toMatchObject({
      type: 'applied',
      revision: 2
    })
    expect(submissions).toEqual([{
      kind: 'author',
      form: 'comment',
      range: { start: 6, end: 14 },
      text: 'note',
      projections: []
    }])
  })

  it('maps later-block authoring after an earlier queued paragraph edit', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const releases: Array<(outcome: EditorCoreApplyOutcome) => void> = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'shifted-author.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            releases.push(resolve)
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 5 }),
      text: 'alpha'
    }, {
      path: Object.freeze([1, 'text'] as const),
      sourceRange: Object.freeze({ start: 7, end: 12 }),
      text: 'omega'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'alpha' }],
      doc: [{ name: 'paragraph', text: 'alpha!' }],
      op: [0, 'text', { es: [5, '!'] }]
    })).toBe('accepted')
    const authoring = adapter.author('substitution', {
      anchor: { path: [1, 'text'], offset: 0 },
      focus: { path: [1, 'text'], offset: 5 }
    }, 'replacement', () => Promise.resolve(bindings))

    expect(submissions).toEqual([{
      edits: [{ start: 5, end: 5, insert: '!' }],
      projections: []
    }])
    releases.shift()?.(applied(2, { start: 5, end: 5, insert: '!' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(submissions[1]).toEqual({
      kind: 'author',
      form: 'substitution',
      range: { start: 8, end: 13 },
      text: 'replacement',
      projections: []
    })
    releases.shift()?.(applied(3, {
      start: 8,
      end: 13,
      insert: '{~~omega~>replacement~~}'
    }))
    await expect(authoring).resolves.toMatchObject({ revision: 3 })
  })

  it('orders immediate undo after its pending edit and settles through view reconciliation', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const releases: Array<(outcome: EditorCoreApplyOutcome) => void> = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'undo.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            releases.push(resolve)
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed!' }],
      op: [0, 'text', { es: [4, '!'] }]
    })).toBe('accepted')
    let finishReconciliation: (() => void) | undefined
    let reconciliationRevision: number | undefined
    const undoing = adapter.history('undo', outcome => {
      reconciliationRevision = outcome.revision
      return new Promise<readonly MuyaPlainTextSourceBinding[]>(resolve => {
        finishReconciliation = () => resolve(Object.freeze([{
          path: Object.freeze([0, 'text'] as const),
          sourceRange: Object.freeze({ start: 0, end: 4 }),
          text: 'seed'
        }]))
      })
    })
    const barrier = adapter.settled()

    expect(submissions).toEqual([{
      edits: [{ start: 4, end: 4, insert: '!' }],
      projections: []
    }])
    releases.shift()?.(applied(2, { start: 4, end: 4, insert: '!' }))
    await Promise.resolve()
    expect(submissions).toEqual([
      { edits: [{ start: 4, end: 4, insert: '!' }], projections: [] },
      { kind: 'undo', projections: [] }
    ])

    releases.shift()?.(applied(3, { start: 4, end: 5, insert: '' }))
    await Promise.resolve()
    expect(reconciliationRevision).toBe(3)
    let barrierResolved = false
    barrier.then(() => { barrierResolved = true }).catch(() => {})
    await Promise.resolve()
    expect(barrierResolved).toBe(false)

    finishReconciliation?.()
    await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 3 })
    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed?' }],
      op: [0, 'text', { es: [4, '?'] }]
    })).toBe('accepted')
    expect(submissions.at(-1)).toEqual({
      edits: [{ start: 4, end: 4, insert: '?' }],
      projections: []
    })
    releases.shift()?.(applied(4, { start: 4, end: 4, insert: '?' }))
    await expect(adapter.settled()).resolves.toBeUndefined()
  })

  it('serializes consecutive native operations and settles through actor acknowledgements', async() => {
    const releases: Array<(outcome: EditorCoreApplyOutcome) => void> = []
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        const acknowledged = new Promise<EditorCoreApplyOutcome>(resolve => {
          releases.push(resolve)
        })
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'plain.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([{
      path: Object.freeze([1, 'text'] as const),
      sourceRange: Object.freeze({ start: 6, end: 12 }),
      text: 'middle'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    expect(adapter.accept({
      source: 'user',
      op: [1, 'text', { es: [3, { d: 'd' }, 'X'] }],
      prevDoc: [{ name: 'paragraph', text: 'head' }, { name: 'paragraph', text: 'middle' }],
      doc: [{ name: 'paragraph', text: 'head' }, { name: 'paragraph', text: 'midXle' }]
    })).toBe('accepted')
    expect(adapter.accept({
      source: 'user',
      op: [1, 'text', { es: [4, 'Y'] }],
      prevDoc: [{ name: 'paragraph', text: 'head' }, { name: 'paragraph', text: 'midXle' }],
      doc: [{ name: 'paragraph', text: 'head' }, { name: 'paragraph', text: 'midXYle' }]
    })).toBe('accepted')

    expect(submissions).toEqual([{
      edits: [{ start: 9, end: 10, insert: 'X' }],
      projections: []
    }])
    const barrier = adapter.settled()
    releases.shift()?.(applied(2, { start: 9, end: 10, insert: 'X' }))
    await Promise.resolve()
    expect(submissions).toEqual([
      { edits: [{ start: 9, end: 10, insert: 'X' }], projections: [] },
      { edits: [{ start: 10, end: 10, insert: 'Y' }], projections: [] }
    ])
    releases.shift()?.(applied(3, { start: 10, end: 10, insert: 'Y' }))

    await expect(barrier).resolves.toBeUndefined()
    expect(adapter.state()).toEqual({ status: 'ready', revision: 3 })
  })

  it('faults closed on an unsupported structural operation', async() => {
    const binding = { submit(): never { throw new Error('must not submit') } } as
      Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 5 }),
      text: 'plain'
    }]), binding)

    expect(adapter.accept({
      source: 'user',
      op: [0, { r: true, i: { name: 'atx-heading', text: 'plain' } }],
      prevDoc: [{ name: 'paragraph', text: 'plain' }],
      doc: [{ name: 'atx-heading', text: 'plain' }]
    })).toBe('unsupported')

    await expect(adapter.settled()).rejects.toThrow('operation-shape')
    expect(adapter.state()).toMatchObject({ status: 'faulted' })
  })

  it('submits one native paragraph-to-heading replacement exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'heading.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 0,
            end: 5,
            insert: '# title'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 5 }),
      text: 'plain'
    }]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'plain' }],
      doc: [{ name: 'atx-heading', text: '# title', meta: { level: 1 } }],
      op: [0, {
        r: true,
        i: { name: 'atx-heading', text: '# title', meta: { level: 1 } }
      }]
    })).toBe('accepted')
    await adapter.settled()

    expect(submissions).toEqual([{
      edits: [{ start: 0, end: 5, insert: '# title' }],
      projections: []
    }])
  })

  it('routes one native paragraph-to-heading format through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-heading.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 0,
            end: 5,
            insert: '{~~plain~># title~~}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 5 }),
      text: 'plain'
    }]), binding)
    let reconcile = false

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'plain' }],
      doc: [{ name: 'atx-heading', text: '# title', meta: { level: 1 } }],
      op: [0, {
        r: true,
        i: { name: 'atx-heading', text: '# title', meta: { level: 1 } }
      }]
    }, () => {
      reconcile = true
      return Promise.resolve(Object.freeze([]))
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(reconcile).toBe(true)
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 0, end: 5 },
      text: '# title',
      projections: []
    }])
  })

  it('submits one native cross-paragraph typing replacement exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        if (!('edits' in input)) throw new Error('Expected a source-edit submission')
        const edit = input.edits[0]
        if (edit === undefined) throw new Error('Expected one exact source edit')
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'cross.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, edit))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 5 }),
        text: 'alpha'
      },
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 7, end: 11 }),
        text: 'beta'
      },
      {
        path: Object.freeze([2, 'text'] as const),
        sourceRange: Object.freeze({ start: 13, end: 18 }),
        text: 'gamma'
      }
    ]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [
        { name: 'paragraph', text: 'alpha' },
        { name: 'paragraph', text: 'beta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      doc: [{ name: 'paragraph', text: 'alXmma' }],
      op: [
        [0, 'text', { es: [2, 'X', { d: 'ph' }, 'mm'] }],
        [1, { r: true }],
        [2, { r: true }]
      ]
    })).toBe('accepted')
    await adapter.settled()

    expect(submissions).toEqual([{
      edits: [{ start: 2, end: 15, insert: 'X' }],
      projections: []
    }])
  })

  it('routes one native cross-paragraph replacement through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'cross-track.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 2,
            end: 15,
            insert: '{~~pha\n\nbeta\n\nga~>X~~}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 5 }),
        text: 'alpha'
      },
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 7, end: 11 }),
        text: 'beta'
      },
      {
        path: Object.freeze([2, 'text'] as const),
        sourceRange: Object.freeze({ start: 13, end: 18 }),
        text: 'gamma'
      }
    ]), binding)

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [
        { name: 'paragraph', text: 'alpha' },
        { name: 'paragraph', text: 'beta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      doc: [{ name: 'paragraph', text: 'alXmma' }],
      op: [
        [0, 'text', { es: [2, 'X', { d: 'ph' }, 'mm'] }],
        [1, { r: true }],
        [2, { r: true }]
      ]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 2, end: 15 },
      text: 'X',
      projections: []
    }])
  })

  it('routes one native cross-paragraph cut through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'cross-cut-track.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 2,
            end: 15,
            insert: '{--pha\n\nbeta\n\nga--}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 5 }),
        text: 'alpha'
      },
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 7, end: 11 }),
        text: 'beta'
      },
      {
        path: Object.freeze([2, 'text'] as const),
        sourceRange: Object.freeze({ start: 13, end: 18 }),
        text: 'gamma'
      }
    ]), binding)

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [
        { name: 'paragraph', text: 'alpha' },
        { name: 'paragraph', text: 'beta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      doc: [{ name: 'paragraph', text: 'almma' }],
      op: [
        [0, 'text', { es: [2, { d: 'ph' }, 'mm'] }],
        [1, { r: true }],
        [2, { r: true }]
      ]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 2, end: 15 },
      text: '',
      projections: []
    }])
  })

  it('refuses authoring through bindings invalidated by a cross-paragraph edit', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    let release: ((outcome: EditorCoreApplyOutcome) => void) | undefined
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'cross-author.md',
            generation: 1,
            transactionId: submissions.length
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            release = resolve
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([
      {
        path: Object.freeze([0, 'text'] as const),
        sourceRange: Object.freeze({ start: 0, end: 5 }),
        text: 'alpha'
      },
      {
        path: Object.freeze([1, 'text'] as const),
        sourceRange: Object.freeze({ start: 7, end: 11 }),
        text: 'beta'
      },
      {
        path: Object.freeze([2, 'text'] as const),
        sourceRange: Object.freeze({ start: 13, end: 18 }),
        text: 'gamma'
      }
    ]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [
        { name: 'paragraph', text: 'alpha' },
        { name: 'paragraph', text: 'beta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      doc: [
        { name: 'paragraph', text: 'alLONGta' },
        { name: 'paragraph', text: 'gamma' }
      ],
      op: [
        [0, 'text', { es: [2, 'LONG', { d: 'pha' }, 'ta'] }],
        [1, { r: true }]
      ]
    })).toBe('accepted')
    const authoring = adapter.author('comment', {
      anchor: { path: [1, 'text'], offset: 0 },
      focus: { path: [1, 'text'], offset: 4 }
    }, 'note', () => Promise.resolve(Object.freeze([])))
    release?.(applied(2, { start: 2, end: 9, insert: 'LONG' }))

    await expect(authoring).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      edits: [{ start: 2, end: 9, insert: 'LONG' }],
      projections: []
    }])
    expect(adapter.state()).toEqual({ status: 'ready', revision: 2 })
  })

  it('maps Mark Highlight without inventing a text payload', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'highlight.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 1,
            end: 4,
            insert: '{==eed==}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(adapter.author('highlight', {
      anchor: { path: [0, 'text'], offset: 1 },
      focus: { path: [0, 'text'], offset: 4 }
    }, '', () => Promise.resolve(bindings))).resolves.toMatchObject({ revision: 2 })
    expect(submissions).toEqual([{
      kind: 'author',
      form: 'highlight',
      range: { start: 1, end: 4 },
      text: '',
      projections: []
    }])
  })

  it('maps authoring through a selection-only structural paragraph binding', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'reference.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 5,
            end: 14,
            insert: '{==important==}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const bindings = Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 25 }),
      text: 'See [important][ref].[^n]',
      editable: false as const
    }])
    const adapter = createMuyaPlainTextCoreAdapter(bindings, binding)

    await expect(adapter.author('highlight', {
      anchor: { path: [0, 'text'], offset: 5 },
      focus: { path: [0, 'text'], offset: 14 }
    }, '', () => Promise.resolve(bindings))).resolves.toMatchObject({ revision: 2 })
    expect(submissions).toEqual([{
      kind: 'author',
      form: 'highlight',
      range: { start: 5, end: 14 },
      text: '',
      projections: []
    }])
    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'See [important][ref].[^n]' }],
      doc: [{ name: 'paragraph', text: 'changed' }],
      op: [[0, 'text', { es: [{ d: 'See [important][ref].[^n]' }, 'changed'] }]]
    })).toBe('unsupported')
  })

  it('holds save settlement through IME and submits only the committed text', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    let release: ((outcome: EditorCoreApplyOutcome) => void) | undefined
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'ime.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: new Promise<EditorCoreApplyOutcome>(resolve => {
            release = resolve
          })
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)

    adapter.compositionStart()
    const saveBarrier = adapter.settled()
    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'paragraph', text: 'seed日本' }],
      op: [0, 'text', { es: [4, '日本'] }]
    })).toBe('accepted')
    expect(submissions).toEqual([])

    const ending = adapter.compositionEnd()
    await Promise.resolve()
    expect(submissions).toEqual([{
      edits: [{ start: 4, end: 4, insert: '日本' }],
      projections: []
    }])
    release?.(applied(2, { start: 4, end: 4, insert: '日本' }))

    await expect(ending).resolves.toBeUndefined()
    await expect(saveBarrier).resolves.toBeUndefined()
  })

  it('submits one native paragraph-to-math-block replacement exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        if (!('edits' in input)) throw new Error('Expected a source-edit submission')
        const edit = input.edits[0]
        if (edit === undefined) throw new Error('Expected one exact source edit')
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'math.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, edit))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'math-block', text: '', meta: { mathStyle: '' } }],
      op: [0, {
        r: true,
        i: { name: 'math-block', text: '', meta: { mathStyle: '' } }
      }]
    })).toBe('accepted')
    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'math-block', text: '', meta: { mathStyle: '' } }],
      doc: [{ name: 'math-block', text: 'x^2', meta: { mathStyle: '' } }],
      op: [0, 'text', { es: ['x^2'] }]
    })).toBe('accepted')
    await adapter.settled()

    expect(submissions).toEqual([
      {
        edits: [{ start: 0, end: 4, insert: '$$\n\n$$' }],
        projections: []
      },
      {
        edits: [{ start: 3, end: 3, insert: 'x^2' }],
        projections: []
      }
    ])
  })

  it('routes one native paragraph-to-math conversion through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-math.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 0,
            end: 4,
            insert: '{~~seed~>$$\n\n$$~~}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)
    let reconcile = false

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [{ name: 'math-block', text: '', meta: { mathStyle: '' } }],
      op: [0, {
        r: true,
        i: { name: 'math-block', text: '', meta: { mathStyle: '' } }
      }]
    }, () => {
      reconcile = true
      return Promise.resolve(Object.freeze([]))
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(reconcile).toBe(true)
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 0, end: 4 },
      text: '$$\n\n$$',
      projections: []
    }])
  })

  it('submits one native markdown-table paste replacement exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        if (!('edits' in input)) throw new Error('Expected a source-edit submission')
        const edit = input.edits[0]
        if (edit === undefined) throw new Error('Expected one exact source edit')
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'table.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, edit))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)
    const table = {
      name: 'table',
      children: [
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: 'a', meta: { align: 'none' } },
            { name: 'table.cell', text: 'b', meta: { align: 'none' } }
          ]
        },
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: '1', meta: { align: 'none' } },
            { name: 'table.cell', text: '2', meta: { align: 'none' } }
          ]
        }
      ]
    }

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [table],
      op: [0, { r: true, i: table }]
    })).toBe('accepted')
    await adapter.settled()

    expect(submissions).toEqual([{
      edits: [{
        start: 0,
        end: 4,
        insert: '| a   | b   |\n| --- | --- |\n| 1   | 2   |'
      }],
      projections: []
    }])
  })

  it('routes one native markdown-table paste through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-table.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 0,
            end: 4,
            insert: '{~~seed~>| a   | b   |\n| --- | --- |\n| 1   | 2   |~~}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 4 }),
      text: 'seed'
    }]), binding)
    const table = {
      name: 'table',
      children: [
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: 'a', meta: { align: 'none' } },
            { name: 'table.cell', text: 'b', meta: { align: 'none' } }
          ]
        },
        {
          name: 'table.row',
          children: [
            { name: 'table.cell', text: '1', meta: { align: 'none' } },
            { name: 'table.cell', text: '2', meta: { align: 'none' } }
          ]
        }
      ]
    }

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'seed' }],
      doc: [table],
      op: [0, { r: true, i: table }]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 0, end: 4 },
      text: '| a   | b   |\n| --- | --- |\n| 1   | 2   |',
      projections: []
    }])
  })

  it('routes one native two-paragraph paste through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-plain-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 3,
            end: 3,
            insert: '{++one\n\ntwo++}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 6 }),
      text: 'foobar'
    }]), binding)
    let reconcile = false

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'foobar' }],
      doc: [
        { name: 'paragraph', text: 'fooone' },
        { name: 'paragraph', text: 'twobar' }
      ],
      op: [
        [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
        [1, { i: { name: 'paragraph', text: 'twobar' } }]
      ]
    }, () => {
      reconcile = true
      return Promise.resolve(Object.freeze([]))
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(reconcile).toBe(true)
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 3, end: 3 },
      text: 'one\n\ntwo',
      projections: []
    }])
  })

  it('routes one native three-paragraph paste through Track Changes', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'track-three-paragraph-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 3,
            end: 3,
            insert: '{++one\n\ntwo\n\nthree++}'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 6 }),
      text: 'foobar'
    }]), binding)

    expect(adapter.acceptTracked({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'foobar' }],
      doc: [
        { name: 'paragraph', text: 'fooone' },
        { name: 'paragraph', text: 'two' },
        { name: 'paragraph', text: 'threebar' }
      ],
      op: [
        [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
        [1, { i: { name: 'paragraph', text: 'two' } }],
        [2, { i: { name: 'paragraph', text: 'threebar' } }]
      ]
    }, () => Promise.resolve(Object.freeze([])))).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()
    expect(submissions).toEqual([{
      kind: 'track',
      range: { start: 3, end: 3 },
      text: 'one\n\ntwo\n\nthree',
      projections: []
    }])
  })

  it('submits one native two-paragraph paste exactly', async() => {
    const submissions: EditorCoreSubmitInput[] = []
    const binding = {
      submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
        submissions.push(structuredClone(input))
        return Object.freeze({
          identity: Object.freeze({
            documentId: 'plain-paste.md',
            generation: 1,
            transactionId: 1
          }),
          acknowledged: Promise.resolve(applied(2, {
            start: 3,
            end: 3,
            insert: 'one\n\ntwo'
          }))
        })
      }
    } as Pick<EditorCoreBinding, 'submit'>
    const adapter = createMuyaPlainTextCoreAdapter(Object.freeze([{
      path: Object.freeze([0, 'text'] as const),
      sourceRange: Object.freeze({ start: 0, end: 6 }),
      text: 'foobar'
    }]), binding)

    expect(adapter.accept({
      source: 'user',
      prevDoc: [{ name: 'paragraph', text: 'foobar' }],
      doc: [
        { name: 'paragraph', text: 'fooone' },
        { name: 'paragraph', text: 'twobar' }
      ],
      op: [
        [0, 'text', { es: [3, { d: 'bar' }, 'one'] }],
        [1, { i: { name: 'paragraph', text: 'twobar' } }]
      ]
    })).toBe('accepted')
    await expect(adapter.settled()).resolves.toBeUndefined()

    expect(submissions).toEqual([{
      edits: [{ start: 3, end: 3, insert: 'one\n\ntwo' }],
      projections: []
    }])
  })
})
