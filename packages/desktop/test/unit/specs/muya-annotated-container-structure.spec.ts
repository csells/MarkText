// @vitest-environment jsdom
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { tableModelCommand, tableSelection, tableInputOptions } from '../helpers/tableModelCommand'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

const nativeListTab = (app: ReturnType<typeof bootBoundMuya>, shift = false) => {
  const block = shift
    ? app.muya.editor.selection.getSelection()?.anchor.block
    : app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
  if (!block) throw new Error('Expected target list paragraph')
  block.setCursor(2, 2, true)
  block.domNode.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
  )
  expect(app.legacyChanges).toEqual([])
}

it.each(['\n', '\r\n', '\r'])(
  'inserts a table row without rewriting existing annotations or lines (%j)',
  async(eol) => {
    const source = `| col |${eol}| --- |${eol}| {++cell++}{>>keep note<<} |${eol}`
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'annotated-table.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          1,
          0,
          { command: 'insertTableRow', placement: 'after' },
          reconcile,
          false
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      const inserted = await binding.sourceAtBarrier()
      expect(inserted).toMatchObject({
        source: source.slice(0, -eol.length) + `${eol}|     |${eol}`
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each([false, true])(
  'preserves queued input after a compound column insertion with tracked=%s',
  async(tracked) => {
    const source = '| col |\n| --- |\n| {++cell++}{>>note<<} |\n'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'queued-column.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: Array<{ name: string; text: string; meta: { align: string } }> }>
    }>
    for (const row of after[0].children) { row.children.push({ name: 'table.cell', text: '', meta: { align: 'none' } }) }
    const typed = structuredClone(after)
    typed[0].children[1].children[1].text = 'X'
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          0,
          0,
          { command: 'insertTableColumn', placement: 'after' },
          reconcile,
          tracked
        )
      ).toEqual({ accepted: true, changed: true })
      const selection = tableSelection(view(), 1, 1)
      expect(
        adapter.input(
          {
            range: selection,
            selection,
            inputType: 'insertText',
            data: 'X',
            options: tableInputOptions
          },
          reconcile,
          tracked
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      const result = view()
      expect(result.state).toEqual(typed)
      const saved = await binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected source')
      expect(saved.source).toContain('{>>note<<}')
      expect(saved.source).toContain('X')
      await adapter.history('undo', reconcile)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each(
  ['\n', '\r\n', '\r'].flatMap((eol) => [false, true].map((multiline) => ({ eol, multiline })))
)(
  'indents a list item with multiline=$multiline and EOL=$eol while retaining annotations',
  async({ eol, multiline }) => {
    const source = `- {++first++}{>>keep note<<}${eol}- second${multiline ? `${eol}  continued` : ''}${eol}`
    const app = bootBoundMuya(source)
    const { binding, adapter, reconcile } = app
    try {
      nativeListTab(app)
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: source
          .replace(`${eol}- second`, `${eol}  - second`)
          .replace(`${eol}  continued`, `${eol}    continued`)
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

// New columns use the shared native serializer's padding and parser-owned slots.
// Existing cells, independent annotations and line endings retain exact bytes.
it.each([0, 1].flatMap((column) => [false, true].map((tracked) => ({ column, tracked }))))(
  'inserts table column $column with tracked=$tracked without rewriting annotated cells',
  async({ column, tracked }) => {
    const source = '| col |\r\n| :--- |\r\n| {++cell++}{>>keep note<<} |\r\n'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'annotated-column.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          0,
          0,
          { command: 'insertTableColumn', placement: column === 0 ? 'before' : 'after' },
          reconcile,
          tracked
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      if (tracked) {
        const result = await binding.sourceAtBarrier()
        expect(result).toMatchObject({ type: 'source' })
        if (result.type !== 'source') throw new Error('Expected source')
        expect(result.source).toBe(
          column === 0
            ? '|{++     |++} col |\r\n|{++ --- |++} :--- |\r\n|{++     |++} {++cell++}{>>keep note<<} |\r\n'
            : '| col {++|     ++}|\r\n| :--- {++| --- ++}|\r\n| {++cell++}{>>keep note<<} {++|     ++}|\r\n'
        )
      } else {
        expect(await binding.sourceAtBarrier()).toMatchObject({
          source:
            column === 0
              ? '|     | col |\r\n| --- | :--- |\r\n|     | {++cell++}{>>keep note<<} |\r\n'
              : '| col |     |\r\n| :--- | --- |\r\n| {++cell++}{>>keep note<<} |     |\r\n'
        })
      }
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each([false, true])(
  'retains sparse column edits immediately after undo with tracked=%s',
  async(tracked) => {
    const source = '| col |\n| --- |\n| {++cell++}{>>note<<} |\n'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'undo-column.md', source })
    await binding.submit({ edits: [{ start: 0, end: 0, insert: 'preface\n\n' }], projections: [] })
      .acknowledged
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const history = adapter.history('undo', reconcile)
    // Undo has already published the new model and view. The next native action
    // uses that domain in the same task, without awaiting the history promise.
    const current = view()
    try {
      expect(
        tableModelCommand(
          adapter,
          current,
          0,
          0,
          { command: 'insertTableColumn', placement: 'after' },
          reconcile,
          tracked
        )
      ).toEqual({ accepted: true, changed: true })
      await history
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: tracked
          ? '| col {++|     ++}|\n| --- {++| --- ++}|\n| {++cell++}{>>note<<} {++|     ++}|\n'
          : '| col |     |\n| --- | --- |\n| {++cell++}{>>note<<} |     |\n'
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      history.catch(() => {})
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each([false, true])(
  'changes annotated table alignment without rewriting its cells with tracked=%s',
  async(tracked) => {
    const source = '| col |\n| ---- |\n| {++cell++}{>>note<<} |\n'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'align-table.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: Array<{ meta: { align: string } }> }>
    }>
    for (const row of after[0].children) row.children[0].meta.align = 'center'
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          0,
          0,
          { command: 'alignTableColumn', alignment: 'center' },
          reconcile,
          tracked
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: tracked
          ? '| col |\n| {++:++}----{++:++} |\n| {++cell++}{>>note<<} |\n'
          : '| col |\n| :----: |\n| {++cell++}{>>note<<} |\n'
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each(['\n', '\r\n', '\r'])(
  'removes a body row while preserving surviving annotated cells (%j)',
  async(eol) => {
    const source = `| col |${eol}| --- |${eol}| {++cell++}{>>note<<} |${eol}| remove |${eol}`
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'remove-row.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{ children: unknown[] }>
    after[0].children.pop()
    try {
      expect(
        tableModelCommand(adapter, initial, 2, 0, { command: 'removeTableRow' }, reconcile, false)
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: `| col |${eol}| --- |${eol}| {++cell++}{>>note<<} |${eol}`
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it.each([0, 1])(
  'removes annotated table column %s without rewriting surviving cells',
  async(column) => {
    const source = '| first | second |\r\n| :--- | ---: |\r\n| {++cell++}{>>note<<} | remove |\r\n'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    await binding.open({ documentId: 'remove-column.md', source })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
      return reply.view
    }
    const initial = view()
    const reconcile = () => view().bindings
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: unknown[] }>
    }>
    for (const row of after[0].children) row.children.splice(column, 1)
    try {
      expect(
        tableModelCommand(
          adapter,
          initial,
          0,
          column,
          { command: 'removeTableColumn' },
          reconcile,
          false
        )
      ).toEqual({ accepted: true, changed: true })
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source:
          column === 0
            ? '| second |\r\n| ---: |\r\n| remove |\r\n'
            : '| first |\r\n| :--- |\r\n| {++cell++}{>>note<<} |\r\n'
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it('removes a header row while retaining the new annotated header and delimiter spelling', async() => {
  const source = '| heading |\n| :---- |\n| {++cell++}{>>note<<} |\n| body |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({ documentId: 'remove-header.md', source })
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
    return reply.view
  }
  const initial = view()
  const reconcile = () => view().bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: unknown[] }>
  after[0].children.shift()
  try {
    expect(
      tableModelCommand(adapter, initial, 0, 0, { command: 'removeTableRow' }, reconcile, false)
    ).toEqual({ accepted: true, changed: true })
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: '| {++cell++}{>>note<<} |\n| :---- |\n| body |\n'
    })
    expect(view().state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('indents a mixed-content list item while retaining its fenced code and annotations', async() => {
  const source = '- {++first++}{>>note<<}\n- second\n\n  ```js\n  const n = 1\n  ```\n'
  const app = bootBoundMuya(source)
  const { binding, adapter, reconcile } = app
  try {
    nativeListTab(app)
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: '- {++first++}{>>note<<}\n  - second\n\n    ```js\n    const n = 1\n    ```\n'
    })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it('tracks column removal and keeps the surviving annotated cell editable', async() => {
  const source = '| first | second |\n| :--- | ---: |\n| {++cell++}{>>note<<} | remove |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({ documentId: 'track-remove-column.md', source })
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected native view') }
    return reply.view
  }
  const initial = view()
  const reconcile = () => view().bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  try {
    expect(
      tableModelCommand(adapter, initial, 0, 1, { command: 'removeTableColumn' }, reconcile, true)
    ).toEqual({ accepted: true, changed: true })
    await adapter.settled()
    const removed =
      '| first {--| second --}|\n| :--- {--| ---: --}|\n| {++cell++}{>>note<<} {--| remove --}|\n'
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: removed })
    // Cell selections use canonical cell offsets, including the addition opener.
    const selection = tableSelection(view(), 1, 0, 7)
    expect(
      adapter.input(
        {
          range: selection,
          selection,
          inputType: 'insertText',
          data: '!',
          options: tableInputOptions
        },
        reconcile,
        true
      )
    ).toEqual({ accepted: true, changed: true })
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: removed.replace('{++cell++}', '{++cell!++}')
    })
    await adapter.history('undo', reconcile)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each(
  [
    { kind: 'thematic break', body: '  ***\n', indented: '    ***\n' },
    {
      kind: 'diagram',
      body: '  ```mermaid\n  graph LR; A-->B\n  ```\n',
      indented: '    ```mermaid\n    graph LR; A-->B\n    ```\n'
    },
    {
      kind: 'blockquote',
      body: '  > quoted\n  > continued\n',
      indented: '    > quoted\n    > continued\n'
    },
    {
      kind: 'table',
      body: '  | a | b |\n  | --- | :--- |\n  | x | y |\n',
      indented: '    | a | b |\n    | --- | :--- |\n    | x | y |\n'
    },
    {
      kind: 'HTML block',
      body: '  <div>\n  literal {++text++}\n  </div>\n',
      indented: '    <div>\n    literal {++text++}\n    </div>\n'
    },
    { kind: 'ATX heading', body: '  ## Section\n', indented: '    ## Section\n' },
    {
      kind: 'setext heading',
      body: '  Section\n  -------\n',
      indented: '    Section\n    -------\n'
    },
    { kind: 'math block', body: '  $$\n  x = 1\n  $$\n', indented: '    $$\n    x = 1\n    $$\n' }
  ].flatMap((entry) => ['\n', '\r\n', '\r'].map((eol) => ({ ...entry, eol })))
)(
  'indents and outdents a list item containing $kind with EOL=$eol while retaining source and annotations',
  async({ kind, body, indented, eol }) => {
    const source = ('- {++first++}{>>note<<}\n- second\n\n' + body).replaceAll('\n', eol)
    const nestedSource = ('- {++first++}{>>note<<}\n  - second\n\n' + indented).replaceAll(
      '\n',
      eol
    )
    const app = bootBoundMuya(source)
    const { binding, adapter, reconcile } = app
    const view = app.view
    const initial = view()
    if (kind === 'table') {
      expect(initial.state).toMatchObject([
        { children: [{}, { children: [{ name: 'paragraph' }, { name: 'table' }] }] }
      ])
    }
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ children: unknown[] }>
    }>
    const second = after[0].children.splice(1, 1)[0]
    after[0].children[0].children.push({
      name: 'bullet-list',
      meta: { marker: '-', loose: true },
      children: [second]
    })
    try {
      nativeListTab(app)
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: nestedSource })
      expect(view().state).toEqual([{ ...after[0], meta: { marker: '-', loose: false } }])
      nativeListTab(app, true)
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: nestedSource })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)
