import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each(['\n', '\r\n', '\r'])('inserts a table row without rewriting existing annotations or lines (%j)', async eol => {
  const source = `| col |${eol}| --- |${eol}| {++cell++}{>>keep note<<} |${eol}`
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'annotated-table.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const row = { name: 'table.row', children: [{ name: 'table.cell', text: '', meta: { align: 'none' } }] }
  const after = structuredClone(initial.state) as unknown as Array<{ children: unknown[] }>
  after[0].children.push(row)
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, 'children', 2, { i: row }] })).toBe('accepted')
    await adapter.settled()
    const inserted = await binding.sourceAtBarrier()
    expect(inserted).toMatchObject({ source: source.slice(0, -eol.length) + `${eol}|     |${eol}` })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each([false, true])('preserves queued input after a compound column insertion with tracked=%s', async tracked => {
  const source = '| col |\n| --- |\n| {++cell++}{>>note<<} |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'queued-column.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: Array<{ name: string, text: string, meta: { align: string } }> }> }>
  for (const row of after[0].children) row.children.push({ name: 'table.cell', text: '', meta: { align: 'none' } })
  const typed = structuredClone(after)
  typed[0].children[1].children[1].text = 'X'
  const changes = [
    { source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] },
    { source: 'user', prevDoc: after, doc: typed, op: [0, 'children', 1, 'children', 1, 'text', { es: ['X'] }] }
  ]
  try {
    for (const change of changes) expect(tracked ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)).toBe('accepted')
    await adapter.settled()
    const result = await view()
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
})

it.each(['\n', '\r\n', '\r'].flatMap(eol => [false, true].map(multiline => ({ eol, multiline }))))('indents a list item with multiline=$multiline and EOL=$eol while retaining annotations', async({ eol, multiline }) => {
  const source = `- {++first++}{>>keep note<<}${eol}- second${multiline ? `${eol}  continued` : ''}${eol}`
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'annotated-list.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: unknown[] }> }>
  const second = after[0].children.splice(1, 1)[0]
  after[0].children[0].children.push({ name: 'bullet-list', meta: { marker: '-', loose: false }, children: [second] })
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: source.replace(`${eol}- second`, `${eol}  - second`).replace(`${eol}  continued`, `${eol}    continued`) })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each([0, 1].flatMap(column => [false, true].map(tracked => ({ column, tracked }))))('inserts table column $column with tracked=$tracked without rewriting annotated cells', async({ column, tracked }) => {
  const source = '| col |\r\n| :--- |\r\n| {++cell++}{>>keep note<<} |\r\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'annotated-column.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: unknown[] }> }>
  const cell = { name: 'table.cell', text: '', meta: { align: 'none' } }
  for (const row of after[0].children) row.children.splice(column, 0, structuredClone(cell))
  try {
    const change = { source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] }
    expect(tracked ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)).toBe('accepted')
    await adapter.settled()
    if (tracked) {
      const result = await binding.sourceAtBarrier()
      expect(result).toMatchObject({ type: 'source' })
      if (result.type !== 'source') throw new Error('Expected source')
      expect(result.source).toBe(column === 0
        ? '| {++ | ++}col |\r\n| {++--- | ++}:--- |\r\n| {++ | cell++}{>>keep note<<} |\r\n'
        : '| col{++ | ++} |\r\n| :---{++ | ---++} |\r\n| {++cell++}{>>keep note<<}{++ | ++} |\r\n')
    } else {
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: column === 0
          ? '|  | col |\r\n| --- | :--- |\r\n|  | {++cell++}{>>keep note<<} |\r\n'
          : '| col |  |\r\n| :--- | --- |\r\n| {++cell++}{>>keep note<<} |  |\r\n'
      })
    }
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each([false, true])('retains sparse column edits across a pending undo with tracked=%s', async tracked => {
  const source = '| col |\n| --- |\n| {++cell++}{>>note<<} |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'undo-column.md', source })
  await binding.submit({ edits: [{ start: 0, end: 0, insert: 'preface\n\n' }], projections: [] }).acknowledged
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children?: Array<{ children: unknown[] }> }>
  for (const row of after[1].children!) row.children.push({ name: 'table.cell', text: '', meta: { align: 'none' } })
  const history = adapter.history('undo', reconcile)
  try {
    const change = { source: 'user', prevDoc: initial.state, doc: after, op: [1, { r: true, i: after[1] }] }
    expect(tracked ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)).toBe('accepted')
    await history
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: tracked
        ? '| col{++ | ++} |\n| ---{++ | ---++} |\n| {++cell++}{>>note<<}{++ | ++} |\n'
        : '| col |  |\n| --- | --- |\n| {++cell++}{>>note<<} |  |\n'
    })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    history.catch(() => {})
    adapter.dispose()
    binding.dispose()
  }
})

it.each([false, true])('changes annotated table alignment without rewriting its cells with tracked=%s', async tracked => {
  const source = '| col |\n| ---- |\n| {++cell++}{>>note<<} |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'align-table.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: Array<{ meta: { align: string } }> }> }>
  for (const row of after[0].children) row.children[0].meta.align = 'center'
  try {
    const change = { source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] }
    expect(tracked ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: tracked
        ? '| col |\n| {++:++}----{++:++} |\n| {++cell++}{>>note<<} |\n'
        : '| col |\n| :----: |\n| {++cell++}{>>note<<} |\n'
    })
    expect((await view()).state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each(['\n', '\r\n', '\r'])('removes a body row while preserving surviving annotated cells (%j)', async eol => {
  const source = `| col |${eol}| --- |${eol}| {++cell++}{>>note<<} |${eol}| remove |${eol}`
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'remove-row.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: unknown[] }>
  after[0].children.pop()
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, 'children', 2, { r: true }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `| col |${eol}| --- |${eol}| {++cell++}{>>note<<} |${eol}` })
    expect((await view()).state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each([0, 1])('removes annotated table column %s without rewriting surviving cells', async column => {
  const source = '| first | second |\r\n| :--- | ---: |\r\n| {++cell++}{>>note<<} | remove |\r\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'remove-column.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: unknown[] }> }>
  for (const row of after[0].children) row.children.splice(column, 1)
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: column === 0
        ? '| second |\r\n| ---: |\r\n| remove |\r\n'
        : '| first |\r\n| :--- |\r\n| {++cell++}{>>note<<} |\r\n'
    })
    expect((await view()).state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('removes a header row while retaining the new annotated header and delimiter spelling', async() => {
  const source = '| heading |\n| :---- |\n| {++cell++}{>>note<<} |\n| body |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'remove-header.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: unknown[] }>
  after[0].children.shift()
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, 'children', 0, { r: true }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '| {++cell++}{>>note<<} |\n| :---- |\n| body |\n' })
    expect((await view()).state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('indents a mixed-content list item while retaining its fenced code and annotations', async() => {
  const source = '- {++first++}{>>note<<}\n- second\n\n  ```js\n  const n = 1\n  ```\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'mixed-list.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: unknown[] }> }>
  const second = after[0].children.splice(1, 1)[0]
  after[0].children[0].children.push({ name: 'bullet-list', meta: { marker: '-', loose: true }, children: [second] })
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: '- {++first++}{>>note<<}\n  - second\n\n    ```js\n    const n = 1\n    ```\n' })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('tracks column removal and keeps the surviving annotated cell editable', async() => {
  const source = '| first | second |\n| :--- | ---: |\n| {++cell++}{>>note<<} | remove |\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'track-remove-column.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  type TableState = Array<{ children: Array<{ children: Array<{ text: string }> }> }>
  const after = structuredClone(initial.state) as unknown as TableState
  for (const row of after[0].children) row.children.pop()
  try {
    expect(adapter.acceptTracked({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] }, reconcile)).toBe('accepted')
    await adapter.settled()
    const removed = '| first{-- | second--} |\n| :---{-- | ---:--} |\n| {++cell++}{>>note<<}{-- | remove--} |\n'
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: removed })
    const shown = (await view()).state
    const typed = structuredClone(shown) as unknown as TableState
    typed[0].children[1].children[0].text += '!'
    expect(adapter.acceptTracked({ source: 'user', prevDoc: shown, doc: typed, op: [0, 'children', 1, 'children', 0, 'text', { es: [4, '!'] }] }, reconcile)).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: removed.replace('{++cell++}', '{++cell!++}') })
    await adapter.history('undo', reconcile)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it.each([
  { kind: 'thematic break', body: '  ***\n', indented: '    ***\n' },
  { kind: 'diagram', body: '  ```mermaid\n  graph LR; A-->B\n  ```\n', indented: '    ```mermaid\n    graph LR; A-->B\n    ```\n' },
  { kind: 'blockquote', body: '  > quoted\n  > continued\n', indented: '    > quoted\n    > continued\n' },
  { kind: 'table', body: '  | a | b |\n  | --- | :--- |\n  | x | y |\n', indented: '    | a | b |\n    | --- | :--- |\n    | x | y |\n' },
  { kind: 'HTML block', body: '  <div>\n  literal {++text++}\n  </div>\n', indented: '    <div>\n    literal {++text++}\n    </div>\n' },
  { kind: 'ATX heading', body: '  ## Section\n', indented: '    ## Section\n' },
  { kind: 'setext heading', body: '  Section\n  -------\n', indented: '    Section\n    -------\n' },
  { kind: 'math block', body: '  $$\n  x = 1\n  $$\n', indented: '    $$\n    x = 1\n    $$\n' }
].flatMap(entry => ['\n', '\r\n', '\r'].map(eol => ({ ...entry, eol }))))('indents and outdents a list item containing $kind with EOL=$eol while retaining source and annotations', async({ kind, body, indented, eol }) => {
  const source = ('- {++first++}{>>note<<}\n- second\n\n' + body).replaceAll('\n', eol)
  const nestedSource = ('- {++first++}{>>note<<}\n  - second\n\n' + indented).replaceAll('\n', eol)
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'mixed-list.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  if (kind === 'table') expect(initial.state).toMatchObject([{ children: [{}, { children: [{ name: 'paragraph' }, { name: 'table' }] }] }])
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ children: unknown[] }> }>
  const second = after[0].children.splice(1, 1)[0]
  after[0].children[0].children.push({ name: 'bullet-list', meta: { marker: '-', loose: true }, children: [second] })
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: nestedSource })
    expect((await view()).state).toEqual([{ ...after[0], meta: { marker: '-', loose: false } }])
    const nested = await view()
    expect(adapter.accept({ source: 'user', prevDoc: nested.state, doc: initial.state, op: [0, { r: true, i: initial.state[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: nestedSource })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
