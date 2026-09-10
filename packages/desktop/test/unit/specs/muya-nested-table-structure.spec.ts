import { tableModelCommand } from '../helpers/tableModelCommand'
import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

describe.each(['\n', '\r\n', '\r'])('nested table commands with %j line endings', (ending) => {
  const eol = (text: string): string => text.replaceAll('\n', ending)
  it.each([
    { command: 'remove column', expected: '  | col |\n  | :--- |\n  | cell |\n' },
    {
      command: 'align column',
      expected: '  | col | other |\n  | ---: | --- |\n  | cell | value |\n'
    },
    {
      command: 'insert column',
      expected: '  | col | other |     |\n  | :--- | --- | --- |\n  | cell | value |     |\n'
    }
  ])(
    'runs $command within an annotated list without rewriting its source',
    async({ command, expected }) => {
      const prefix = eol('- {++first++}{>>note<<}\n- second\n\n')
      const source = prefix + eol('  | col | other |\n  | :--- | --- |\n  | cell | value |\n')
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
      await binding.open({ documentId: 'nested-table-columns.md', source })
      const view = () => {
        const reply = binding.plainTextViewAtBarrier()
        if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
        return reply.view
      }
      const initial = view()
      const reconcile = () => view().bindings
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.bindings,
        binding,
        undefined,
        reconcile
      )
      type Table = {
        children: Array<{
          children: Array<{ name: string; text: string; meta: { align: string } }>
        }>
      }
      const after = structuredClone(initial.state) as unknown as Array<{
        children: Array<{ children: Table[] }>
      }>
      for (const row of after[0].children[1].children[1].children) {
        if (command === 'remove column') row.children.pop()
        if (command === 'align column') row.children[0].meta.align = 'right'
        if (command === 'insert column') { row.children.push({ name: 'table.cell', text: '', meta: { align: 'none' } }) }
      }
      try {
        expect(
          tableModelCommand(
            adapter,
            initial,
            0,
            command === 'align column' ? 0 : 1,
            command === 'remove column'
              ? { command: 'removeTableColumn' }
              : command === 'align column'
                ? { command: 'alignTableColumn', alignment: 'right' }
                : { command: 'insertTableColumn', placement: 'after' },
            reconcile
          )
        ).toEqual({ accepted: true, changed: true })
        await adapter.settled()
        expect(await binding.sourceAtBarrier()).toMatchObject({ source: prefix + eol(expected) })
        expect(view().state).toEqual(after)
        await adapter.history('undo', reconcile)
        expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      } finally {
        adapter.dispose()
        binding.dispose()
      }
    }
  )

  it('inserts a row in an annotated list table and restores exact source through undo', async() => {
    const source = eol('- {++first++}{>>note<<}\n- second\n\n  | col |\n  | --- |\n  | cell |\n')
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'nested-table.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: Array<{ children: unknown[] }> }>
    }>
    after[0].children[1].children[1].children.push({
      name: 'table.row',
      children: [{ name: 'table.cell', text: '', meta: { align: 'none' } }]
    })
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          1,
          0,
          { command: 'insertTableRow', placement: 'after' },
          reconcile
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: source + eol('  |     |\n') })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })

  it('removes the last row in an annotated list table and restores exact source through undo', async() => {
    const source = eol('- {++first++}{>>note<<}\n- second\n\n  | col |\n  | --- |\n  | cell |\n')
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'nested-table.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: Array<{ children: unknown[] }> }>
    }>
    after[0].children[1].children[1].children.pop()
    try {
      expect(
        tableModelCommand(adapter, initial, 1, 0, { command: 'removeTableRow' }, reconcile)
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: eol('- {++first++}{>>note<<}\n- second\n\n  | col |\n  | --- |\n')
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })

  it('promotes the body after removing the header in an annotated list table and restores exact source through undo', async() => {
    const source = eol('- {++first++}{>>note<<}\n- second\n\n  | col |\n  | --- |\n  | cell |\n')
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'nested-table.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: Array<{ children: unknown[] }> }>
    }>
    after[0].children[1].children[1].children.shift()
    try {
      expect(
        tableModelCommand(adapter, initial, 0, 0, { command: 'removeTableRow' }, reconcile)
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: eol('- {++first++}{>>note<<}\n- second\n\n  | cell |\n  | --- |\n')
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })
})
