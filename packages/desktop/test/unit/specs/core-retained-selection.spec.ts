import { expect, it } from 'vitest'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

const boot = (source = 'abc\n') => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'prepared.md', source })
  return binding
}
const options = { autoPairBracket: false, autoPairQuote: false, autoPairMarkdownSyntax: false }
const paste = (binding: ReturnType<typeof boot>, target: string, markdown: string) =>
  binding.submit({
    kind: 'apply-prepared',
    target,
    operation: { kind: 'clipboard', action: { kind: 'paste', markdown, tracked: false } },
    projections: []
  }).acknowledged
const retain = (binding: ReturnType<typeof boot>, start: number, end = start) => {
  const reply = binding.retainSelection({ ranges: [{ anchor: start, focus: end }], primary: 0 })
  if (reply.type !== 'retained-selection') throw new Error('Expected retained selection')
  return reply.id
}

it.each([true, false])(
  'preserves preparation order independently of completion order, first=%s',
  (first) => {
    const binding = boot()
    try {
      const a = retain(binding, 1)
      const b = retain(binding, 1)
      binding.submit({
        kind: 'input',
        action: {
          selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
          range: { start: 1, end: 1 },
          inputType: 'insertText',
          data: 'X',
          options
        },
        tracked: false,
        projections: []
      })
      if (first) {
        expect(paste(binding, a, 'P').type).toBe('applied')
        expect(paste(binding, b, 'Q').type).toBe('applied')
      } else {
        expect(paste(binding, b, 'Q').type).toBe('applied')
        expect(paste(binding, a, 'P').type).toBe('applied')
      }
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'aPQXbc\n' })
      expect(paste(binding, a, 'again')).toMatchObject({
        type: 'rejected',
        reason: 'prepared-selection-unavailable'
      })
    } finally {
      binding.dispose()
    }
  }
)

it('refuses an overlapped prepared target without changing source or unrelated handles', () => {
  const binding = boot()
  try {
    const selected = retain(binding, 1, 2)
    const other = retain(binding, 0)
    binding.submit({ edits: [{ start: 1, end: 2, insert: 'X' }], projections: [] })
    expect(binding.retainedSelectionAtBarrier(selected)).toMatchObject({
      status: 'conflict',
      selectionRevision: 1
    })
    expect(paste(binding, selected, 'P')).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-conflict'
    })
    expect(paste(binding, other, 'Q').type).toBe('applied')
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'QaXc\n' })
  } finally {
    binding.dispose()
  }
})

it('does not reuse prepared targets in another document generation', () => {
  const first = boot()
  const second = boot()
  try {
    const target = retain(first, 1)
    retain(second, 1)
    expect(paste(second, target, 'wrong')).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-unavailable'
    })
    expect(second.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
    first.releaseSelection(target)
    first.releaseSelection(target)
    expect(paste(first, target, 'wrong')).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-unavailable'
    })
    expect(first.sourceAtBarrier()).toMatchObject({
      revision: 1,
      recoveryHistory: { undo: [], redo: [] }
    })
  } finally {
    first.dispose()
    second.dispose()
  }
})

it('consumes an accepted empty completion without a revision or history entry', () => {
  const binding = boot()
  try {
    const target = retain(binding, 1)
    expect(paste(binding, target, '')).toMatchObject({
      type: 'applied',
      revision: 1,
      preparedSelection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }
    })
    binding.releaseSelection(target)
    expect(binding.retainedSelectionAtBarrier(target)).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-unavailable'
    })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: 'abc\n',
      revision: 1,
      recoveryHistory: { undo: [], redo: [] }
    })
  } finally {
    binding.dispose()
  }
})

it('bounds retained resources and reuses capacity after cancellation without modifying source', () => {
  const binding = boot()
  try {
    const targets = Array.from({ length: 256 }, () => retain(binding, 1))
    expect(
      binding.retainSelection({ ranges: [{ anchor: 1, focus: 1 }], primary: 0 })
    ).toMatchObject({ type: 'rejected', reason: 'prepared-selection-limit' })
    const first = targets[0]
    if (first === undefined) throw new Error('Expected retained capacity fixture')
    binding.releaseSelection(first)
    expect(
      binding.retainSelection({ ranges: [{ anchor: 1, focus: 1 }], primary: 0 })
    ).toMatchObject({ type: 'retained-selection', status: 'ready' })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: 'abc\n',
      revision: 1,
      recoveryHistory: { undo: [], redo: [] }
    })
  } finally {
    binding.dispose()
  }
})

it('recovers completed preparations as resolved model actions without reviving old handles', async() => {
  let generation = 0
  const replayed: string[] = []
  const manager = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      const currentGeneration = ++generation
      return createEditorCoreBinding({
        request: (request) => {
          if (currentGeneration > 1) replayed.push(request.type)
          return actor.handle(request)
        },
        dispose: () => actor.dispose()
      })
    }
  })
  const documentId = 'prepared-recovery.md'
  await manager.open({ documentId, source: 'abc\n', lineEnding: '\n' })
  let lease = manager.lease(documentId)
  try {
    const emptyTarget = retain(lease.binding, 1)
    expect(paste(lease.binding, emptyTarget, '')).toMatchObject({ type: 'applied', revision: 1 })
    const target = retain(lease.binding, 1)
    expect(
      lease.binding.submit({
        kind: 'input',
        action: {
          selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
          range: { start: 0, end: 0 },
          inputType: 'insertText',
          data: 'X',
          options
        },
        tracked: false,
        projections: []
      }).acknowledged.type
    ).toBe('applied')
    expect(paste(lease.binding, target, 'Q')).toMatchObject({
      type: 'applied',
      preparedSelection: { ranges: [{ anchor: 2, focus: 2 }], primary: 0 }
    })
    lease.faultView(new Error('Presentation disconnected after resource completion'))
    lease = await manager.recover(lease)
    expect(replayed).toContain('input')
    expect(replayed.filter((type) => type === 'clipboard')).toEqual(['clipboard'])
    expect(replayed).not.toContain('apply-prepared')
    expect(lease.binding.retainedSelectionAtBarrier(target)).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-unavailable'
    })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'XaQbc\n' })
    expect(lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged.type).toBe(
      'applied'
    )
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'Xabc\n' })
    expect(lease.binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe(
      'applied'
    )
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'XaQbc\n' })
  } finally {
    await manager.handoff(lease)
    await manager.close(documentId)
  }
})

it('rebases a retained rectangle through preceding edits and restores rectangle history after prepared paste', () => {
  const table = '| a | b |\n| --- | --- |\n| c | d |'
  const source = `before\n\n${table}\n`
  const binding = boot(source)
  const rectangle = {
    kind: 'table' as const,
    table: { start: 8, end: source.length - 1 },
    anchor: { row: 1, column: 0 },
    focus: { row: 1, column: 0 }
  }
  try {
    const retained = binding.retainSelection(rectangle)
    if (retained.type !== 'retained-selection') throw new Error('Expected retained rectangle')
    binding.submit({ edits: [{ start: 0, end: 0, insert: 'X' }], projections: [] })
    const shifted = { ...rectangle, table: { start: 9, end: source.length } }
    expect(binding.retainedSelectionAtBarrier(retained.id)).toMatchObject({
      status: 'ready',
      selection: shifted
    })
    const outcome = binding.submit({
      kind: 'apply-prepared',
      target: retained.id,
      operation: {
        kind: 'clipboard',
        action: { kind: 'table', operation: 'paste', markdown: 'y', tracked: false }
      },
      projections: []
    }).acknowledged
    expect(outcome).toMatchObject({
      type: 'applied',
      preparedSelection: shifted,
      clipboardResult: {
        selection: {
          kind: 'table-cell',
          cell: { table: shifted.table, row: 1, column: 0 },
          anchor: 1,
          focus: 1
        }
      }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: 'Xbefore\n\n| a | b |\n| --- | --- |\n| y | d |\n'
    })
    expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
      type: 'applied',
      historyResult: { selection: shifted }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({ source: `X${source}` })
    expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe('applied')
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: 'Xbefore\n\n| a | b |\n| --- | --- |\n| y | d |\n'
    })
  } finally {
    binding.dispose()
  }
})

it('rejects prepared rectangle paste after its selected cell was replaced', () => {
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  const binding = boot(source)
  try {
    const rectangle = {
      kind: 'table' as const,
      table: { start: 0, end: source.length - 1 },
      anchor: { row: 1, column: 0 },
      focus: { row: 1, column: 0 }
    }
    const retained = binding.retainSelection(rectangle)
    if (retained.type !== 'retained-selection') throw new Error('Expected retained rectangle')
    const at = source.indexOf('c | d')
    binding.submit({ edits: [{ start: at, end: at + 1, insert: 'Z' }], projections: [] })
    expect(binding.retainedSelectionAtBarrier(retained.id)).toMatchObject({ status: 'conflict' })
    expect(
      binding.submit({
        kind: 'apply-prepared',
        target: retained.id,
        operation: {
          kind: 'clipboard',
          action: { kind: 'table', operation: 'paste', markdown: 'y', tracked: false }
        },
        projections: []
      }).acknowledged
    ).toMatchObject({ type: 'rejected', reason: 'prepared-selection-conflict' })
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: '| a | b |\n| --- | --- |\n| Z | d |\n'
    })
  } finally {
    binding.dispose()
  }
})

it('replays completed rectangle preparation as its resolved clipboard action after owner recovery', async() => {
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  const completed = '| a | b |\n| --- | --- |\n| y | d |\n'
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  const documentId = 'prepared-table-recovery.md'
  await manager.open({ documentId, source, lineEnding: '\n' })
  let lease = manager.lease(documentId)
  const rectangle = {
    kind: 'table' as const,
    table: { start: 0, end: source.length - 1 },
    anchor: { row: 1, column: 0 },
    focus: { row: 1, column: 0 }
  }
  try {
    const target = lease.binding.retainSelection(rectangle)
    if (target.type !== 'retained-selection') throw new Error('Expected retained rectangle')
    const result = lease.binding.submit({
      kind: 'apply-prepared',
      target: target.id,
      operation: {
        kind: 'clipboard',
        action: { kind: 'table', operation: 'paste', markdown: 'y', tracked: false }
      },
      projections: []
    }).acknowledged
    expect(result).toMatchObject({ type: 'applied', preparedSelection: rectangle })
    lease.faultView(new Error('Presentation disconnected after rectangle completion'))
    lease = await manager.recover(lease)
    expect(lease.binding.retainedSelectionAtBarrier(target.id)).toMatchObject({
      type: 'rejected',
      reason: 'prepared-selection-unavailable'
    })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: completed })
    expect(lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
      type: 'applied',
      historyResult: { selection: rectangle }
    })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source })
    expect(lease.binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe(
      'applied'
    )
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: completed })
  } finally {
    await manager.handoff(lease)
    await manager.close(documentId)
  }
})
