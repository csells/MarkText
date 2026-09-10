import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner, type CoreModelTestControl } from '@/documentAuthority/localCoreOwner'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

describe('synchronous document model authority', () => {
  it('publishes the actual input result and revision before the next action in the same task', () => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    try {
      const opened = binding.open({ documentId: 'same-task.md', source: 'seed' })
      expect(opened).toMatchObject({ type: 'opened' })
      const observed: number[] = []
      binding.observe((event) => {
        observed.push(event.outcome.revision)
      })
      const first = binding.submit({
        kind: 'input',
        action: {
          range: { start: 4, end: 4 },
          selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 },
          data: ' ',
          inputType: 'insertText',
          options
        },
        tracked: false,
        projections: []
      })
      expect(first.acknowledged).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 } }
      })
      const second = binding.submit({
        kind: 'input',
        action: {
          range: { start: 5, end: 5 },
          selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 },
          data: '*',
          inputType: 'insertText',
          options
        },
        tracked: false,
        projections: []
      })
      expect(second.acknowledged).toMatchObject({
        type: 'applied',
        inputResult: { selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 } }
      })
      expect(observed).toEqual([opened.revision + 1, opened.revision + 2])
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed **' })
    } finally {
      binding.dispose()
    }
  })
})

it('faults the same model once and prevents further reads or mutations', () => {
  let control: CoreModelTestControl | undefined
  const failures: Error[] = []
  const binding = createEditorCoreBinding(
    createLocalCoreOwner({
      registerTestControl: (value) => {
        control = value
      },
      onFailure: (error) => {
        failures.push(error)
      }
    })
  )
  binding.open({ documentId: 'crash.md', source: 'seed' })
  control?.crash()
  control?.crash()
  expect(failures).toHaveLength(1)
  expect(() => binding.sourceAtBarrier()).toThrow('Core model was terminated')
  expect(() =>
    binding.submit({ edits: [{ start: 4, end: 4, insert: 'x' }], projections: [] })
  ).toThrow('Core model was terminated')
  binding.dispose()
  expect(() => binding.sourceAtBarrier()).toThrow('disposed')
})

it('rejects a stale actual input without applying it and requires reconciliation immediately', () => {
  let control: CoreModelTestControl | undefined
  const binding = createEditorCoreBinding(
    createLocalCoreOwner({
      registerTestControl: (value) => {
        control = value
      }
    })
  )
  try {
    binding.open({ documentId: 'stale.md', source: 'seed' })
    control?.staleNextTransaction()
    expect(
      binding.submit({
        kind: 'input',
        action: {
          range: { start: 4, end: 4 },
          selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 },
          data: 'x',
          inputType: 'insertText',
          options
        },
        tracked: false,
        projections: []
      }).acknowledged
    ).toMatchObject({ type: 'rejected', reason: 'stale-base' })
    expect(() => binding.sourceAtBarrier()).toThrow('reconciliation is required')
    expect(() => binding.submit({ edits: [], projections: [] })).toThrow(
      'reconciliation is required'
    )
  } finally {
    binding.dispose()
  }
})
