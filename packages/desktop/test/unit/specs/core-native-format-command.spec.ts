import { describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

const selectionSet = (anchor: number, focus: number) => ({
  ranges: [{ anchor, focus }],
  primary: 0
})

const formats = [
  { format: 'strong', expected: '**abc**\n', offset: 2 },
  { format: 'em', expected: '*abc*\n', offset: 1 },
  { format: 'del', expected: '~~abc~~\n', offset: 2 },
  { format: 'inline_code', expected: '`abc`\n', offset: 1 }
] as const

describe('first-class model formatting commands', () => {
  it.each(formats)(
    'formats $format synchronously with one undo and redo',
    ({ format, expected, offset }) => {
      const binding = createEditorCoreBinding(createLocalCoreOwner())
      try {
        binding.open({ documentId: 'native-format.md', source: 'abc\n' })
        const result = binding.submit({
          kind: 'format',
          action: { format, selection: selectionSet(0, 3), tracked: false },
          projections: []
        }).acknowledged
        expect(result).toMatchObject({
          type: 'applied',
          formatResult: { selection: selectionSet(offset, 3 + offset) }
        })
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged.type).toBe('applied')
        expect(binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
        expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe('applied')
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        binding.dispose()
      }
    }
  )

  it.each([
    {
      source: 'aaa\n',
      expected: 'a{~~a~>**a**~~}a\n',
      start: 1,
      end: 2,
      selected: { start: 9, end: 10 }
    },
    {
      source: 'a{++a++}a\n',
      expected: 'a{++**a**++}a\n',
      start: 4,
      end: 5,
      selected: { start: 6, end: 7 }
    }
  ])(
    'tracks formatting from $source with the planned selected arm',
    ({ source, expected, start, end, selected }) => {
      const binding = createEditorCoreBinding(createLocalCoreOwner())
      try {
        binding.open({ documentId: 'tracked-format.md', source })
        const result = binding.submit({
          kind: 'format',
          action: { format: 'strong', selection: selectionSet(start, end), tracked: true },
          projections: []
        }).acknowledged
        expect(result).toMatchObject({
          type: 'applied',
          formatResult: { selection: selectionSet(selected.start, selected.end) }
        })
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        binding.submit({ kind: 'undo', projections: [] })
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
        binding.submit({ kind: 'redo', projections: [] })
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        binding.dispose()
      }
    }
  )

  it('accepts a literal-block no-op without creating source history', () => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    try {
      const opened = binding.open({ documentId: 'literal-format.md', source: '```\nabc\n```\n' })
      const result = binding.submit({
        kind: 'format',
        action: { format: 'strong', selection: selectionSet(4, 7), tracked: false },
        projections: []
      }).acknowledged
      expect(result).toMatchObject({
        type: 'applied',
        revision: opened.revision,
        formatResult: { selection: selectionSet(4, 7) }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: '```\nabc\n```\n',
        recoveryHistory: { undo: [], redo: [] }
      })
    } finally {
      binding.dispose()
    }
  })

  it('rejects an invalid selection without changing source/history', () => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    try {
      binding.open({ documentId: 'invalid-format.md', source: 'abc\n' })
      const result = binding.submit({
        kind: 'format',
        action: { format: 'strong', selection: selectionSet(0, 40), tracked: false },
        projections: []
      }).acknowledged
      expect(result).toMatchObject({ type: 'rejected', reason: 'author-invalid' })
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: 'abc\n',
        recoveryHistory: { undo: [], redo: [] }
      })
    } finally {
      binding.dispose()
    }
  })

  it('journals and recovers the accepted formatting operation', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
    })
    await manager.open({ documentId: 'format-recovery.md', source: 'abc\n', lineEnding: '\n' })
    let lease = manager.lease('format-recovery.md')
    try {
      const action = { format: 'strong' as const, selection: selectionSet(0, 3), tracked: false }
      expect(
        lease.binding.submit({ kind: 'format', action, projections: [] }).acknowledged.type
      ).toBe('applied')
      action.selection.ranges[0].focus = 40
      lease.faultView(new Error('Disconnected native view'))
      lease = await manager.recover(lease)
      expect(await manager.saveBarrier('format-recovery.md')).toMatchObject({ source: '**abc**\n' })
      expect(lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged.type).toBe(
        'applied'
      )
      expect(await manager.saveBarrier('format-recovery.md')).toMatchObject({ source: 'abc\n' })
    } finally {
      await manager.handoff(lease)
      await manager.close('format-recovery.md')
    }
  })
})

it('recovers an image property command and its actual selection without sharing mutable request data', async() => {
  const source = '![a](old.png) text\n'
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  await manager.open({ documentId: 'image-properties.md', source, lineEnding: '\n' })
  let lease = manager.lease('image-properties.md')
  try {
    const action = {
      format: 'image-properties' as const,
      selection: { start: 0, end: 13 },
      currentSelection: selectionSet(15, 17),
      properties: { alt: 'a', src: 'new-file.png', title: '' },
      tracked: false
    }
    expect(
      lease.binding.submit({ kind: 'format', action, projections: [] }).acknowledged
    ).toMatchObject({
      type: 'applied',
      formatResult: { selection: selectionSet(20, 22) }
    })
    action.properties.src = 'mutated-after-admission.png'
    action.currentSelection.ranges[0].anchor = 0
    lease.faultView(new Error('Image presentation disconnected'))
    lease = await manager.recover(lease)
    expect(await manager.saveBarrier('image-properties.md')).toMatchObject({
      source: '![a](new-file.png) text\n'
    })
    expect(lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
      type: 'applied',
      historyResult: { selection: { ranges: [{ anchor: 15, focus: 17 }], primary: 0 } }
    })
    expect(await manager.saveBarrier('image-properties.md')).toMatchObject({ source })
    expect(lease.binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
      type: 'applied',
      historyResult: { selection: { ranges: [{ anchor: 20, focus: 22 }], primary: 0 } }
    })
  } finally {
    await manager.handoff(lease)
    await manager.close('image-properties.md')
  }
})
